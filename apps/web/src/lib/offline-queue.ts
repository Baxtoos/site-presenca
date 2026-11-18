import type { AttendanceStatus } from "@presenca/contracts";

/**
 * Registro de chamada feito sem internet, esperando para ir à API.
 * A `key` é a Idempotency-Key do POST: reenviar a mesma marcação (rede que caiu no meio, duas
 * abas, o app reaberto) nunca grava duas vezes.
 */
export interface PendingMark {
  key: string;
  /** Dono da marcação: num aparelho compartilhado, só o próprio aluno envia (e vê) as suas. */
  userId: string;
  subjectId: string;
  subjectName: string;
  classDate: string;
  scheduleId: string | null;
  status: AttendanceStatus;
  unitsMissed?: number;
  createdAt: number;
}

/** Corpo do POST /v1/attendance. Sempre o mesmo para a mesma chave (a API confere). */
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

// ---------------------------------------------------------------------------------------------
// Armazenamento: IndexedDB (sobrevive a fechar o app e reiniciar o celular).

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

/** Só para testes: esquece a conexão aberta (cada teste usa um IndexedDB novo). */
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

// ---------------------------------------------------------------------------------------------
// Envio.

/** Erro de envio já classificado (o api-client converte respostas HTTP nisto, ver offline-provider). */
export interface SendFailure {
  status: number;
  code: string;
  message: string;
}

export type StopReason = "network" | "auth" | "server";

export interface FlushResult {
  sent: PendingMark[];
  /** A API recusou de vez (ex.: a aula já tinha registro feito em outro aparelho): sai da fila. */
  rejected: { mark: PendingMark; message: string }[];
  /** Por que parou antes do fim (o resto continua na fila para a próxima tentativa). */
  stopped: StopReason | null;
}

/**
 * O que fazer com uma falha: parar e tentar depois (rede, sessão, servidor fora) ou descartar
 * (a API respondeu que essa marcação não pode entrar, e reenviar não muda isso).
 */
export function classify(failure: SendFailure): StopReason | "reject" {
  if (failure.code === "NETWORK_ERROR" || failure.status === 0) return "network";
  if (failure.status === 401) return "auth";
  if (failure.status >= 500 || failure.status === 429 || failure.status === 408) return "server";
  return "reject";
}

/**
 * Envia as marcações pendentes do aluno, da mais antiga para a mais nova. Para no primeiro erro
 * temporário, para não martelar a API sem rede; erros definitivos saem da fila e são avisados.
 */
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

/**
 * Uma sincronização por vez, mesmo com o app aberto em várias abas (Web Locks). Sem suporte,
 * roda direto: a Idempotency-Key já impede gravação dupla, o lock só evita trabalho repetido.
 */
export function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request("presenca-sync", fn) as Promise<T>;
}
