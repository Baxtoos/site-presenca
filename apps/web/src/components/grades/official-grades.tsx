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
      {official.assessments.length > 0 ? (
        <ul className="grid gap-1 border-t border-line pt-2" aria-label="Avaliações no SUAP">
          {official.assessments.map((a, i) => (
            <li key={`${a.stage}-${a.code}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs text-muted">{a.stage}</span>
              <span className="font-medium">{a.code}</span>
              {a.kind || a.description ? (
                <span className="text-muted">
                  {[a.kind, a.description !== a.code ? a.description : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {a.weight !== null ? (
                <span className="text-xs text-muted">peso {suapScore(a.weight)}</span>
              ) : null}
              <span className="ml-auto font-semibold tabular-nums">{suapScore(a.score)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {official.status ? <p className="text-xs text-muted">Situação: {official.status}</p> : null}
    </section>
  );
}

/**
 * Avaliações do SUAP como ponto de partida da regra: cada sigla vira uma avaliação e a forma de
 * cálculo da etapa vira a fórmula (média aritmética, ponderada pelos pesos, ou soma). A "Etapa
 * Final" (exame) fica de fora: o exame se configura no editor.
 */
export function suapDraft(official: Official, scale: number) {
  const regular = official.assessments.filter((a) => !/final/i.test(a.stage));
  const used = new Set<string>();
  const items = regular.map((a, n) => {
    const base =
      a.code
        .normalize("NFD")
        .replace(/[^A-Za-z0-9_]/g, "")
        .slice(0, 20) || `A${n + 1}`;
    let key = /^[A-Za-z_]/.test(base) ? base : `A${base}`;
    for (let i = 2; used.has(key.toLowerCase()); i++) key = `${base.slice(0, 18)}_${i}`;
    used.add(key.toLowerCase());
    return {
      a,
      item: {
        key,
        name: (a.description && a.description !== a.code
          ? a.description
          : `${a.kind ?? "Avaliação"} ${a.code}`
        ).slice(0, 120),
        maxScore: scale * 100,
        group: null,
        role: "regular" as const,
        dueOn: null,
      },
    };
  });
  const stages = [...new Set(items.map((x) => x.a.stage))];
  const formulaOf = (stage: string) => {
    const xs = items.filter((x) => x.a.stage === stage);
    const method = (xs[0]?.a.method ?? "").toLowerCase();
    if (method.includes("soma")) return xs.map((x) => x.item.key).join(" + ");
    if (
      xs.every((x) => x.a.weight !== null && x.a.weight > 0) &&
      xs.some((x) => x.a.weight !== 1)
    ) {
      const total = xs.reduce((s, x) => s + x.a.weight!, 0);
      return `(${xs.map((x) => `${x.a.weight}*${x.item.key}`).join(" + ")}) / ${total}`;
    }
    return xs.length === 1 ? xs[0]!.item.key : `media(${xs.map((x) => x.item.key).join(", ")})`;
  };
  const formula =
    stages.length <= 1
      ? formulaOf(stages[0] ?? "")
      : `media(${stages.map((s) => `(${formulaOf(s)})`).join(", ")})`;
  return { items: items.map((x) => x.item), formula };
}
