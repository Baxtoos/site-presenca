# Monitor de Presenças

App web (PWA) para estudantes controlarem faltas por matéria, saberem quanto ainda podem faltar e
receberem alertas antes de reprovar. O planejamento aprovado está em
[planejamento.html](planejamento.html).

## Regras de arquitetura

1. **O navegador nunca fala com o banco.** Só `apps/api` e `apps/worker` têm credenciais.
   O CI falha se `apps/web` importar `packages/db` ou um driver de banco (`pnpm lint:deps` e ESLint).
2. **Toda regra de negócio roda na API.** O web só exibe e pede.
3. **Toda escrita é transacional e a contagem de faltas é derivada**, nunca armazenada.
4. **Isolamento em duas camadas:** a API filtra por usuário e o Postgres aplica RLS forçado.
5. **O banco só muda por migration** versionada e revisada.

## Estrutura

```
apps/
  web/        Next.js · só interface; fala com a API pelo proxy /api
  api/        NestJS + Fastify · regras de negócio, autenticação, acesso a dados
  worker/     alertas (outbox) e tarefas agendadas
packages/
  engine/     motor de cálculo puro (sem I/O)
  contracts/  schemas Zod compartilhados entre web e API
  db/         schema Drizzle, migrations e conexão (só api e worker importam)
  emails/     templates de e-mail
e2e/          testes no navegador (Playwright) contra o app inteiro
infra/
  docker-compose.yml   Postgres 17, Valkey (Redis) e Mailpit para desenvolvimento
  postgres/init/       papéis do banco (app_owner, app_api, app_worker, app_auth)
  docker/              Dockerfiles de produção
  ci/                  ensaio de deploy da imagem da API
```

## Requisitos

- Node.js 22 (`.nvmrc`) e pnpm 10
- Docker com Compose v2 (para Postgres, Redis e Mailpit locais)

## Primeiros passos

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:setup      # migrations + dados de exemplo (demo@presenca.local)
pnpm dev
```

Depois disso, `pnpm dev:all` sobe a infraestrutura, aplica migrations pendentes e roda web, API e
worker juntos:

| Serviço                    | Endereço                                                       |
| -------------------------- | -------------------------------------------------------------- |
| Web                        | http://localhost:3000                                          |
| API                        | http://localhost:4000 (`/healthz`, `/readyz`, `/openapi.json`) |
| Mailpit (e-mails de teste) | http://localhost:8025                                          |
| Postgres                   | `localhost:5432`, banco `presenca`                             |

Sem Docker, `pnpm dev` ainda roda web, API e worker; o `/readyz` da API responde 503 até o banco existir.

## Scripts

| Comando                        | O que faz                                         |
| ------------------------------ | ------------------------------------------------- |
| `pnpm dev`                     | Roda todos os apps em modo desenvolvimento        |
| `pnpm dev:all`                 | Sobe a infraestrutura e roda os apps              |
| `pnpm build`                   | Compila tudo                                      |
| `pnpm typecheck`               | Checa tipos em todos os pacotes                   |
| `pnpm test`                    | Testes unitários                                  |
| `pnpm test:int`                | Testes de integração (Postgres real em container) |
| `pnpm test:e2e`                | Testes no navegador (precisa do app no ar)        |
| `pnpm db:migrate`              | Aplica migrations pendentes (papel `app_owner`)   |
| `pnpm db:seed`                 | Dados de exemplo (idempotente)                    |
| `pnpm db:setup`                | Migrations + seed                                 |
| `pnpm db:check`                | Falha se o schema mudou sem migration             |
| `pnpm lint`                    | ESLint                                            |
| `pnpm lint:deps`               | Barreira de arquitetura (dependency-cruiser)      |
| `pnpm format`                  | Formata com Prettier                              |
| `pnpm check`                   | Tudo o que o CI roda                              |
| `pnpm infra:up` / `infra:down` | Sobe ou para Postgres, Redis e Mailpit            |
| `pnpm infra:reset`             | Apaga os volumes (banco zerado, papéis recriados) |

## Papéis do banco

| Papel        | Uso        | Permissões                                       |
| ------------ | ---------- | ------------------------------------------------ |
| `app_owner`  | migrations | dono do schema `app`                             |
| `app_api`    | API        | só DML, sujeito a RLS, sem DDL                   |
| `app_worker` | worker     | permissões por tabela (definidas nas migrations) |
| `app_auth`   | sem login  | dono das funções de autenticação (ver abaixo)    |

Para conferir que os papéis têm só essas permissões (com a infraestrutura no ar):

```bash
pnpm --filter @presenca/db verify:roles
```

As senhas em `.env.example` e `infra/postgres/init` servem só para desenvolvimento local.

## Banco de dados

- **Schema:** `packages/db/src/schema` (Drizzle), 17 tabelas no schema `app`.
- **Migrations:** `packages/db/migrations`. A `0001_tables` é gerada pelo Drizzle; `0000_foundation`
  (UUID v7, funções de trigger) e `0002_security` (FKs compostas, view `subject_totals`, triggers,
  RLS forçado e permissões de cada papel) são escritas à mão.
- **Mudar o schema:** edite `src/schema`, rode `pnpm --filter @presenca/db db:generate` e revise o
  SQL gerado. Regras que o Drizzle não gera (RLS, triggers, permissões) vão numa migration manual:
  `pnpm --filter @presenca/db db:generate:custom --name=<nome>`.
- **Toda transação da API** passa por `withUser(db, { userId, requestId }, fn)`. Sem `app.user_id`,
  o RLS não deixa ver nenhuma linha.
- **Deploy:** a imagem da API leva as migrations. O passo de migration roda, com `DATABASE_URL_OWNER`,
  `node node_modules/@presenca/db/dist/cli/migrate.js` antes de subir a nova versão.
  `infra/ci/smoke-api.sh` ensaia isso de ponta a ponta (o CI roda a cada push).

## Autenticação

Tudo dentro da API, sem serviço externo de identidade.

- **Senhas:** Argon2id (19 MiB, 2 iterações). Senhas que aparecem em vazamentos são recusadas
  (Have I Been Pwned por k-anonimato: só os 5 primeiros caracteres do SHA-1 saem do servidor).
  Login com e-mail inexistente roda o Argon2 contra um hash falso: mesmo tempo, mesma resposta.
- **Sessões:** token aleatório de 256 bits no cookie `__Host-sid` (`HttpOnly`, `Secure`,
  `SameSite=Lax`). O banco guarda só o SHA-256. Validade de 30 dias renovada com o uso, expira após
  14 dias parada e no máximo 90 dias. Trocar a senha encerra todas as sessões.
- **Links por e-mail** (verificação, redefinição de senha, magic link): uso único, só o hash no
  banco, 15 min (24 h na verificação). Um link novo invalida o anterior.
- **Google:** OAuth 2.0 com PKCE e `state` em cookie. Só vincula a uma conta existente se ela já
  tiver o e-mail confirmado. Configure `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` e cadastre o retorno
  `<WEB_ORIGIN>/api/v1/auth/google/callback`.
- **Antes de saber quem é o usuário** (login, cookie, links), a API chama funções `SECURITY DEFINER`
  do papel `app_auth` (`packages/db/migrations/0003_auth.sql`), que só enxerga as colunas necessárias.
  Todo o resto passa pelo RLS normal.
- **Limite de tentativas** (Redis): login 5/min por conta e IP, cadastro 10/h por IP (redes de universidade compartilham IP), links por e-mail
  3 a cada 15 min por endereço. Com o Redis fora do ar, essas rotas respondem 503 em vez de ficarem
  sem proteção.
- **CSRF:** escritas com cookie de sessão precisam do cabeçalho `Origin` igual a `WEB_ORIGIN`.

## Motor de cálculo e matérias

- **Motor** (`packages/engine`): converte as regras de cada matéria (por carga horária, por número
  de aulas ou limite fixo) em tempos de chamada e calcula limite, saldo, semáforo e presença. Conta
  só com inteiros e arredonda o limite sempre para baixo, a favor do aluno. Testes por propriedades
  (fast-check) conferem, em milhares de casos aleatórios, que o limite é exatamente o piso da conta
  exata. O calendário (`classOccurrences`, `planSkips`) alimenta o "Posso faltar?".
- **A API é a fonte oficial dos números:** cada matéria volta com `summary`, calculado pelo motor a
  partir da view `subject_totals`. O web usa o mesmo motor só para a prévia enquanto o aluno digita.
- **Concorrência:** recursos editáveis voltam com `ETag` (a versão). `PATCH`/`PUT`/`DELETE` de
  semestre, matéria, horário e registro de presença exigem `If-Match`; sem ele, 428; com versão velha, 412 (outro
  dispositivo salvou antes).
- **Matéria nova** é criada com regras e grade numa transação só: um horário inválido não deixa a
  matéria pela metade.

## Presenças (registro de chamada)

- **Aulas do dia** (`GET /v1/today?date=`): as aulas da grade do dia (hoje no fuso do aluno, por
  padrão) de todos os semestres ativos, com o registro já feito, o resumo de cada matéria e os
  feriados que bloqueiam a aula. Dias futuros são recusados (422 `FUTURE_DATE`).
- **Registrar** (`POST /v1/attendance`): presente, falta, falta parcial (`unitsMissed`) ou aula
  cancelada. Sem `scheduleId`, vira aula extra (`unitsScheduled`). A resposta traz o registro e o
  `summary` recalculado. Mesma aula duas vezes → 409 `ATTENDANCE_CONFLICT`.
- **Idempotency-Key obrigatória no POST** (428 sem ela). Repetir a mesma chave com o mesmo corpo
  devolve a resposta original (`Idempotent-Replayed: true`) sem gravar de novo; mesma chave com
  corpo diferente → 422 `IDEMPOTENCY_KEY_REUSED`. Chaves valem 24 h, por usuário; erro não é
  guardado. O web repete uma vez, com a mesma chave, se a rede cair.
- **Corrigir/apagar** (`PATCH`/`DELETE /v1/attendance/:id`) exigem `If-Match`. O "Desfazer" do web
  usa isso: apaga o registro novo ou restaura os campos do anterior.
- **Histórico** (`GET /v1/subjects/:id/attendance`): paginação por cursor (`limit`, `cursor`,
  `status`), do mais recente ao mais antigo.
- **Posso faltar?** (`GET /v1/subjects/:id/simulate`): a próxima aula, o efeito de faltar nela e
  quantas das próximas aulas ainda dá para faltar, já descontando feriados e o que foi registrado.
- Cada mudança gera um evento de auditoria (`attendance_log_events`) com o `requestId`.

## App instalável e modo offline

- **Instalável (PWA):** `app/manifest.ts` (ícones normais e "maskable", atalho para "Aulas de
  hoje"), ícone da Apple e cor do tema. A home convida a instalar: botão no Android/Chrome/Edge e
  instrução de "Adicionar à Tela de Início" no iPhone.
- **Service worker** (`apps/web/public/sw.js`, escrito à mão, sem plugin de build):
  - estáticos com hash (`/_next/static`, ícones): cache primeiro;
  - páginas da área logada: rede primeiro (prazo de 4 s), e a última versão boa fica guardada para
    abrir sem internet. Redirecionamento (sessão expirada) nunca é guardado;
  - `/api` nunca passa pelo cache;
  - sem rede e sem cópia: página estática `/offline`.
  - Só é registrado no build de produção (ou com `NEXT_PUBLIC_SW=1`). Em `next dev`, um SW que
    tenha sobrado é removido, para não servir arquivos velhos.
- **Marcar aula sem internet:** se o `POST /v1/attendance` falha por rede (já depois de uma
  repetição), a marcação vai para uma fila no **IndexedDB** com a **mesma `Idempotency-Key`** da
  tentativa: se ela chegou ao servidor, o reenvio só devolve a resposta original. A aula aparece
  como "não enviado", e trocar o status ainda offline troca o que vai ser enviado.
  - A fila é enviada sozinha quando a conexão volta, quando o app volta para a frente e a cada
    30 s enquanto houver pendência, uma aba por vez (Web Locks).
  - Erro temporário (rede, 5xx, 429, sessão expirada) para o envio e mantém a fila; recusa
    definitiva (ex.: 409, a aula já tinha registro em outro aparelho) sai da fila com aviso.
  - Cada marcação tem dono: num aparelho compartilhado, só a própria conta envia (e vê) as suas.
- **Privacidade no aparelho:** ao sair, o app apaga as páginas guardadas e a fila daquela conta
  (avisando antes se há registros não enviados). Se outra conta entra no mesmo aparelho, as
  páginas guardadas da anterior são apagadas.
- Correções e exclusões de registros já enviados continuam exigindo internet (usam `If-Match`).
- Testes: `apps/web/src/lib/offline-queue.test.ts` (fila e envio, com `fake-indexeddb`) e
  `e2e/tests/offline.spec.ts`. O teste do service worker só roda contra o build de produção (como
  no CI); em `next dev` ele é pulado.

## Avisos e notificações

- **Marcos de alerta** (50/75/90/100% do limite de faltas), regra pura em
  `packages/engine/src/thresholds.ts` (testada por propriedades): cada marco de cada matéria tem
  `armed`/`cycle` em `subject_threshold_state`. Cruzar um marco armado desarma, soma um ciclo e gera
  o aviso; voltar abaixo dele (falta apagada, abonada ou corrigida) rearma. Num salto que cruza
  vários marcos, só o mais grave é enviado; os outros ficam registrados como pulados.
- **Outbox transacional:** a API avalia os marcos **na mesma transação** que muda os números
  (registrar, corrigir, apagar presença ou mudar as regras da matéria) e grava em
  `notification_logs`: a central (`in_app`) já entregue, e-mail e push como `pending`. O
  `dedupe_key` (`threshold:{matéria}:{marco}:{ciclo}`) com `UNIQUE (dedupe_key, channel)` impede
  aviso repetido. Um trigger faz `pg_notify('presenca_outbox')`, que só sai no COMMIT.
- **Worker** (`apps/worker`): escuta o NOTIFY (reconecta sozinho) e varre a fila a cada 30 s como
  rede de segurança. Reserva lotes com `FOR UPDATE SKIP LOCKED` e um prazo de 5 min (se o worker
  morrer no meio, outro retoma). Falhas tentam de novo em 1, 2, 4, 8, 16 min, até 6 tentativas.
  Decide na hora do envio: e-mail só para quem confirmou o endereço; preferências valem as atuais.
  - **E-mail:** os mesmos transportes da API (`@presenca/emails/transport`: SMTP/Mailpit, Resend),
    com o id do aviso como chave de idempotência.
  - **Web Push (VAPID):** biblioteca `web-push` 3.6.7. Aparelho que cancelou (404/410) é apagado;
    o que falha 5 vezes seguidas também. Sem chaves VAPID, os pushes ficam como pulados.
  - **Horário silencioso:** dentro da janela do aluno (no fuso dele), o envio é adiado para o fim
    dela sem gastar tentativa. A central recebe na hora.
  - **Lembrete de chamada:** diário (se ficou aula de hoje sem registro) ou semanal (últimos 7 dias),
    no horário escolhido, no fuso do aluno; feriados não contam. Vai por push, ou por e-mail se o
    aluno não tem push. Um por dia (`dedupe_key`).
  - **Limpeza de hora em hora:** chaves de idempotência com mais de 24 h, sessões vencidas há 7
    dias, links de uso único vencidos.
  - Permissões (migration `0004_notifications`): o `app_worker` lê só as colunas necessárias. Dos
    registros de presença, só "qual aula tem registro" (nunca status, motivo ou observação).
- **API:** `GET /v1/notifications` (cursor, contador de não lidos), `POST /v1/notifications/:id/read`,
  `POST /v1/notifications/read-all`, `POST /v1/notifications/test` (um a cada 20 s),
  `GET|PUT /v1/notification-preferences`, `POST|DELETE /v1/push-subscriptions` (endereço de outra
  conta → 409 `PUSH_ENDPOINT_IN_USE`).
- **Web:** sino com contador no cabeçalho, página `/avisos`, preferências em Conta (marcos, e-mail,
  push por aparelho com "Enviar teste", lembrete, horário silencioso). O service worker mostra o
  push e abre a página do aviso ao tocar. Ao sair, o push daquele aparelho é desativado.
- **Configurar o push:** `pnpm --filter @presenca/worker exec web-push generate-vapid-keys`. A
  chave pública vai em `VAPID_PUBLIC_KEY` (API e worker), a privada **só** no worker
  (`VAPID_PRIVATE_KEY`), mais `VAPID_SUBJECT` (mailto: ou https:). O push precisa do build de
  produção (service worker) e de um navegador com serviço de push: não funciona em aba anônima nem
  no Chromium de testes.

## API

- **Erros:** sempre `application/problem+json` (RFC 9457), com `code` estável e `requestId`.
- **Request id:** cada resposta traz `X-Request-Id`, que aparece em todas as linhas de log e na
  auditoria do banco.
- **Contrato:** as rotas são declaradas em `packages/contracts/src/routes.ts`, que gera o
  `/openapi.json`. Um teste falha se a API tiver rota fora do contrato ou o contrato tiver rota que
  a API não implementa.
- **Escritas** (POST/PUT/PATCH/DELETE) vindas de outra origem que não `WEB_ORIGIN` são recusadas (403).
