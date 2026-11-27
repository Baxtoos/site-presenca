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
        <strong>Favorito novo, que funciona no celular.</strong> Ele ficou curto e agora se atualiza
        sozinho, trazendo também as notas do boletim e as avaliações. Se você já tinha um favorito
        salvo, apague o antigo e salve de novo pelo passo a passo abaixo. É a última vez.
      </Alert>
      <SuapBookmarklet />
    </>
  );
}
