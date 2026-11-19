#!/usr/bin/env bash
# Ensaio de restauração: num PostgreSQL 17 VAZIO (container ou serviço de CI), faz exatamente o
# que uma restauração de verdade faria e mostra as linhas de cada tabela.
#
#   ADMIN_URL=postgres://postgres:SENHA@localhost:5432/postgres \
#     bash infra/prod/restore-test.sh dados.sql[.gz] > contagens.txt
#
# 1. papéis e schema (infra/postgres/init/01-roles.sql, senhas de desenvolvimento);
# 2. migrations do código (estrutura, permissões e histórico);
# 3. dados do backup (infra/prod/restore-data.sh).
# Precisa do pacote @presenca/db compilado (pnpm --filter @presenca/db build). As contagens saem
# no stdout ("tabela linhas", ordenadas); o progresso vai para o stderr.
set -euo pipefail

FILE="${1:?uso: ADMIN_URL=... bash infra/prod/restore-test.sh dados.sql[.gz]}"
: "${ADMIN_URL:?defina ADMIN_URL (superusuário de um PostgreSQL vazio)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOSTPART="${ADMIN_URL#*@}"
HOSTPART="${HOSTPART%%/*}"
OWNER_URL="postgres://app_owner:app_owner_dev@$HOSTPART/presenca"
CHECK_URL="${ADMIN_URL%/*}/presenca"

psql_as() { docker run --rm -i --network host -e URL="$1" postgres:17-alpine sh -c 'psql "$URL" -X -q -v ON_ERROR_STOP=1 '"${2:-}"; }

echo "▸ Papéis e schema..." >&2
psql_as "$ADMIN_URL" < "$ROOT/infra/postgres/init/01-roles.sql" >/dev/null

echo "▸ Migrations do código..." >&2
NODE_ENV=production DATABASE_URL_OWNER="$OWNER_URL" node "$ROOT/packages/db/dist/cli/migrate.js" >&2

echo "▸ Dados do backup..." >&2
OWNER_URL="$OWNER_URL" bash "$ROOT/infra/prod/restore-data.sh" "$FILE" >&2

# Superusuário: enxerga todas as linhas (o RLS não vale para ele).
COUNTS_SQL="select format('select %L as t, count(*) as n from app.%I', relname, relname)
              from pg_class where relnamespace = 'app'::regnamespace and relkind in ('r','p')"
docker run --rm --network host -e URL="$CHECK_URL" -e SQL="$COUNTS_SQL" postgres:17-alpine sh -c \
  'psql "$URL" -XAtc "$SQL" | paste -sd "|" | sed "s/|/ union all /g" | psql "$URL" -XAt -F " "' | sort
