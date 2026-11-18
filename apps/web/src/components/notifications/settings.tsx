"use client";

import type { NotificationPreferences, UnreadCount } from "@presenca/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";
import { WEEKDAYS } from "@/lib/format";
import {
  currentPushSubscription,
  disablePushOnThisDevice,
  enablePush,
  PushSetupError,
  pushSupport,
} from "@/lib/push-client";

const THRESHOLDS = [50, 75, 90, 100] as const;
const inputClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-base disabled:opacity-60";

function Toggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-accent"
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Preferências de aviso: canais, marcos, lembrete de chamada, horário silencioso e push do aparelho. */
export function NotificationSettings({ initial }: { initial: NotificationPreferences }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [quiet, setQuiet] = useState(initial.quietStart !== null);
  const [device, setDevice] = useState<"checking" | "on" | "off" | "unsupported" | "ios">(
    "checking",
  );
  const [pushBusy, setPushBusy] = useState(false);

  // Estado do push NESTE aparelho (só o navegador sabe).
  useEffect(() => {
    const support = pushSupport();
    if (support !== "ok") {
      setDevice(support === "ios-needs-install" ? "ios" : "unsupported");
      return;
    }
    void currentPushSubscription()
      .then((sub) => setDevice(sub ? "on" : "off"))
      .catch(() => setDevice("off"));
  }, []);

  const set = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => setPrefs((p) => ({ ...p, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setFieldErrors({});
    try {
      const saved = await api<NotificationPreferences>("/v1/notification-preferences", {
        method: "PUT",
        body: {
          emailEnabled: prefs.emailEnabled,
          pushEnabled: prefs.pushEnabled,
          thresholds: prefs.thresholds,
          checkinReminder: prefs.checkinReminder,
          checkinTime: prefs.checkinTime,
          checkinWeekday: prefs.checkinWeekday,
          quietStart: quiet ? (prefs.quietStart ?? "22:00") : null,
          quietEnd: quiet ? (prefs.quietEnd ?? "07:00") : null,
        },
      });
      setPrefs(saved);
      toast.push({ tone: "success", message: "Preferências de aviso salvas." });
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        if (!e.problem.errors) setError(e.message);
      } else {
        setError("Não foi possível salvar.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function turnOnPush() {
    if (!prefs.vapidPublicKey) return;
    setPushBusy(true);
    try {
      const devices = await enablePush(prefs.vapidPublicKey);
      setPrefs((p) => ({ ...p, pushEnabled: true, pushDevices: devices }));
      setDevice("on");
      toast.push({ tone: "success", message: "Notificações ativadas neste aparelho." });
    } catch (e) {
      toast.push({
        tone: "error",
        message:
          e instanceof PushSetupError || e instanceof ApiError
            ? e.message
            : "Não foi possível ativar.",
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function turnOffPush() {
    setPushBusy(true);
    try {
      const devices = await disablePushOnThisDevice();
      if (devices !== null) setPrefs((p) => ({ ...p, pushDevices: devices }));
      setDevice("off");
      toast.push({ message: "Notificações desativadas neste aparelho." });
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível desativar.",
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTest() {
    try {
      await api<UnreadCount>("/v1/notifications/test", { method: "POST" });
      toast.push({
        tone: "success",
        message: prefs.pushEnabled
          ? "Aviso de teste enviado. Ele chega neste aparelho em alguns segundos."
          : "Aviso de teste enviado para a central.",
      });
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível enviar.",
      });
    }
  }

  return (
    <form
      method="post"
      onSubmit={(e) => void save(e)}
      className="grid gap-6 rounded-2xl border border-line bg-surface p-6 text-sm"
      aria-labelledby="notificacoes"
      noValidate
    >
      <h2 id="notificacoes" className="scroll-mt-24 text-base font-semibold">
        Avisos
      </h2>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">Alertas de faltas</legend>
        <p className="text-muted">Avisar quando uma matéria chegar a:</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Marcos de alerta">
          {THRESHOLDS.map((pct) => {
            const on = prefs.thresholds.includes(pct);
            return (
              <label
                key={pct}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${
                  on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    set(
                      "thresholds",
                      e.target.checked
                        ? [...prefs.thresholds, pct].sort((a, b) => a - b)
                        : prefs.thresholds.filter((t) => t !== pct),
                    )
                  }
                  className="size-4 accent-accent"
                />
                {pct === 100 ? "100% (limite)" : `${pct}%`}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted">
          Cada marco avisa uma vez. Se você corrigir ou abonar faltas e voltar a ficar abaixo, ele
          avisa de novo quando cruzar outra vez.
        </p>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">Onde receber</legend>
        <p className="text-muted">A central de avisos (o sino) sempre recebe.</p>
        <Toggle
          id="aviso-email"
          label="E-mail"
          hint={
            prefs.emailVerified
              ? undefined
              : "Confirme seu e-mail para receber os alertas por e-mail (o link está no aviso da página inicial)."
          }
          checked={prefs.emailEnabled}
          onChange={(v) => set("emailEnabled", v)}
        />
        <div className="grid gap-2 rounded-xl bg-surface-2 p-3">
          <Toggle
            id="aviso-push"
            label="Notificações no celular ou computador"
            hint={
              prefs.pushDevices > 0
                ? `${prefs.pushDevices} ${prefs.pushDevices === 1 ? "aparelho ativo" : "aparelhos ativos"}.`
                : "Ative em cada aparelho em que quiser receber."
            }
            checked={prefs.pushEnabled}
            onChange={(v) => set("pushEnabled", v)}
          />
          {!prefs.vapidPublicKey ? (
            <p className="text-xs text-muted">
              O servidor ainda não está configurado para notificações.
            </p>
          ) : device === "ios" ? (
            <p className="text-xs text-muted">
              No iPhone, instale o app (Compartilhar → Adicionar à Tela de Início) e abra por ele
              para ativar.
            </p>
          ) : device === "unsupported" ? (
            <p className="text-xs text-muted">Este navegador não oferece notificações.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {device === "on" ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    loading={pushBusy}
                    onClick={() => void turnOffPush()}
                  >
                    Desativar neste aparelho
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void sendTest()}>
                    Enviar teste
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  loading={pushBusy || device === "checking"}
                  onClick={() => void turnOnPush()}
                >
                  Ativar neste aparelho
                </Button>
              )}
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">Lembrete de marcar a chamada</legend>
        <div className="grid gap-2" role="radiogroup" aria-label="Frequência do lembrete">
          {(
            [
              ["off", "Não lembrar"],
              ["daily", "Todo dia com aula, se faltar marcar alguma"],
              ["weekly", "Uma vez por semana, com o que ficou sem registro"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-3">
              <input
                type="radio"
                name="lembrete"
                value={value}
                checked={prefs.checkinReminder === value}
                onChange={() => set("checkinReminder", value)}
                className="size-4 accent-accent"
              />
              {label}
            </label>
          ))}
        </div>
        {prefs.checkinReminder !== "off" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 font-medium" htmlFor="lembrete-hora">
              Horário
              <input
                id="lembrete-hora"
                type="time"
                value={prefs.checkinTime}
                onChange={(e) => set("checkinTime", e.target.value)}
                className={inputClass}
              />
              {fieldErrors.checkinTime ? (
                <span className="text-fail">{fieldErrors.checkinTime}</span>
              ) : null}
            </label>
            {prefs.checkinReminder === "weekly" ? (
              <label className="grid min-w-0 gap-1.5 font-medium" htmlFor="lembrete-dia">
                Dia
                <select
                  id="lembrete-dia"
                  value={prefs.checkinWeekday}
                  onChange={(e) => set("checkinWeekday", Number(e.target.value))}
                  className={inputClass}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAYS[d]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">Horário silencioso</legend>
        <Toggle
          id="silencio"
          label="Não mandar e-mail nem notificação neste horário"
          hint="O que chegar no período é entregue quando ele acabar. A central recebe na hora."
          checked={quiet}
          onChange={setQuiet}
        />
        {quiet ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="grid min-w-0 gap-1.5 font-medium" htmlFor="silencio-inicio">
              De
              <input
                id="silencio-inicio"
                type="time"
                value={prefs.quietStart ?? "22:00"}
                onChange={(e) => set("quietStart", e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 font-medium" htmlFor="silencio-fim">
              Até
              <input
                id="silencio-fim"
                type="time"
                value={prefs.quietEnd ?? "07:00"}
                onChange={(e) => set("quietEnd", e.target.value)}
                className={inputClass}
              />
              {fieldErrors.quietEnd ? (
                <span className="text-fail">{fieldErrors.quietEnd}</span>
              ) : null}
            </label>
          </div>
        ) : null}
      </fieldset>

      <Button type="submit" loading={saving} className="w-fit">
        Salvar avisos
      </Button>
    </form>
  );
}
