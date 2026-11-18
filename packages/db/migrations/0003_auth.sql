-- Autenticação (Fase 2): funções SECURITY DEFINER para o que precisa acontecer ANTES de se saber
-- quem é o usuário (login por e-mail, sessão pelo token do cookie, links de uso único).
-- Rodam como app_auth (sem login), que enxerga só as colunas necessárias. A API só pode EXECUTAR.
-- Escrita à mão (drizzle-kit generate --custom). Roda como app_owner.

-- ---------------------------------------------------------------------------
-- 1. Permissões mínimas do app_auth.
-- ---------------------------------------------------------------------------
GRANT SELECT (id, email, password_hash, status, email_verified_at) ON app.users TO app_auth;
--> statement-breakpoint
CREATE POLICY auth_lookup ON app.users FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
GRANT SELECT (id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
  ON app.sessions TO app_auth;
--> statement-breakpoint
CREATE POLICY auth_lookup ON app.sessions FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (used_at) ON app.auth_tokens TO app_auth;
--> statement-breakpoint
CREATE POLICY auth_tokens_all ON app.auth_tokens FOR ALL TO app_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT (user_id, provider, provider_account_id) ON app.auth_accounts TO app_auth;
--> statement-breakpoint
CREATE POLICY auth_lookup ON app.auth_accounts FOR SELECT TO app_auth USING (true);
--> statement-breakpoint

-- Invalidação de links anteriores do mesmo e-mail e finalidade.
CREATE INDEX auth_tokens_active_idx ON app.auth_tokens (email, purpose) WHERE used_at IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Funções. Cada uma faz uma coisa só e devolve só o necessário.
-- ---------------------------------------------------------------------------

-- Login, "esqueci a senha" e magic link: acha a conta pelo e-mail.
CREATE FUNCTION app.auth_find_user_by_email(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, status app.user_status, email_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT u.id, u.password_hash, u.status, u.email_verified_at IS NOT NULL
    FROM app.users u
   WHERE u.email = lower(trim(p_email))
$$;
--> statement-breakpoint

-- Cada requisição autenticada: resolve o cookie (já como SHA-256) numa sessão válida.
-- Sessão revogada, expirada ou de conta desativada não volta nada.
CREATE FUNCTION app.auth_resolve_session(p_token_hash bytea)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  created_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz,
  email_verified boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT s.id, s.user_id, s.created_at, s.last_seen_at, s.expires_at, u.email_verified_at IS NOT NULL
    FROM app.sessions s
    JOIN app.users u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND u.status = 'active'
$$;
--> statement-breakpoint

-- Emite um link de uso único. Invalida os links anteriores do mesmo e-mail e finalidade:
-- só o último enviado funciona. Com p_user_id, confere que a conta é mesmo daquele e-mail.
CREATE FUNCTION app.auth_issue_token(
  p_user_id uuid,
  p_email text,
  p_purpose app.token_purpose,
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
  IF p_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.users WHERE id = p_user_id AND email = v_email
  ) THEN
    RAISE EXCEPTION 'conta e e-mail não conferem' USING ERRCODE = 'foreign_key_violation';
  END IF;

  UPDATE app.auth_tokens
     SET used_at = now()
   WHERE email = v_email AND purpose = p_purpose AND used_at IS NULL;

  INSERT INTO app.auth_tokens (user_id, email, purpose, token_hash, expires_at)
  VALUES (p_user_id, v_email, p_purpose, p_token_hash, now() + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Consome um link: marca como usado e devolve a conta (ou só o e-mail, no cadastro por magic link).
-- O UPDATE é atômico: dois cliques simultâneos no mesmo link não abrem duas sessões.
CREATE FUNCTION app.auth_consume_token(p_token_hash bytea, p_purpose app.token_purpose)
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  UPDATE app.auth_tokens t
     SET used_at = now()
   WHERE t.token_hash = p_token_hash
     AND t.purpose = p_purpose
     AND t.used_at IS NULL
     AND t.expires_at > now()
  RETURNING t.user_id, t.email
$$;
--> statement-breakpoint

-- Login com Google: acha a conta já vinculada ao "sub" do provedor.
CREATE FUNCTION app.auth_find_account(p_provider text, p_provider_account_id text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT a.user_id FROM app.auth_accounts a
   WHERE a.provider = p_provider AND a.provider_account_id = p_provider_account_id
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Propriedade e execução: as funções rodam como app_auth; só a API executa.
--    O Postgres exige CREATE no schema para o novo dono: concedido só durante a troca.
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA app TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.auth_find_user_by_email(text) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.auth_resolve_session(bytea) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.auth_issue_token(uuid, text, app.token_purpose, bytea, integer) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.auth_consume_token(bytea, app.token_purpose) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.auth_find_account(text, text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app.auth_find_user_by_email(text),
  app.auth_resolve_session(bytea),
  app.auth_issue_token(uuid, text, app.token_purpose, bytea, integer),
  app.auth_consume_token(bytea, app.token_purpose),
  app.auth_find_account(text, text)
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.auth_find_user_by_email(text),
  app.auth_resolve_session(bytea),
  app.auth_issue_token(uuid, text, app.token_purpose, bytea, integer),
  app.auth_consume_token(bytea, app.token_purpose),
  app.auth_find_account(text, text)
TO app_api;
