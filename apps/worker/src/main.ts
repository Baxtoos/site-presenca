import { resolve } from "node:path";
import { createDb } from "@presenca/db";
import { createMailer } from "@presenca/emails/transport";
import { cleanupExpired } from "./cleanup";
import { processOutbox } from "./delivery";
import { loadEnv } from "./env";
import { OutboxListener } from "./listener";
import { WebPushSender } from "./push";
import { enqueueReminders } from "./reminders";

if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(resolve(__dirname, "../../../.env"));
  } catch {
    // sem .env: segue com o ambiente atual
  }
}

type Level = "info" | "warn" | "error";
function log(level: Level, msg: string, extra: Record<string, unknown> = {}) {
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

const CLEANUP_EVERY_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const env = loadEnv();
  const handle = createDb({
    connectionString: env.WORKER_DATABASE_URL,
    applicationName: "presenca-worker",
    maxConnections: 4,
  });
  const mailer = createMailer({
    transport: env.MAIL_TRANSPORT,
    from: env.MAIL_FROM,
    smtpUrl: env.SMTP_URL,
    resendApiKey: env.RESEND_API_KEY,
    log: (line) => log("info", line),
  });
  const push = new WebPushSender({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  });

  let stopping = false;
  let running = false;
  let again = false;
  let timer: NodeJS.Timeout | undefined;
  let lastCleanup = 0;

  /** Um ciclo: lembretes vencidos, depois tudo o que estiver na fila. Nunca dois ao mesmo tempo. */
  const cycle = async () => {
    if (stopping) return;
    if (running) {
      again = true; // chegou aviso no meio do ciclo: roda de novo ao terminar
      return;
    }
    running = true;
    clearTimeout(timer);
    try {
      const reminders = await enqueueReminders(handle.pool, new Date());
      const stats = await processOutbox({
        pool: handle.pool,
        mailer,
        push,
        appUrl: env.WEB_ORIGIN,
        log: (level, msg, extra) => log(level, msg, extra),
      });
      if (reminders > 0 || stats.sent + stats.failed + stats.skipped + stats.postponed > 0) {
        log("info", "ciclo do outbox", { reminders, ...stats });
      }
      if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) {
        lastCleanup = Date.now();
        log("info", "limpeza de dados expirados", { ...(await cleanupExpired(handle.pool)) });
      }
    } catch (error) {
      log("warn", "ciclo falhou; tentando de novo no próximo", { error: describeError(error) });
    } finally {
      running = false;
      if (!stopping) {
        if (again) {
          again = false;
          setImmediate(() => void cycle());
        } else {
          timer = setTimeout(() => void cycle(), env.WORKER_POLL_INTERVAL_MS);
        }
      }
    }
  };

  // Vários NOTIFY seguidos (um registro gera até 3 avisos) viram um ciclo só.
  let wakeTimer: NodeJS.Timeout | undefined;
  const wake = () => {
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => void cycle(), 150);
  };
  const listener = new OutboxListener(env.WORKER_DATABASE_URL, wake, log);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    clearTimeout(wakeTimer);
    log("info", "encerrando", { signal });
    await listener.stop();
    await handle.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  log("info", "worker iniciado", {
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    mail: env.MAIL_TRANSPORT,
    push: push.configured ? "vapid" : "desligado",
  });
  await listener.start();
  await cycle();
}

main().catch((error: unknown) => {
  log("error", describeError(error));
  process.exit(1);
});
