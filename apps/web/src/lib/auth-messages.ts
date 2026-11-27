export const LOGIN_REDIRECT_ERRORS: Record<string, string> = {
  google_indisponivel:
    "O login com Google ainda não está disponível. Use e-mail e senha ou um link de acesso.",
  google_cancelado: "Você cancelou o login com Google.",
  google_sessao_expirada: "O login com Google demorou demais ou foi interrompido. Tente de novo.",
  google_email_nao_verificado:
    "Seu e-mail no Google não está verificado. Use outro jeito de entrar.",
  conta_nao_verificada:
    "Já existe uma conta com este e-mail, mas ele ainda não foi confirmado. Entre com a senha e confirme o e-mail antes de usar o Google.",
  conta_desativada: "Esta conta está desativada.",
  google_falhou: "Não foi possível entrar com o Google agora. Tente de novo em instantes.",
  segundo_fator_travado:
    "Muitos códigos errados na verificação em duas etapas. Por segurança, tente de novo daqui a uma hora.",
};

/** Lê `?erro=` com segurança: só mostra mensagens conhecidas (nada vindo da URL é exibido cru). */
export function redirectErrorMessage(value: string | string[] | undefined): string | undefined {
  const code = Array.isArray(value) ? value[0] : value;
  return code ? LOGIN_REDIRECT_ERRORS[code] : undefined;
}
