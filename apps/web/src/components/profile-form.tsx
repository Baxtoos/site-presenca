"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useToast } from "@/components/toast";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

export function ProfileForm({
  initial,
}: {
  initial: { fullName: string; institution: string | null; course: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (name: string) => formText(form, name).trim() || null;
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      await api("/v1/me", {
        method: "PATCH",
        body: {
          fullName: formText(form, "perfil-nome"),
          institution: optional("perfil-instituicao"),
          course: optional("perfil-curso"),
        },
      });
      toast.push({ tone: "success", message: "Perfil salvo." });
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setFields(e.fieldErrors);
      if (!e.problem.errors) setError(e.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-4 card p-5 text-sm sm:p-6" aria-labelledby="perfil-titulo">
      <div className="grid gap-1">
        <h2 id="perfil-titulo" className="text-base font-semibold text-ink">
          Seu perfil
        </h2>
        <p className="text-muted">Aparece no topo, nos e-mails e na planilha exportada.</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field
          id="perfil-nome"
          label="Nome"
          defaultValue={initial.fullName}
          autoComplete="name"
          required
          maxLength={120}
          error={fields.fullName}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="perfil-instituicao"
            label="Instituição (opcional)"
            defaultValue={initial.institution ?? ""}
            maxLength={120}
            error={fields.institution}
            hint="Ex.: IFSP Câmpus Salto"
          />
          <Field
            id="perfil-curso"
            label="Curso (opcional)"
            defaultValue={initial.course ?? ""}
            maxLength={120}
            error={fields.course}
          />
        </div>
        <Button type="submit" variant="secondary" loading={pending} className="w-fit">
          Salvar perfil
        </Button>
      </form>
    </section>
  );
}
