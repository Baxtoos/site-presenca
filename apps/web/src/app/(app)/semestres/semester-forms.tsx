"use client";

import type { Semester } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";
import { addHolidays, missingHolidays } from "@/lib/holidays";

function suggestion() {
  const now = new Date();
  const year = now.getFullYear();
  const second = now.getMonth() >= 6;
  return second
    ? { label: `${year}.2`, startsOn: `${year}-08-03`, endsOn: `${year}-12-18` }
    : { label: `${year}.1`, startsOn: `${year}-02-02`, endsOn: `${year}-07-03` };
}

export function CreateSemesterForm({ makeCurrentByDefault }: { makeCurrentByDefault: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const s = suggestion();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      const created = await api<Semester>("/v1/semesters", {
        method: "POST",
        body: {
          label: formText(form, "rotulo"),
          startsOn: formText(form, "inicio"),
          endsOn: formText(form, "fim"),
          isCurrent: form.get("atual") === "on",
        },
      });
      if (form.get("feriados") === "on") {
        await addHolidays(
          created.id,
          missingHolidays(created, []).filter((h) => !h.optional),
        ).catch(() => undefined);
      }
      router.push(`/semestres/${created.id}`);
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFields(e.fieldErrors);
      if (!e.problem.errors) setError(e.message);
      setPending(false);
    }
  }

  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="rotulo"
        label="Nome"
        defaultValue={s.label}
        required
        error={fields.label}
        hint="Ex.: 2026.2"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="inicio"
          label="Início das aulas"
          type="date"
          defaultValue={s.startsOn}
          required
          error={fields.startsOn}
        />
        <Field
          id="fim"
          label="Fim das aulas"
          type="date"
          defaultValue={s.endsOn}
          required
          error={fields.endsOn}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="atual"
          defaultChecked={makeCurrentByDefault}
          className="size-4 accent-accent"
        />
        Este é o semestre que estou cursando agora
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="feriados"
          defaultChecked
          className="mt-0.5 size-4 accent-accent"
        />
        <span>
          Já adicionar os feriados nacionais do período
          <span className="block text-muted">
            Carnaval e Corpus Christi (pontos facultativos) você escolhe depois, na página do
            semestre.
          </span>
        </span>
      </label>
      <Button type="submit" loading={pending} className="sm:w-fit">
        Criar semestre
      </Button>
    </form>
  );
}

export function SemesterActions({ semester }: { semester: Semester }) {
  const router = useRouter();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function run(name: string, action: () => Promise<unknown>, after?: () => void) {
    setPending(name);
    setError(undefined);
    try {
      await action();
      if (after) after();
      else router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível concluir.");
    } finally {
      setPending(undefined);
    }
  }

  const patch = (body: Record<string, unknown>) =>
    api(`/v1/semesters/${semester.id}`, { method: "PATCH", body, ifMatch: semester.version });

  return (
    <div className="grid gap-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {!semester.isCurrent ? (
          <Button
            variant="secondary"
            loading={pending === "atual"}
            onClick={() => void run("atual", () => patch({ isCurrent: true }))}
          >
            Tornar o semestre atual
          </Button>
        ) : null}
        {semester.status === "active" ? (
          <Button
            variant="secondary"
            loading={pending === "arquivar"}
            onClick={() => void run("arquivar", () => patch({ status: "archived" }))}
          >
            Arquivar
          </Button>
        ) : (
          <Button
            variant="secondary"
            loading={pending === "arquivar"}
            onClick={() => void run("arquivar", () => patch({ status: "active" }))}
          >
            Desarquivar
          </Button>
        )}
        {!confirmDelete ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Apagar semestre
          </Button>
        ) : null}
      </div>
      {confirmDelete ? (
        <div
          className="grid gap-3 rounded-xl border border-fail/40 bg-fail-soft p-4 text-sm"
          role="alertdialog"
          aria-labelledby="confirma-apagar"
        >
          <p id="confirma-apagar">
            Apagar <strong>{semester.label}</strong> remove também as matérias, a grade e todos os
            registros de presença. Isso não pode ser desfeito.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              loading={pending === "apagar"}
              onClick={() =>
                void run(
                  "apagar",
                  () =>
                    api(`/v1/semesters/${semester.id}`, {
                      method: "DELETE",
                      ifMatch: semester.version,
                    }),
                  () => {
                    router.push("/semestres");
                    router.refresh();
                  },
                )
              }
            >
              Apagar de vez
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
