import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TextLink } from "@/components/ui";
import { getMe } from "@/lib/api-server";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Criar conta · Monitor de Presenças" };

export default async function RegisterPage() {
  if (await getMe()) redirect("/");
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Criar conta</h1>
        <p className="text-sm text-muted">Leva menos de um minuto. Depois você monta sua grade.</p>
      </header>
      <RegisterForm />
      <p className="text-center text-sm text-muted">
        Já tem conta? <TextLink href="/entrar">Entrar</TextLink>
      </p>
    </>
  );
}
