import type { Metadata } from "next";
import { EmailRequestForm } from "@/components/email-request-form";
import { TextLink } from "@/components/ui";

export const metadata: Metadata = { title: "Esqueci a senha · Monitor de Presenças" };

export default function ForgotPasswordPage() {
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Esqueci a senha</h1>
        <p className="text-sm text-muted">Enviamos um link para você escolher uma senha nova.</p>
      </header>
      <EmailRequestForm
        endpoint="/v1/auth/password/forgot"
        submitLabel="Enviar link de redefinição"
        sentMessage="Se existir uma conta com {email}, o link chega em instantes."
      />
      <p className="text-center text-sm text-muted">
        Lembrou? <TextLink href="/entrar">Voltar para o login</TextLink>
      </p>
    </>
  );
}
