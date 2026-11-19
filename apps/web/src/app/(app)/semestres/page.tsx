import { semestersResponseSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { ButtonLink, PageHeader, SectionTitle } from "@/components/ui";
import { apiGet } from "@/lib/api-server";
import { formatDate, plural } from "@/lib/format";
import { CreateSemesterForm } from "./semester-forms";

export const metadata: Metadata = { title: "Semestres · Monitor de Presenças" };

export default async function SemestersPage() {
  const { semesters } = await apiGet("/v1/semesters", semestersResponseSchema);
  const active = semesters.filter((s) => s.status === "active");
  const archived = semesters.filter((s) => s.status === "archived");

  return (
    <>
      <PageHeader
        icon="🎓"
        title="Semestres"
        description="O semestre atual é o que aparece no início e na barra lateral."
      >
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/importar" variant="secondary">
            Importar grade de um colega
          </ButtonLink>
          <ButtonLink href="/compartilhar" variant="ghost">
            Seus códigos compartilhados
          </ButtonLink>
        </div>
      </PageHeader>

      {active.length > 0 ? (
        <ul className="card divide-y divide-line overflow-hidden">
          {active.map((s) => (
            <li key={s.id}>
              <Link
                href={`/semestres/${s.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2"
              >
                <span className="grid gap-0.5">
                  <span className="font-semibold">
                    {s.label}
                    {s.isCurrent ? (
                      <span className="ml-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                        atual
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm text-muted">
                    {formatDate(s.startsOn)} a {formatDate(s.endsOn)} ·{" "}
                    {plural(s.subjectsCount, "matéria", "matérias")}
                  </span>
                </span>
                <ChevronRightIcon size={18} className="shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="card grid gap-4 p-5 sm:p-6" aria-labelledby="novo">
        <SectionTitle id="novo">
          {semesters.length === 0 ? "Criar meu primeiro semestre" : "Novo semestre"}
        </SectionTitle>
        <CreateSemesterForm makeCurrentByDefault={!semesters.some((s) => s.isCurrent)} />
      </section>

      {archived.length > 0 ? (
        <section className="grid gap-2" aria-labelledby="arquivados">
          <h2 id="arquivados" className="text-sm font-semibold text-muted">
            Arquivados
          </h2>
          <ul className="grid gap-1 text-sm">
            {archived.map((s) => (
              <li key={s.id}>
                <Link href={`/semestres/${s.id}`} className="text-accent hover:underline">
                  {s.label}
                </Link>{" "}
                <span className="text-muted">
                  · {plural(s.subjectsCount, "matéria", "matérias")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
