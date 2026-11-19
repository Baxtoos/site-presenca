# Revisão de segurança — OWASP ASVS nível 2

Revisão do Monitor de Presenças contra o OWASP ASVS (nível 2), feita em novembro de 2026 sobre o
código da `main`. Foco: autenticação, sessões, controle de acesso, a rota de repasse de e-mail,
cabeçalhos, dados pessoais (LGPD) e integrações externas.

Legenda: ✅ atende · 🔧 corrigido nesta revisão · ⚠️ recomendação (risco aceito por enquanto).

## Resumo

| Área                         | Situação | Observação                                                                           |
| :--------------------------- | :------: | :----------------------------------------------------------------------------------- |
| Senhas e login               |    ✅    | Argon2id, checagem de senha vazada, limite de tentativas, login sem vazar existência |
| Links por e-mail (tokens)    |    ✅    | Hash no banco, uso único, 15 min (nova senha / acesso) e 24 h (confirmação)          |
| Sessões                      |    ✅    | Token opaco, cookie `__Host-` HttpOnly/Secure/SameSite, ociosidade 14 d, teto 90 d   |
| Login com Google             |    ✅    | OAuth com PKCE e `state` comparado em tempo constante                                |
| Controle de acesso           |    ✅    | Filtro na API + RLS forçado no Postgres; testes de isolamento entre usuários         |
| CSRF                         |    ✅    | Escritas só com `Origin` do app; cookie SameSite=Lax                                 |
| Validação de entrada         |    ✅    | Zod em todo corpo, parâmetro e consulta; limite de corpo de 64 KB                    |
| Cache de respostas da API    |    🔧    | `Cache-Control: no-store` em todas as respostas                                      |
| CSP do site                  |    🔧    | Política restritiva criada (com `'unsafe-inline'` em scripts, ver ⚠️ 1)              |
| SSRF no push                 |    🔧    | Só serviços de push dos navegadores (API e worker)                                   |
| Política de privacidade/LGPD |    🔧    | Operadores, transferência internacional, retenção, backups, base legal e contato     |
| Rota de repasse de e-mail    |    ✅    | Segredo comparado em tempo constante, validação, sem segredo nada sai                |
| Logs e rastreamento de erros |    ✅    | Senhas, tokens e cookies omitidos nos logs; Sentry sem dados pessoais                |
| Backups                      |    ✅    | Papel só leitura, criptografados (AES-256), restauração testada, 30 dias             |
| Enumeração de contas         |    🔧    | Cadastro responde sempre "confira seu e-mail"; a conta nasce no link (ver 🔧 5)      |
| Reautenticação               |    🔧    | Conta sem senha confirma a exclusão por link enviado ao e-mail (ver 🔧 6)            |
| MFA                          |    ⚠️    | Não há segundo fator (ver ⚠️ 2)                                                      |

## O que já estava bem feito

- **Senhas (V6/V2):** Argon2id (19 MiB, 2 iterações), mínimo de 10 e máximo de 128 caracteres, sem
  regras de composição, recusa de senhas vazadas (Have I Been Pwned, k-anonimato). Login com conta
  inexistente roda o mesmo hash (tempo igual) e responde a mesma mensagem.
- **Limite de tentativas:** login 5/min por IP+e-mail e 30/min por IP; e-mails 3 a cada 15 min por
  endereço; rotas de token por IP. O IP real vem da Vercel com segredo (`API_PROXY_SECRET`).
- **Tokens de e-mail:** aleatórios, guardados só como hash, de uso único, consumidos por POST (a
  pré-visualização de links do cliente de e-mail não gasta o token).
- **Sessões (V7/V3):** token opaco de 256 bits, guardado como hash; cookie `__Host-sid` HttpOnly,
  Secure, SameSite=Lax; expira por ociosidade (14 dias) e por idade (90 dias); nova senha derruba
  todas as sessões; o aluno vê e encerra as sessões de outros aparelhos.
- **Controle de acesso (V8/V4):** toda consulta roda numa transação com `app.user_id`, e o Postgres
  aplica RLS **forçado** (nem o dono das tabelas escapa). Papéis separados para API, worker, backup e
  migrations, sem BYPASSRLS. Testes de integração conferem o isolamento tabela por tabela.
- **CSRF (V3.5):** escrita de outro site (`Origin` diferente) ou com cookie e sem `Origin` é
  recusada com 403.
- **Cabeçalhos:** API com helmet (CSP `default-src 'none'`, `frame-ancestors 'none'`); site com
  HSTS de 2 anos, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` e `Permissions-Policy`.
- **TLS com o banco:** verificação completa do certificado (`verify-full`).
- **LGPD:** exportação completa em JSON, exclusão definitiva (inclusive trilha de auditoria) por
  função `SECURITY DEFINER` restrita ao próprio usuário.

## Corrigido nesta revisão

1. **Cache (V14.3 / V8.2.1):** a API não mandava `Cache-Control`, então respostas com dados do aluno
   podiam ficar no cache do navegador ou de proxies. Agora toda resposta sai com `no-store`
   (testado).
2. **CSP no site (V3.4 / V14.4):** o site não tinha Content-Security-Policy. Agora só aceita
   recursos do próprio domínio, bloqueia `<object>`, troca de `<base>`, formulários para fora,
   iframes de terceiros (`frame-ancestors 'none'`) e conexões externas (exceto o Sentry, quando
   configurado).
3. **SSRF no Web Push (V12.6 / V1.12):** o endereço de inscrição aceitava qualquer URL HTTPS, e o
   worker faria POST nela (ex.: `https://169.254.169.254/...`). Agora só são aceitos os serviços de
   push dos navegadores (FCM, Mozilla, Apple, Windows), na porta padrão; o worker confere de novo
   antes de enviar e descarta inscrições fora da lista. Testado com endereços internos, portas e
   domínios parecidos.
4. **Transparência (LGPD art. 9º, 33):** a política de privacidade não citava os operadores, a
   transferência internacional, a retenção dos backups, a base legal nem um contato. Atualizada.
5. **Enumeração de contas no cadastro (V6.3.8), corrigido depois da revisão:** o cadastro dizia
   "e-mail já cadastrado". Agora responde sempre igual ("confira seu e-mail"), com a mesma
   checagem de senha e o mesmo custo de Argon2 nos dois casos. E-mail novo recebe um link de
   confirmação (24 h, uso único, só o último vale) que guarda nome e hash da senha; a conta só é
   criada no clique, já com o e-mail confirmado. E-mail que já tem conta recebe um aviso, sem link
   que crie ou altere nada. Isso também impede o "sequestro antes da conta" (alguém cadastrar o
   e-mail de outra pessoa com uma senha que ele conhece). Testado na API e no navegador.
6. **Reautenticação de conta sem senha, corrigido depois da revisão:** quem entra só por link ou
   Google confirmava a exclusão da conta digitando o próprio e-mail, que um invasor com a sessão
   também sabe. Agora recebe um link por e-mail (15 min, uso único, só vale para a conta logada) e
   confirma num clique na página aberta pelo link; abrir o link sozinho não exclui nada.

## Recomendações (riscos aceitos por enquanto)

1. **`'unsafe-inline'` em scripts na CSP:** necessário para os scripts inline do Next e a máscara
   da barra de endereço. Remover exige nonce por requisição em todas as páginas (renderização sempre
   dinâmica). O React já escapa o conteúdo; o risco residual é baixo.
2. **Sem segundo fator (MFA):** para um app de controle de faltas, a combinação senha forte +
   senha vazada recusada + limite de tentativas + avisos de sessão é proporcional. Se o app passar
   a guardar dados mais sensíveis, adicionar TOTP ou passkeys.
3. **Segredo compartilhado:** `API_PROXY_SECRET` protege o IP real **e** a rota de repasse de
   e-mail. Se vazar, alguém poderia mandar e-mails pela conta Gmail do app. Troque o valor (na
   Vercel e no Render, juntos) se houver qualquer suspeita; um segredo separado para o e-mail é uma
   melhoria simples para depois.
4. **Senha mínima de 10 caracteres:** atende o ASVS 5.0 (mínimo 8, com checagem de senha vazada);
   o ASVS 4.0.3 pedia 12. Subir para 12 é trivial se quiser seguir a versão mais rígida.

## Como repetir

- `pnpm test:int` cobre isolamento (RLS), papéis, CSRF, tokens, sessões, push e cache.
- Cabeçalhos do site: `curl -sI https://SEU-SITE.vercel.app | grep -i -E "content-security|strict-transport|x-frame"`.
- Cabeçalhos da API: `curl -sI https://SEU-SITE.vercel.app/api/healthz | grep -i cache-control`.
