import type { SubjectGrading } from "@presenca/contracts";

type Official = NonNullable<SubjectGrading["official"]>;

/** 7.5 → "7,5" (a nota como o SUAP mostra, na escala do curso). */
export const suapScore = (v: number | null) => (v === null ? "–" : String(v).replace(".", ","));

const syncedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "numeric" });

/**
 * Nota oficial do boletim do SUAP, como o professor lançou (vem pelo favorito "Enviar para o
 * Monitor"). Fica ao lado do que o app calcula, para a pessoa perceber se algo não bate.
 */
export function OfficialGrades({ official }: { official: Official }) {
  const items: [string, string][] = [
    ...official.stages.map((s): [string, string] => [s.label, suapScore(s.score)]),
    ["Média", suapScore(official.average)],
    ["NAF", suapScore(official.finalExam)],
    ["Média final", official.concept ?? suapScore(official.finalGrade)],
  ];
  return (
    <section
      className="grid gap-2 rounded-lg border border-line bg-surface-2 p-3 text-sm"
      aria-labelledby="nota-suap"
      data-testid="nota-suap"
    >
      <h3
        id="nota-suap"
        className="flex flex-wrap items-baseline justify-between gap-2 font-semibold"
      >
        Nota oficial do SUAP
        <span className="text-xs font-normal text-muted">
          atualizada em {syncedOn(official.syncedAt)} pelo favorito do SUAP
        </span>
      </h3>
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {official.status ? <p className="text-xs text-muted">Situação: {official.status}</p> : null}
    </section>
  );
}
