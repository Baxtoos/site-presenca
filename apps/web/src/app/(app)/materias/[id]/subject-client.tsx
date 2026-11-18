"use client";

import type { Schedule, Subject } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";
import { WEEKDAYS } from "@/lib/format";

/** Grade de uma matéria já salva: cada inclusão ou remoção grava na hora. */
export function ScheduleManager({
  subjectId,
  schedules,
  defaultUnits,
}: {
  subjectId: string;
  schedules: Schedule[];
  defaultUnits: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      await api(`/v1/subjects/${subjectId}/schedules`, {
        method: "POST",
        body: {
          weekday: Number(formText(form, "dia")),
          startsAt: formText(form, "inicio"),
          endsAt: formText(form, "fim"),
          units: Number(formText(form, "tempos")),
          room: formText(form, "sala") || null,
        },
      });
      formEl.reset();
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFields(e.fieldErrors);
      if (!e.problem.errors) setError(e.message);
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    try {
      await api(`/v1/subjects/${subjectId}/schedules/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível remover.");
    } finally {
      setRemoving(undefined);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {schedules.length === 0 ? (
        <p className="text-sm text-muted">Nenhum horário cadastrado.</p>
      ) : (
        <ul className="grid divide-y divide-line">
          {schedules.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span>
                <strong>{WEEKDAYS[s.weekday]}</strong>, {s.startsAt}–{s.endsAt} · {s.units}{" "}
                {s.units === 1 ? "tempo" : "tempos"}
                {s.room ? ` · ${s.room}` : ""}
              </span>
              <Button
                variant="danger"
                loading={removing === s.id}
                onClick={() => void remove(s.id)}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => void add(e)}
        className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-[1.2fr_1fr_1fr_0.8fr_1fr_auto] sm:items-end"
        noValidate
      >
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          Dia
          <select
            name="dia"
            defaultValue="1"
            className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-base"
          >
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>
                {WEEKDAYS[d]}
              </option>
            ))}
          </select>
        </label>
        <Field
          id="inicio"
          label="Início"
          type="time"
          defaultValue="19:00"
          error={fields.startsAt}
        />
        <Field id="fim" label="Fim" type="time" defaultValue="20:40" error={fields.endsAt} />
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          Tempos
          <select
            name="tempos"
            defaultValue={String(defaultUnits)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-base"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Field id="sala" label="Sala" />
        <Button type="submit" variant="secondary" loading={pending}>
          Adicionar
        </Button>
      </form>
    </div>
  );
}

export function DeleteSubject({ subject }: { subject: Subject }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    setPending(true);
    try {
      await api(`/v1/subjects/${subject.id}`, { method: "DELETE", ifMatch: subject.version });
      router.push(`/semestres/${subject.semesterId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="danger" className="w-fit" onClick={() => setConfirming(true)}>
        Apagar matéria
      </Button>
    );
  }
  return (
    <div
      className="grid gap-3 rounded-xl border border-fail/40 bg-fail-soft p-4 text-sm"
      role="alertdialog"
      aria-labelledby="confirma-materia"
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p id="confirma-materia">
        Apagar <strong>{subject.name}</strong> remove também a grade e os registros de presença
        dela. Isso não pode ser desfeito.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" loading={pending} onClick={() => void remove()}>
          Apagar de vez
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
