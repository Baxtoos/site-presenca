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
        <h1 className="text-3xl font-bold tracking-tight">Política de Privacidade e LGPD</h1>
        <p className="text-xs text-muted">Última atualização: novembro de 2026</p>
      </header>

      <section className="grid gap-3 card p-5 sm:p-6">
        <h2 className="text-base font-semibold">1. Quais dados coletamos</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong>Dados de conta:</strong> nome, e-mail, hash de senha (Argon2id) ou identificador
            OAuth do Google, instituição, curso e fuso horário.
          </li>
          <li>
            <strong>Verificação em duas etapas (se você ligar):</strong> a chave do app
            autenticador, guardada cifrada, e os códigos de recuperação, dos quais guardamos só um
            resumo criptográfico (hash).
          </li>
          <li>
            <strong>Dados acadêmicos:</strong> semestres, matérias, horários, feriados, registros de
            presença/falta (com o conteúdo da aula e observações, se você escrever), tarefas e
            entregas, e a regra de cálculo e as notas de cada matéria, tudo criado por você.
          </li>
          <li>
            <strong>Moodle (se você conectar):</strong> o link do calendário e, se você informar, a
            chave de segurança, guardados cifrados. Com eles o app lê da sua conta no Moodle os
            prazos das entregas, se você já enviou e as notas lançadas pelo professor.
          </li>
          <li>
            <strong>Assistente de notas (se você usar):</strong> o texto que você escreve para
            explicar como o professor calcula a nota.
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
            <code>.xlsx</code>). A planilha também pode ser importada de volta (em outra conta ou
            neste app): o arquivo é lido no seu aparelho, e só os dados do semestre são enviados,
            quando você confirma.
          </li>
          <li>
            <strong>Eliminação definitiva:</strong> em <em>Conta → Excluir minha conta</em>, você
            pode apagar imediatamente sua conta, matérias, registros de presença, sessões e trilha
            de auditoria. Cópias de segurança criptografadas do banco são guardadas por até 30 dias
            e depois apagadas automaticamente; nesse prazo, seus dados só seriam lidos para
            restaurar o serviço após uma falha.
          </li>
          <li>
            <strong>Correção, informação e revogação:</strong> você corrige seus dados em{" "}
            <em>Conta</em> e pode pedir informações sobre o tratamento pelo contato abaixo.
          </li>
        </ul>

        <h2 className="pt-2 text-base font-semibold">4. Para que usamos e por quanto tempo</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong>Finalidade:</strong> calcular suas faltas e notas, avisar quando você se
            aproxima do limite, de prazos e de notas novas, e proteger sua conta. Base legal:
            execução do serviço que você pediu ao criar a conta (art. 7º, V) e legítimo interesse na
            segurança (art. 7º, IX).
          </li>
          <li>
            <strong>Retenção:</strong> enquanto a conta existir. Sessões expiram após 14 dias sem
            uso (no máximo 90 dias); links de acesso e de nova senha valem 15 minutos.
          </li>
        </ul>

        <h2 className="pt-2 text-base font-semibold">5. Quem processa os dados para nós</h2>
        <p className="text-muted">
          Usamos serviços de infraestrutura que tratam os dados só para operar o app, sem uso
          próprio: Vercel (site), Render (servidor), Neon (banco de dados), Upstash (limite de
          tentativas), GitHub (avisos agendados e cópias de segurança criptografadas) e Google
          (envio de e-mails). Se você usar o assistente de notas, o texto que você escreve e o nome
          da matéria vão para a IA do Google (Gemini), só para montar a regra de cálculo; nunca vão
          suas faltas, notas, e-mail ou senhas. Conforme os termos do Google, no plano gratuito o
          Google pode usar esse texto para melhorar os produtos dele; por isso, não escreva dados
          pessoais no assistente. Se ativado, o Sentry recebe relatórios de erro sem dados pessoais
          (sem e-mail, IP ou conteúdo das suas anotações). Esses serviços ficam fora do Brasil
          (principalmente nos Estados Unidos); a transferência é necessária para prestar o serviço
          (art. 33 da LGPD).
        </p>

        <h2 className="pt-2 text-base font-semibold">6. Contato</h2>
        <p className="text-muted">
          Dúvidas ou pedidos sobre seus dados: responda a qualquer e-mail enviado pelo Monitor de
          Presenças. Respondemos em até 15 dias.
        </p>
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
