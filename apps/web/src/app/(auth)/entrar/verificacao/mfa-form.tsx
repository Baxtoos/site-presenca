"use client";

import type { MeResponse } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field, TextLink } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";
import { withNext } from "@/lib/next-path";

export function MfaForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [recovery, setRecovery] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; expired: boolean }>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      await api<MeResponse>("/v1/auth/mfa/verify", {
        method: "POST",
        body: { code: formText(form, "codigo") },
      });
      router.replace(next ?? "/");
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setError({ message: e.message, expired: e.code === "MFA_CHALLENGE_EXPIRED" });
      setPending(false);
    }
  }

  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? (
        <Alert tone="error">
          {error.message}{" "}
          {error.expired ? (
            <TextLink href={withNext("/entrar", next)}>Entrar de novo</TextLink>
          ) : null}
        </Alert>
      ) : null}
      {recovery ? (
        <Field
          key="recuperacao"
          id="codigo"
          label="Código de recuperação"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          hint="Um dos códigos que você guardou ao ligar a verificação (ex.: ABCD-EFGH). Cada um vale uma vez."
        />
      ) : (
        <Field
          key="app"
          id="codigo"
          label="Código do app"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
        />
      )}
      <Button type="submit" loading={pending}>
        Verificar e entrar
      </Button>
      <button
        type="button"
        className="justify-self-center text-sm font-medium text-accent hover:underline"
        onClick={() => {
          setRecovery((v) => !v);
          setError(undefined);
        }}
      >
        {recovery ? "Usar o código do app" : "Perdeu o celular? Usar um código de recuperação"}
      </button>
    </form>
  );
}
