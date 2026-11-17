export interface ThresholdAlertEmailProps {
  studentName: string;
  subjectName: string;
  thresholdPct: number;
  absentUnits: number;
  maxUnits: number;
  remainingClasses: number;
  appUrl: string;
}

/**
 * Esboço do alerta de limite: HTML de e-mail com tabelas e estilos inline (compatível com
 * Gmail e Outlook). O layout final chega na Fase 6.
 */
export function ThresholdAlertEmail(props: ThresholdAlertEmailProps) {
  const remaining = Math.max(0, props.maxUnits - props.absentUnits);
  const title = `${props.subjectName}: ${props.thresholdPct}% do limite de faltas`;
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
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
                      <td style={{ padding: 24, color: "#15212C", fontSize: 15, lineHeight: 1.5 }}>
                        <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>{title}</h1>
                        <p style={{ margin: "0 0 12px" }}>Olá, {props.studentName}.</p>
                        <p style={{ margin: "0 0 20px" }}>
                          Você tem {props.absentUnits} de {props.maxUnits} faltas permitidas. Restam{" "}
                          {remaining} tempos, cerca de {props.remainingClasses} aulas.
                        </p>
                        <a
                          href={props.appUrl}
                          style={{
                            display: "inline-block",
                            backgroundColor: "#1D5C8C",
                            color: "#FFFFFF",
                            padding: "10px 18px",
                            borderRadius: 8,
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                        >
                          Abrir o app
                        </a>
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
