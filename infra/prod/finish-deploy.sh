#!/usr/bin/env bash
# Conclui a configuração dos segredos externos do deploy gratuito (Passos 1, 2, 4, 5, 7 e 9):
#   1. Lê ~/presenca-producao.env (já com DATABASE_URL*, VAPID_*).
#   2. Pede os valores que faltarem (WEB_ORIGIN, API_INTERNAL_URL, REDIS_URL, SMTP_URL, MAIL_FROM)
#      e grava tudo em ~/presenca-producao.env (permissão 600).
#   3. Criptografa e envia todos os segredos do worker para o GitHub Actions e dispara o 1º ciclo.
#   4. Se WEB_ORIGIN e API_INTERNAL_URL estiverem preenchidos, roda infra/prod/check-deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE="${PRESENCA_PROD_ENV:-$HOME/presenca-producao.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Arquivo $ENV_FILE não encontrado. Rode antes: bash infra/prod/provision.sh"
  exit 1
fi
chmod 600 "$ENV_FILE"

getvar() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
setvar() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    grep -vE "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

ask_if_missing() {
  local key="$1" prompt="$2" secret="${3:-false}"
  local cur
  cur="$(getvar "$key")"
  if [ -n "$cur" ]; then
    return 0
  fi
  echo "$prompt"
  if [ "$secret" = "true" ]; then
    read -r -s cur
    echo
  else
    read -r cur
  fi
  cur="${cur%/}"
  if [ -n "$cur" ]; then
    setvar "$key" "$cur"
  fi
}

ask_if_missing "WEB_ORIGIN" "Endereço do site na Vercel (ex.: https://site-presenca.vercel.app, sem barra no fim):" false
ask_if_missing "API_INTERNAL_URL" "Endereço da API no Render (ex.: https://presenca-api.onrender.com, ou Enter se ainda não criou):" false
ask_if_missing "REDIS_URL" "URL do Redis no Upstash (rediss://default:...@...upstash.io:6379 — texto oculto):" true
ask_if_missing "SMTP_URL" "URL SMTP do Brevo (smtp://LOGIN:CHAVE@smtp-relay.brevo.com:587 — texto oculto):" true
ask_if_missing "MAIL_FROM" "Remetente verificado no Brevo (ex.: Monitor de Presenças <seu-email@exemplo.com>):" false
setvar "MAIL_TRANSPORT" "smtp"

echo "▸ Sincronizando segredos do worker com o GitHub Actions..."
python3 - <<'PY'
import os, re, json, urllib.request
from nacl import encoding, public

cred_path = os.path.expanduser("~/.git-credentials")
if not os.path.exists(cred_path):
    raise SystemExit("Credenciais do Git (~/.git-credentials) não encontradas.")
with open(cred_path) as f:
    m = re.search(r"https://[^:]+:([^@]+)@github\.com", f.read())
    if not m:
        raise SystemExit("Token do GitHub não encontrado em ~/.git-credentials.")
    token = m.group(1)

env_file = os.environ.get("PRESENCA_PROD_ENV", os.path.expanduser("~/presenca-producao.env"))
env_vars = {}
with open(env_file) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k] = v

def gh_api(method, path, body=None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/Baxtoos/site-presenca{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "presenca-deploy",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return resp.status, json.loads(raw) if raw else {}

_, pk = gh_api("GET", "/actions/secrets/public-key")
pub_key = public.PublicKey(pk["key"].encode("utf-8"), encoding.Base64Encoder())
sealed_box = public.SealedBox(pub_key)

wanted = [
    "WORKER_DATABASE_URL",
    "WEB_ORIGIN",
    "MAIL_TRANSPORT",
    "SMTP_URL",
    "MAIL_FROM",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
]
for name in wanted:
    val = env_vars.get(name, "")
    if val:
        enc = sealed_box.encrypt(val.encode("utf-8"), encoder=encoding.Base64Encoder()).decode("utf-8")
        st, _ = gh_api("PUT", f"/actions/secrets/{name}", {"encrypted_value": enc, "key_id": pk["key_id"]})
        print(f"  ✔ Segredo {name} atualizado no GitHub (HTTP {st})")

if all(env_vars.get(k) for k in ("WORKER_DATABASE_URL", "WEB_ORIGIN", "SMTP_URL", "MAIL_FROM")):
    st, _ = gh_api("POST", "/actions/workflows/worker.yml/dispatches", {"ref": "main"})
    print(f"  ✔ Workflow 'Worker (pontual)' disparado na branch main (HTTP {st})")
else:
    print("  ℹ Faltam WEB_ORIGIN, SMTP_URL ou MAIL_FROM para disparar o worker completo.")
PY

WEB_ORIGIN="$(getvar WEB_ORIGIN)"
API_URL="$(getvar API_INTERNAL_URL)"
if [ -n "$WEB_ORIGIN" ] && [ -n "$API_URL" ]; then
  echo
  echo "▸ Conferindo deploy no ar..."
  bash infra/prod/check-deploy.sh "$WEB_ORIGIN" "$API_URL"
fi
