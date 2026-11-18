#!/usr/bin/env bash
# Backup do banco de produção e teste opcional de restauração (Fase 9).
# Uso:
#   bash infra/prod/backup.sh             # gera ~/backups-presenca/presenca-AAAA-MM-DD-HHMMSS.sql.gz (permissão 600)
#   bash infra/prod/backup.sh --verify    # além do dump, sobe um Postgres 17 temporário no Docker e testa a restauração
set -euo pipefail

ENV_FILE="${PRESENCA_PROD_ENV:-$HOME/presenca-producao.env}"
OUT_DIR="${PRESENCA_BACKUP_DIR:-$HOME/backups-presenca}"
VERIFY=false
if [[ "${1:-}" == "--verify" ]]; then
  VERIFY=true
fi

getvar() {
  [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true
}

DB_URL="${ADMIN_DATABASE_URL:-$(getvar DATABASE_URL_OWNER)}"
if [ -z "$DB_URL" ]; then
  echo "Cole a URL do banco (ADMIN_DATABASE_URL ou DATABASE_URL_OWNER) com texto oculto e tecle Enter:"
  read -r -s DB_URL
  echo
fi

umask 077
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

STAMP="$(date +%Y-%m-%d-%H%M%S)"
OUT_FILE="$OUT_DIR/presenca-$STAMP.sql.gz"

echo "▸ Gerando backup compactado em $OUT_FILE ..."
docker run --rm -e PGCONNECT_TIMEOUT=15 -e PGOPTIONS="-c app.deleting_account=on" postgres:17-alpine \
  pg_dump --enable-row-security --no-owner --no-privileges --schema=app "$DB_URL" | gzip -9 > "$OUT_FILE"
chmod 600 "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "✔ Backup salvo ($SIZE, permissão 600): $OUT_FILE"

if [ "$VERIFY" = true ]; then
  echo "▸ Testando restauração em container temporário..."
  CID="$(docker run -d --rm -e POSTGRES_PASSWORD=verify_tmp -e POSTGRES_DB=verify_db postgres:17-alpine)"
  trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

  for _ in $(seq 1 20); do
    if docker exec "$CID" pg_isready -U postgres -d verify_db >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  docker exec "$CID" psql -U postgres -d verify_db -v ON_ERROR_STOP=1 -c "
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DO \$\$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN CREATE ROLE app_owner; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN CREATE ROLE app_api; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN CREATE ROLE app_worker; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN CREATE ROLE app_auth; END IF;
    END \$\$;
  " >/dev/null

  gzip -dc "$OUT_FILE" | docker exec -i "$CID" psql -U postgres -d verify_db -v ON_ERROR_STOP=1 >/dev/null
  TABLES="$(docker exec "$CID" psql -U postgres -d verify_db -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE'")"
  echo "✔ Restauração verificada com sucesso ($TABLES tabelas no schema app)."
fi
