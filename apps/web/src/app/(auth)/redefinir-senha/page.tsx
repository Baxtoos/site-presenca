import type { Metadata } from "next";
import { Alert, TextLink } from "@/components/ui";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Nova senha · Monitor de Presenças",
  referrer: "no-referrer",
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && TOKEN.test(raw) ? raw : undefined;

  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Escolher nova senha</h1>
        <p className="text-sm text-muted">
          Ao salvar, as sessões abertas em outros dispositivos são encerradas.
        </p>
      </header>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert tone="error">
          Este link está incompleto. <TextLink href="/esqueci-senha">Peça um novo</TextLink>.
        </Alert>
      )}
    </>
  );
}
