# Hospedagem gratuita, sem cartão

Tudo abaixo usa planos gratuitos que não pedem cartão de crédito. Os limites dos planos mudam com
frequência: antes de criar cada conta, confira a página de preços do serviço.

```
Navegador ──► Vercel (site, Next.js) ──/api──► Render (API) ──► Neon (Postgres)
                                                  │            └► Upstash (Redis)
GitHub Actions (a cada 15 min) ──► worker pontual ─┴──────────► Neon + e-mail + push
```

| Peça     | Serviço gratuito     | O que esperar                                                                                                                                                   |
| :------- | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site     | Vercel (já no ar)    | Uso pessoal/não comercial no plano gratuito.                                                                                                                    |
| API      | Render, plano Free   | Dorme após 15 min sem acesso e leva ~1 min para acordar. Um monitor gratuito a mantém acordada (passo 10). 750 h/mês bastam para **uma** API ligada o mês todo. |
| Postgres | Neon, plano Free     | 0,5 GB e horas de computação limitadas por mês; suspende sozinho após 5 min ocioso (acorda em ~1 s).                                                            |
| Redis    | Upstash, plano Free  | 500 mil comandos/mês e 256 MB. Só guarda os limites de tentativa de login.                                                                                      |
| Worker   | GitHub Actions       | Roda **uma vez** a cada 15 min e sai.                                                                                                                           |
| E-mail   | Gmail (senha de app) | Veja o passo 6.                                                                                                                                                 |

## O que muda por não ter servidor sempre ligado

- **Avisos de falta e lembretes de chamada chegam em até ~15 min**, não na hora. A central (o sino)
  continua instantânea, porque a API grava o aviso na mesma hora.
- **A primeira abertura depois de um tempo parado pode demorar** (API e banco acordando). Com o
  monitor do passo 10 a API fica acordada; o banco acorda sozinho na primeira consulta.
- **Backup:** o plano gratuito do Neon guarda pouco histórico. Faça um `pg_dump` de vez em quando
  (passo 12).

## Antes de começar

No seu computador: Node 22 (`. ~/.nvm/nvm.sh`) e `pnpm install` feito na raiz do repositório. Os
comandos abaixo rodam **no seu computador**, uma vez, para preparar o banco.

> **Segredos:** as URLs de conexão têm senha. Guarde num gerenciador de senhas, **nunca** no
> repositório. A URL do `app_owner` só é usada no seu computador (migrations); ela **não** vai para
> o Render nem para o GitHub.

## 1. Neon (Postgres)

1. Crie a conta em neon.com (pode entrar com o GitHub).
2. Crie um projeto: Postgres **17**, região **AWS US East 1 (N. Virginia)** (a mesma do Render).
3. Em _Connection details_, **desligue "Connection pooling"** e copie a string de conexão. Ela tem
   o host **sem** `-pooler`. O app precisa de conexão direta (o `LISTEN/NOTIFY` e as transações com
   usuário por requisição não combinam com o pooler).

Essa é a URL de **administração** (`ADMIN_DATABASE_URL`). Ela só é usada no passo 2. Nunca cole essa
string em chats, e-mails ou no repositório: se ela vazar, troque a senha do `neondb_owner` no Neon
(_Roles → Reset password_) antes de continuar.

## 2. Papéis do banco, migrations e conferência (um comando)

O Docker local cria os papéis do app sozinho; num banco gerenciado, quem faz isso é este script. Ele
pede a conexão de administração **com o texto escondido**, cria `app_owner`, `app_api`,
`app_worker` e `app_auth` com senhas fortes geradas na hora, aplica as migrations, confere as
permissões e grava as URLs novas em `~/presenca-producao.env` (permissão 600, **fora** do
repositório). Nenhuma senha é impressa na tela:

```bash
bash infra/prod/provision.sh
```

Tem de terminar com "Papéis do banco OK.". Abra o arquivo `~/presenca-producao.env` para copiar os
valores nos próximos passos. Rodar de novo gera senhas novas (use isso se alguma vazar).

Com a CLI da Neon logada (`neon login`), dá para o script usar a conexão sem digitar nada:
`ADMIN_DATABASE_URL="$(neon connection-string production --role-name neondb_owner)" bash infra/prod/provision.sh`.

## 3. Migrations futuras

O passo 2 já aplicou as migrations atuais. Quando o projeto ganhar uma migration nova, rode no seu
computador, antes (ou logo depois) de publicar a versão nova:

```bash
DATABASE_URL_OWNER="$(grep ^DATABASE_URL_OWNER= ~/presenca-producao.env | cut -d= -f2-)" \
  pnpm --filter @presenca/db db:migrate
```

## 4. Upstash (Redis)

1. Crie a conta em upstash.com e um banco Redis, região **us-east-1**.
2. Copie a URL que começa com `rediss://` (com TLS). Ela será o `REDIS_URL` da API.
   Formato: `rediss://default:SENHA@NOME.upstash.io:6379`. A senha é o mesmo "token" que o painel
   mostra; use a conexão **Redis (TCP)**, não a de REST.

Já foi testado com um Redis do Upstash: a API sobe com `redis: up` no `/readyz` e o limite de
tentativas funciona (as 10 primeiras requisições passam e a 11ª recebe 429 com `Retry-After`). Cada
tentativa usa poucos comandos, então os 500 mil por mês do plano gratuito sobram para um grupo de
alunos.

## 5. Chaves do push (opcional)

Sem elas o app funciona, só sem notificações no celular/computador.

```bash
pnpm --filter @presenca/worker exec web-push generate-vapid-keys
```

Guarde a chave **pública** (vai na API e no worker) e a **privada** (só no worker).

## 6. E-mail

A API manda os e-mails de confirmação de conta, link de acesso e redefinição de senha; o worker
manda os alertas. Sem domínio próprio, o caminho gratuito é enviar pelo **Gmail** com uma _senha de
app_ (o e-mail sai dos servidores do Google e chega; remetente @gmail.com por outro provedor, como
o Brevo, costuma ser bloqueado pelo Gmail).

> **O Render gratuito bloqueia SMTP** (portas 25, 465 e 587, desde setembro de 2025). Por isso a
> API usa `MAIL_TRANSPORT=relay`: ela entrega a mensagem por HTTPS à rota interna do site
> (`/interno/email`, na Vercel, protegida pelo `MAIL_RELAY_SECRET`), e o site envia por SMTP. O
> worker roda no GitHub Actions, que não bloqueia SMTP, e envia direto (`MAIL_TRANSPORT=smtp`).

1. Na conta Google do remetente, ligue a verificação em duas etapas e crie uma senha de app em
   <https://myaccount.google.com/apppasswords> (16 letras; copie **sem** os espaços).
2. Monte a URL, trocando o `@` do e-mail por `%40`:
   `smtps://SEUEMAIL%40gmail.com:SENHADEAPP@smtp.gmail.com:465`.
3. `MAIL_FROM` = `Monitor de Presenças <seuemail@gmail.com>` (o **mesmo** Gmail).

O Gmail permite cerca de 500 envios por dia. Com um domínio seu, o Resend (`MAIL_TRANSPORT=resend`,
por HTTPS) também funciona direto do Render e dá um remetente mais profissional.

## 7. Render (API)

1. Crie a conta em render.com (pode entrar com o GitHub) e autorize o repositório.
2. _New_ → _Blueprint_ → escolha este repositório. O Render lê o `render.yaml` e propõe o serviço
   `presenca-api` no plano **Free**.
3. Preencha as variáveis marcadas como "sync: false":

   | Variável             | Valor                                                                                                                                                                                               |
   | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `WEB_ORIGIN`         | O endereço do site na Vercel, com `https://` e **sem** barra no fim (ex.: `https://meu-site.vercel.app`). Tem de ser idêntico ao que o navegador mostra.                                            |
   | `DATABASE_URL`       | A linha `DATABASE_URL` do passo 2 (papel `app_api`).                                                                                                                                                |
   | `REDIS_URL`          | A URL `rediss://` do passo 4.                                                                                                                                                                       |
   | `API_PROXY_SECRET`   | Gere com `openssl rand -base64 32`; o **mesmo** valor vai na Vercel (passo 8).                                                                                                                      |
   | `MAIL_RELAY_SECRET`  | Outro valor, gerado do mesmo jeito (**diferente** do `API_PROXY_SECRET`); o **mesmo** vai na Vercel (passo 8). Protege o repasse de e-mail.                                                         |
   | `MFA_ENCRYPTION_KEY` | Mais um valor de `openssl rand -base64 32`, só no Render. Cifra as chaves da verificação em duas etapas; vazio = recurso indisponível. **Não troque depois**: quem já ligou teria de ligar de novo. |
   | `FEEDBACK_TO`        | O seu e-mail: recebe as sugestões e os problemas enviados pela página Conta (responder vai direto para o aluno). Vazio = formulário indisponível.                                                   |
   | `VAPID_PUBLIC_KEY`   | A chave pública do passo 5 (ou deixe vazio).                                                                                                                                                        |

4. Crie. O primeiro build leva alguns minutos. Quando terminar, copie a URL do serviço (algo como
   `https://presenca-api.onrender.com`).

> A API recusa subir com variável faltando ou insegura (e-mail só no log, `RATE_LIMIT_FACTOR`
> diferente de 1, `WEB_ORIGIN` sem HTTPS...) e diz qual está errada nos logs do Render.

## 8. Vercel (site)

Em _Settings → Environment Variables_ do projeto, crie **`API_INTERNAL_URL`** com a URL do Render
(sem barra no fim), para _Production_, e faça um **novo deploy** (a variável é lida no build).

Crie também **`API_PROXY_SECRET`** com o **mesmo valor** usado no Render (gere com
`openssl rand -base64 32`). O site manda à API o IP real do aluno junto com esse segredo; sem ele,
a API só enxerga um IP da Cloudflare do Render, igual para todos, e o limite de tentativas por IP
passa a valer para todo mundo junto.

Crie ainda **`SMTP_URL`** e **`MAIL_FROM`** (os do passo 6) e **`MAIL_RELAY_SECRET`** (o mesmo do
Render): o site é quem envia os e-mails da API (`MAIL_TRANSPORT=relay` no Render), e só aceita
pedidos com esse segredo. Faça um novo deploy depois de criar as variáveis.

> Instalações antigas usavam o `API_PROXY_SECRET` também para o e-mail; sem `MAIL_RELAY_SECRET`,
> os dois lados continuam assim. Para separar: gere um valor novo, crie `MAIL_RELAY_SECRET` na
> Vercel e no Render no mesmo momento e faça um novo deploy na Vercel. Nos 1 a 2 minutos em que
> só um lado tem a variável, os e-mails da API (confirmação, link de acesso, nova senha) falham.

Se o build do site falhar por falta dos pacotes internos, use como _Build Command_:
`cd ../.. && pnpm turbo run build --filter=@presenca/web`, com _Root Directory_ `apps/web`.

## 9. GitHub (worker pontual)

Em _Settings → Secrets and variables → Actions_, crie os segredos:

| Segredo                                                  | Valor                                                                                |
| :------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `WORKER_DATABASE_URL`                                    | A linha `WORKER_DATABASE_URL` do passo 2 (papel `app_worker`).                       |
| `WEB_ORIGIN`                                             | O mesmo endereço do site.                                                            |
| `MAIL_TRANSPORT`                                         | `smtp`                                                                               |
| `SMTP_URL`, `MAIL_FROM`                                  | Os mesmos do passo 6.                                                                |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Passo 5; o assunto é `mailto:seu-email@exemplo.com`. Opcionais, mas só valem juntos. |
| `INTEGRATION_ENCRYPTION_KEY`                             | A mesma do Render (passo 14). Opcional: liga a sincronização com o Moodle.           |

Depois, em _Actions → Worker (pontual) → Run workflow_, rode uma vez à mão e veja o log: tem de
aparecer "ciclo único concluído". A partir daí ele roda sozinho a cada 15 minutos.

> **Atalho:** se você estiver no computador com o Git autenticado e o arquivo `~/presenca-producao.env`,
> rode `bash infra/prod/finish-deploy.sh`: ele pede os valores que faltarem (`WEB_ORIGIN`,
> `API_INTERNAL_URL`, `REDIS_URL`, `SMTP_URL`, `MAIL_FROM`), grava em `~/presenca-producao.env`,
> envia todos os segredos ao GitHub Actions, dispara o primeiro ciclo do worker e confere o deploy.

- **Repositório privado:** o GitHub dá 2000 min/mês de graça e cada execução gasta ~1 min. Edite o
  `cron` em `.github/workflows/worker.yml` para `*/30`.
- Se o repositório ficar 60 dias sem nenhum commit, o GitHub pode desligar os agendamentos;
  reative em _Actions_.

## 10. Manter a API acordada

Crie uma conta gratuita no UptimeRobot (ou serviço parecido) e um monitor HTTP para
`https://SUA-API.onrender.com/healthz` a cada 5 minutos. Esse endereço não toca no banco, então o
Neon continua dormindo quando ninguém usa.

## 11. Conferir

```bash
bash infra/prod/check-deploy.sh https://meu-site.vercel.app https://presenca-api.onrender.com
```

Depois, à mão, no site:

1. **Cadastro** e confirmação de e-mail (o e-mail chega?).
2. **IP real dos visitantes.** A API usa o IP para limitar tentativas. Logado, abra o console do
   navegador (F12) e rode
   `fetch('/api/v1/me/sessions').then(r => r.json()).then(d => console.log(d.sessions.find(s => s.current)?.ip))`:
   o IP mostrado deve ser o **seu** IP público. Se for outro (por exemplo 104.x, da Cloudflare),
   confira se `API_PROXY_SECRET` existe com o mesmo valor na Vercel e no Render, faça um novo
   deploy dos dois, saia e entre de novo; senão todos os usuários dividiriam o mesmo limite de
   tentativas.
3. **Registrar uma falta**, ver o aviso no sino e (em até 15 min) o e-mail.
4. **Push:** em Conta → _Ativar neste aparelho_ → _Enviar teste_, num Chrome/Edge normal (não
   anônimo) ou no celular com o app instalado.

## 12. Rotina

- **Avisos de falha:**
  - **Worker:** se um envio de aviso falhar, a execução do _Worker (pontual)_ sai como falha e o
    GitHub manda um e-mail. Confira em <https://github.com/settings/notifications> → _Actions_ que
    está marcado _Email_ e _Only notify for failed workflows_.
  - **Sentry (erros da API e do site):** crie a conta gratuita em <https://sentry.io> (plano
    _Developer_), um projeto **Node.js** (para a API e o worker) e um **Next.js** (para o site), e
    copie a _DSN_ de cada um (_Settings → Client Keys (DSN)_). Depois: `SENTRY_DSN` no Render (DSN
    do Node.js), o segredo `SENTRY_DSN` no GitHub (o mesmo, para o worker) e
    `NEXT_PUBLIC_SENTRY_DSN` na Vercel (DSN do Next.js; precisa de novo deploy). Em _Alerts_, deixe
    o alerta padrão de "novo problema" mandando e-mail. Sem DSN nada é enviado. Só erros vão para o
    Sentry: sem corpo das requisições, cookies, IP ou usuário, e com os e-mails mascarados.
- **Backup automático (diário):** o workflow _Backup do banco_ roda todo dia às 03:23 (Brasília),
  lê com o papel `app_backup` (só leitura) e guarda só os **dados**: a estrutura, as permissões e
  o histórico de migrations vêm do código. Ele ensaia a restauração (PostgreSQL 17 vazio →
  migrations → dados) e guarda o arquivo **criptografado** (AES-256) por 30 dias na aba _Actions_.
  Todo dia 1º, o workflow _Ensaio de restauração_ baixa o arquivo guardado mais recente, abre com
  a senha e restaura de novo, para garantir que o caminho de emergência funciona. Se falhar, o GitHub
  avisa por e-mail. Para ligar (uma vez): `bash infra/prod/backup-role.sh`. Ele pede a conexão de
  administração do Neon, dá login ao `app_backup` **sem trocar as outras senhas**, aplica a
  migration 0008, grava `BACKUP_DATABASE_URL` e `BACKUP_PASSPHRASE` em `~/presenca-producao.env`,
  envia os dois ao GitHub e dispara o primeiro backup. Guarde a `BACKUP_PASSPHRASE` também no
  gerenciador de senhas: sem ela nenhum backup abre. (Rode esse script **antes** de qualquer
  `db:migrate` que inclua a 0008: ela precisa do papel `app_backup`.)
- **Restaurar um backup** (perda do banco): primeiro tente a restauração do próprio Neon
  (_Branches_ → restaurar para um horário anterior), que é mais rápida. Se não der:
  1. Em _Actions → Backup do banco_, abra a execução e baixe o artefato (um `.zip`) e abra:

     ```bash
     unzip presenca-backup-*.zip
     gpg -d presenca-dados-*.sql.gz.gpg > dados.sql.gz   # pede a BACKUP_PASSPHRASE
     ```

  2. Crie um banco **novo e vazio** (no Neon: um projeto ou banco novo) e, com o código na mesma
     versão do backup (`git checkout` do commit da época, se houve migration depois):

     ```bash
     ADMIN_DATABASE_URL="conexão do dono do banco novo" pnpm db:provision   # papéis e senhas novas
     DATABASE_URL_OWNER="a linha que o provision mostrou" pnpm db:migrate  # estrutura e permissões
     OWNER_URL="a mesma DATABASE_URL_OWNER" bash infra/prod/restore-data.sh dados.sql.gz
     ```

     O último passo só carrega num banco sem contas e mantém a trilha de auditoria como estava.

  3. Rode `bash infra/prod/backup-role.sh` no banco novo (backup de novo), troque `DATABASE_URL`
     no Render e `WORKER_DATABASE_URL` no GitHub, e confira entrando no app.

  Arquivos de antes de 19/11/2026 (`presenca-AAAA-...`, sem `dados` no nome) têm outro formato e
  saem da aba _Actions_ sozinhos em 30 dias.

- **Backup manual (no seu computador):** `bash infra/prod/backup.sh --verify`
  (gera os dados compactados em `~/backups-presenca/` com permissão `600` e ensaia a restauração
  num container PostgreSQL 17 temporário, com as migrations do código).
- **Trocar senhas:** rode de novo o `db:provision` (passo 2), atualize as variáveis no Render e no
  GitHub.
- **Versão nova:** `git push` na `main` publica sozinho na Vercel e no Render. Se houver migration
  nova, rode o passo 3 antes.
- **Limites:** no Neon, acompanhe as horas de computação; no GitHub, os minutos (repositório
  privado); no Upstash, os comandos. Os três mostram o uso no painel.

## 13. Login com Google (opcional)

O código já está pronto; o botão "Entrar com Google" aparece como indisponível até existirem as
credenciais.

1. Em <https://console.cloud.google.com>, crie um projeto (ex.: "Monitor de Presenças").
2. _APIs e serviços → Tela de consentimento OAuth_ (ou _Google Auth Platform → Branding_): tipo
   **Externo**, nome do app, e-mail de suporte e de contato do desenvolvedor. Em _Público-alvo_,
   publique o app (**Em produção**); os escopos usados (`openid`, `email`, `profile`) não exigem
   verificação do Google.
3. _Credenciais → Criar credenciais → ID do cliente OAuth_, tipo **Aplicativo da Web**:
   - _Origens JavaScript autorizadas_: `https://SEU-SITE.vercel.app`
   - _URIs de redirecionamento autorizados_: `https://SEU-SITE.vercel.app/api/v1/auth/google/callback`
     (exatamente o `WEB_ORIGIN` + `/api/v1/auth/google/callback`).
4. Copie o **ID do cliente** e a **chave secreta do cliente** para o Render: `GOOGLE_CLIENT_ID` e
   `GOOGLE_CLIENT_SECRET` (as duas juntas). A API reinicia sozinha.
5. Teste em uma aba anônima: _Entrar com Google_ → escolher a conta → volta logado ao app.

Erro `redirect_uri_mismatch` = a URI do passo 3 não bate com o `WEB_ORIGIN` (barra no fim,
`http`, endereço de preview).

## 14. Moodle (opcional)

O conector do Moodle (Conta → Moodle) importa as entregas com prazo pelo link do calendário (.ics)
de cada aluno. O link e a chave do Moodle ficam cifrados no banco com uma chave que só a API e o
worker conhecem.

1. Gere a chave no seu computador: `openssl rand -base64 32`.
2. Render → serviço da API → _Environment_: crie `INTEGRATION_ENCRYPTION_KEY` com esse valor.
3. GitHub → _Settings → Secrets and variables → Actions_: crie o segredo
   `INTEGRATION_ENCRYPTION_KEY` com **o mesmo valor** (o worker sincroniza a cada ~45 min).
4. Guarde a chave em `~/presenca-producao.env`. **Não troque depois**: com outra chave, os alunos
   precisam colar o link do Moodle de novo.

Sem a chave, a página Conta → Moodle diz que a integração não está ligada e nada mais muda.
`INTEGRATIONS_ALLOW_INSECURE_FETCH` é só para os testes (a API e o worker recusam fora de
`NODE_ENV=test`).

## Problemas comuns

| Sintoma                                      | Causa provável                                                                                        |
| :------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| Login/cadastro dá "403"                      | `WEB_ORIGIN` no Render diferente do endereço real do site (barra no fim, `http`, domínio de preview). |
| `/api/...` dá 404 ou erro de conexão no site | `API_INTERNAL_URL` ausente na Vercel ou sem novo deploy depois de criar.                              |
| A primeira página demora ~1 min              | API dormindo: confira o monitor do passo 10.                                                          |
| API não sobe no Render                       | Veja o log: ela lista a variável inválida.                                                            |
| "password authentication failed"             | Senha do papel trocada ou URL errada: rode o `db:provision` de novo e atualize.                       |
| Alertas por e-mail não chegam                | Confira o log da execução do worker no GitHub e se o e-mail está confirmado na conta.                 |
