#!/usr/bin/env bash
# Confere um deploy no ar, de fora, como um visitante:
#   bash infra/prod/check-deploy.sh https://meu-site.vercel.app https://presenca-api.onrender.com
# Não cria conta nem grava nada. Sai com erro se alguma checagem falhar.
set -uo pipefail

WEB="${1:?uso: check-deploy.sh <url-do-site> <url-da-api>}"
API="${2:?uso: check-deploy.sh <url-do-site> <url-da-api>}"
WEB="${WEB%/}"; API="${API%/}"
FAIL=0
ok()   { printf '  ✔ %s\n' "$1"; }
bad()  { printf '  ✘ %s\n' "$1"; FAIL=1; }

# A primeira chamada pode demorar ~1 min (a API gratuita do Render dorme quando ociosa).
get() { curl -sS -m 90 -o "$2" -w '%{http_code}' "$1" 2>/dev/null || echo 000; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "API ($API)"
[ "$(get "$API/healthz" "$TMP/h")" = 200 ] && ok "/healthz responde" || bad "/healthz não respondeu 200"
READY="$(get "$API/readyz" "$TMP/r")"
if [ "$READY" = 200 ]; then ok "/readyz: banco e Redis respondem"; else bad "/readyz → $READY ($(head -c 200 "$TMP/r"))"; fi
[ "$(get "$API/openapi.json" "$TMP/o")" = 404 ] && ok "openapi.json desligado em produção" || bad "openapi.json está publicado"

echo "Site ($WEB)"
[ "$(get "$WEB/entrar" "$TMP/e")" = 200 ] && ok "/entrar abre" || bad "/entrar não abriu"
[ "$(get "$WEB/manifest.webmanifest" "$TMP/m")" = 200 ] && ok "manifest do app instalável" || bad "manifest ausente"
[ "$(get "$WEB/sw.js" "$TMP/s")" = 200 ] && ok "service worker publicado" || bad "sw.js ausente"

echo "Site → API (reescrita de /api)"
VIA="$(get "$WEB/api/healthz" "$TMP/v")"
if [ "$VIA" = 200 ]; then ok "o site fala com a API"; else bad "$WEB/api/healthz → $VIA (confira API_INTERNAL_URL na Vercel e faça um novo deploy)"; fi
ME="$(get "$WEB/api/v1/me" "$TMP/me")"
[ "$ME" = 401 ] && ok "/v1/me sem sessão → 401 (esperado)" || bad "/v1/me → $ME (esperado 401)"

echo
if [ "$FAIL" = 0 ]; then echo "Tudo certo."; else echo "Há problemas acima."; exit 1; fi
