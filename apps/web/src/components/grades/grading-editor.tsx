"use client";

import type { SaveGradingBody, SubjectGrading } from "@presenca/contracts";
import { formatGrade, parseGrade } from "@presenca/engine";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, INPUT_CLASS } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

type Item = {
  id?: string;
  key: string;
  name: string;
  max: string;
  group: string;
  role: "regular" | "substitute" | "exam";
  dueOn: string;
  createTask: boolean;
};
type Group = { key: string; name: string; aggregate: "mean" | "sum"; drop: string };
export type EditorDraft = Partial<SaveGradingBody> | null;

const ROUNDING = [
  { value: 1, label: "Não arredonda" },
  { value: 10, label: "Para 0,1" },
  { value: 50, label: "Para 0,5" },
  { value: 100, label: "Para 1" },
];

const pts = (centi: number | undefined) => (centi === undefined ? "" : formatGrade(centi));

function initialItems(base: SubjectGrading, draft: EditorDraft): Item[] {
  if (draft?.items?.length) {
    return draft.items.map((i) => ({
      key: i.key,
      name: i.name,
      max: pts(i.maxScore),
      group: i.group ?? "",
      role: i.role ?? "regular",
      dueOn: i.dueOn ?? "",
      createTask: false,
    }));
  }
  if (base.items.length) {
    return base.items.map((i) => ({
      id: i.id,
      key: i.key,
      name: i.name,
      max: pts(i.maxScore),
      group: i.group ?? "",
      role: i.role,
      dueOn: i.dueOn ?? "",
      createTask: false,
    }));
  }
  return [
    {
      key: "P1",
      name: "Prova 1",
      max: "10",
      group: "",
      role: "regular",
      dueOn: "",
      createTask: false,
    },
    {
      key: "P2",
      name: "Prova 2",
      max: "10",
      group: "",
      role: "regular",
      dueOn: "",
      createTask: false,
    },
  ];
}

/**
 * Editor manual da regra de cálculo: escala, nota mínima, avaliações, fórmula (com atalhos para
 * média simples e soma), grupos com descarte, substitutiva, exame e arredondamento. Também é o
 * plano B do assistente de IA (abre já preenchido com o que a IA entendeu).
 */
export function GradingEditor({
  subjectId,
  base,
  draft,
  onCancel,
  notice,
}: {
  subjectId: string;
  base: SubjectGrading;
  draft: EditorDraft;
  onCancel?: () => void;
  notice?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const rules = draft?.rules ?? base.scheme?.rules;
  const [scale, setScale] = useState<10 | 100>(rules?.scale ?? 10);
  const [passing, setPassing] = useState(pts(rules?.passing ?? 600));
  const [items, setItems] = useState<Item[]>(() => initialItems(base, draft));
  const [formula, setFormula] = useState(rules?.formula ?? "(P1 + P2) / 2");
  const [groups, setGroups] = useState<Group[]>(
    (rules?.groups ?? []).map((g) => ({ ...g, drop: String(g.dropLowest) })),
  );
  const [exam, setExam] = useState(
    rules?.exam
      ? {
          min: pts(rules.exam.minToTake),
          formula: rules.exam.formula,
          passing: pts(rules.exam.passing),
        }
      : null,
  );
  const [subOf, setSubOf] = useState<string[] | null>(rules?.substitute?.replaces ?? null);
  const [rounding, setRounding] = useState<number>(rules?.roundingStep ?? 1);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const regular = items.filter((i) => i.role === "regular" && !i.group);
  const update = (index: number, patch: Partial<Item>) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const ensureRole = (role: "exam" | "substitute", key: string, name: string) =>
    setItems((list) =>
      list.some((i) => i.role === role)
        ? list
        : [
            ...list,
            { key, name, max: String(scale), group: "", role, dueOn: "", createTask: false },
          ],
    );
  const dropRole = (role: "exam" | "substitute") =>
    setItems((list) => list.filter((i) => i.role !== role));
  const terms = [...regular.map((i) => i.key), ...groups.map((g) => g.key)];

  async function save() {
    const parse = (text: string, label: string, list: string[]) => {
      const v = parseGrade(text);
      if (v === null) list.push(`${label}: use um número como 7 ou 7,5.`);
      return v ?? 0;
    };
    const problems: string[] = [];
    const body: SaveGradingBody = {
      source: draft ? "ai" : "manual",
      rules: {
        scale,
        passing: parse(passing, "Nota mínima", problems),
        formula,
        groups: groups.map((g) => ({
          key: g.key,
          name: g.name || g.key,
          aggregate: g.aggregate,
          dropLowest: Number(g.drop) || 0,
        })),
        exam: exam
          ? {
              minToTake: parse(exam.min, "Nota para ter direito ao exame", problems),
              formula: exam.formula,
              passing: parse(exam.passing, "Nota mínima depois do exame", problems),
            }
          : null,
        substitute: subOf && subOf.length > 0 ? { replaces: subOf } : null,
        roundingStep: rounding,
      },
      items: items.map((i) => ({
        ...(i.id ? { id: i.id } : {}),
        key: i.key.trim(),
        name: i.name.trim(),
        maxScore: parse(i.max, `Nota máxima de ${i.key}`, problems),
        group: i.group || null,
        role: i.role,
        dueOn: i.dueOn || null,
        ...(i.createTask ? { createTask: true } : {}),
      })),
    };
    if (problems.length > 0) return setErrors(problems);
    setPending(true);
    setErrors([]);
    try {
      await api(`/v1/subjects/${subjectId}/grading`, {
        method: "PUT",
        body,
        ...(base.scheme ? { ifMatch: base.scheme.version } : {}),
      });
      toast.push({ tone: "success", message: "Regra de cálculo salva." });
      onCancel?.();
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setErrors(
        e.problem.errors?.map((err) => err.message) ?? [
          e.problem.status === 412
            ? "A regra mudou em outro lugar. Recarregue a página."
            : e.message,
        ],
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-5" data-testid="editor-notas">
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {errors.length > 0 ? (
        <Alert tone="error">
          <ul className="grid gap-1">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="nota-escala">
          Escala
          <select
            id="nota-escala"
            className={INPUT_CLASS}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value) as 10 | 100)}
          >
            <option value={10}>De 0 a 10</option>
            <option value={100}>De 0 a 100</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="nota-minima">
          Nota mínima para passar
          <input
            id="nota-minima"
            className={INPUT_CLASS}
            inputMode="decimal"
            value={passing}
            onChange={(e) => setPassing(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="nota-arredonda">
          Arredondamento da média
          <select
            id="nota-arredonda"
            className={INPUT_CLASS}
            value={rounding}
            onChange={(e) => setRounding(Number(e.target.value))}
          >
            {ROUNDING.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Avaliações</legend>
        <p className="text-xs text-muted">
          O nome curto (P1, Lista1, Trabalho) é o que vai na fórmula. Com data, dá para criar a
          tarefa no calendário com aviso.
        </p>
        <ul className="grid gap-2">
          {items.map((it, i) => (
            <li
              key={i}
              className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[6rem_1fr_5rem_8rem_auto]"
              data-testid="avaliacao-editor"
            >
              <input
                aria-label={`Nome curto da avaliação ${i + 1}`}
                className={INPUT_CLASS}
                value={it.key}
                onChange={(e) => update(i, { key: e.target.value })}
              />
              <input
                aria-label={`Nome da avaliação ${i + 1}`}
                className={INPUT_CLASS}
                value={it.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <input
                aria-label={`Nota máxima da avaliação ${i + 1}`}
                className={INPUT_CLASS}
                inputMode="decimal"
                value={it.max}
                onChange={(e) => update(i, { max: e.target.value })}
              />
              <input
                aria-label={`Data da avaliação ${i + 1}`}
                type="date"
                className={INPUT_CLASS}
                value={it.dueOn}
                onChange={(e) => update(i, { dueOn: e.target.value })}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {it.role === "regular" && groups.length > 0 ? (
                  <select
                    aria-label={`Grupo da avaliação ${i + 1}`}
                    className={`${INPUT_CLASS} min-h-9 w-auto`}
                    value={it.group}
                    onChange={(e) => update(i, { group: e.target.value })}
                  >
                    <option value="">Sem grupo</option>
                    {groups.map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.name || g.key}
                      </option>
                    ))}
                  </select>
                ) : null}
                {it.role !== "regular" ? (
                  <span className="text-muted">
                    {it.role === "exam" ? "Exame" : "Substitutiva"}
                  </span>
                ) : null}
                {it.dueOn && !it.id ? (
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={it.createTask}
                      onChange={(e) => update(i, { createTask: e.target.checked })}
                    />
                    Criar tarefa
                  </label>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setItems((l) => l.filter((_, j) => j !== i))}
                >
                  Tirar
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          onClick={() =>
            setItems((l) => [
              ...l,
              {
                key: `A${l.length + 1}`,
                name: `Avaliação ${l.length + 1}`,
                max: String(scale),
                group: "",
                role: "regular",
                dueOn: "",
                createTask: false,
              },
            ])
          }
        >
          Adicionar avaliação
        </Button>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Como calcular a média</legend>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={terms.length === 0}
            onClick={() => setFormula(`(${terms.join(" + ")}) / ${terms.length}`)}
          >
            Média simples
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={terms.length === 0}
            onClick={() => setFormula(terms.join(" + "))}
          >
            Soma de pontos
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={terms.length < 2}
            onClick={() => setFormula(terms.map((t) => `0.5*${t}`).join(" + "))}
          >
            Com pesos
          </Button>
        </div>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="nota-formula">
          Fórmula
          <input
            id="nota-formula"
            className={`${INPUT_CLASS} font-mono`}
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            spellCheck={false}
          />
        </label>
        <p className="text-xs text-muted">
          Use os nomes curtos, + − * /, parênteses e max(), min() ou media(). Ex.: 0.4*P1 + 0.6*P2
          ou (2*P1 + 3*P2)/5 + Trabalho.
        </p>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Extras (opcional)</legend>
        <div className="grid gap-2">
          <Button
            type="button"
            variant="ghost"
            className="w-fit"
            onClick={() =>
              setGroups((g) => [
                ...g,
                {
                  key: g.length ? `Grupo${g.length + 1}` : "Listas",
                  name: "Listas",
                  aggregate: "mean",
                  drop: "0",
                },
              ])
            }
          >
            Adicionar grupo (ex.: listas com descarte)
          </Button>
          {groups.map((g, i) => (
            <div
              key={i}
              className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-4"
              data-testid="grupo-editor"
            >
              <input
                aria-label={`Nome curto do grupo ${i + 1}`}
                className={INPUT_CLASS}
                value={g.key}
                onChange={(e) =>
                  setGroups((l) => l.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                }
              />
              <select
                aria-label={`Como juntar o grupo ${i + 1}`}
                className={INPUT_CLASS}
                value={g.aggregate}
                onChange={(e) =>
                  setGroups((l) =>
                    l.map((x, j) =>
                      j === i ? { ...x, aggregate: e.target.value as "mean" | "sum" } : x,
                    ),
                  )
                }
              >
                <option value="mean">Média</option>
                <option value="sum">Soma</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                Descartar as
                <input
                  aria-label={`Descartar piores do grupo ${i + 1}`}
                  className={`${INPUT_CLASS} w-16`}
                  inputMode="numeric"
                  value={g.drop}
                  onChange={(e) =>
                    setGroups((l) =>
                      l.map((x, j) => (j === i ? { ...x, drop: e.target.value } : x)),
                    )
                  }
                />
                piores
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setGroups((l) => l.filter((_, j) => j !== i))}
              >
                Tirar grupo
              </Button>
            </div>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={subOf !== null}
            onChange={(e) => {
              setSubOf(e.target.checked ? regular.map((r) => r.key) : null);
              if (e.target.checked) ensureRole("substitute", "Sub", "Substitutiva");
              else dropRole("substitute");
            }}
          />
          Tem substitutiva (troca a menor nota, se for maior)
        </label>
        {subOf !== null ? (
          <div className="flex flex-wrap gap-3 pl-6 text-sm">
            {regular.map((r) => (
              <label key={r.key} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={subOf.includes(r.key)}
                  onChange={(e) =>
                    setSubOf((s) =>
                      e.target.checked
                        ? [...(s ?? []), r.key]
                        : (s ?? []).filter((k) => k !== r.key),
                    )
                  }
                />
                {r.key}
              </label>
            ))}
          </div>
        ) : null}

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={exam !== null}
            onChange={(e) => {
              setExam(
                e.target.checked
                  ? { min: "4", formula: "(MEDIA + EXAME) / 2", passing: "5" }
                  : null,
              );
              if (e.target.checked) ensureRole("exam", "Exame", "Exame final");
              else dropRole("exam");
            }}
          />
          Tem exame / prova final
        </label>
        {exam ? (
          <div className="grid gap-2 pl-6 sm:grid-cols-3">
            <label className="grid gap-1 text-sm" htmlFor="exame-min">
              Faz o exame a partir de
              <input
                id="exame-min"
                className={INPUT_CLASS}
                inputMode="decimal"
                value={exam.min}
                onChange={(e) => setExam({ ...exam, min: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm" htmlFor="exame-formula">
              Média depois do exame
              <input
                id="exame-formula"
                className={`${INPUT_CLASS} font-mono`}
                value={exam.formula}
                onChange={(e) => setExam({ ...exam, formula: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm" htmlFor="exame-minima">
              Passa com
              <input
                id="exame-minima"
                className={INPUT_CLASS}
                inputMode="decimal"
                value={exam.passing}
                onChange={(e) => setExam({ ...exam, passing: e.target.value })}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={pending} onClick={() => void save()}>
          Salvar regra
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
