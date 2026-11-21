import { semestersResponseSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import { SemesterIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { SpreadsheetImport } from "./spreadsheet-import";
import { SuapImport } from "./suap-import";

export const metadata: Metadata = { title: "Importar planilha · Monitor de Presenças" };

export default async function ImportSpreadsheetPage() {
  const { semesters } = await apiGet("/v1/semesters", semestersResponseSchema);
  const active = semesters
    .filter((s) => s.status === "active")
    .map((s) => ({ id: s.id, label: s.label, isCurrent: s.isCurrent }));
  return (
    <>
      <PageHeader
        icon={<SemesterIcon size={26} />}
        title="Importar planilha"
        description="Traga para o app a planilha exportada por ele ou a que você fazia sozinho: matérias, grade, presenças e faltas, já configuradas e sem perder nenhum registro."
        back={{ href: "/semestres", label: "Semestres" }}
      />
      <SuapImport semesters={active} />
      <SpreadsheetImport />
    </>
  );
}
