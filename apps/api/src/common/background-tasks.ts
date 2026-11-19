import { Injectable, Logger } from "@nestjs/common";
import { reportError } from "@presenca/observability";

/**
 * Tarefas que rodam depois da resposta (ex.: enviar e-mail em "esqueci a senha", para que a
 * resposta demore o mesmo exista ou não a conta). Erros são registrados, nunca derrubam a requisição.
 */
@Injectable()
export class BackgroundTasks {
  private readonly logger = new Logger(BackgroundTasks.name);
  private readonly pending = new Set<Promise<void>>();

  run(name: string, task: () => Promise<void>): void {
    const promise = task()
      .catch((error: unknown) => {
        // Ex.: o envio do e-mail de recuperação falhou. A resposta já saiu; só o Sentry fica sabendo.
        reportError(error, { task: name });
        this.logger.error(
          `tarefa "${name}" falhou: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  /** Espera as tarefas em andamento (testes e desligamento gracioso). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }
}
