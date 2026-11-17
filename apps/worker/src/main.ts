import { resolve } from "node:path";
import { createDb } from "@presenca/db";
import { loadEnv } from "./env";

if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(resolve(__dirname, "../../../.env"));
  } catch {
    // sem .env: segue com o ambiente atual
  }
}

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({ level, service: "worker", msg, time: new Date().toISOString(), ...extra }),
  );
}

/** O pg lança AggregateError sem mensagem quando a conexão é recusada; usa o código nesse caso. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return error.message || code || error.name;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const handle = createDb({
    connectionString: env.WORKER_DATABASE_URL,
    applicationName: "presenca-worker",
    maxConnections: 4,
  });

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;

  // A Fase 6 troca este ciclo pelo consumo do outbox (LISTEN/NOTIFY + varredura com SKIP LOCKED).
  const tick = async () => {
    try {
      const latencyMs = await handle.ping();
      log("info", "ciclo do worker", { databaseLatencyMs: latencyMs });
    } catch (error) {
      log("warn", "banco indisponível; tentando de novo no próximo ciclo", {
        error: describeError(error),
      });
    }
    if (!stopping) timer = setTimeout(() => void tick(), env.WORKER_POLL_INTERVAL_MS);
  };

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    log("info", "encerrando", { signal });
    await handle.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("info", "worker iniciado", { pollIntervalMs: env.WORKER_POLL_INTERVAL_MS });
  await tick();
}

main().catch((error: unknown) => {
  log("error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
