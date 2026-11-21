import type { Metadata } from "next";
import { SemesterIcon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { SuapBookmarklet } from "./suap-bookmarklet";

export const metadata: Metadata = { title: "Conectar ao SUAP · Monitor de Presenças" };

export default function SuapPage() {
  return (
    <>
      <PageHeader
        icon={<SemesterIcon size={26} />}
        title="Conectar ao SUAP"
        description="Traga do SUAP as suas disciplinas, o horário e as faltas de cada aula, com um clique, sempre que quiser."
        back={{ href: "/semestres", label: "Semestres" }}
      />
      <SuapBookmarklet />
    </>
  );
}
