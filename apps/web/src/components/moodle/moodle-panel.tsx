"use client";

import type {
  MoodleConnection,
  MoodleCourse,
  MoodleStatus,
  MoodleSyncResult,
} from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, Field, INPUT_CLASS, SectionTitle } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

type SubjectOption = { id: string; name: string };

const TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function summary(r: MoodleSyncResult): string {
  const parts = [
    r.created ? `${r.created} ${r.created === 1 ? "tarefa nova" : "tarefas novas"}` : null,
    r.updated ? `${r.updated} ${r.updated === 1 ? "atualizada" : "atualizadas"}` : null,
    r.completed
      ? `${r.completed} ${r.completed === 1 ? "concluída pelo Moodle" : "concluídas pelo Moodle"}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? `Sincronizado: ${parts.join(", ")}.` : "Sincronizado: nada mudou.";
}

export function MoodlePanel({
  initial,
  subjects,
}: {
  initial: MoodleStatus;
  subjects: SubjectOption[];
}) {
  const conn = initial.connection;
  if (!initial.available) {
    return (
      <Alert tone="info">
        A integração com o Moodle ainda não está ligada neste servidor. Enquanto isso, cadastre as
        entregas em Calendário → Nova tarefa.
      </Alert>
    );
  }
  return conn ? (
    <Connected conn={conn} subjects={subjects} />
  ) : (
    <section className="card grid gap-5 p-5 sm:p-6" aria-labelledby="conectar-moodle">
      <SectionTitle id="conectar-moodle">Conectar em 1 minuto</SectionTitle>
      <Steps />
      <ConnectForm />
    </section>
  );
}

function Steps() {
  return (
    <ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed">
      <li>Abra o Moodle da sua instituição e entre na sua conta.</li>
      <li>
        Vá em <strong>Calendário</strong> e toque em <strong>Exportar calendário</strong> (em alguns
        Moodles fica em <em>Importar ou exportar calendários</em>).
      </li>
      <li>
        Em <em>Eventos a exportar</em>, escolha <strong>Todos os eventos</strong>; em <em>Para</em>,
        escolha <strong>Eventos recentes e próximos</strong>.
      </li>
      <li>
        Toque em <strong>Obter URL do calendário</strong> e copie o link que aparece.
      </li>
      <li>Cole o link abaixo e toque em Testar e conectar.</li>
    </ol>
  );
}

function ConnectForm({ editing, onDone }: { editing?: MoodleConnection; onDone?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const icsUrl = formText(form, "moodle-ics");
    const baseUrl = formText(form, "moodle-endereco");
    const wstoken = formText(form, "moodle-chave");
    const body: Record<string, unknown> = {};
    if (icsUrl) body.icsUrl = icsUrl;
    if (baseUrl) body.baseUrl = baseUrl;
    if (wstoken) body.wstoken = wstoken;
    if (Object.keys(body).length === 0) {
      setFields({ icsUrl: "Cole o link do calendário do Moodle." });
      return;
    }
    setPending(true);
    setFields({});
    setError(undefined);
    try {
      const result = await api<MoodleSyncResult>("/v1/moodle", { method: "PUT", body });
      toast.push({ tone: "success", message: summary(result) });
      onDone?.();
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFields(e.fieldErrors);
      setError(e.problem.errors ? undefined : e.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="moodle-ics"
        label={editing ? "Novo link do calendário (opcional)" : "Link do calendário do Moodle"}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://moodle.../calendar/export_execute.php?…"
        hint="O link funciona como uma senha: o Monitor guarda cifrado e nunca mostra de novo. Não compartilhe."
        error={fields.icsUrl}
      />
      <details className="grid gap-3 rounded-lg border border-line p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Opcional: marcar como concluída quando eu enviar e trazer as notas do Moodle
        </summary>
        <p className="mt-2 text-muted">
          No Moodle, abra <strong>Preferências → Chaves de segurança</strong> e copie a chave do{" "}
          <em>Moodle mobile web service</em>. Se essa opção não aparecer, a instituição não liberou:
          o link do calendário já basta. Com a chave, as notas lançadas pelo professor também chegam
          (ligue as avaliações na seção Notas de cada matéria).
        </p>
        <div className="mt-3 grid gap-3">
          <Field
            id="moodle-endereco"
            label="Endereço do Moodle"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://moodle.exemplo.edu.br"
            defaultValue=""
            error={fields.baseUrl}
          />
          <Field
            id="moodle-chave"
            label={editing?.hasToken ? "Nova chave de segurança" : "Chave de segurança"}
            autoComplete="off"
            spellCheck={false}
            error={fields.wstoken}
          />
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {editing ? "Testar e salvar" : "Testar e conectar"}
        </Button>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Connected({ conn, subjects }: { conn: MoodleConnection; subjects: SubjectOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const syncKey = useRef<string | null>(null);

  async function act(label: string, action: () => Promise<string>) {
    setBusy(label);
    try {
      toast.push({ tone: "success", message: await action() });
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível falar com o servidor.",
      });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const syncNow = () =>
    act("sync", async () => {
      syncKey.current ??= crypto.randomUUID();
      try {
        const r = await api<MoodleSyncResult>("/v1/moodle/sync", {
          method: "POST",
          idempotencyKey: syncKey.current,
        });
        return summary(r);
      } finally {
        syncKey.current = null;
      }
    });

  const toggleAuto = () =>
    act("auto", async () => {
      await api("/v1/moodle", { method: "PUT", body: { syncEnabled: !conn.syncEnabled } });
      return conn.syncEnabled
        ? "Sincronização automática desligada."
        : "Sincronização automática ligada.";
    });

  const disconnect = (keepTasks: boolean) =>
    act("disconnect", async () => {
      await api(`/v1/moodle?keepTasks=${keepTasks}`, { method: "DELETE", ifMatch: conn.version });
      return keepTasks
        ? "Moodle desconectado. As tarefas ficaram como manuais."
        : "Moodle desconectado. As tarefas futuras importadas foram apagadas.";
    });

  return (
    <>
      <section
        className="card grid gap-4 p-5 sm:p-6"
        aria-labelledby="moodle-estado"
        data-testid="moodle-conectado"
      >
        <SectionTitle id="moodle-estado">Conectado</SectionTitle>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Moodle</dt>
            <dd className="font-medium [overflow-wrap:anywhere]">{conn.icsHost}</dd>
          </div>
          <div>
            <dt className="text-muted">Conclusão automática</dt>
            <dd className="font-medium">
              {conn.hasToken ? "Ligada (com a chave)" : "Desligada (só o calendário)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Última sincronização</dt>
            <dd className="font-medium">
              {conn.lastSyncAt ? TIME.format(new Date(conn.lastSyncAt)) : "Ainda não"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Tarefas importadas</dt>
            <dd className="font-medium">{conn.importedCount}</dd>
          </div>
        </dl>
        {conn.lastSyncError ? <Alert tone="error">{conn.lastSyncError}</Alert> : null}
        <p className="text-sm text-muted">
          {conn.syncEnabled
            ? `Sincroniza sozinho a cada 45 minutos, mais ou menos (próxima por volta de ${TIME.format(new Date(conn.nextSyncAt))}). Prazos novos ou adiados pelo professor entram no calendário com aviso.`
            : "A sincronização automática está desligada. Use Sincronizar agora quando quiser."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            loading={busy === "sync"}
            disabled={busy !== null}
            onClick={() => void syncNow()}
          >
            Sincronizar agora
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={busy === "auto"}
            disabled={busy !== null}
            onClick={() => void toggleAuto()}
          >
            {conn.syncEnabled ? "Desligar automática" : "Ligar automática"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => setEditing((v) => !v)}
          >
            Trocar link ou chave
          </Button>
        </div>
        {editing ? <ConnectForm editing={conn} onDone={() => setEditing(false)} /> : null}
      </section>

      <Courses courses={conn.courses} subjects={subjects} />

      <section className="card grid gap-3 p-5 text-sm sm:p-6" aria-labelledby="moodle-desconectar">
        <SectionTitle id="moodle-desconectar">Desconectar</SectionTitle>
        <p className="text-muted">
          O link e a chave são apagados. Você escolhe o que fazer com as tarefas que vieram do
          Moodle.
        </p>
        {confirm ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              loading={busy === "disconnect"}
              onClick={() => void disconnect(true)}
            >
              Desconectar e manter as tarefas
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy !== null}
              onClick={() => void disconnect(false)}
            >
              Desconectar e apagar as futuras
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="danger" className="w-fit" onClick={() => setConfirm(true)}>
            Desconectar o Moodle
          </Button>
        )}
      </section>
    </>
  );
}

const IGNORE = "__ignorar__";

function Courses({ courses, subjects }: { courses: MoodleCourse[]; subjects: SubjectOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState<string | null>(null);

  async function change(course: MoodleCourse, value: string) {
    setSaving(course.id);
    const body =
      value === IGNORE ? { ignored: true } : { subjectId: value || null, ignored: false };
    try {
      await api(`/v1/moodle/courses/${course.id}`, {
        method: "PATCH",
        ifMatch: course.version,
        body,
      });
      toast.push({
        tone: "success",
        message:
          value === IGNORE
            ? `Turma ${course.courseKey} ignorada: as entregas dela não entram mais.`
            : "Turma ligada à matéria. As tarefas importadas foram atualizadas.",
      });
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível salvar.",
      });
    } finally {
      setSaving(null);
      router.refresh();
    }
  }

  return (
    <section className="card grid gap-3 p-5 sm:p-6" aria-labelledby="moodle-turmas">
      <SectionTitle id="moodle-turmas">Turmas do Moodle</SectionTitle>
      {courses.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma turma encontrada ainda. Elas aparecem aqui quando o Moodle tiver entregas com
          prazo.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Ligue cada turma a uma matéria do semestre para as entregas aparecerem com a cor e o
            nome dela. Turma ignorada não entra no calendário.
          </p>
          <ul className="grid gap-3">
            {courses.map((c) => {
              const options =
                c.subjectId && !subjects.some((s) => s.id === c.subjectId)
                  ? [...subjects, { id: c.subjectId, name: c.subjectName ?? "Matéria" }]
                  : subjects;
              const id = `turma-${c.id}`;
              return (
                <li
                  key={c.id}
                  className="grid gap-1.5 sm:grid-cols-[1fr_16rem] sm:items-center"
                  data-testid="turma-moodle"
                >
                  <label htmlFor={id} className="text-sm">
                    <span className="font-medium [overflow-wrap:anywhere]">{c.courseKey}</span>
                    <span className="block text-xs text-muted">
                      {c.taskCount} {c.taskCount === 1 ? "tarefa importada" : "tarefas importadas"}
                    </span>
                  </label>
                  <select
                    id={id}
                    className={INPUT_CLASS}
                    value={c.ignored ? IGNORE : (c.subjectId ?? "")}
                    disabled={saving === c.id}
                    onChange={(e) => void change(c, e.target.value)}
                  >
                    <option value="">Sem matéria</option>
                    {options.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value={IGNORE}>Ignorar esta turma</option>
                  </select>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
