-- Fundação: schema e funções usadas pelas tabelas e triggers.
-- Escrita à mão (drizzle-kit generate --custom). Roda como app_owner.

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- UUID v7 (RFC 9562): 48 bits de timestamp em ms + aleatório. Ordenável por tempo, o que
-- mantém os índices de chave primária compactos. O Postgres 17 ainda não tem uuidv7() nativo.
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;
--> statement-breakpoint

-- Usuário da transação atual (definido pela API com set_config('app.user_id', ..., true)).
-- Sem valor, retorna NULL e nenhuma política casa: a falha é fechada.
-- O nullif evita erro de conversão quando a variável ficou vazia após outra transação.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Controle de concorrência otimista: toda alteração incrementa a versão.
-- A API compara com o If-Match antes de gravar.
CREATE OR REPLACE FUNCTION app.bump_version() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
