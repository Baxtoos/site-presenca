"use client";

import { DEFAULT_TASK_REMIND, type SubjectGrading, type Task } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, Field, INPUT_CLASS } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";
import { REMIND_CHOICES } from "@/lib/tasks";

type SubjectOption = { id: string; name: string };

const localToday = () => new Date().toLocaleDateString("en-CA");

export function TaskForm({
  task,
  subjects,
  returnTo = "/calendario",
  initialDate,
}: {
  task?: Task;
  subjects: SubjectOption[];
  returnTo?: string;
  initialDate?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef(crypto.randomUUID());
  const imported = task !== undefined && task.source !== "manual";
  const options =
    task?.subject && !subjects.some((s) => s.id === task.subject!.id)
      ? [...subjects, { id: task.subject.id, name: task.subject.name }]
      : subjects;
  const [subjectId, setSubjectId] = useState(task?.subjectId ?? "");
  const [evaluations, setEvaluations] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    if (!subjectId) {
      setEvaluations([]);
      return;
    }
    api<SubjectGrading>(`/v1/subjects/${subjectId}/grading`)
      .then((g) => alive && setEvaluations(g.items.map((i) => ({ id: i.id, name: i.name }))))
      .catch(() => alive && setEvaluations([]));
    return () => {
      alive = false;
    };
  }, [subjectId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const common = {
      notes: formText(form, "tarefa-notas"),
      subjectId: formText(form, "tarefa-materia") || null,
      evaluationItemId: form.has("tarefa-avaliacao")
        ? formText(form, "tarefa-avaliacao") || null
        : undefined,
      remindBeforeMinutes: formText(form, "tarefa-aviso")
        ? Number(formText(form, "tarefa-aviso"))
        : null,
    };
    const body = imported
      ? common
      : {
          ...common,
          title: formText(form, "tarefa-titulo"),
          dueAt: `${formText(form, "tarefa-data")}T${formText(form, "tarefa-hora")}`,
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
      {imported ? (
        <Alert tone="info">
          Esta tarefa veio do Moodle: título, prazo e link seguem o Moodle e se atualizam sozinhos.
          Você pode mudar a matéria, o aviso e as observações.
        </Alert>
      ) : null}
      <Field
        id="tarefa-titulo"
        disabled={imported}
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
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
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
      {evaluations.length > 0 ? (
        <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="tarefa-avaliacao">
          Vale nota? Avaliação (opcional)
          <select
            key={subjectId}
            id="tarefa-avaliacao"
            name="tarefa-avaliacao"
            defaultValue={task?.subjectId === subjectId ? (task?.evaluation?.id ?? "") : ""}
            className={INPUT_CLASS}
          >
            <option value="">Não vale nota</option>
            {evaluations.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-muted">
            Depois de entregue, a tarefa lembra você de lançar a nota.
          </span>
          {fields.evaluationItemId ? (
            <span className="text-sm text-fail">{fields.evaluationItemId}</span>
          ) : null}
        </label>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          id="tarefa-data"
          disabled={imported}
          label="Data do prazo"
          type="date"
          defaultValue={task?.dueLocal.date ?? initialDate ?? localToday()}
          required
          error={fields.dueAt}
        />
        <Field
          id="tarefa-hora"
          disabled={imported}
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
        disabled={imported}
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
