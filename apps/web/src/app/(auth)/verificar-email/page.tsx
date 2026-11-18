import type { Metadata } from "next";
import { ConsumeToken } from "@/components/consume-token";
import { Alert, TextLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "Confirmar e-mail · Monitor de Presenças",
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && TOKEN.test(raw) ? raw : undefined;

  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Confirmar e-mail</h1>
      </header>
      {token ? (
        <ConsumeToken
          token={token}
          endpoint="/v1/auth/verify-email"
          pendingText="Confirmando…"
          successContent={
            <Alert tone="success">
              E-mail confirmado. <TextLink href="/">Ir para o app</TextLink>
            </Alert>
          }
          failureExtra={
            <p className="text-sm text-muted">
              Entre no app para pedir um novo link. <TextLink href="/">Ir para o app</TextLink>
            </p>
          }
        />
      ) : (
        <Alert tone="error">
          Este link está incompleto. <TextLink href="/">Ir para o app</TextLink>
        </Alert>
      )}
    </>
  );
}
