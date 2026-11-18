import pg from "pg";

export const OUTBOX_CHANNEL = "presenca_outbox";

/**
 * Conexão dedicada que escuta o NOTIFY do outbox e chama `onWake`. Reconecta sozinha se cair;
 * enquanto estiver fora, a varredura periódica do worker garante que nada fica parado.
 */
export class OutboxListener {
  private client: pg.Client | null = null;
  private stopped = false;
  private retry: NodeJS.Timeout | undefined;

  constructor(
    private readonly connectionString: string,
    private readonly onWake: () => void,
    private readonly log: (
      level: "info" | "warn",
      msg: string,
      extra?: Record<string, unknown>,
    ) => void,
    private readonly retryMs = 5_000,
  ) {}

  async start(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({
      connectionString: this.connectionString,
      application_name: "presenca-worker-listen",
    });
    client.on("notification", (msg) => {
      if (msg.channel === OUTBOX_CHANNEL) this.onWake();
    });
    const reconnect = (error?: Error) => {
      if (this.stopped || this.client !== client) return;
      this.client = null;
      client.removeAllListeners();
      void client.end().catch(() => undefined);
      this.log("warn", "escuta do outbox caiu; reconectando", { error: error?.message });
      this.schedule();
    };
    client.on("error", reconnect);
    client.on("end", () => reconnect());
    try {
      await client.connect();
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
      this.client = client;
      this.log("info", "escutando o outbox");
      // Pode ter chegado algo enquanto estava desconectado.
      this.onWake();
    } catch (error) {
      client.removeAllListeners();
      void client.end().catch(() => undefined);
      this.log("warn", "não deu para escutar o outbox; tentando de novo", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.schedule();
    }
  }

  private schedule() {
    if (this.stopped) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.start(), this.retryMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retry);
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
    }
  }
}
