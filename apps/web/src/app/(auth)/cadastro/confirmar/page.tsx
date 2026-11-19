import type { Metadata } from "next";
import { ConsumeToken } from "@/components/consume-token";
import { TextLink } from "@/components/ui";
import { safeNext } from "@/lib/next-path";

export const metadata: Metadata = {
  title: "Confirmar cadastro · Monitor de Presenças",
  // A URL contém o token: nada de enviá-la como Referer para outros sites.
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function ConfirmSignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" && TOKEN.test(params.token) ? params.token : undefined;
  const next = safeNext(params.next);

  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Criar conta</h1>
        <p className="text-sm text-muted">Confirmando seu e-mail.</p>
      </header>

      {token ? (
        <ConsumeToken
          token={token}
          endpoint="/v1/auth/register/confirm"
          redirectTo={next ?? "/"}
          pendingText="Criando sua conta…"
          failureExtra={
            <p className="text-sm text-muted">
              Links de cadastro valem por 24 horas e funcionam uma vez.{" "}
              <TextLink href="/cadastro">Começar de novo</TextLink> ou{" "}
              <TextLink href="/entrar">entrar</TextLink> se a conta já existe.
            </p>
          }
        />
      ) : (
        <>
          <p className="text-sm">Este link está incompleto.</p>
          <p className="text-sm text-muted">
            Abra o link exatamente como veio no e-mail ou{" "}
            <TextLink href="/cadastro">faça o cadastro de novo</TextLink>.
          </p>
        </>
      )}
    </>
  );
}
