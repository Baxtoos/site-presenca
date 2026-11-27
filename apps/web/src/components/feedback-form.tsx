"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

const KINDS = [
  { value: "sugestao", label: "Sugestão" },
  { value: "problema", label: "Problema" },
  { value: "outro", label: "Outro assunto" },
] as const;

export function FeedbackForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setPending(true);
    setError(undefined);
    setFieldError(undefined);
    try {
      await api("/v1/feedback", {
        method: "POST",
        body: { kind: formText(form, "fb-tipo"), message: formText(form, "fb-mensagem") },
      });
      formEl.reset();
      setSent(true);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFieldError(e.fieldErrors.message);
      if (!e.problem.errors) setError(e.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-4 card p-5 text-sm sm:p-6" aria-labelledby="sugestoes-titulo">
      <div className="grid gap-1">
        <h2 id="sugestoes-titulo" className="text-base font-semibold text-ink">
          Sugestões e problemas
        </h2>
        <p className="text-muted">
          Achou um erro ou tem uma ideia? Conte aqui. A resposta, se precisar, chega no seu e-mail.
        </p>
      </div>
      {sent ? <Alert tone="success">Recebido, obrigado! Sua mensagem foi enviada.</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form className="grid gap-3" onSubmit={(e) => void onSubmit(e)} noValidate>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className="mb-1.5 text-sm font-medium">Assunto</legend>
          {KINDS.map((k, i) => (
            <label key={k.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="fb-tipo"
                value={k.value}
                defaultChecked={i === 0}
                className="size-4 accent-accent"
              />
              {k.label}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-1.5">
          <label htmlFor="fb-mensagem" className="text-sm font-medium">
            Mensagem
          </label>
          <textarea
            id="fb-mensagem"
            name="fb-mensagem"
            rows={4}
            maxLength={2000}
            required
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "fb-mensagem-erro" : undefined}
            onInput={() => setSent(false)}
            className="w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 py-2 text-base outline-none hover:border-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent/20 sm:text-sm"
            placeholder="Ex.: na tela Hoje, a aula de Cálculo aparece no dia errado."
          />
          {fieldError ? (
            <p id="fb-mensagem-erro" className="text-sm text-fail">
              {fieldError}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="secondary" loading={pending} className="sm:w-fit">
          Enviar
        </Button>
      </form>
    </section>
  );
}
