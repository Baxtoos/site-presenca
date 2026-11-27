import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/ui";
import { getMe } from "@/lib/api-server";
import { safeNext, withNext } from "@/lib/next-path";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Verificação em duas etapas · Monitor de Presenças" };

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getMe()) redirect(next ?? "/");
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Verificação em duas etapas</h1>
        <p className="text-sm text-muted">
          Abra o app autenticador no celular e digite o código de 6 dígitos do Monitor de Presenças.
        </p>
      </header>
      <MfaForm next={next} />
      <p className="text-center text-sm text-muted">
        <TextLink href={withNext("/entrar", next)}>Voltar para o login</TextLink>
      </p>
    </>
  );
}
