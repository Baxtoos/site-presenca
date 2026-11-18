"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button, Field, TextLink } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; tokenInvalid: boolean }>();
  const [fieldError, setFieldError] = useState<string>();

  // Tira o token da barra de endereço (o formulário já o tem em memória).
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = formText(form, "senha");
    if (password !== formText(form, "confirmacao")) {
      setFieldError("As duas senhas precisam ser iguais.");
      return;
    }
    setPending(true);
    setError(undefined);
    setFieldError(undefined);
    try {
      await api("/v1/auth/password/reset", { method: "POST", body: { token, password } });
      router.replace("/");
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFieldError(e.fieldErrors.password);
      if (!e.problem.errors)
        setError({ message: e.message, tokenInvalid: e.code === "INVALID_TOKEN" });
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? (
        <Alert tone="error">
          {error.message}{" "}
          {error.tokenInvalid ? <TextLink href="/esqueci-senha">Pedir novo link</TextLink> : null}
        </Alert>
      ) : null}
      <Field
        id="senha"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        hint="Pelo menos 10 caracteres."
        error={fieldError}
      />
      <Field
        id="confirmacao"
        label="Repita a nova senha"
        type="password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" loading={pending}>
        Salvar e entrar
      </Button>
    </form>
  );
}
