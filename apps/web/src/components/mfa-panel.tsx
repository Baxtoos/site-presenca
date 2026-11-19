"use client";

import type {
  MfaRecoveryCodesResponse,
  MfaSetupResponse,
  MfaStatusResponse,
} from "@presenca/contracts";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { CheckCircleIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

type Mode =
  | { kind: "idle" }
  | { kind: "setup"; setup: MfaSetupResponse }
  | { kind: "codes"; codes: string[] }
  | { kind: "confirm"; action: "disable" | "regenerate" };

const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : "Algo deu errado.");

/** Verificação em duas etapas (app autenticador) na página Conta. */
export function MfaPanel({
  initial,
  hasPassword,
}: {
  initial: MfaStatusResponse;
  hasPassword: boolean;
}) {
  const toast = useToast();
  const [status, setStatus] = useState(initial);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    setStatus(await api<MfaStatusResponse>("/v1/me/mfa"));
  }

  async function startSetup() {
    setPending(true);
    setError(undefined);
    try {
      const setup = await api<MfaSetupResponse>("/v1/me/mfa/setup", { method: "POST" });
      setMode({ kind: "setup", setup });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>, run: (form: FormData) => Promise<void>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      await run(form);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-4 card p-5 text-sm sm:p-6" aria-labelledby="mfa-titulo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="mfa-titulo" className="text-base font-semibold text-ink">
            Verificação em duas etapas
          </h2>
          <p className="max-w-prose text-muted">
            Além da senha (ou do link por e-mail), o login pede um código do app autenticador do seu
            celular, como Google Authenticator, Microsoft Authenticator ou 1Password.
          </p>
        </div>
        {status.enabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
            <CheckCircleIcon size={14} />
            Ligada
          </span>
        ) : null}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!status.available ? (
        <p className="text-muted">Ainda não está disponível neste servidor.</p>
      ) : mode.kind === "setup" ? (
        <SetupStep
          setup={mode.setup}
          hasPassword={hasPassword}
          pending={pending}
          onCancel={() => setMode({ kind: "idle" })}
          onSubmit={(e) =>
            void submit(e, async (form) => {
              const { recoveryCodes } = await api<MfaRecoveryCodesResponse>("/v1/me/mfa/enable", {
                method: "POST",
                body: {
                  code: formText(form, "mfa-codigo"),
                  ...(hasPassword ? { password: formText(form, "mfa-senha") } : {}),
                },
              });
              setMode({ kind: "codes", codes: recoveryCodes });
              await refresh();
            })
          }
        />
      ) : mode.kind === "codes" ? (
        <RecoveryCodes
          codes={mode.codes}
          onDone={() => {
            setMode({ kind: "idle" });
            toast.push({ tone: "success", message: "Verificação em duas etapas ligada." });
          }}
        />
      ) : mode.kind === "confirm" ? (
        <form
          className="grid gap-3"
          onSubmit={(e) =>
            void submit(e, async (form) => {
              const code = formText(form, "mfa-confirmar");
              if (mode.action === "disable") {
                await api("/v1/me/mfa/disable", { method: "POST", body: { code } });
                setMode({ kind: "idle" });
                toast.push({ tone: "success", message: "Verificação em duas etapas desligada." });
              } else {
                const { recoveryCodes } = await api<MfaRecoveryCodesResponse>(
                  "/v1/me/mfa/recovery-codes",
                  { method: "POST", body: { code } },
                );
                setMode({ kind: "codes", codes: recoveryCodes });
              }
              await refresh();
            })
          }
        >
          <Field
            id="mfa-confirmar"
            label="Código do app ou de recuperação"
            autoComplete="one-time-code"
            required
            hint={
              mode.action === "disable"
                ? "Para desligar, confirme que é você."
                : "Os códigos de recuperação antigos deixam de valer."
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={mode.action === "disable" ? "danger" : "primary"}
              loading={pending}
            >
              {mode.action === "disable" ? "Desligar" : "Gerar novos códigos"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setMode({ kind: "idle" })}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : status.enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted">
            {status.recoveryCodesLeft === 1
              ? "Resta 1 código de recuperação."
              : `Restam ${status.recoveryCodesLeft} códigos de recuperação.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setMode({ kind: "confirm", action: "regenerate" })}
            >
              Novos códigos de recuperação
            </Button>
            <Button variant="ghost" onClick={() => setMode({ kind: "confirm", action: "disable" })}>
              Desligar
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button loading={pending} onClick={() => void startSetup()}>
            Ligar verificação em duas etapas
          </Button>
        </div>
      )}
    </section>
  );
}

function SetupStep({
  setup,
  hasPassword,
  pending,
  onCancel,
  onSubmit,
}: {
  setup: MfaSetupResponse;
  hasPassword: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [qr, setQr] = useState<string>();
  useEffect(() => {
    void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => setQr(undefined));
  }, [setup.otpauthUrl]);
  const grouped = setup.secret.match(/.{1,4}/g)?.join(" ") ?? setup.secret;

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <ol className="grid list-decimal gap-1 pl-5 text-muted">
        <li>No app autenticador, adicione uma conta lendo o QR Code abaixo.</li>
        <li>Digite o código de 6 dígitos que aparecer no app.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL gerada no navegador
          <img
            src={qr}
            alt="QR Code para adicionar o Monitor de Presenças ao app autenticador"
            width={160}
            height={160}
            className="rounded-md border border-line bg-white p-1"
          />
        ) : null}
        <div className="grid min-w-0 gap-1">
          <p className="text-muted">Sem câmera? Digite esta chave no app:</p>
          <code
            className="w-fit rounded-md bg-surface-2 px-2 py-1 font-mono text-sm tracking-wider [overflow-wrap:anywhere]"
            data-testid="mfa-chave"
          >
            {grouped}
          </code>
        </div>
      </div>
      <Field
        id="mfa-codigo"
        label="Código do app"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
      />
      {hasPassword ? (
        <Field
          id="mfa-senha"
          label="Senha atual"
          type="password"
          autoComplete="current-password"
          required
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          Ligar
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  return (
    <div className="grid gap-3">
      <Alert tone="info">
        Guarde estes códigos de recuperação num lugar seguro. Se perder o celular, cada um permite
        entrar uma vez. Eles não aparecem de novo.
      </Alert>
      <ul
        className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-surface-2 p-3 font-mono text-sm sm:w-fit"
        data-testid="mfa-codigos"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)}
        >
          Copiar
        </Button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Monitor de Presenças: códigos de recuperação\n\n${text}\n`)}`}
          download="codigos-de-recuperacao-presencas.txt"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2 sm:min-h-10"
        >
          Baixar .txt
        </a>
        <Button onClick={onDone}>Já guardei</Button>
      </div>
    </div>
  );
}
