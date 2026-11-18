import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
        <h1 className="text-2xl font-bold tracking-tight">Entrar</h1>
        <p className="text-sm text-muted">
          Acompanhe suas faltas e saiba quanto ainda pode faltar.
        </p>
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <LoginForm next={next} />

      <OrDivider />

      <div className="grid gap-3">
        {/* Navegação de página inteira: o fluxo OAuth passa pelo Google e volta via /api. */}
        <a
          href="/api/v1/auth/google"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
        >
          <GoogleMark />
          Entrar com Google
        </a>
        <a
          href="/entrar/link"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
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

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"
      />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7H2.1a11 11 0 0 0 0 9.9l3.7-2.7z" />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"
      />
    </svg>
  );
}
