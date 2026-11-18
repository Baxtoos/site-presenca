import { normalizeShareCode, semestersResponseSchema } from "@presenca/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { ImportPreview } from "@/components/sharing/import-preview";
import { apiGet, getMe } from "@/lib/api-server";

export const metadata: Metadata = {
  title: "Importar grade · Monitor de Presenças",
  // O código dá acesso à grade de alguém: a página não deve aparecer em buscadores.
  robots: { index: false, follow: false },
};

export default async function ImportPage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeShareCode(decodeURIComponent((await params).code));
  if (!code) {
    return (
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-6 text-sm">
        <h1 className="text-xl font-bold">Código inválido</h1>
        <p className="text-muted">O código tem 8 letras e números (ex.: K7QM-2XPA).</p>
        <Link href="/importar" className="font-medium text-accent hover:underline">
          Digitar outro código
        </Link>
      </section>
    );
  }
  const me = await getMe();
  // Para modelo de matéria, o aluno escolhe em qual dos seus semestres ela entra.
  const semesters = me ? (await apiGet("/v1/semesters", semestersResponseSchema)).semesters : [];

  return (
    <ImportPreview
      code={code}
      loggedIn={me !== null}
      semesters={semesters.map((s) => ({ id: s.id, label: s.label, isCurrent: s.isCurrent }))}
    />
  );
}
