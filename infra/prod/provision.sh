#!/usr/bin/env bash
# Prepara o banco de PRODUÇÃO (Neon etc.) sem expor nenhuma senha na tela:
#   1. pede a conexão de administração com o texto escondido (ou usa ADMIN_DATABASE_URL, se já
#      estiver no ambiente);
#   2. cria os papéis do app com senhas fortes geradas na hora;
#   3. roda as migrations e confere as permissões dos papéis;
#   4. grava as URLs novas num arquivo só seu (permissão 600, FORA do repositório).
# Uso:  bash infra/prod/provision.sh
# Variável opcional: PRESENCA_PROD_ENV = onde gravar (padrão: ~/presenca-producao.env)
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT="${PRESENCA_PROD_ENV:-$HOME/presenca-producao.env}"

if [ -f "$OUT" ]; then
  echo "O arquivo $OUT já existe. Continuar GERA SENHAS NOVAS e substitui o arquivo."
  read -r -p "Continuar? [s/N] " ANSWER
  [[ "$ANSWER" =~ ^[sSyY]$ ]] || { echo "Cancelado."; exit 1; }
fi

if ! command -v pnpm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi
command -v pnpm >/dev/null 2>&1 || { echo "pnpm não encontrado (precisa do Node 22 e do pnpm)."; exit 1; }

# Já veio no ambiente (ex.: obtida pela CLI da Neon, sem passar pela tela)? Não pergunta.
if [ -z "${ADMIN_DATABASE_URL:-}" ]; then
  echo "Cole a conexão de ADMINISTRAÇÃO do Neon (o texto não aparece na tela) e tecle Enter:"
  read -r -s ADMIN_DATABASE_URL
  echo
fi
case "$ADMIN_DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "Isso não parece uma conexão (deve começar com postgresql://)."; exit 1 ;;
esac
case "$ADMIN_DATABASE_URL" in
  *-pooler*) echo "Atenção: o endereço tem '-pooler'. Desligue 'Connection pooling' no Neon e copie de novo."; exit 1 ;;
esac
export ADMIN_DATABASE_URL

umask 077
TMP="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$TMP" "$ERR"' EXIT

echo "▸ Criando papéis e schema..."
if ! pnpm --filter @presenca/db db:provision >"$TMP" 2>"$ERR"; then
  echo "Falhou:"; grep -v '^$' "$ERR" | tail -5; exit 1
fi
unset ADMIN_DATABASE_URL

# Só as três linhas de conexão, sem os comentários do comando.
grep -E '^(DATABASE_URL_OWNER|DATABASE_URL|WORKER_DATABASE_URL)=' "$TMP" | sed -E 's/   #.*$//' > "$OUT.novo"
[ "$(wc -l < "$OUT.novo")" -eq 3 ] || { echo "Saída inesperada do provisionamento."; rm -f "$OUT.novo"; exit 1; }
{
  echo "# Banco de produção do Monitor de Presenças. SEGREDO: não commite, não envie, não cole em chats."
  echo "# DATABASE_URL_OWNER só serve para as migrations (no seu computador). Não vai para Render nem GitHub."
  cat "$OUT.novo"
} > "$OUT"
rm -f "$OUT.novo"
chmod 600 "$OUT"

# Lê do arquivo (e não da tela) para as próximas etapas.
getvar() { grep -E "^$1=" "$OUT" | head -1 | cut -d= -f2-; }

echo "▸ Aplicando as migrations..."
DATABASE_URL_OWNER="$(getvar DATABASE_URL_OWNER)" pnpm --filter @presenca/db db:migrate 2>&1 | tail -2

echo "▸ Conferindo as permissões dos papéis..."
DATABASE_URL="$(getvar DATABASE_URL)" WORKER_DATABASE_URL="$(getvar WORKER_DATABASE_URL)" \
  pnpm --filter @presenca/db verify:roles 2>&1 | tail -3

echo
echo "Pronto. As senhas novas estão em: $OUT"
echo "Abra esse arquivo para copiar os valores nos próximos passos (ele não foi impresso aqui)."
