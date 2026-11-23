import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GoogleButton } from "@/components/google-button";
import { Alert, OrDivider, TextLink } from "@/components/ui";
import { getMe } from "@/lib/api-server";
import { redirectErrorMessage } from "@/lib/auth-messages";
import { safeNext, withNext } from "@/lib/next-path";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar · Monitor de Presenças" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getMe()) redirect(next ?? "/");
  const error = redirectErrorMessage(params.erro);

  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Entrar</h1>
        <p className="text-sm text-muted">
          Acompanhe suas faltas e saiba quanto ainda pode faltar.
        </p>
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <LoginForm next={next} />

      <OrDivider />

      <div className="grid gap-3">
        <GoogleButton label="Entrar com Google" />
        <a
          href="/entrar/link"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2 sm:min-h-10"
        >
          Receber link de acesso por e-mail
        </a>
      </div>

      <p className="text-center text-sm text-muted">
        Ainda não tem conta? <TextLink href={withNext("/cadastro", next)}>Criar conta</TextLink>
      </p>
    </>
  );
}
