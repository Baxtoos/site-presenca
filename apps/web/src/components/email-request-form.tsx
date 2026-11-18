"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

/**
 * Pede um e-mail e chama uma rota que responde sempre igual (magic link, esqueci a senha).
 * A mensagem de sucesso não confirma se a conta existe.
 */
export function EmailRequestForm({
  endpoint,
  submitLabel,
  sentMessage,
}: {
  endpoint: "/v1/auth/magic-link" | "/v1/auth/password/forgot";
  submitLabel: string;
  /** Texto de confirmação; "{email}" é trocado pelo endereço digitado. */
  sentMessage: string;
}) {
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = formText(new FormData(event.currentTarget), "email");
    setPending(true);
    setError(undefined);
    setFieldError(undefined);
    try {
      await api(endpoint, { method: "POST", body: { email } });
      setSentTo(email.trim().toLowerCase());
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFieldError(e.fieldErrors.email);
      if (!e.problem.errors) setError(e.message);
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="grid gap-4">
        <Alert tone="success">{sentMessage.replace("{email}", sentTo)}</Alert>
        <p className="text-sm text-muted">
          Não chegou? Confira o spam. O link vale por 15 minutos; pedir de novo invalida o anterior.
        </p>
        <Button type="button" variant="secondary" onClick={() => setSentTo(undefined)}>
          Usar outro e-mail
        </Button>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        error={fieldError}
      />
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
