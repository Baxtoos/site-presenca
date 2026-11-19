#!/usr/bin/env bash
# Liga o backup automático (workflow "Backup do banco"), sem mostrar nenhuma senha na tela:
#   1. pede a conexão de ADMINISTRAÇÃO do Neon (texto oculto) e dá login ao papel app_backup,
#      só de leitura. As senhas da API, do worker e do dono NÃO mudam;
#   2. aplica as migrations pendentes (a 0008 cria as permissões de leitura do backup);
#   3. grava BACKUP_DATABASE_URL e BACKUP_PASSPHRASE em ~/presenca-producao.env (permissão 600);
#   4. envia os dois segredos ao GitHub Actions e dispara o primeiro backup.
# Uso:  bash infra/prod/backup-role.sh
# Pode rodar de novo: troca a senha do app_backup e mantém a BACKUP_PASSPHRASE.
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE="${PRESENCA_PROD_ENV:-$HOME/presenca-producao.env}"
[ -f "$ENV_FILE" ] || { echo "Arquivo $ENV_FILE não encontrado (crie com infra/prod/provision.sh)."; exit 1; }
chmod 600 "$ENV_FILE"

getvar() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
setvar() {
  local key="$1" val="$2"
  grep -vE "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

if ! command -v pnpm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi
command -v pnpm >/dev/null 2>&1 || { echo "pnpm não encontrado (precisa do Node 22 e do pnpm)."; exit 1; }

OWNER_URL="$(getvar DATABASE_URL_OWNER)"
[ -n "$OWNER_URL" ] || { echo "DATABASE_URL_OWNER não está em $ENV_FILE."; exit 1; }

if [ -z "${ADMIN_DATABASE_URL:-}" ]; then
  echo "Cole a conexão de ADMINISTRAÇÃO do Neon (a do neondb_owner; o texto não aparece) e tecle Enter:"
  read -r -s ADMIN_DATABASE_URL
  echo
fi
case "$ADMIN_DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "Isso não parece uma conexão (deve começar com postgresql://)."; exit 1 ;;
esac
case "$ADMIN_DATABASE_URL" in
  *-pooler*) echo "O endereço tem '-pooler'. Desligue 'Connection pooling' no Neon e copie de novo."; exit 1 ;;
esac

umask 077
TMP="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$TMP" "$ERR"' EXIT

echo "▸ Preparando o papel de backup (só leitura)..."
if ! ADMIN_DATABASE_URL="$ADMIN_DATABASE_URL" pnpm --filter @presenca/db db:backup-role >"$TMP" 2>"$ERR"; then
  echo "Falhou:"; grep -v '^$' "$ERR" | tail -5; exit 1
fi
unset ADMIN_DATABASE_URL
BACKUP_URL="$(grep -E '^BACKUP_DATABASE_URL=' "$TMP" | head -1 | cut -d= -f2-)"
[ -n "$BACKUP_URL" ] || { echo "Saída inesperada do comando."; exit 1; }
setvar BACKUP_DATABASE_URL "$BACKUP_URL"

if [ -z "$(getvar BACKUP_PASSPHRASE)" ]; then
  setvar BACKUP_PASSPHRASE "$(openssl rand -base64 33 | tr -d '\n')"
  echo "  ✔ Senha da criptografia gerada (BACKUP_PASSPHRASE)."
fi

echo "▸ Aplicando as migrations pendentes..."
DATABASE_URL_OWNER="$OWNER_URL" pnpm --filter @presenca/db db:migrate 2>&1 | tail -1

echo "▸ Enviando os segredos ao GitHub Actions e disparando o primeiro backup..."
if ! PRESENCA_PROD_ENV="$ENV_FILE" python3 - <<'PY'
import json, os, re, urllib.request
from nacl import encoding, public

with open(os.path.expanduser("~/.git-credentials")) as f:
    m = re.search(r"https://[^:]+:([^@]+)@github\.com", f.read())
if not m:
    raise SystemExit("Token do GitHub não encontrado em ~/.git-credentials.")
token = m.group(1)

env = {}
with open(os.environ["PRESENCA_PROD_ENV"]) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v

def gh(method, path, body=None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/Baxtoos/site-presenca{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "presenca-backup",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return resp.status, json.loads(raw) if raw else {}

_, pk = gh("GET", "/actions/secrets/public-key")
box = public.SealedBox(public.PublicKey(pk["key"].encode(), encoding.Base64Encoder()))
for name in ("BACKUP_DATABASE_URL", "BACKUP_PASSPHRASE"):
    enc = box.encrypt(env[name].encode(), encoder=encoding.Base64Encoder()).decode()
    status, _ = gh("PUT", f"/actions/secrets/{name}", {"encrypted_value": enc, "key_id": pk["key_id"]})
    print(f"  ✔ Segredo {name} enviado ao GitHub (HTTP {status})")
status, _ = gh("POST", "/actions/workflows/backup.yml/dispatches", {"ref": "main"})
print(f"  ✔ Primeiro backup disparado (HTTP {status})")
PY
then
  echo
  echo "Não consegui enviar os segredos automaticamente. Faça à mão em"
  echo "  https://github.com/Baxtoos/site-presenca/settings/secrets/actions"
  echo "criando BACKUP_DATABASE_URL e BACKUP_PASSPHRASE com os valores de $ENV_FILE,"
  echo "e depois rode o workflow 'Backup do banco' na aba Actions."
fi

echo
echo "Pronto. Guarde a BACKUP_PASSPHRASE também no seu gerenciador de senhas:"
echo "sem ela, nenhum backup pode ser aberto. (Ela está em $ENV_FILE e não foi impressa aqui.)"
