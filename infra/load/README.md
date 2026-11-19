# Testes de carga (k6)

| Arquivo       | O que faz                                                                                    |
| :------------ | :------------------------------------------------------------------------------------------- |
| `k6-smoke.js` | Fumaça: só `/healthz` e `/readyz`, 10 usuários por 30 s. Serve para conferir um deploy.      |
| `k6-turma.js` | Realista: cada usuário cria conta, semestre e matéria e usa o app como um aluno, com pausas. |

## Como rodar (`k6-turma.js`)

Sempre contra um ambiente de **teste** (local ou um branch do Neon), nunca contra a produção
gratuita: o cadastro tem limite de 10 contas por hora por IP, e a carga gastaria a cota do Neon e
do Render.

```bash
pnpm infra:up && pnpm db:migrate && pnpm build
RATE_LIMIT_FACTOR=1000 NODE_ENV=test node apps/api/dist/main.js     # limites folgados, só no teste
docker run --rm --network host -v "$PWD/infra/load:/scripts:ro" grafana/k6:1.4.0 run \
  -e PERFIL=padrao -e API_URL=http://localhost:4000 -e WEB_ORIGIN=http://localhost:3000 \
  /scripts/k6-turma.js
```

Perfis (`-e PERFIL=`): `rapido` (1 min, até 20 alunos), `padrao` (4 min, até 60), `pico` (5 min,
até 150).

A cada volta, o aluno virtual abre o início (`/v1/me`, `/v1/today`), a matéria (calendário do mês e
"Posso faltar?") e marca presença (80%) ou falta numa aula passada, com 4 a 9 segundos de pausa no
total. Limites que reprovam o teste: mais de 1% de erros, p95 de leitura acima de 500 ms (p99 acima
de 1 s) ou p95 de escrita acima de 800 ms.

## Resultado (novembro de 2026, ambiente local)

Máquina de 4 núcleos e 16 GB, Postgres 17 e Valkey em Docker, API em produção (`node dist/main.js`).

| Perfil | Alunos simultâneos | Requisições | Erros | p95 leitura | p95 escrita (marcar aula) | Máximo |
| :----- | -----------------: | ----------: | ----: | ----------: | ------------------------: | -----: |
| rapido |                 20 |         645 |    0% |       12 ms |                     23 ms |  28 ms |
| pico   |                150 |      18 410 |    0% |       11 ms |                     19 ms |  60 ms |

Com 150 alunos usando ao mesmo tempo (≈60 requisições por segundo, muito acima de uma turma real),
a API não chegou perto dos limites. O gargalo não é o código.

## O que muda em produção (plano gratuito)

- **Render Free** tem 0,1 CPU e 512 MB: as mesmas requisições devem levar de 5 a 10 vezes mais. O
  passo mais caro é o **login** (Argon2id, de propósito lento contra ataques): perto de 0,5 s cada
  no Render gratuito. Leituras e marcações ficam na casa das dezenas de milissegundos.
- **A primeira requisição depois de 15 min parado** leva cerca de 1 minuto (o Render dorme). O
  UptimeRobot no `/healthz` evita isso.
- **Neon Free** suspende o banco sem uso; a primeira consulta depois disso acorda o banco (cerca
  de 1 s).
- Para uma turma (30 a 60 alunos, cada um abrindo o app algumas vezes por dia), a folga é grande.
  Se o app crescer para várias turmas, o primeiro passo é o plano pago do Render (CPU dedicada).
