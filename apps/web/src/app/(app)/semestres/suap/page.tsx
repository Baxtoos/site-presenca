import type { Metadata } from "next";
import { SemesterIcon } from "@/components/icons";
import { Alert, PageHeader } from "@/components/ui";
import { SuapBookmarklet } from "./suap-bookmarklet";

export const metadata: Metadata = { title: "Conectar ao SUAP · Monitor de Presenças" };

export default function SuapPage() {
  return (
    <>
      <PageHeader
        icon={<SemesterIcon size={26} />}
        title="Conectar ao SUAP"
        description="Traga do SUAP as suas disciplinas, o horário, as faltas de cada aula e as notas do boletim, com um clique, sempre que quiser."
        back={{ href: "/semestres", label: "Semestres" }}
      />
      <Alert>
        <strong>Novo: notas do boletim.</strong> O favorito agora traz também as notas de cada
        etapa, a média, a NAF e a média final. Se você já tinha salvo o favorito antes de 27/11,
        apague o antigo e salve de novo pelo passo a passo abaixo: o favorito é uma cópia e não se
        atualiza sozinho.
      </Alert>
      <SuapBookmarklet />
    </>
  );
}
