"use client";

import type { MeResponse } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field, TextLink } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      await api<MeResponse>("/v1/auth/login", {
        method: "POST",
        body: { email: formText(form, "email"), password: formText(form, "senha") },
      });
      router.replace("/");
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFields(e.fieldErrors);
      setError(e.problem.errors ? undefined : e.message);
      setPending(false);
    }
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
        error={fields.email}
      />
      <Field
        id="senha"
        label="Senha"
        type="password"
        autoComplete="current-password"
        required
        error={fields.password}
      />
      <div className="-mt-1 text-right text-sm">
        <TextLink href="/esqueci-senha">Esqueci a senha</TextLink>
      </div>
      <Button type="submit" loading={pending}>
        Entrar
      </Button>
    </form>
  );
}
