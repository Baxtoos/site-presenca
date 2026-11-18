import { sharedTemplatesResponseSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { MyTemplates } from "@/components/sharing/my-templates";
import { apiGet } from "@/lib/api-server";

export const metadata: Metadata = { title: "Compartilhar grade · Monitor de Presenças" };

export default async function SharePage() {
  const { templates } = await apiGet("/v1/templates", sharedTemplatesResponseSchema);
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Compartilhar grade</h1>
        <p className="text-sm text-muted">
          Os códigos que você gerou. Para gerar outro, abra o semestre ou a matéria. Recebeu um
          código?{" "}
          <Link href="/importar" className="font-medium text-accent hover:underline">
            Importar
          </Link>
          .
        </p>
      </header>
      <MyTemplates templates={templates} />
    </>
  );
}
