import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Termos de Uso · Monitor de Presenças" };

export default function TermosPage() {
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-10 text-sm leading-relaxed text-ink">
      <header className="grid gap-2">
        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          ← Voltar ao Monitor de Presenças
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Termos de Uso</h1>
        <p className="text-xs text-muted">Última atualização: novembro de 2026</p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-base font-semibold">1. Finalidade do serviço</h2>
        <p className="text-muted">
          O Monitor de Presenças é uma ferramenta pessoal de organização acadêmica para estudantes
          acompanharem horários, limites de faltas e alertas. Os cálculos e simulações (“Posso
          faltar?”) dependem das regras e registros informados por você e não substituem a chamada
          nem o sistema acadêmico oficial da sua instituição de ensino.
        </p>

        <h2 className="pt-2 text-base font-semibold">2. Sua conta e responsabilidade</h2>
        <p className="text-muted">
          Você é responsável por manter a confidencialidade da sua senha e por conferir as regras de
          frequência mínima e carga horária no plano de ensino oficial de cada disciplina.
        </p>

        <h2 className="pt-2 text-base font-semibold">3. Compartilhamento de grades</h2>
        <p className="text-muted">
          Ao gerar um código de compartilhamento de semestre ou matéria, apenas a estrutura da grade
          (nomes das matérias, horários, regras de cálculo e feriados) é compartilhada. Seus
          registros pessoais de presença, atestados e anotações nunca são incluídos no código.
        </p>

        <h2 className="pt-2 text-base font-semibold">4. Disponibilidade e encerramento</h2>
        <p className="text-muted">
          O serviço é oferecido gratuitamente “no estado em que se encontra”. Você pode exportar
          seus dados em Excel (`.xlsx`) ou JSON (`.json`) e excluir definitivamente sua conta a
          qualquer momento na área <strong>Conta</strong>.
        </p>
      </section>

      <footer className="flex flex-wrap gap-4 text-xs text-muted">
        <Link href="/privacidade" className="text-accent hover:underline">
          Política de Privacidade e LGPD
        </Link>
        <Link href="/entrar" className="text-accent hover:underline">
          Entrar
        </Link>
      </footer>
    </main>
  );
}
