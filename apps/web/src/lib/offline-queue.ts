import type { AttendanceStatus } from "@presenca/contracts";

export interface PendingMark {
  key: string;
  userId: string;
  subjectId: string;
  subjectName: string;
  classDate: string;
  scheduleId: string | null;
  status: AttendanceStatus;
  unitsMissed?: number;
  createdAt: number;
}

export function markBody(mark: PendingMark) {
  return {
    subjectId: mark.subjectId,
    classDate: mark.classDate,
    scheduleId: mark.scheduleId,
    status: mark.status,
    ...(mark.status === "partial" ? { unitsMissed: mark.unitsMissed } : {}),
  };
}

export interface QueueStore {
  all(): Promise<PendingMark[]>;
  put(mark: PendingMark): Promise<void>;
  delete(key: string): Promise<void>;
}

const DB_NAME = "presenca";
const STORE = "pending-marks";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Falha no IndexedDB."));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("userId", "userId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Não foi possível abrir o IndexedDB."));
    };
  });
  return dbPromise;
}

export function resetDbForTests() {
  dbPromise = null;
}

export function idbStore(factory: IDBFactory = indexedDB): QueueStore {
  async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await openDb(factory);
    const tx = db.transaction(STORE, mode);
    const result = await request(fn(tx.objectStore(STORE)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha no IndexedDB."));
      tx.onabort = () => reject(tx.error ?? new Error("Transação do IndexedDB cancelada."));
    });
    return result;
  }
  return {
    all: async () =>
      ((await run("readonly", (s) => s.getAll())) as PendingMark[]).sort(
        (a, b) => a.createdAt - b.createdAt,
      ),
    put: async (mark) => {
      await run("readwrite", (s) => s.put(mark));
    },
    delete: async (key) => {
      await run("readwrite", (s) => s.delete(key));
    },
  };
}

export interface SendFailure {
  status: number;
  code: string;
  message: string;
}

export type StopReason = "network" | "auth" | "server";

export interface FlushResult {
  sent: PendingMark[];
  rejected: { mark: PendingMark; message: string }[];
  stopped: StopReason | null;
}

export function classify(failure: SendFailure): StopReason | "reject" {
  if (failure.code === "NETWORK_ERROR" || failure.status === 0) return "network";
  if (failure.status === 401) return "auth";
  if (failure.status >= 500 || failure.status === 429 || failure.status === 408) return "server";
  return "reject";
}

export async function flushQueue(
  store: QueueStore,
  userId: string,
  send: (mark: PendingMark) => Promise<void>,
  toFailure: (error: unknown) => SendFailure,
): Promise<FlushResult> {
  const result: FlushResult = { sent: [], rejected: [], stopped: null };
  const marks = (await store.all()).filter((m) => m.userId === userId);
  for (const mark of marks) {
    try {
      await send(mark);
      await store.delete(mark.key);
      result.sent.push(mark);
    } catch (error) {
      const failure = toFailure(error);
      const action = classify(failure);
      if (action === "reject") {
        await store.delete(mark.key);
        result.rejected.push({ mark, message: failure.message });
        continue;
      }
      result.stopped = action;
      break;
    }
  }
  return result;
}

export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request("presenca-sync", fn) as Promise<T>;
}
