import type { Metadata } from "next";
import { SemesterIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { SpreadsheetImport } from "./spreadsheet-import";

export const metadata: Metadata = { title: "Importar planilha · Monitor de Presenças" };

export default function ImportSpreadsheetPage() {
  return (
    <>
      <PageHeader
        icon={<SemesterIcon size={26} />}
        title="Importar planilha"
        description="Traga para o app a planilha exportada por ele ou a que você fazia sozinho: matérias, grade, presenças e faltas, já configuradas e sem perder nenhum registro."
        back={{ href: "/semestres", label: "Semestres" }}
      />
      <SpreadsheetImport />
    </>
  );
}
