import { resolve } from "node:path";
import { createDb, isConnectionLost } from "@presenca/db";
import { createMailer } from "@presenca/emails/transport";
import { flushErrors, initErrorReporting, reportError } from "@presenca/observability";
import { type CycleDeps, didWork, runCycle } from "./cycle";
import { loadEnv } from "./env";
import { OutboxListener } from "./listener";
import { WebPushSender } from "./push";

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
  initErrorReporting({ dsn: env.SENTRY_DSN, service: "worker", environment: env.NODE_ENV });
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

  const deps: CycleDeps = {
    pool: handle.pool,
    mailer,
    push,
    appUrl: env.WEB_ORIGIN,
    log: (level, msg, extra) => log(level, msg, extra),
  };

  // Modo pontual: um ciclo e sai. Sem escuta do outbox, sem timers. Falhou → código de saída 1,
  // para o agendador mostrar a execução como falha.
  if (env.WORKER_MODE === "once") {
    let failed = 0;
    try {
      const result = await runCycle(deps, { cleanup: true }).catch(async (error: unknown) => {
        // O Neon encerra as conexões quando reinicia ou acorda o banco: espera e tenta de novo
        // uma vez, em vez de falhar a execução (e mandar e-mail de alarme) por alguns segundos.
        if (!isConnectionLost(error)) throw error;
        log("warn", "conexão com o banco encerrada pelo servidor; tentando de novo em 5 s");
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return runCycle(deps, { cleanup: true });
      });
      failed = result.delivery.failed;
      log("info", "ciclo único concluído", {
        reminders: result.reminders,
        ...result.delivery,
        cleanup: result.cleanup,
      });
    } finally {
      await handle.close();
    }
    if (failed > 0) {
      // Envio que falhou (SMTP recusou, push expirado...) tenta de novo no próximo ciclo, mas a
      // execução sai como FALHA para o GitHub avisar o dono por e-mail. O motivo está no log acima.
      log("error", `${failed} envio(s) falharam neste ciclo; veja "envio falhou" acima`, {
        failed,
      });
      process.exit(1);
    }
    // Conexões keep-alive abertas pelo envio (SMTP, push) não devem segurar o processo.
    process.exit(0);
  }

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
      const due = Date.now() - lastCleanup > CLEANUP_EVERY_MS;
      if (due) lastCleanup = Date.now();
      const result = await runCycle(deps, { cleanup: due });
      if (didWork(result)) {
        log("info", "ciclo do outbox", { reminders: result.reminders, ...result.delivery });
      }
      if (result.cleanup) log("info", "limpeza de dados expirados", { ...result.cleanup });
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
    mode: env.WORKER_MODE,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    mail: env.MAIL_TRANSPORT,
    push: push.configured ? "vapid" : "desligado",
  });
  await listener.start();
  await cycle();
}

main().catch(async (error: unknown) => {
  log("error", describeError(error));
  reportError(error, { phase: "worker" });
  await flushErrors();
  process.exit(1);
});
