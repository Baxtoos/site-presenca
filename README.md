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
infra/
  docker-compose.yml   Postgres 17, Valkey (Redis) e Mailpit para desenvolvimento
  postgres/init/       papéis do banco (app_owner, app_api, app_worker)
  docker/              Dockerfiles de produção
```

## Requisitos

- Node.js 22 (`.nvmrc`) e pnpm 10
- Docker com Compose v2 (para Postgres, Redis e Mailpit locais)

## Primeiros passos

```bash
cp .env.example .env
pnpm install
pnpm dev:all
```

`pnpm dev:all` sobe a infraestrutura e roda web, API e worker juntos:

| Serviço                    | Endereço                                      |
| -------------------------- | --------------------------------------------- |
| Web                        | http://localhost:3000                         |
| API                        | http://localhost:4000 (`/healthz`, `/readyz`) |
| Mailpit (e-mails de teste) | http://localhost:8025                         |
| Postgres                   | `localhost:5432`, banco `presenca`            |

Sem Docker, `pnpm dev` ainda roda web, API e worker; o `/readyz` da API responde 503 até o banco existir.

## Scripts

| Comando                        | O que faz                                         |
| ------------------------------ | ------------------------------------------------- |
| `pnpm dev`                     | Roda todos os apps em modo desenvolvimento        |
| `pnpm dev:all`                 | Sobe a infraestrutura e roda os apps              |
| `pnpm build`                   | Compila tudo                                      |
| `pnpm typecheck`               | Checa tipos em todos os pacotes                   |
| `pnpm test`                    | Roda os testes                                    |
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

Para conferir que os papéis têm só essas permissões (com a infraestrutura no ar):

```bash
pnpm --filter @presenca/db verify:roles
```

As senhas em `.env.example` e `infra/postgres/init` servem só para desenvolvimento local.
