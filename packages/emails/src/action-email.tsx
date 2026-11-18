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
  footnote: string;
}

/** Layout de e-mail com uma ação principal: tabelas e estilos inline (Gmail, Outlook, Apple Mail). */
function ActionEmail(props: ActionEmailProps) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
      </head>
      <body style={{ margin: 0, backgroundColor: "#F4F6F8", fontFamily: "Arial, sans-serif" }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ maxWidth: 520, backgroundColor: "#FFFFFF", borderRadius: 10 }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: 28, color: "#15212C", fontSize: 15, lineHeight: 1.55 }}>
                        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#56657A" }}>
                          Monitor de Presenças
                        </p>
                        <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>{props.title}</h1>
                        {props.paragraphs.map((p) => (
                          <p key={p} style={{ margin: "0 0 14px" }}>
                            {p}
                          </p>
                        ))}
                        <p style={{ margin: "22px 0" }}>
                          <a
                            href={props.actionUrl}
                            style={{
                              display: "inline-block",
                              backgroundColor: "#1D5C8C",
                              color: "#FFFFFF",
                              padding: "11px 20px",
                              borderRadius: 8,
                              textDecoration: "none",
                              fontWeight: 600,
                            }}
                          >
                            {props.actionLabel}
                          </a>
                        </p>
                        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#56657A" }}>
                          Se o botão não funcionar, copie este endereço no navegador:
                        </p>
                        <p style={{ margin: "0 0 20px", fontSize: 13, wordBreak: "break-all" }}>
                          {props.actionUrl}
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: "#56657A" }}>
                          {props.footnote}
                        </p>
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
    "",
    `${props.actionLabel}: ${props.actionUrl}`,
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
