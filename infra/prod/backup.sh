#!/usr/bin/env bash
# Backup manual dos DADOS do banco de produção e ensaio opcional de restauração.
# Uso:
#   bash infra/prod/backup.sh             # gera ~/backups-presenca/presenca-dados-AAAA-MM-DD-HHMMSS.sql.gz (600)
#   bash infra/prod/backup.sh --verify    # além disso, restaura num Postgres 17 temporário (Docker):
#                                         # migrations do código + dados (infra/prod/restore-test.sh)
# A estrutura, as permissões e o histórico de migrations vêm do código; restaurar: docs, passo 12.
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
OUT_FILE="$OUT_DIR/presenca-dados-$STAMP.sql.gz"

echo "▸ Gerando backup compactado em $OUT_FILE ..."
docker run --rm -e PGCONNECT_TIMEOUT=15 -e PGOPTIONS="-c app.deleting_account=on" postgres:17-alpine \
  pg_dump --data-only --enable-row-security --no-owner --no-privileges --rows-per-insert=500 \
  --schema=app "$DB_URL" | gzip -9 > "$OUT_FILE"
chmod 600 "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "✔ Backup salvo ($SIZE, permissão 600): $OUT_FILE"

if [ "$VERIFY" = true ]; then
  echo "▸ Ensaio de restauração num container temporário..."
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  (cd "$ROOT" && pnpm --filter @presenca/db build >/dev/null)
  CID="$(docker run -d --rm -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=verify_tmp postgres:17-alpine)"
  trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
  for _ in $(seq 1 30); do
    docker exec "$CID" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  sleep 1
  COUNTS="$(ADMIN_URL=postgres://postgres:verify_tmp@127.0.0.1:55432/postgres \
    bash "$ROOT/infra/prod/restore-test.sh" "$OUT_FILE")"
  echo "$COUNTS" | awk '{ printf "  %-26s %8s\n", $1, $2 }'
  echo "✔ Restauração verificada ($(echo "$COUNTS" | wc -l) tabelas, com a estrutura do código)."
fi
