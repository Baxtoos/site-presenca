#!/usr/bin/env bash
# Carrega um backup de DADOS do Monitor de Presenças num banco já preparado.
#
# O backup (workflow "Backup do banco" ou infra/prod/backup.sh) guarda só os dados, em INSERTs.
# A estrutura (tabelas, funções, políticas de RLS, permissões dos papéis e o histórico de
# migrations) vem do próprio código, na mesma versão do backup:
#
#   1. banco novo e vazio:      ADMIN_DATABASE_URL=... pnpm db:provision
#   2. estrutura completa:      DATABASE_URL_OWNER=... pnpm db:migrate
#   3. dados do backup:         OWNER_URL=... bash infra/prod/restore-data.sh dados.sql[.gz]
#
# Roda como app_owner: liga a manutenção (app.deleting_account, migration 0006) para escrever
# sob o RLS forçado e desliga os gatilhos durante a carga, para a trilha de auditoria e as
# versões entrarem exatamente como estavam (sem eventos duplicados). Recusa um banco com contas.
# Usa o psql do container postgres:17-alpine (não precisa de psql instalado).
set -euo pipefail

FILE="${1:?uso: OWNER_URL=postgres://app_owner:SENHA@host/banco bash infra/prod/restore-data.sh dados.sql[.gz]}"
: "${OWNER_URL:?defina OWNER_URL com a conexão do app_owner do banco de destino}"
[ -f "$FILE" ] || { echo "Arquivo não encontrado: $FILE" >&2; exit 1; }

read_dump() {
  case "$FILE" in
    *.gz) gzip -dc "$FILE" ;;
    *) cat "$FILE" ;;
  esac
}

{
  cat <<'SQL'
\set ON_ERROR_STOP on
begin;
set local app.deleting_account = 'on';
do $$ begin
  if to_regclass('app.users') is null then
    raise exception 'O banco de destino não tem a estrutura do app: rode db:provision e db:migrate antes.';
  end if;
  if exists (select 1 from app.users) then
    raise exception 'O banco de destino já tem contas: a restauração só carrega num banco vazio.';
  end if;
end $$;
do $$ declare t text; begin
  for t in select relname from pg_class where relnamespace = 'app'::regnamespace and relkind = 'r' loop
    execute format('alter table app.%I disable trigger user', t);
  end loop;
end $$;
SQL
  # \restrict/\unrestrict (pg_dump 17.6+) bloqueariam os comandos do psql que vêm depois.
  read_dump | grep -v -E '^\\(un)?restrict '
  cat <<'SQL'
set app.deleting_account = 'on';
do $$ declare t text; begin
  for t in select relname from pg_class where relnamespace = 'app'::regnamespace and relkind = 'r' loop
    execute format('alter table app.%I enable trigger user', t);
  end loop;
end $$;
commit;
SQL
} | docker run --rm -i --network host -e OWNER_URL postgres:17-alpine \
  sh -c 'psql "$OWNER_URL" -X -q -o /dev/null -v ON_ERROR_STOP=1'

echo "✔ Dados carregados."
