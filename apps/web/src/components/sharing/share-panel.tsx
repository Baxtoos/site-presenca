"use client";

import { type CreateTemplateBody, formatShareCode, type SharedTemplate } from "@presenca/contracts";
import Link from "next/link";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";
import { formText } from "@/lib/form";

const selectClass =
  "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-base outline-none hover:border-muted/60 focus:border-accent focus:ring-[3px] focus:ring-accent/20 sm:min-h-10 sm:text-sm";

export const importUrl = (code: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/importar/${code}`;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareResult({ template }: { template: SharedTemplate }) {
  const toast = useToast();
  const [qr, setQr] = useState<string>();
  const url = importUrl(template.code);

  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => setQr(undefined));
  }, [url]);

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="grid gap-4 rounded-xl bg-surface-2 p-4" data-testid="codigo-gerado">
      <div className="grid gap-1 text-center">
        <p className="text-xs text-muted">Código</p>
        <p
          className="font-mono text-3xl font-bold tracking-widest"
          aria-label={`Código ${template.code.split("").join(" ")}`}
        >
          {formatShareCode(template.code)}
        </p>
        <p className="text-xs text-muted">
          {template.expiresAt
            ? `Vale até ${new Date(template.expiresAt).toLocaleDateString("pt-BR")}`
            : "Sem data de validade"}
          {template.maxUses ? ` · até ${template.maxUses} importações` : ""}
        </p>
      </div>
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagem gerada no navegador (data URL)
        <img
          src={qr}
          alt="QR Code para importar a grade"
          width={200}
          height={200}
          className="mx-auto rounded-lg bg-white p-2"
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate" data-testid="link-importacao">
          {url}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            void copy(url).then((ok) =>
              toast.push(
                ok
                  ? { tone: "success", message: "Link copiado." }
                  : { tone: "error", message: "Não deu para copiar; selecione o link." },
              ),
            )
          }
        >
          Copiar link
        </Button>
        {canShare ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void navigator
                .share({
                  title: template.title,
                  text: `Importe a grade "${template.title}" no Monitor de Presenças (código ${formatShareCode(template.code)}).`,
                  url,
                })
                .catch(() => undefined)
            }
          >
            Compartilhar…
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Quem importar recebe as matérias, as regras de falta, os horários, os feriados e a regra de
        cálculo da nota (as avaliações e os pesos). Suas faltas, notas, tarefas, anotações e o seu
        Moodle nunca vão junto.
      </p>
    </div>
  );
}

export function SharePanel({
  source,
  defaultTitle,
  emailVerified,
}: {
  source: CreateTemplateBody["source"];
  defaultTitle: string;
  emailVerified: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<SharedTemplate>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [days, setDays] = useState(30);
  const [maxUses, setMaxUses] = useState<string>("");

  if (!emailVerified) {
    return (
      <Alert tone="info">
        Para compartilhar, confirme seu e-mail (o link está no aviso da página inicial). Assim quem
        recebe o código sabe que ele veio de uma conta real.
      </Alert>
    );
  }

  if (created) {
    return (
      <div className="grid gap-3">
        <ShareResult template={created} />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/compartilhar" className="font-medium text-accent hover:underline">
            Ver todos os seus códigos
          </Link>
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => setCreated(undefined)}
          >
            Gerar outro
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="w-fit">
        Gerar código para colegas
      </Button>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      const template = await api<SharedTemplate>("/v1/templates", {
        method: "POST",
        body: {
          source,
          title: formText(form, "titulo"),
          institution: formText(form, "instituicao"),
          course: formText(form, "curso"),
          expiresInDays: days,
          maxUses: maxUses === "" ? null : Number(maxUses),
        },
      });
      setCreated(template);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(e.fieldErrors);
        if (!e.problem.errors) setError(e.message);
      } else {
        setError("Não foi possível gerar o código.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      method="post"
      onSubmit={(e) => void onSubmit(e)}
      className="grid gap-4 rounded-xl bg-surface-2 p-4 text-sm"
      noValidate
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        id="titulo"
        label="Nome que os colegas veem"
        defaultValue={defaultTitle}
        maxLength={120}
        error={fields.title}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="instituicao"
          label="Instituição (opcional)"
          maxLength={120}
          error={fields.institution}
        />
        <Field id="curso" label="Curso (opcional)" maxLength={120} error={fields.course} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 font-medium" htmlFor="validade">
          Validade do código
          <select
            id="validade"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className={selectClass}
          >
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5 font-medium" htmlFor="limite-usos">
          Quantas pessoas podem importar
          <select
            id="limite-usos"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className={selectClass}
          >
            <option value="">Sem limite</option>
            <option value="1">1 pessoa</option>
            <option value="10">Até 10</option>
            <option value="50">Até 50</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          Gerar código
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
