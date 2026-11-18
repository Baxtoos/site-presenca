import { semestersResponseSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
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
      <header className="grid gap-0.5">
        <h1 className="text-2xl font-bold tracking-tight">Semestres</h1>
        <p className="text-sm text-muted">O semestre atual é o que aparece no início.</p>
      </header>

      {active.length > 0 ? (
        <ul className="grid gap-2">
          {active.map((s) => (
            <li key={s.id}>
              <Link
                href={`/semestres/${s.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent/50"
              >
                <span className="grid gap-0.5">
                  <span className="font-semibold">
                    {s.label}
                    {s.isCurrent ? (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                        atual
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm text-muted">
                    {formatDate(s.startsOn)} a {formatDate(s.endsOn)} ·{" "}
                    {plural(s.subjectsCount, "matéria", "matérias")}
                  </span>
                </span>
                <span aria-hidden className="text-muted">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section
        className="grid gap-4 rounded-2xl border border-line bg-surface p-6"
        aria-labelledby="novo"
      >
        <h2 id="novo" className="font-semibold">
          {semesters.length === 0 ? "Criar meu primeiro semestre" : "Novo semestre"}
        </h2>
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
