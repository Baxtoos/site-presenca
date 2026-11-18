import {
  semestersResponseSchema,
  simulateResponseSchema,
  subjectsResponseSchema,
  todayResponseSchema,
} from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { TodayPanel } from "@/components/attendance/today-panel";
import { SubjectCard } from "@/components/subject-card";
import { apiGet, getMe } from "@/lib/api-server";
import { simulateHint } from "@/lib/format";
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

  return (
    <>
      <header className="grid gap-0.5">
        <p className="text-sm text-muted">
          {current ? `Semestre ${current.label}` : "Bem-vinda(o)"}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Olá, {firstName}</h1>
      </header>

      {me && !me.emailVerified ? <VerifyEmailBanner email={me.email} /> : null}
      <InstallPrompt />

      {!current ? (
        <section className="grid gap-3 rounded-2xl border border-dashed border-line bg-surface p-6">
          <h2 className="font-semibold">Comece pelo seu semestre</h2>
          <p className="text-sm text-muted">
            Cadastre o semestre e as matérias com a regra de faltas de cada uma. O app passa a
            mostrar quantas faltas você ainda pode ter.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/semestres"
              className="inline-flex min-h-11 w-fit items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
            >
              Criar meu semestre
            </Link>
            <Link href="/importar" className="text-sm font-medium text-accent hover:underline">
              ou importe a grade de um colega
            </Link>
          </div>
        </section>
      ) : subjects.length === 0 ? (
        <section className="grid gap-3 rounded-2xl border border-dashed border-line bg-surface p-6">
          <h2 className="font-semibold">Nenhuma matéria em {current.label}</h2>
          <Link
            href={`/semestres/${current.id}/materias/nova`}
            className="inline-flex min-h-11 w-fit items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink"
          >
            Adicionar a primeira matéria
          </Link>
        </section>
      ) : (
        <>
          {today ? (
            <section className="grid gap-3" aria-labelledby="hoje">
              <div className="flex items-center justify-between gap-3">
                <h2 id="hoje" className="font-semibold">
                  Aulas de hoje
                </h2>
                <Link href="/hoje" className="text-sm font-medium text-accent hover:underline">
                  Outros dias
                </Link>
              </div>
              <TodayPanel data={today} compact />
            </section>
          ) : null}
          <section className="grid gap-3" aria-labelledby="materias">
            <div className="flex items-center justify-between gap-3">
              <h2 id="materias" className="font-semibold">
                Suas matérias
              </h2>
              <Link
                href={`/semestres/${current.id}`}
                className="text-sm font-medium text-accent hover:underline"
              >
                Gerenciar semestre
              </Link>
            </div>
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
