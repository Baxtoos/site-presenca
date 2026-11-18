import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidade e LGPD · Monitor de Presenças",
};

export default function PrivacidadePage() {
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-10 text-sm leading-relaxed text-ink">
      <header className="grid gap-2">
        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          ← Voltar ao Monitor de Presenças
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Política de Privacidade e LGPD</h1>
        <p className="text-xs text-muted">Última atualização: novembro de 2026</p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-base font-semibold">1. Quais dados coletamos</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong>Dados de conta:</strong> nome, e-mail, hash de senha (Argon2id) ou identificador
            OAuth do Google, instituição, curso e fuso horário.
          </li>
          <li>
            <strong>Dados acadêmicos:</strong> semestres, matérias, horários, feriados e registros
            de presença/falta criados por você.
          </li>
          <li>
            <strong>Dados de segurança e sessão:</strong> endereço IP e navegador das sessões ativas
            (para você gerenciar seus aparelhos conectados e para proteção contra força bruta).
          </li>
        </ul>

        <h2 className="pt-2 text-base font-semibold">2. Isolamento e proteção</h2>
        <p className="text-muted">
          Seus dados são isolados no banco de dados por políticas de segurança em nível de linha
          (Row-Level Security forçado no PostgreSQL). Nenhum outro usuário tem acesso às suas faltas
          ou anotações. Não vendemos nem compartilhamos seus dados com anunciantes.
        </p>

        <h2 className="pt-2 text-base font-semibold">
          3. Seus direitos (LGPD — Lei nº 13.709/2018)
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong>Acesso e portabilidade:</strong> em <em>Conta → Seus dados e privacidade</em>,
            você pode baixar todos os seus dados estruturados em formato JSON (
            <code>/api/v1/me/export.json</code>), além de exportar cada semestre em planilha Excel (
            <code>.xlsx</code>).
          </li>
          <li>
            <strong>Eliminação definitiva:</strong> em <em>Conta → Excluir minha conta</em>, você
            pode apagar imediatamente sua conta, matérias, registros de presença, sessões e trilha
            de auditoria.
          </li>
        </ul>
      </section>

      <footer className="flex flex-wrap gap-4 text-xs text-muted">
        <Link href="/termos" className="text-accent hover:underline">
          Termos de Uso
        </Link>
        <Link href="/entrar" className="text-accent hover:underline">
          Entrar
        </Link>
      </footer>
    </main>
  );
}
