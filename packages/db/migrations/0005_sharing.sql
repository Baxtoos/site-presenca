-- Compartilhamento de grades (Fase 7). Escrita à mão (drizzle-kit generate --custom). Roda como app_owner.
--
-- Pelo RLS, só o dono enxerga o próprio modelo. Quem recebe o código precisa ver a prévia (até sem
-- conta) e importar: isso passa por duas funções SECURITY DEFINER, do papel sem login app_auth,
-- que devolvem SÓ os campos do modelo (nunca o dono, nunca faltas: o payload não tem faltas).

-- ---------------------------------------------------------------------------
-- 1. O mínimo que app_auth precisa enxergar e alterar.
-- ---------------------------------------------------------------------------
GRANT SELECT (id, kind, code, title, institution, course, payload, payload_version, expires_at,
              max_uses, uses_count, revoked_at)
  ON app.shared_templates TO app_auth;
--> statement-breakpoint
GRANT UPDATE (uses_count) ON app.shared_templates TO app_auth;
--> statement-breakpoint
CREATE POLICY share_lookup ON app.shared_templates FOR SELECT TO app_auth USING (true);
--> statement-breakpoint
CREATE POLICY share_consume ON app.shared_templates FOR UPDATE TO app_auth USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Funções.
-- ---------------------------------------------------------------------------

-- Prévia: o modelo, se o código existir e ainda valer (não revogado, não expirado, com usos).
-- Código inexistente, revogado ou esgotado dão o mesmo resultado (nada): não vira oráculo.
CREATE FUNCTION app.share_preview(p_code text)
RETURNS TABLE (
  kind app.template_kind,
  title text,
  institution text,
  course text,
  payload jsonb,
  payload_version smallint,
  uses_count integer,
  expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT t.kind, t.title, t.institution, t.course, t.payload, t.payload_version, t.uses_count, t.expires_at
    FROM app.shared_templates t
   WHERE t.code = p_code
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND (t.max_uses IS NULL OR t.uses_count < t.max_uses)
$$;
--> statement-breakpoint

-- Importação: gasta um uso e devolve o modelo, numa operação só. O UPDATE trava a linha, então
-- dois alunos importando ao mesmo tempo nunca passam do limite de usos. Roda dentro da transação
-- da importação: se ela falhar, o uso volta.
CREATE FUNCTION app.share_consume(p_code text)
RETURNS TABLE (
  template_id uuid,
  kind app.template_kind,
  title text,
  payload jsonb,
  payload_version smallint
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  UPDATE app.shared_templates t
     SET uses_count = t.uses_count + 1
   WHERE t.code = p_code
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND (t.max_uses IS NULL OR t.uses_count < t.max_uses)
  RETURNING t.id, t.kind, t.title, t.payload, t.payload_version
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Donas: app_auth. Só a API executa.
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA app TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.share_preview(text) OWNER TO app_auth;
--> statement-breakpoint
ALTER FUNCTION app.share_consume(text) OWNER TO app_auth;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA app FROM app_auth;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.share_preview(text), app.share_consume(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.share_preview(text), app.share_consume(text) TO app_api;
