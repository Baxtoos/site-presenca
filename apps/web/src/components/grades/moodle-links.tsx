"use client";

import type { EvaluationItemDto, MoodleGrades } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, INPUT_CLASS } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

const gradeText = (g: number | null, max: number) =>
  g === null ? `sem nota (de ${max})` : `${String(g).replace(".", ",")} de ${max}`;

/**
 * Liga as avaliações da matéria aos itens do livro de notas do Moodle. Ligada e sem nota sua, a
 * avaliação passa a seguir o Moodle (o worker traz as notas novas e avisa); nota lançada por você
 * continua sua.
 */
export function MoodleLinks({
  subjectId,
  items,
}: {
  subjectId: string;
  items: EvaluationItemDto[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<MoodleGrades | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api<MoodleGrades>(`/v1/subjects/${subjectId}/moodle-grades`);
      setData(res);
      setChoice(
        Object.fromEntries(res.items.map((i) => [i.externalId, i.linkedTo ?? i.suggested ?? ""])),
      );
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível ler o Moodle agora.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!data) return;
    // Cada avaliação liga a um item só; a que ficar sem item é desligada.
    const byEvaluation = new Map<string, string | null>(
      items.filter((i) => i.externalGradeItemId).map((i) => [i.id, null]),
    );
    for (const [externalId, evaluationId] of Object.entries(choice)) {
      if (evaluationId) byEvaluation.set(evaluationId, externalId);
    }
    setSaving(true);
    try {
      const res = await api<MoodleGrades>(`/v1/subjects/${subjectId}/moodle-grades`, {
        method: "PUT",
        body: {
          links: [...byEvaluation].map(([evaluationItemId, externalGradeItemId]) => ({
            evaluationItemId,
            externalGradeItemId,
          })),
        },
      });
      setData(res);
      toast.push({ tone: "success", message: "Avaliações ligadas ao Moodle." });
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

  if (!data) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="w-fit"
        loading={loading}
        onClick={() => void load()}
      >
        Ligar avaliações às notas do Moodle
      </Button>
    );
  }
  if (!data.available) return <Alert>{data.reason}</Alert>;
  return (
    <section
      className="grid gap-3 rounded-lg border border-line p-3"
      aria-labelledby="moodle-notas"
    >
      <h3 id="moodle-notas" className="text-sm font-semibold">
        Notas do Moodle ({data.courseKey})
      </h3>
      {data.items.length === 0 ? (
        <p className="text-sm text-muted">O Moodle ainda não tem itens de nota nesta turma.</p>
      ) : (
        <ul className="grid gap-2">
          {data.items.map((m) => (
            <li
              key={m.externalId}
              className="grid gap-1 text-sm sm:grid-cols-[1fr_14rem] sm:items-center"
            >
              <label htmlFor={`moodle-${m.externalId}`}>
                <span className="font-medium">{m.name}</span>{" "}
                <span className="text-xs text-muted">· {gradeText(m.grade, m.max)}</span>
              </label>
              <select
                id={`moodle-${m.externalId}`}
                className={INPUT_CLASS}
                value={choice[m.externalId] ?? ""}
                onChange={(e) => setChoice((c) => ({ ...c, [m.externalId]: e.target.value }))}
              >
                <option value="">Não ligar</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        Ligada e sem nota sua, a avaliação segue o Moodle: as notas novas chegam sozinhas, com
        aviso. Nota que você lançar à mão continua sua.
      </p>
      {data.items.length > 0 ? (
        <Button type="button" className="w-fit" loading={saving} onClick={() => void save()}>
          Salvar ligações
        </Button>
      ) : null}
    </section>
  );
}

/** Avaliações do Moodle como ponto de partida da regra (o aluno confere pesos e fórmula). */
export async function moodleDraftItems(subjectId: string, scale: number) {
  const res = await api<MoodleGrades>(`/v1/subjects/${subjectId}/moodle-grades`);
  if (!res.available) return { reason: res.reason ?? "Moodle indisponível.", items: [] };
  const used = new Set<string>();
  const items = res.items.map((m, n) => {
    const base =
      m.name
        .normalize("NFD")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 12) || `M${n + 1}`;
    let key = /^[A-Za-z]/.test(base) ? base : `M${base}`;
    for (let i = 2; used.has(key.toLowerCase()); i++) key = `${base.slice(0, 10)}${i}`;
    used.add(key.toLowerCase());
    return {
      key,
      name: m.name,
      maxScore: scale * 100,
      group: null,
      role: "regular" as const,
      dueOn: null,
    };
  });
  return { reason: null, items };
}
