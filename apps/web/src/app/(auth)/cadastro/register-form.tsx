"use client";

import type { MeResponse } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Alert, Button, Field, TextLink } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

export function RegisterForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; emailTaken: boolean }>();
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      await api<MeResponse>("/v1/auth/register", {
        method: "POST",
        body: {
          fullName: formText(form, "nome"),
          email: formText(form, "email"),
          password: formText(form, "senha"),
        },
      });
      router.replace("/");
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFields(e.fieldErrors);
      if (!e.problem.errors) setError({ message: e.message, emailTaken: e.code === "EMAIL_TAKEN" });
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? (
        <Alert tone="error">
          {error.message}{" "}
          {error.emailTaken ? <TextLink href="/esqueci-senha">Recuperar a senha</TextLink> : null}
        </Alert>
      ) : null}
      <Field id="nome" label="Nome" autoComplete="name" required error={fields.fullName} />
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
        autoComplete="new-password"
        minLength={10}
        required
        hint="Pelo menos 10 caracteres. Uma frase curta funciona bem."
        error={fields.password}
      />
      <Button type="submit" loading={pending}>
        Criar conta
      </Button>
    </form>
  );
}
