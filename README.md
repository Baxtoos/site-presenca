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
  emails/     templates de e-mail e transportes (SMTP, Resend, repasse pela Vercel)
  observability/  Sentry (API, worker e site), sem dados pessoais
e2e/          testes no navegador (Playwright) contra o app inteiro
infra/
  docker-compose.yml   Postgres 17, Valkey (Redis) e Mailpit para desenvolvimento
  postgres/init/       papéis do banco (app_owner, app_api, app_worker, app_auth)
  docker/              Dockerfiles de produção
  ci/                  ensaio de deploy da imagem da API
  prod/                provisionamento, backup manual e restauração (restore-data.sh, restore-test.sh)
  load/                teste de carga (k6)
docs/
  deploy-gratuito.md   passo a passo da hospedagem gratuita e da rotina (backups, restauração)
  seguranca-asvs.md    revisão OWASP ASVS nível 2 e o que foi corrigido
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

> **Banco local criado antes da migration 0008** (backup): o papel `app_backup` não existe no
> volume antigo e o `db:migrate` falha. Crie-o uma vez, sem perder os dados locais:
>
> ```bash
> docker compose -f infra/docker-compose.yml exec -T postgres psql -U postgres -d presenca -c \
>   "create role app_backup login password 'app_backup_dev' nobypassrls;
>    grant connect on database presenca to app_backup;
>    alter role app_backup in database presenca set search_path = app;"
> ```

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

| Comando                                   | O que faz                                                 |
| ----------------------------------------- | --------------------------------------------------------- |
| `pnpm dev`                                | Roda todos os apps em modo desenvolvimento                |
| `pnpm dev:all`                            | Sobe a infraestrutura e roda os apps                      |
| `pnpm build`                              | Compila tudo                                              |
| `pnpm typecheck`                          | Checa tipos em todos os pacotes                           |
| `pnpm test`                               | Testes unitários                                          |
| `pnpm test:int`                           | Testes de integração (Postgres real em container)         |
| `pnpm test:e2e`                           | Testes no navegador (precisa do app no ar)                |
| `pnpm db:migrate`                         | Aplica migrations pendentes (papel `app_owner`)           |
| `pnpm db:seed`                            | Dados de exemplo (idempotente)                            |
| `pnpm db:setup`                           | Migrations + seed                                         |
| `pnpm --filter @presenca/db db:provision` | Cria os papéis e o schema num banco gerenciado (produção) |
| `pnpm db:check`                           | Falha se o schema mudou sem migration                     |
| `pnpm lint`                               | ESLint                                                    |
| `pnpm lint:deps`                          | Barreira de arquitetura (dependency-cruiser)              |
| `pnpm format`                             | Formata com Prettier                                      |
| `pnpm check`                              | Tudo o que o CI roda                                      |
| `pnpm infra:up` / `infra:down`            | Sobe ou para Postgres, Redis e Mailpit                    |
| `pnpm infra:reset`                        | Apaga os volumes (banco zerado, papéis recriados)         |

## Compartilhamento de grades

- **Gerar código** (`POST /v1/templates`, exige e-mail confirmado): copia a estrutura de um semestre
  (matérias, regras de falta, horários, feriados) ou de uma matéria para um modelo com código de
  8 caracteres Crockford base32 (sem I, L, O, U). **Nunca leva faltas, registros, anotações, ids nem
  dados do dono.** Validade de 1 a 90 dias (padrão 30), limite opcional de importações, no máximo 20
  códigos ativos por aluno. A tela mostra o código, o link `/importar/CODIGO` e um QR Code.
- **Prévia pública** (`GET /v1/templates/:code`, sem login, 30 consultas/min por IP). Código
  inexistente, revogado, expirado ou esgotado dão a mesma resposta (404), para não virar oráculo.
  O código digitado é normalizado (minúsculas, hífen, O→0, I/L→1). No site a prévia é buscada pelo
  navegador, não pelo servidor do Next, para o limite ser de cada visitante.
- **Importar** (`POST /v1/templates/:code/import`, com `Idempotency-Key`): cria o semestre, as
  matérias, a grade e os feriados (inclusive as exceções de uma matéria só, religadas à matéria nova)
  numa transação só. Nome repetido ganha sufixo "(2)". Modelo de matéria pede o semestre de destino.
- **Como funciona com RLS:** só o dono enxerga o próprio modelo. A prévia e o consumo passam por
  duas funções `SECURITY DEFINER` (`app.share_preview` e `app.share_consume`, migration
  `0005_sharing`), do papel sem login `app_auth`, que devolvem só os campos do modelo. O consumo é um
  `UPDATE ... WHERE uses_count < max_uses`: importações simultâneas nunca passam do limite, e se a
  importação falhar o uso volta junto com a transação.
- **Revogar** (`DELETE /v1/templates/:id`): o link para de funcionar; quem já importou continua com a
  cópia (ela é dele).
- **Login com retorno:** `/entrar?next=/importar/...` e `/cadastro?next=...` voltam para a página de
  origem. Só caminhos internos (nada de `//outro-site` ou `https://...`).

## Planilha Excel: exportar e importar

- **Exportar** (`GET /v1/semesters/:id/export.xlsx`): abas Resumo (com fórmulas), Historico (as
  faltas) e Grade Horária, mais uma aba **muito oculta** `Dados` (o aluno não vê nem reexibe pelo
  Excel) com o semestre inteiro em JSON: regras, grade, feriados e todos os registros (presenças,
  faltas, parciais, canceladas, anotações). O formato é `spreadsheetDataSchema`
  (`packages/contracts/src/imports.ts`), em pedaços de 30 mil caracteres por célula (limite do Excel).
- **Importar** (`/semestres/importar` → `POST /v1/imports/semester`, com `Idempotency-Key`): o
  navegador lê o arquivo (`apps/web/src/lib/spreadsheet-import.ts`, ExcelJS carregado só nessa hora)
  e mostra uma prévia com nome e datas editáveis; nada sai do aparelho até o aluno confirmar.
  - Planilha nova: usa a aba `Dados`, importação exata. Se o Histórico foi editado no Excel, avisa que
    vale o original.
  - Planilha antiga (sem `Dados`): reconstrói pelas abas visíveis. Regras e cor saem do Resumo e da
    Grade, as faltas do Historico; as datas do semestre são estimadas pelo nome (`2026.1` → fev–jul,
    `.2` → ago–dez, sempre cobrindo as faltas). Presenças e feriados não existem nelas, e a tela avisa.
  - Planilha que o aluno fazia sozinho (.xlsx ou .csv, `apps/web/src/lib/own-spreadsheet.ts`):
    leitura guiada. Reconhece três formatos por aba: uma linha por aula (colunas achadas pelo
    nome: Data, Matéria, Situação, Tempos, Motivo, Observação; sem matéria, a aba é a matéria; sem
    situação, cada linha é uma falta), matérias nas linhas × datas nas colunas, e datas nas linhas
    × matérias nas colunas. Datas com ou sem ano ("02/03", "2 de março"). O aluno confere as
    colunas, o significado de cada marcação ("P", "F", "atestado"; números = tempos de falta; "x"
    é ambíguo e exige escolha), as regras, os tempos por aula e os dias e horário de cada matéria
    (dias sugeridos pelos registros; dia que aparece uma vez vira aula avulsa). Duas linhas da
    mesma aula avulsa no mesmo dia viram uma (o banco guarda uma por dia); motivo e observação vão
    para a anotação da aula. Há uma planilha modelo para baixar na própria tela.
  - A API valida tudo de novo (`SpreadsheetImportService`): data dentro do semestre e não no futuro,
    horário no dia da semana certo, parcial menor que a aula, sem aula repetida. O erro aponta o
    registro (`attendance.N.campo`, "Registro N (dd/mm/aaaa): ..."), e nada é gravado.
  - Cria semestre, matérias, grade, feriados e registros numa transação só (nome repetido ganha
    "(2)"). Os marcos de aviso ficam em dia **sem avisar** sobre faltas antigas
    (`ThresholdAlerts.sync`). Limite de 10 importações por hora, até 3.000 registros, corpo de até
    2 MB só nessa rota.

## SUAP (IFSP e outros institutos)

- **Por que um favorito:** a API do SUAP do IFSP não expõe boletim, faltas nem aulas para estudantes
  (só `/api/eu/`, a identificação do "Login com SUAP"), e as páginas do site exigem o login com
  reCAPTCHA. Por isso o Monitor não entra no SUAP nem guarda senha: o aluno usa o favorito
  **"Enviar para o Monitor"** (`apps/web/src/lib/suap-collector.ts`) na sessão que ele mesmo abriu.
- **O que o favorito lê** (mesma origem, com a sessão do aluno): o boletim do período
  (`/edu/aluno/<matrícula>/boletins/?ano_periodo=2026_2`, fragmento htmx) e, de cada turma,
  `/edu/sala_virtual/<diário>/?tab=aulas` (data, nº de aulas, faltas, abono) e `?tab=dados_gerais`
  (professor, local e a grade de horários). Se a aba vier vazia (o SUAP preenche por script), abre a
  turma num quadro escondido (o SUAP manda `X-Frame-Options: SAMEORIGIN`) e espera o conteúdo.
- **Transporte:** o retrato vai no fragmento da URL (`/semestres/importar#suap=...`), que não sai do
  navegador; o script da página (`lib/url-mask.ts`) guarda no `sessionStorage` antes de mascarar a
  URL, o que também sobrevive ao login. A tela mostra as disciplinas e deixa escolher entre criar um
  semestre ou atualizar um existente.
- **Sincronização** (`POST /v1/imports/suap`, `SuapSyncService`, com `Idempotency-Key`): cria o que
  falta (semestre "2026.2", disciplinas com a sigla no código, regra de 75%, abono descontando,
  horários juntando os tempos seguidos) e, nas aulas já lançadas, **vale o SUAP**: cria ou corrige o
  registro (presença, falta, parcial, abonada). O que o aluno marcou em dias que o SUAP ainda não tem
  fica. Aulas futuras já lançadas não viram registro (ficam na grade) e estendem o fim do semestre.
  Semestre novo põe os marcos de aviso em dia em silêncio; atualização avisa normalmente.
- **Teste:** `e2e/tests/suap.spec.ts` finge ser o `suap.ifsp.edu.br` com páginas reais anonimizadas
  (`e2e/fixtures/suap/`) e roda o favorito de verdade, do clique à atualização.

## Hospedagem gratuita (sem cartão)

Guia passo a passo em [`docs/deploy-gratuito.md`](docs/deploy-gratuito.md): site na Vercel, API no
Render (`render.yaml`), Postgres no Neon, Redis no Upstash e o worker em **modo pontual** disparado
pelo GitHub Actions (`.github/workflows/worker.yml`).

- `WORKER_MODE=once` roda um ciclo (lembretes, outbox, limpeza) e sai; sem ele (`loop`, o padrão) o
  worker fica ligado, escuta o NOTIFY do outbox e varre a cada 30 s.
- `pnpm --filter @presenca/db db:provision` faz num banco gerenciado o que o `infra/postgres/init`
  faz no Docker: cria `app_owner`, `app_api`, `app_worker` e `app_auth` com senhas fortes. Funciona
  com administrador sem superusuário e pode rodar de novo para trocar as senhas.
- `bash infra/prod/check-deploy.sh <site> <api>` confere um deploy no ar, de fora.
- **Backup diário** (`.github/workflows/backup.yml`): só os dados, lidos pelo papel `app_backup`,
  criptografados (AES-256) e guardados por 30 dias. Antes de guardar, ensaia a restauração num
  Postgres vazio com as migrations do código (`infra/prod/restore-test.sh`). Todo dia 1º, o
  `restore-drill.yml` baixa o arquivo guardado, abre com a senha e restaura de novo.
- **Quedas do banco:** o Neon encerra as conexões quando reinicia ou acorda. A transação que caiu
  no meio é repetida uma vez (`withUser`), e o worker tenta de novo antes de falhar.

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

- **Schema:** `packages/db/src/schema` (Drizzle), 19 tabelas no schema `app`.
- **Migrations:** `packages/db/migrations`. A `0001_tables` é gerada pelo Drizzle; `0000_foundation`
  (UUID v7, funções de trigger) e `0002_security` (FKs compostas, view `subject_totals`, triggers,
  RLS forçado e permissões de cada papel) são escritas à mão. Depois: `0003_auth` (funções de
  autenticação), `0004_notifications`, `0005_sharing`, `0006_lgpd` (exclusão de conta),
  `0007_threshold_sem_materia`, `0008_backup_role`, `0009_cadastro_e_exclusao` (cadastro
  pendente e links novos) e `0010_segundo_fator`.
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
- **Cadastro sem revelar quem tem conta:** `POST /v1/auth/register` responde sempre 202 ("confira
  seu e-mail"), com o mesmo custo de Argon2 nos dois casos. E-mail novo recebe um link (24 h) que
  guarda nome e hash da senha; a conta só nasce em `POST /v1/auth/register/confirm`, já com o e-mail
  confirmado. E-mail que já tem conta recebe um aviso, sem link. Senha mínima de 8 caracteres (NIST); senhas que aparecem em vazamentos são recusadas.
- **Links por e-mail** (verificação, redefinição de senha, magic link, cadastro, exclusão de conta,
  ligar o segundo fator): uso único, só o hash no banco, 15 min (24 h na verificação e no
  cadastro). Um link novo invalida o anterior.
- **Segundo fator (opcional):** app autenticador (TOTP), ligado em Conta com senha e código (conta
  sem senha confirma por link no e-mail). Segredo cifrado com AES-256-GCM (`MFA_ENCRYPTION_KEY`, só
  na API), código não reaproveitável e 10 códigos de recuperação. Ligado, senha, link, Google e nova
  senha só abrem a sessão depois do código (`POST /v1/auth/mfa/verify`, desafio de 5 min no cookie
  `__Host-mfa`, 5 tentativas).
- **Excluir a conta:** quem tem senha confirma com ela; quem entra sem senha recebe um link por
  e-mail (`POST /v1/me/delete-request`) e confirma num clique.
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
- **CSP do site com nonce:** cada página sai com um nonce novo (`apps/web/src/proxy.ts`,
  `lib/csp.ts`), sem `'unsafe-inline'` em scripts. Por isso as páginas são sempre dinâmicas.

## Motor de cálculo e matérias

- **Motor** (`packages/engine`): converte as regras de cada matéria (por carga horária, por número
  de aulas ou limite fixo) em tempos de chamada e calcula limite, saldo, semáforo e presença. Conta
  só com inteiros e arredonda o limite sempre para baixo, a favor do aluno. Testes por propriedades
  (fast-check) conferem, em milhares de casos aleatórios, que o limite é exatamente o piso da conta
  exata. O calendário (`classOccurrences`, `planSkips`) alimenta o "Posso faltar?".
- **Feriados nacionais** (`brazilHolidays`): calculados a partir da Páscoa (Carnaval, Sexta-feira
  Santa, Corpus Christi) e da lei (Consciência Negra desde 2024). Entram sozinhos ao criar o
  semestre; os pontos facultativos o aluno escolhe na página do semestre.
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
    aluno não tem push. Um por dia (`dedupe_key`). Com até 6 aulas no dia, o push traz as aulas e
    a notificação ganha **Fui** / **Faltei** (ou **Fui a todas**): o service worker registra direto
    na API com a sessão, sem abrir o app.
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
- **Conta e LGPD:** `GET /v1/me/export.json` traz todos os dados da pessoa, inclusive sessões, conta
  Google vinculada, aparelhos com push e a situação do segundo fator (nunca hashes, chaves ou
  códigos). `POST /v1/feedback` manda sugestões e problemas por e-mail para `FEEDBACK_TO`, com
  "responder" para o aluno.
