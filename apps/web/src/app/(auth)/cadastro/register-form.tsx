"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

/**
 * Cadastro em duas etapas: o formulário só pede o link; a conta nasce quando o link do e-mail é
 * aberto. A resposta é a mesma para e-mail novo ou já cadastrado (não revela quem tem conta).
 */
export function RegisterForm({ next = null }: { next?: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sentTo, setSentTo] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = formText(form, "email");
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      await api("/v1/auth/register", {
        method: "POST",
        body: {
          fullName: formText(form, "nome"),
          email,
          password: formText(form, "senha"),
          ...(next ? { next } : {}),
        },
      });
      setSentTo(email.trim().toLowerCase());
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFields(e.fieldErrors);
      if (!e.problem.errors) setError(e.message);
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="grid gap-4" role="status">
        <Alert tone="success">
          <strong className="font-semibold">Confira seu e-mail.</strong> Enviamos um link para{" "}
          <span className="[overflow-wrap:anywhere]">{sentTo}</span>. Abra-o para criar a conta.
        </Alert>
        <p className="text-sm text-muted">
          O link vale por 24 horas. Se não chegar em alguns minutos, olhe a caixa de spam ou{" "}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => setSentTo(undefined)}
          >
            tente de novo
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
      {error ? <Alert tone="error">{error}</Alert> : null}
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
        minLength={8}
        required
        hint="Pelo menos 8 caracteres."
        error={fields.password}
      />
      <Button type="submit" loading={pending}>
        Criar conta
      </Button>
    </form>
  );
}
