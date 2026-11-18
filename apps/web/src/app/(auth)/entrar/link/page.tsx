import type { Metadata } from "next";
import { ConsumeToken } from "@/components/consume-token";
import { EmailRequestForm } from "@/components/email-request-form";
import { TextLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "Link de acesso · Monitor de Presenças",
  // A URL pode conter o token: nada de enviá-la como Referer para outros sites.
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && TOKEN.test(raw) ? raw : undefined;

  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Entrar sem senha</h1>
        <p className="text-sm text-muted">
          Mandamos um link de uso único para o seu e-mail. Se ainda não tiver conta, ela é criada.
        </p>
      </header>

      {token ? (
        <ConsumeToken
          token={token}
          endpoint="/v1/auth/magic-link/consume"
          redirectTo="/"
          pendingText="Entrando…"
          failureExtra={
            <EmailRequestForm
              endpoint="/v1/auth/magic-link"
              submitLabel="Enviar novo link"
              sentMessage="Se {email} puder receber, o link chega em instantes."
            />
          }
        />
      ) : (
        <EmailRequestForm
          endpoint="/v1/auth/magic-link"
          submitLabel="Enviar link de acesso"
          sentMessage="Pronto. Se {email} puder receber, o link chega em instantes."
        />
      )}

      <p className="text-center text-sm text-muted">
        Prefere senha? <TextLink href="/entrar">Entrar com senha</TextLink>
      </p>
    </>
  );
}
