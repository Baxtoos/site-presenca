import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classify,
  flushQueue,
  idbStore,
  markBody,
  type PendingMark,
  type QueueStore,
  resetDbForTests,
  type SendFailure,
} from "./offline-queue";

let n = 0;
function mark(over: Partial<PendingMark> = {}): PendingMark {
  n += 1;
  return {
    key: `chave-${n}`,
    userId: "ana",
    subjectId: "materia-1",
    subjectName: "Física I",
    classDate: "2026-11-18",
    scheduleId: "horario-1",
    status: "absent",
    createdAt: n,
    ...over,
  };
}

class Failure extends Error {
  constructor(readonly failure: SendFailure) {
    super(failure.message);
  }
}
const fail = (status: number, code = `HTTP_${status}`) =>
  new Failure({ status, code, message: `erro ${status}` });
const toFailure = (e: unknown) =>
  e instanceof Failure ? e.failure : { status: 0, code: "NETWORK_ERROR", message: "?" };

let store: QueueStore;
beforeEach(() => {
  resetDbForTests();
  store = idbStore(new IDBFactory());
});

describe("armazenamento no IndexedDB", () => {
  it("guarda, lista em ordem de criação e apaga", async () => {
    const b = mark({ createdAt: 20 });
    const a = mark({ createdAt: 10 });
    await store.put(b);
    await store.put(a);
    expect((await store.all()).map((m) => m.key)).toEqual([a.key, b.key]);
    await store.delete(a.key);
    expect((await store.all()).map((m) => m.key)).toEqual([b.key]);
  });

  it("put com a mesma chave substitui (não duplica)", async () => {
    const a = mark();
    await store.put(a);
    await store.put({ ...a, status: "present" });
    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("present");
  });
});

describe("markBody", () => {
  it("só manda unitsMissed na parcial", () => {
    expect(markBody(mark({ status: "absent", unitsMissed: 1 }))).not.toHaveProperty("unitsMissed");
    expect(markBody(mark({ status: "partial", unitsMissed: 1 }))).toMatchObject({ unitsMissed: 1 });
  });

  it("não vaza campos internos (dono, nome, horário de criação)", () => {
    expect(Object.keys(markBody(mark())).sort()).toEqual(
      ["classDate", "scheduleId", "status", "subjectId"].sort(),
    );
  });
});

describe("classify", () => {
  it.each([
    [{ status: 0, code: "NETWORK_ERROR" }, "network"],
    [{ status: 401, code: "UNAUTHENTICATED" }, "auth"],
    [{ status: 500, code: "HTTP_500" }, "server"],
    [{ status: 503, code: "HTTP_503" }, "server"],
    [{ status: 429, code: "RATE_LIMITED" }, "server"],
    [{ status: 409, code: "ATTENDANCE_CONFLICT" }, "reject"],
    [{ status: 422, code: "IDEMPOTENCY_KEY_REUSED" }, "reject"],
    [{ status: 422, code: "OUT_OF_SEMESTER" }, "reject"],
    [{ status: 404, code: "NOT_FOUND" }, "reject"],
  ] as [Omit<SendFailure, "message">, string][])("%o → %s", (failure, expected) => {
    expect(classify({ ...failure, message: "" })).toBe(expected);
  });
});

describe("flushQueue", () => {
  it("envia tudo em ordem, com a chave de cada marcação, e esvazia a fila", async () => {
    const a = mark();
    const b = mark();
    await store.put(b);
    await store.put(a);
    const send = vi.fn(async (_mark: PendingMark) => undefined);
    const result = await flushQueue(store, "ana", send, toFailure);
    expect(send.mock.calls.map(([m]) => m.key)).toEqual([a.key, b.key]);
    expect(result.sent.map((m) => m.key)).toEqual([a.key, b.key]);
    expect(result.stopped).toBeNull();
    expect(await store.all()).toEqual([]);
  });

  it("sem rede: para na primeira falha e mantém tudo para depois", async () => {
    await store.put(mark());
    await store.put(mark());
    const send = vi.fn(async () => {
      throw fail(0, "NETWORK_ERROR");
    });
    const result = await flushQueue(store, "ana", send, toFailure);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.stopped).toBe("network");
    expect(await store.all()).toHaveLength(2);
  });

  it("sessão expirada ou servidor fora: para e não descarta nada", async () => {
    for (const status of [401, 503]) {
      resetDbForTests();
      store = idbStore(new IDBFactory());
      await store.put(mark());
      const result = await flushQueue(
        store,
        "ana",
        async () => {
          throw fail(status);
        },
        toFailure,
      );
      expect(result.stopped).toBe(status === 401 ? "auth" : "server");
      expect(await store.all()).toHaveLength(1);
    }
  });

  it("recusa definitiva (aula já registrada em outro aparelho) sai da fila e o resto continua", async () => {
    const a = mark();
    const b = mark();
    await store.put(a);
    await store.put(b);
    const send = vi.fn(async (m: PendingMark) => {
      if (m.key === a.key) throw fail(409, "ATTENDANCE_CONFLICT");
    });
    const result = await flushQueue(store, "ana", send, toFailure);
    expect(result.rejected.map((r) => r.mark.key)).toEqual([a.key]);
    expect(result.sent.map((m) => m.key)).toEqual([b.key]);
    expect(await store.all()).toEqual([]);
  });

  it("parte enviada antes de a rede cair não é reenviada; o resto fica", async () => {
    const a = mark();
    const b = mark();
    const c = mark();
    for (const m of [a, b, c]) await store.put(m);
    const send = vi.fn(async (m: PendingMark) => {
      if (m.key === b.key) throw fail(0, "NETWORK_ERROR");
    });
    const result = await flushQueue(store, "ana", send, toFailure);
    expect(result.sent.map((m) => m.key)).toEqual([a.key]);
    expect((await store.all()).map((m) => m.key)).toEqual([b.key, c.key]);
  });

  it("nunca envia marcação de outra pessoa (aparelho compartilhado)", async () => {
    const mine = mark();
    const theirs = mark({ userId: "bruno" });
    await store.put(mine);
    await store.put(theirs);
    const send = vi.fn(async (_mark: PendingMark) => undefined);
    await flushQueue(store, "ana", send, toFailure);
    expect(send.mock.calls.map(([m]) => m.key)).toEqual([mine.key]);
    expect((await store.all()).map((m) => m.key)).toEqual([theirs.key]);
  });
});
