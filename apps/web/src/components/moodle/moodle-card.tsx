import { moodleStatusSchema } from "@presenca/contracts";
import { ButtonLink, SectionTitle } from "@/components/ui";
import { apiGet } from "@/lib/api-server";

/** Cartão na página Conta: estado do Moodle e o caminho para conectar ou gerenciar. */
export async function MoodleCard() {
  const status = await apiGet("/v1/moodle", moodleStatusSchema).catch(() => null);
  if (!status?.available) return null;
  const conn = status.connection;
  return (
    <section className="card grid gap-3 p-5 text-sm sm:p-6" aria-labelledby="moodle-conta">
      <SectionTitle
        id="moodle-conta"
        action={
          <ButtonLink href="/conta/moodle" variant="secondary">
            {conn ? "Gerenciar" : "Conectar"}
          </ButtonLink>
        }
      >
        Moodle
      </SectionTitle>
      <p className="text-muted">
        {conn
          ? conn.lastSyncError
            ? `Conectado a ${conn.icsHost}, mas a última sincronização falhou: ${conn.lastSyncError}`
            : `Conectado a ${conn.icsHost}: ${conn.importedCount} ${conn.importedCount === 1 ? "tarefa importada" : "tarefas importadas"}.`
          : "Traga as entregas com prazo do Moodle direto para o calendário, com aviso antes do prazo."}
      </p>
    </section>
  );
}
