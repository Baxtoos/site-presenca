"use client";

import {
  type EvaluationItemDto,
  GRADE_STATUS_LABEL,
  type SubjectGrading,
} from "@presenca/contracts";
import { formatGrade, parseGrade, simulateGrades } from "@presenca/engine";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { Button, INPUT_CLASS } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { GRADE_STATUS_STYLE } from "@/lib/grades";
import { type EditorDraft, GradingEditor } from "./grading-editor";
import { GradingAssistant } from "./grading-assistant";
import { MoodleLinks, moodleDraftItems } from "./moodle-links";

type Setup = { draft: EditorDraft; notice?: string; rev: number };

/**
 * Seção "Notas" da matéria. Montar a regra: assistente de IA (só coleta) em cima e editor embaixo;
 * o que a IA entende preenche o editor, e sem IA (desligada, limite ou falha) o editor segue
 * sozinho. Com regra: nota garantida, média parcial, quanto falta, situação, lançar notas e simular
 * "e se eu tirar X?" (tudo calculado pelo motor, no navegador e na API).
 */
export function GradesPanel({ initial }: { initial: SubjectGrading }) {
  const [setup, setSetup] = useState<Setup | null>(initial.scheme ? null : { draft: null, rev: 0 });
  const open = () => setSetup({ draft: null, rev: 0 });
  const [fromMoodle, setFromMoodle] = useState(false);
  async function draftFromMoodle() {
    setFromMoodle(true);
    try {
      const res = await moodleDraftItems(initial.subjectId, initial.scheme?.rules.scale ?? 10);
      setSetup((s) => ({
        draft: res.items.length ? { items: res.items } : (s?.draft ?? null),
        notice:
          res.reason ??
          (res.items.length
            ? "Avaliações trazidas do Moodle. Confira a nota máxima de cada uma e escreva a fórmula."
            : "O Moodle ainda não tem itens de nota nesta turma."),
        rev: (s?.rev ?? 0) + 1,
      }));
    } catch {
      setSetup((s) => ({
        draft: s?.draft ?? null,
        notice: "Não foi possível ler o Moodle agora.",
        rev: (s?.rev ?? 0) + 1,
      }));
    } finally {
      setFromMoodle(false);
    }
  }

  return (
    <section className="grid gap-4 card p-5 sm:p-6" aria-labelledby="notas" id="notas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="notas" className="text-lg font-semibold tracking-tight">
          Notas
        </h2>
        {initial.scheme && !setup ? (
          <Button type="button" variant="ghost" onClick={open}>
            Editar regra
          </Button>
        ) : null}
      </div>

      {setup ? (
        <>
          {initial.assistantAvailable ? (
            <GradingAssistant
              subjectId={initial.subjectId}
              onDraft={(draft, notice) =>
                setSetup((s) => ({ draft, notice, rev: (s?.rev ?? 0) + 1 }))
              }
            />
          ) : null}
          {initial.moodleLinkable ? (
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              loading={fromMoodle}
              onClick={() => void draftFromMoodle()}
            >
              Trazer avaliações do Moodle
            </Button>
          ) : null}
          <GradingEditor
            // Cada resposta da IA recria o editor com o rascunho novo.
            key={setup.rev}
            subjectId={initial.subjectId}
            base={initial}
            draft={setup.draft}
            notice={setup.notice}
            onCancel={initial.scheme ? () => setSetup(null) : undefined}
          />
        </>
      ) : (
        <>
          <GradesView grading={initial} />
          {initial.moodleLinkable ? (
            <MoodleLinks subjectId={initial.subjectId} items={initial.items} />
          ) : null}
        </>
      )}
    </section>
  );
}

function GradesView({ grading }: { grading: SubjectGrading }) {
  const rules = grading.scheme!.rules;
  const [hyp, setHyp] = useState<Record<string, string>>({});
  const hypothetical = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(hyp)) {
      const n = parseGrade(v);
      if (n !== null) out[k] = n;
    }
    return out;
  }, [hyp]);
  const engineItems = grading.items.map((i) => ({
    key: i.key,
    name: i.name,
    maxScore: i.maxScore,
    group: i.group,
    role: i.role,
    score: i.score,
  }));
  const simulating = Object.keys(hypothetical).length > 0;
  const summary = simulating ? simulateGrades(rules, engineItems, hypothetical) : grading.summary;
  if (!summary)
    return <p className="text-sm text-muted">Não foi possível calcular. Confira a regra.</p>;
  const scale = rules.scale;

  return (
    <div className="grid gap-4" data-testid="resumo-notas">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${GRADE_STATUS_STYLE[summary.status]}`}
          data-testid="situacao-nota"
        >
          {GRADE_STATUS_LABEL[summary.status]}
        </span>
        {simulating ? <span className="text-xs text-muted">Simulação: nada foi salvo.</span> : null}
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label={summary.final !== null ? "Média final" : "Nota garantida"}
          value={formatGrade(summary.final ?? summary.guaranteed)}
        />
        <Stat
          label="Média parcial"
          value={summary.partial === null ? "—" : formatGrade(summary.partial)}
        />
        <Stat label="Máximo possível" value={formatGrade(summary.maxPossible)} />
        <Stat label="Passa com" value={`${formatGrade(rules.passing)} de ${scale}`} />
      </dl>
      {summary.needed ? (
        <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm" data-testid="quanto-falta">
          Para passar, você precisa de{" "}
          {summary.needed.items.map((i) => `${formatGrade(i.needed)} na ${i.name}`).join(", ")}.
        </p>
      ) : null}
      {summary.neededOnExam !== null ? (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-sm">
          No exame, você precisa de {formatGrade(summary.neededOnExam)}.
        </p>
      ) : null}
      {summary.status === "sem_chance_direta" ? (
        <p className="text-sm text-warn">
          Mesmo tirando a nota máxima no que falta, só passa pelo exame.
        </p>
      ) : null}

      <ul className="grid gap-2" aria-label="Avaliações">
        {grading.items.map((it) => (
          <ScoreRow
            key={it.id}
            item={it}
            hypothetical={hyp[it.key] ?? ""}
            onHypothetical={(v) => setHyp((h) => ({ ...h, [it.key]: v }))}
          />
        ))}
      </ul>
      {simulating ? (
        <Button type="button" variant="ghost" className="w-fit" onClick={() => setHyp({})}>
          Limpar simulação
        </Button>
      ) : null}
      <p className="text-xs text-muted">
        Média: <span className="font-mono">{rules.formula}</span>
        {rules.exam ? ` · exame a partir de ${formatGrade(rules.exam.minToTake)}` : ""}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function ScoreRow({
  item,
  hypothetical,
  onHypothetical,
}: {
  item: EvaluationItemDto;
  hypothetical: string;
  onHypothetical: (value: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(item.score === null ? "" : formatGrade(item.score));
  const [saving, setSaving] = useState(false);
  const taskPending = item.task?.status === "pending";
  const [completeTask, setCompleteTask] = useState(true);
  const id = `nota-${item.id}`;

  async function save(text = value) {
    const score = text.trim() === "" ? null : parseGrade(text);
    if (text.trim() !== "" && score === null) {
      toast.push({ tone: "error", message: "Use um número como 7 ou 7,5." });
      return;
    }
    setSaving(true);
    try {
      await api(`/v1/evaluation-items/${item.id}`, {
        method: "PATCH",
        ifMatch: item.version,
        body: { score, completeTask: taskPending && completeTask },
      });
      toast.push({
        tone: "success",
        message: score === null ? "Nota apagada." : `Nota de ${item.name} lançada.`,
      });
      router.refresh();
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível salvar.",
      });
    } finally {
      setSaving(false);
    }
  }

  const awaiting = item.score === null && item.task?.status === "completed";
  return (
    <li
      className="grid gap-2 rounded-lg border border-line px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center"
      data-testid="avaliacao"
    >
      <div className="grid gap-0.5">
        <label htmlFor={id} className="font-medium">
          {item.name} <span className="font-mono text-xs text-muted">{item.key}</span>
        </label>
        <span className="text-xs text-muted">
          até {formatGrade(item.maxScore)}
          {item.role === "exam" ? " · exame" : item.role === "substitute" ? " · substitutiva" : ""}
          {item.scoreSource === "moodle" && item.score !== null ? " · do Moodle" : ""}
          {awaiting ? " · entregue, aguardando nota" : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          className={`${INPUT_CLASS} w-20`}
          inputMode="decimal"
          placeholder="—"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="button" variant="secondary" loading={saving} onClick={() => void save()}>
          {item.score === null ? "Lançar nota" : "Salvar"}
        </Button>
        {item.score === null && item.task?.status === "not_completed" ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void save("0")}>
            Lançar 0 (não entregue)
          </Button>
        ) : null}
      </div>
      {item.score === null && taskPending ? (
        <label className="flex items-center gap-2 text-xs text-muted sm:col-span-3">
          <input
            type="checkbox"
            checked={completeTask}
            onChange={(e) => setCompleteTask(e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          Ao lançar, marcar a tarefa “{item.task?.title}” como entregue
        </label>
      ) : null}
      {item.score === null && item.role === "regular" ? (
        <label className="flex items-center gap-2 text-xs text-muted" htmlFor={`${id}-sim`}>
          E se eu tirar
          <input
            id={`${id}-sim`}
            className={`${INPUT_CLASS} min-h-9 w-16`}
            inputMode="decimal"
            value={hypothetical}
            onChange={(e) => onHypothetical(e.target.value)}
          />
        </label>
      ) : (
        <span />
      )}
    </li>
  );
}
