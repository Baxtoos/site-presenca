"use client";

import type { CalendarExceptionDto, Semester } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";
import { formatDate } from "@/lib/format";
import { NationalHolidays } from "./national-holidays";

const KIND_LABEL: Record<CalendarExceptionDto["kind"], string> = {
  holiday: "Feriado",
  no_classes: "Sem aula",
  exam_week: "Semana de provas",
};

export function ExceptionsManager({
  semester,
  exceptions,
  subjects,
}: {
  semester: Semester;
  exceptions: CalendarExceptionDto[];
  subjects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const startsOn = formText(form, "exc-inicio");
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      await api(`/v1/semesters/${semester.id}/exceptions`, {
        method: "POST",
        body: {
          label: formText(form, "exc-nome"),
          startsOn,
          endsOn: formText(form, "exc-fim") || startsOn,
          kind: formText(form, "exc-tipo"),
          subjectId: formText(form, "exc-materia") || null,
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
      await api(`/v1/semesters/${semester.id}/exceptions/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível remover.");
    } finally {
      setRemoving(undefined);
    }
  }

  return (
    <div className="grid gap-4">
      <NationalHolidays semester={semester} exceptions={exceptions} />
      {exceptions.length > 0 ? (
        <ul className="grid divide-y divide-line">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="grid gap-0.5">
                <span className="font-medium">{e.label}</span>
                <span className="text-muted">
                  {KIND_LABEL[e.kind]} · {formatDate(e.startsOn)}
                  {e.endsOn !== e.startsOn ? ` a ${formatDate(e.endsOn)}` : ""}
                  {e.subjectId ? ` · só ${subjectName.get(e.subjectId) ?? "uma matéria"}` : ""}
                </span>
              </span>
              <Button
                variant="danger"
                loading={removing === e.id}
                onClick={() => void remove(e.id)}
                aria-label={`Remover ${e.label}`}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        method="post"
        onSubmit={(e) => void onSubmit(e)}
        className="grid gap-3 rounded-xl bg-surface-2 p-4"
        noValidate
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          id="exc-nome"
          label="Nome"
          placeholder="Ex.: Carnaval"
          required
          error={fields.label}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="exc-inicio"
            label="Data (ou início)"
            type="date"
            min={semester.startsOn}
            max={semester.endsOn}
            required
            error={fields.startsOn}
          />
          <Field
            id="exc-fim"
            label="Até (opcional)"
            type="date"
            min={semester.startsOn}
            max={semester.endsOn}
            error={fields.endsOn}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Tipo
            <select
              name="exc-tipo"
              className="min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-base outline-none hover:border-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent/20 sm:min-h-10 sm:text-sm"
            >
              <option value="holiday">Feriado</option>
              <option value="no_classes">Sem aula (recesso, evento)</option>
              <option value="exam_week">Semana de provas (aula normal)</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Vale para
            <select
              name="exc-materia"
              className="min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-base outline-none hover:border-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent/20 sm:min-h-10 sm:text-sm"
            >
              <option value="">Todas as matérias</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  Só {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button type="submit" variant="secondary" loading={pending} className="sm:w-fit">
          Adicionar
        </Button>
      </form>
    </div>
  );
}
