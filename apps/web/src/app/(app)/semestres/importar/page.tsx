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
        description="Recrie um semestre a partir da planilha .xlsx exportada pelo app: matérias, regras, grade e faltas, já configurados."
        back={{ href: "/semestres", label: "Semestres" }}
      />
      <SpreadsheetImport />
    </>
  );
}
