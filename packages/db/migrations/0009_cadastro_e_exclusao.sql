-- Cadastro sem revelar contas existentes e exclusão de conta confirmada por e-mail (revisão ASVS).
-- - "register": o cadastro vira um link de confirmação; a conta só nasce quando a pessoa clica.
--   Nome e hash da senha esperam no próprio token (o hash é apagado ao consumir).
-- - "delete_account": quem não tem senha confirma a exclusão por um link (auth_issue_token/consume).
-- Os valores novos do enum só são citados dentro de plpgsql: o Drizzle aplica as migrations numa
-- transação só, e o Postgres não deixa usar um valor de enum na transação que o criou.
ALTER TYPE "app"."token_purpose" ADD VALUE 'register';--> statement-breakpoint
ALTER TYPE "app"."token_purpose" ADD VALUE 'delete_account';--> statement-breakpoint
ALTER TABLE "app"."auth_tokens" DROP CONSTRAINT "auth_tokens_user_required_chk";--> statement-breakpoint
ALTER TABLE "app"."auth_tokens" ADD COLUMN "pending_full_name" text;--> statement-breakpoint
ALTER TABLE "app"."auth_tokens" ADD COLUMN "pending_password_hash" text;--> statement-breakpoint
ALTER TABLE "app"."auth_tokens" ADD CONSTRAINT "auth_tokens_user_required_chk" CHECK ("app"."auth_tokens"."user_id" is not null or "app"."auth_tokens"."purpose"::text in ('magic_link', 'register'));--> statement-breakpoint

GRANT UPDATE (pending_password_hash) ON app.auth_tokens TO app_auth;
--> statement-breakpoint

-- Emite o link de confirmação de cadastro com o nome e o hash da senha. Só o último vale.
CREATE FUNCTION app.auth_issue_registration(
  p_email text,
  p_full_name text,
  p_password_hash text,
  p_token_hash bytea,
  p_ttl_seconds integer
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_id uuid;
BEGIN
  IF p_ttl_seconds NOT BETWEEN 60 AND 172800 THEN
    RAISE EXCEPTION 'validade do token fora do permitido: % s', p_ttl_seconds
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE app.auth_tokens
     SET used_at = now(), pending_password_hash = NULL
   WHERE email = v_email AND purpose = 'register' AND used_at IS NULL;

  INSERT INTO app.auth_tokens
    (user_id, email, purpose, token_hash, expires_at, pending_full_name, pending_password_hash)
  VALUES
    (NULL, v_email, 'register', p_token_hash, now() + make_interval(secs => p_ttl_seconds),
     p_full_name, p_password_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Consome o link de cadastro: marca como usado, apaga o hash guardado e devolve os dados.
-- Atômico: dois cliques simultâneos não criam duas contas.
CREATE FUNCTION app.auth_consume_registration(p_token_hash bytea)
RETURNS TABLE (email text, full_name text, password_hash text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH alvo AS (
    SELECT t.id, t.pending_password_hash AS hash
      FROM app.auth_tokens t
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'register'
       AND t.used_at IS NULL
       AND t.expires_at > now()
       FOR UPDATE
  )
  UPDATE app.auth_tokens t
     SET used_at = now(), pending_password_hash = NULL
    FROM alvo
   WHERE t.id = alvo.id
  RETURNING t.email, t.pending_full_name, alvo.hash;
END
$$;
--> statement-breakpoint
-- O novo dono precisa poder criar no schema; o direito é retirado logo depois (como na 0003).
GRANT CREATE ON SCHEMA app TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.auth_issue_registration(text, text, text, bytea, integer) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.auth_consume_registration(bytea) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app.auth_issue_registration(text, text, text, bytea, integer),
  app.auth_consume_registration(bytea)
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.auth_issue_registration(text, text, text, bytea, integer),
  app.auth_consume_registration(bytea)
TO app_api;
