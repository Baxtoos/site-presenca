import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/ui";
import { getMe } from "@/lib/api-server";
import { safeNext, withNext } from "@/lib/next-path";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Criar conta · Monitor de Presenças" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getMe()) redirect(next ?? "/");
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Criar conta</h1>
        <p className="text-sm text-muted">Leva menos de um minuto. Depois você monta sua grade.</p>
      </header>
      <RegisterForm next={next} />
      <p className="text-center text-sm text-muted">
        Já tem conta? <TextLink href={withNext("/entrar", next)}>Entrar</TextLink>
      </p>
    </>
  );
}
