import { sharedTemplatesResponseSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { MyTemplates } from "@/components/sharing/my-templates";
import { apiGet } from "@/lib/api-server";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Compartilhar grade · Monitor de Presenças" };

export default async function SharePage() {
  const { templates } = await apiGet("/v1/templates", sharedTemplatesResponseSchema);
  return (
    <>
      <PageHeader
        icon="🔗"
        title="Compartilhar grade"
        description={
          <>
            Os códigos que você gerou. Para gerar outro, abra o semestre ou a matéria. Recebeu um
            código?{" "}
            <Link href="/importar" className="font-medium text-accent hover:underline">
              Importar
            </Link>
            .
          </>
        }
      />
      <MyTemplates templates={templates} />
    </>
  );
}
