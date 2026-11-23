import {
  semestersResponseSchema,
  simulateResponseSchema,
  subjectsResponseSchema,
  todayResponseSchema,
} from "@presenca/contracts";
import type { Metadata } from "next";
import { TodayPanel } from "@/components/attendance/today-panel";
import { LibraryIcon, MoonIcon, PlusIcon, SemesterIcon, SunIcon } from "@/components/icons";
import { SubjectCard } from "@/components/subject-card";
import { UpcomingTasks } from "@/components/tasks/upcoming-tasks";
import { ButtonLink, PageHeader, SectionTitle } from "@/components/ui";
import { apiGet, getMe } from "@/lib/api-server";
import { plural, simulateHint } from "@/lib/format";
import { InstallPrompt, VerifyEmailBanner } from "./home-client";

export const metadata: Metadata = { title: "Monitor de Presenças" };

export default async function Home() {
  const [me, { semesters }] = await Promise.all([
    getMe(),
    apiGet("/v1/semesters", semestersResponseSchema),
  ]);
  const current = semesters.find((s) => s.isCurrent);
  const [subjects, today] = current
    ? await Promise.all([
        apiGet(`/v1/semesters/${current.id}/subjects`, subjectsResponseSchema).then(
          (r) => r.subjects,
        ),
        apiGet("/v1/today", todayResponseSchema),
      ])
    : [[], null];
  // Uma chamada por matéria: são poucas (uma grade tem ~5–8) e cada uma é barata na API.
  const hints = new Map(
    await Promise.all(
      subjects.map(
        async (s) =>
          [
            s.id,
            simulateHint(await apiGet(`/v1/subjects/${s.id}/simulate`, simulateResponseSchema)),
          ] as const,
      ),
    ),
  );
  const firstName = me?.fullName.split(" ")[0] ?? "";
  const atRisk = subjects.filter((s) => s.summary.risk !== "safe").length;
  const pendingToday = today?.classes.filter((c) => !c.record && !c.blocked).length ?? 0;
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", timeZone: me?.timezone }).format(
      new Date(),
    ),
  );
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <>
      <PageHeader
        icon={hour < 18 ? <SunIcon size={26} /> : <MoonIcon size={26} />}
        eyebrow={current ? `${greeting} · Semestre ${current.label}` : "Bem-vinda(o)"}
        title={`Olá, ${firstName}`}
        description={
          current && subjects.length > 0
            ? [
                today && today.classes.length > 0
                  ? pendingToday > 0
                    ? `${plural(pendingToday, "aula", "aulas")} para marcar hoje.`
                    : "Tudo marcado hoje."
                  : "Sem aula hoje.",
                atRisk > 0
                  ? `${plural(atRisk, "matéria pede", "matérias pedem")} atenção.`
                  : "Todas as matérias com folga.",
              ].join(" ")
            : undefined
        }
      />

      {me && !me.emailVerified ? <VerifyEmailBanner email={me.email} /> : null}
      <InstallPrompt />
      <UpcomingTasks days={7} title="Próximas entregas" />

      {!current ? (
        <section className="card grid gap-4 p-6 sm:p-8">
          <div
            className="grid size-12 place-items-center rounded-xl border border-line bg-surface-2 shadow-sm"
            aria-hidden
          >
            <SemesterIcon size={26} />
          </div>
          <div className="grid gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight">Comece pelo seu semestre</h2>
            <p className="max-w-prose text-[15px] text-muted">
              Cadastre o semestre e as matérias com a regra de faltas de cada uma. O app passa a
              mostrar quantas faltas você ainda pode ter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="/semestres">Criar meu semestre</ButtonLink>
            <ButtonLink href="/importar" variant="ghost">
              ou importe a grade de um colega
            </ButtonLink>
          </div>
        </section>
      ) : subjects.length === 0 ? (
        <section className="card grid gap-4 p-6 sm:p-8">
          <div
            className="grid size-12 place-items-center rounded-xl border border-line bg-surface-2 shadow-sm"
            aria-hidden
          >
            <LibraryIcon size={26} />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            Nenhuma matéria em {current.label}
          </h2>
          <ButtonLink href={`/semestres/${current.id}/materias/nova`}>
            <PlusIcon size={16} />
            Adicionar a primeira matéria
          </ButtonLink>
        </section>
      ) : (
        <>
          {today ? (
            <section className="grid gap-3" aria-labelledby="hoje">
              <SectionTitle
                id="hoje"
                action={
                  <ButtonLink href="/hoje" variant="ghost" className="-mr-2">
                    Outros dias
                  </ButtonLink>
                }
              >
                Aulas de hoje
              </SectionTitle>
              <TodayPanel data={today} compact />
            </section>
          ) : null}
          <section className="grid gap-3" aria-labelledby="materias">
            <SectionTitle
              id="materias"
              action={
                <ButtonLink href={`/semestres/${current.id}`} variant="ghost" className="-mr-2">
                  Gerenciar semestre
                </ButtonLink>
              }
            >
              Suas matérias
            </SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {subjects.map((subject) => (
                <SubjectCard key={subject.id} subject={subject} hint={hints.get(subject.id)} />
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
