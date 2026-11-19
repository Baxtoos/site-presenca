import { renderEmail } from "./render";

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Versão em texto puro: alguns clientes (e filtros de spam) preferem. */
  text: string;
}

interface ActionEmailProps {
  title: string;
  paragraphs: string[];
  actionLabel: string;
  actionUrl: string;
  /** Link secundário, em texto, abaixo do botão (ex.: "Esqueci a senha"). */
  secondary?: { label: string; url: string };
  /** Destaque em bloco cinza (o texto principal de um aviso). */
  callout?: string;
  footnote: string;
}

/*
 * Visual do app (inspirado no Notion): página quase branca, cartão branco de borda fina,
 * tinta grafite, azul só no botão. Sem imagens: nada a bloquear, nada a baixar.
 */
const C = {
  page: "#F7F7F5",
  card: "#FFFFFF",
  line: "#E9E9E7",
  ink: "#37352F",
  muted: "#64635E",
  accent: "#0B6BCB",
  calloutBg: "#F1F1EF",
};
const FONT =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Layout de e-mail com uma ação principal: tabelas e estilos inline (Gmail, Outlook, Apple Mail). */
function ActionEmail(props: ActionEmailProps) {
  // Texto que aparece ao lado do assunto na caixa de entrada.
  const preview = props.callout ?? props.paragraphs.find((p) => !p.startsWith("Olá")) ?? "";
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{props.title}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: C.page, fontFamily: FONT }}>
        <div
          style={{
            display: "none",
            maxHeight: 0,
            overflow: "hidden",
            opacity: 0,
            color: C.page,
            fontSize: 1,
            lineHeight: "1px",
          }}
        >
          {preview}
        </div>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: C.page }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "32px 12px" }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ maxWidth: 520 }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          padding: "0 4px 14px",
                          fontSize: 14,
                          fontWeight: 600,
                          color: C.ink,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        Monitor de Presenças
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          backgroundColor: C.card,
                          border: `1px solid ${C.line}`,
                          borderRadius: 12,
                          padding: "28px 28px 24px",
                          color: C.ink,
                          fontSize: 15,
                          lineHeight: 1.6,
                        }}
                      >
                        <h1
                          style={{
                            fontSize: 22,
                            lineHeight: 1.3,
                            fontWeight: 700,
                            letterSpacing: "-0.01em",
                            margin: "0 0 16px",
                            color: C.ink,
                          }}
                        >
                          {props.title}
                        </h1>
                        {props.paragraphs.map((p) => (
                          <p key={p} style={{ margin: "0 0 14px" }}>
                            {p}
                          </p>
                        ))}
                        {props.callout ? (
                          <table
                            role="presentation"
                            width="100%"
                            cellPadding={0}
                            cellSpacing={0}
                            style={{ margin: "4px 0 14px" }}
                          >
                            <tbody>
                              <tr>
                                <td
                                  style={{
                                    backgroundColor: C.calloutBg,
                                    borderRadius: 8,
                                    padding: "14px 16px",
                                    whiteSpace: "pre-wrap",
                                  }}
                                >
                                  {props.callout}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        ) : null}
                        <p style={{ margin: "22px 0 8px" }}>
                          <a
                            href={props.actionUrl}
                            style={{
                              display: "inline-block",
                              backgroundColor: C.accent,
                              color: "#FFFFFF",
                              padding: "10px 18px",
                              borderRadius: 6,
                              textDecoration: "none",
                              fontWeight: 600,
                              fontSize: 15,
                            }}
                          >
                            {props.actionLabel}
                          </a>
                        </p>
                        {props.secondary ? (
                          <p style={{ margin: "12px 0 0", fontSize: 14 }}>
                            <a
                              href={props.secondary.url}
                              style={{ color: C.accent, textDecoration: "underline" }}
                            >
                              {props.secondary.label}
                            </a>
                          </p>
                        ) : null}
                        <p
                          style={{
                            margin: "22px 0 6px",
                            paddingTop: 18,
                            borderTop: `1px solid ${C.line}`,
                            fontSize: 13,
                            color: C.muted,
                          }}
                        >
                          Se o botão não funcionar, copie este endereço no navegador:
                        </p>
                        <p
                          style={{
                            margin: "0 0 14px",
                            fontSize: 13,
                            color: C.muted,
                            wordBreak: "break-all",
                          }}
                        >
                          {props.actionUrl}
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{props.footnote}</p>
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "14px 4px 0",
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: C.muted,
                        }}
                      >
                        Monitor de Presenças · controle de faltas por matéria
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

function render(subject: string, props: ActionEmailProps): RenderedEmail {
  const text = [
    props.title,
    "",
    ...props.paragraphs,
    ...(props.callout ? ["", props.callout] : []),
    "",
    `${props.actionLabel}: ${props.actionUrl}`,
    ...(props.secondary ? [`${props.secondary.label}: ${props.secondary.url}`] : []),
    "",
    props.footnote,
  ].join("\n");
  return { subject, html: renderEmail(<ActionEmail {...props} />), text };
}

export function verifyEmailMessage(params: { name: string; url: string }): RenderedEmail {
  return render("Confirme seu e-mail", {
    title: "Confirme seu e-mail",
    paragraphs: [
      `Olá, ${params.name}.`,
      "Confirme este endereço para receber os alertas de faltas e poder compartilhar sua grade.",
    ],
    actionLabel: "Confirmar e-mail",
    actionUrl: params.url,
    footnote: "O link vale por 24 horas. Se você não criou esta conta, ignore este e-mail.",
  });
}

/** Cadastro: a conta só é criada quando a pessoa usa este link. */
export function confirmSignupMessage(params: { name: string; url: string }): RenderedEmail {
  return render("Confirme seu e-mail para criar a conta", {
    title: "Confirme seu e-mail",
    paragraphs: [
      `Olá, ${params.name}.`,
      "Falta só confirmar este endereço. Ao clicar no botão, sua conta é criada e você já entra no app.",
    ],
    actionLabel: "Confirmar e criar conta",
    actionUrl: params.url,
    footnote:
      "O link vale por 24 horas e funciona uma vez. Se você não pediu esta conta, ignore este e-mail: nada é criado.",
  });
}

/**
 * Alguém tentou criar conta com um e-mail que já tem conta. O cadastro responde igual nos dois
 * casos (não revela quem tem conta); só o dono do e-mail fica sabendo, por aqui.
 */
export function accountExistsMessage(params: {
  loginUrl: string;
  resetUrl: string;
}): RenderedEmail {
  return render("Você já tem uma conta no Monitor de Presenças", {
    title: "Você já tem uma conta",
    paragraphs: [
      "Alguém (provavelmente você) tentou criar uma conta com este e-mail, mas ela já existe.",
      "Para entrar, use o botão abaixo. Se esqueceu a senha, escolha uma nova pelo link logo abaixo dele.",
    ],
    actionLabel: "Entrar",
    actionUrl: params.loginUrl,
    secondary: { label: "Esqueci a senha", url: params.resetUrl },
    footnote: "Se não foi você, ignore este e-mail: nada mudou na sua conta.",
  });
}

/** Exclusão de conta (quem entra sem senha confirma por aqui). */
export function deleteAccountMessage(params: { name: string; url: string }): RenderedEmail {
  return render("Confirme a exclusão da sua conta", {
    title: "Confirme a exclusão da conta",
    paragraphs: [
      `Olá, ${params.name}.`,
      "Recebemos um pedido para excluir sua conta do Monitor de Presenças, com todos os semestres, matérias e registros de presença.",
      "Para continuar, abra o link abaixo no aparelho em que você está conectado e confirme. Isso não pode ser desfeito.",
    ],
    actionLabel: "Revisar e excluir",
    actionUrl: params.url,
    footnote:
      "O link vale por 15 minutos e funciona uma vez. Se não foi você, ignore este e-mail: nada é apagado.",
  });
}

/** Ligar o segundo fator numa conta sem senha (o link confirma que é o dono do e-mail). */
export function mfaEnableMessage(params: { name: string; url: string }): RenderedEmail {
  return render("Ligar a verificação em duas etapas", {
    title: "Ligar a verificação em duas etapas",
    paragraphs: [
      `Olá, ${params.name}.`,
      "Recebemos um pedido para ligar a verificação em duas etapas na sua conta. Depois de ligada, entrar vai pedir também um código do app autenticador do seu celular.",
      "Para continuar, abra o link abaixo no aparelho em que você está conectado.",
    ],
    actionLabel: "Continuar",
    actionUrl: params.url,
    footnote:
      "O link vale por 15 minutos e funciona uma vez. Se não foi você, ignore este e-mail e troque o acesso: alguém pode estar com a sua sessão aberta.",
  });
}

const FEEDBACK_KIND: Record<string, string> = {
  sugestao: "Sugestão",
  problema: "Problema",
  outro: "Mensagem",
};

/** Sugestão ou problema enviado por um aluno (vai para o responsável pelo app). */
export function feedbackMessage(params: {
  kind: string;
  message: string;
  name: string;
  email: string;
  page?: string;
  version: string;
  userAgent?: string;
  appUrl: string;
}): RenderedEmail {
  const kind = FEEDBACK_KIND[params.kind] ?? "Mensagem";
  const firstLine = params.message.split("\n")[0]!.slice(0, 60);
  return render(`[${kind}] ${firstLine}`, {
    title: `${kind} de ${params.name}`,
    paragraphs: [`De: ${params.name} <${params.email}>`],
    callout: params.message,
    actionLabel: "Abrir o app",
    actionUrl: params.appUrl,
    footnote: [
      params.page ? `Tela: ${params.page}.` : null,
      `Versão: ${params.version}.`,
      params.userAgent ? `Navegador: ${params.userAgent}.` : null,
      "Responda este e-mail para falar direto com a pessoa.",
    ]
      .filter(Boolean)
      .join(" "),
  });
}

export function resetPasswordMessage(params: { url: string }): RenderedEmail {
  return render("Redefinir sua senha", {
    title: "Redefinir sua senha",
    paragraphs: [
      "Recebemos um pedido para trocar a senha da sua conta.",
      "Ao trocar, todas as sessões abertas em outros dispositivos são encerradas.",
    ],
    actionLabel: "Escolher nova senha",
    actionUrl: params.url,
    footnote:
      "O link vale por 15 minutos e funciona uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.",
  });
}

export function magicLinkMessage(params: { url: string; newAccount: boolean }): RenderedEmail {
  return render(params.newAccount ? "Crie sua conta" : "Seu link de acesso", {
    title: params.newAccount ? "Crie sua conta" : "Entrar no Monitor de Presenças",
    paragraphs: params.newAccount
      ? ["Use o botão abaixo para criar sua conta e entrar. Não precisa de senha."]
      : ["Use o botão abaixo para entrar. Não precisa de senha."],
    actionLabel: params.newAccount ? "Criar conta e entrar" : "Entrar",
    actionUrl: params.url,
    footnote:
      "O link vale por 15 minutos e funciona uma vez. Se você não pediu este acesso, ignore este e-mail.",
  });
}

/**
 * Aviso do app (alerta de faltas, lembrete de chamada). O título e o texto vêm de
 * `notificationContent` (contracts), os mesmos da central e do push.
 */
export function noticeMessage(params: {
  name: string;
  title: string;
  body: string;
  url: string;
  settingsUrl: string;
}): RenderedEmail {
  return render(params.title, {
    title: params.title,
    paragraphs: [`Olá, ${params.name}.`],
    callout: params.body,
    actionLabel: "Abrir no app",
    actionUrl: params.url,
    footnote: `Você recebe este e-mail porque os avisos por e-mail estão ligados. Para mudar, abra ${params.settingsUrl}.`,
  });
}
