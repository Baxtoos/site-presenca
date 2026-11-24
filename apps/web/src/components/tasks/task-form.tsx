"use client";

import { DEFAULT_TASK_REMIND, type Task } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, Field, INPUT_CLASS } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";
import { REMIND_CHOICES } from "@/lib/tasks";

type SubjectOption = { id: string; name: string };

/** Hoje no fuso do aparelho (AAAA-MM-DD), para o valor inicial da data. */
const localToday = () => new Date().toLocaleDateString("en-CA");

/**
 * Criar ou editar uma tarefa. O prazo vai como data e hora locais; a API interpreta no fuso da
 * conta. Criar usa uma Idempotency-Key fixa por formulário (clique duplo não duplica); editar manda
 * a versão no If-Match.
 */
export function TaskForm({
  task,
  subjects,
  returnTo = "/calendario",
  initialDate,
}: {
  task?: Task;
  subjects: SubjectOption[];
  /** Lista ou calendário, já validado pela página (taskReturnPath). */
  returnTo?: string;
  /** Data inicial vinda do calendário (dia clicado). */
  initialDate?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef(crypto.randomUUID());
  // A matéria da tarefa pode ser de outro semestre: continua na lista.
  const options =
    task?.subject && !subjects.some((s) => s.id === task.subject!.id)
      ? [...subjects, { id: task.subject.id, name: task.subject.name }]
      : subjects;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      title: formText(form, "tarefa-titulo"),
      notes: formText(form, "tarefa-notas"),
      subjectId: formText(form, "tarefa-materia") || null,
      dueAt: `${formText(form, "tarefa-data")}T${formText(form, "tarefa-hora")}`,
      // "" = sem aviso.
      remindBeforeMinutes: formText(form, "tarefa-aviso")
        ? Number(formText(form, "tarefa-aviso"))
        : null,
      externalUrl: formText(form, "tarefa-link"),
    };
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      if (task) {
        await api(`/v1/tasks/${task.id}`, { method: "PATCH", ifMatch: task.version, body });
        toast.push({ tone: "success", message: "Tarefa salva." });
      } else {
        await api("/v1/tasks", { method: "POST", idempotencyKey: key.current, body });
        toast.push({ tone: "success", message: "Tarefa criada." });
      }
      router.push(returnTo);
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const byField = e.fieldErrors;
      setFields(byField);
      setError(
        e.problem.status === 412
          ? "Esta tarefa mudou em outro lugar. Volte para a lista e abra de novo."
          : e.problem.errors
            ? undefined
            : e.message,
      );
      setPending(false);
    }
  }

  return (
    <form className="card grid gap-4 p-5 sm:p-6" onSubmit={(e) => void onSubmit(e)} noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="tarefa-titulo"
        label="Título"
        defaultValue={task?.title ?? ""}
        maxLength={200}
        required
        placeholder="Ex.: Lista 3 de Cálculo"
        error={fields.title}
      />
      <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="tarefa-materia">
        Matéria (opcional)
        <select
          id="tarefa-materia"
          name="tarefa-materia"
          defaultValue={task?.subjectId ?? ""}
          className={INPUT_CLASS}
        >
          <option value="">Sem matéria</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {fields.subjectId ? <span className="text-sm text-fail">{fields.subjectId}</span> : null}
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id="tarefa-data"
          label="Data do prazo"
          type="date"
          defaultValue={task?.dueLocal.date ?? initialDate ?? localToday()}
          required
          error={fields.dueAt}
        />
        <Field
          id="tarefa-hora"
          label="Hora do prazo"
          type="time"
          defaultValue={task?.dueLocal.time ?? "23:59"}
          required
        />
        <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="tarefa-aviso">
          Avisar
          <select
            id="tarefa-aviso"
            name="tarefa-aviso"
            defaultValue={
              task ? String(task.remindBeforeMinutes ?? "") : String(DEFAULT_TASK_REMIND)
            }
            className={INPUT_CLASS}
          >
            <option value="">Sem aviso</option>
            {REMIND_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="tarefa-notas">
        Observações (opcional)
        <textarea
          id="tarefa-notas"
          name="tarefa-notas"
          rows={3}
          maxLength={2000}
          defaultValue={task?.notes ?? ""}
          className={`${INPUT_CLASS} py-2`}
        />
      </label>
      <Field
        id="tarefa-link"
        label="Link da atividade (opcional)"
        type="url"
        inputMode="url"
        defaultValue={task?.externalUrl ?? ""}
        maxLength={2000}
        placeholder="https://moodle.../mod/assign/view.php?id=…"
        hint="Cole o endereço da atividade no Moodle ou em outro site, para abrir direto da tarefa."
        error={fields.externalUrl}
      />
      <p className="text-xs text-muted">
        O aviso chega no sino, no celular (se as notificações estiverem ligadas) e por e-mail,
        enquanto a tarefa estiver pendente.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {task ? "Salvar tarefa" : "Criar tarefa"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => router.push(returnTo)}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
