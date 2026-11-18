#!/usr/bin/env bash
# Ensaio de deploy da imagem da API:
#   banco novo (com os papéis de infra/postgres/init) → migrations rodando DE DENTRO da imagem,
#   duas vezes (precisa ser idempotente) → API sobe com o papel app_api → /readyz responde 200.
# Uso:  bash infra/ci/smoke-api.sh presenca-api:local
set -euo pipefail

IMAGE="${1:?uso: smoke-api.sh <imagem-da-api>}"
ID="$$"
NET="presenca-smoke-$ID"
PG="presenca-smoke-pg-$ID"
REDIS="presenca-smoke-redis-$ID"
API="presenca-smoke-api-$ID"

cleanup() {
  docker rm -f "$API" "$PG" "$REDIS" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step() { printf '\n▸ %s\n' "$1"; }

docker network create "$NET" >/dev/null

step "Subindo Valkey e Postgres 17 (com os papéis de infra/postgres/init)"
docker run -d --name "$REDIS" --network "$NET" valkey/valkey:8-alpine >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres_smoke -e POSTGRES_DB=postgres \
  -v "$(pwd)/infra/postgres/init:/docker-entrypoint-initdb.d:ro" \
  postgres:17-alpine >/dev/null
# Via TCP só responde depois do init (o servidor temporário do init escuta só no socket local).
for _ in $(seq 1 60); do
  docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres -d presenca >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres -d presenca >/dev/null

OWNER_URL="postgres://app_owner:app_owner_dev@$PG:5432/presenca"
API_URL="postgres://app_api:app_api_dev@$PG:5432/presenca"

for run in 1 2; do
  step "Migrations pela imagem (execução $run)"
  docker run --rm --network "$NET" -e NODE_ENV=production -e DATABASE_URL_OWNER="$OWNER_URL" \
    "$IMAGE" node node_modules/@presenca/db/dist/cli/migrate.js
done

TABLES=$(docker exec "$PG" psql -U postgres -d presenca -tAc \
  "select count(*) from pg_class where relnamespace = 'app'::regnamespace and relkind = 'r' and relforcerowsecurity")
echo "Tabelas com RLS forçado: $TABLES"
[ "$TABLES" -eq 17 ] || { echo "esperado 17"; exit 1; }

step "Subindo a API com o papel app_api"
docker run -d --name "$API" --network "$NET" \
  -e NODE_ENV=production -e WEB_ORIGIN=https://app.exemplo -e TRUST_PROXY=1 \
  -e DATABASE_URL="$API_URL" -e REDIS_URL="redis://$REDIS:6379" \
  -e MAIL_TRANSPORT=smtp -e SMTP_URL="smtp://smtp-nao-usado:1025" -e HIBP_ENABLED=false \
  "$IMAGE" >/dev/null

READY=""
for _ in $(seq 1 30); do
  if READY=$(docker exec "$API" wget -qO- http://127.0.0.1:4000/readyz 2>/dev/null); then break; fi
  READY=""
  sleep 1
done
if [ -z "$READY" ]; then
  echo "A API não ficou pronta. Logs:"
  docker logs "$API"
  exit 1
fi
echo "/readyz → $READY"

if docker exec "$API" wget -qO- http://127.0.0.1:4000/openapi.json >/dev/null 2>&1; then
  echo "openapi.json não deveria estar publicado em produção"
  exit 1
fi
echo "openapi.json desligado em produção: ok"

step "Cadastro de verdade pela imagem (Argon2 nativo no Alpine + funções do banco + sessão)"
REGISTER=$(docker exec "$API" wget -S -qO- \
  --header "Content-Type: application/json" --header "Origin: https://app.exemplo" \
  --post-data '{"email":"smoke@exemplo.com","password":"senha-do-ensaio-de-deploy","fullName":"Ensaio"}' \
  http://127.0.0.1:4000/v1/auth/register 2>&1) || { echo "$REGISTER"; docker logs "$API"; exit 1; }
echo "$REGISTER" | grep -q '"emailVerified":false' || { echo "$REGISTER"; exit 1; }
echo "$REGISTER" | grep -qi 'set-cookie: __Host-sid=.*HttpOnly.*Secure' || { echo "cookie de sessão ausente ou inseguro"; echo "$REGISTER"; exit 1; }
HASH=$(docker exec "$PG" psql -U postgres -d presenca -tAc "select left(password_hash, 13) from app.users where email = 'smoke@exemplo.com'")
echo "Conta criada; hash de senha: $HASH…"
[ "$HASH" = '$argon2id$v=1' ] || { echo "hash inesperado"; exit 1; }

printf '\n✔ Ensaio de deploy da API passou.\n'
