-- Segundo fator (TOTP) opcional: segredo cifrado por conta e códigos de recuperação.
-- As duas tabelas seguem o padrão das outras: RLS forçado (a API só vê as linhas da própria
-- conta), manutenção da exclusão de conta (0006) e leitura pelo backup (0008). O worker não
-- tem acesso a elas.
-- Também: finalidade de link mfa_enable (conta sem senha confirma por e-mail para ligar).
ALTER TYPE "app"."token_purpose" ADD VALUE 'mfa_enable';--> statement-breakpoint
CREATE TABLE "app"."mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT app.uuid_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_recovery_codes_user_code_key" UNIQUE("user_id","code_hash"),
	CONSTRAINT "mfa_recovery_codes_hash_len_chk" CHECK (octet_length("app"."mfa_recovery_codes"."code_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "app"."user_mfa" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_secret_len_chk" CHECK (octet_length("app"."user_mfa"."secret_ciphertext") between 40 and 200)
);
--> statement-breakpoint
ALTER TABLE "app"."mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_mfa" ADD CONSTRAINT "user_mfa_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_mfa', 'mfa_recovery_codes']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY api_owner_all ON app.%I FOR ALL TO app_api '
      'USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id())',
      t);
    EXECUTE format(
      'CREATE POLICY owner_maintenance ON app.%I FOR ALL TO app_owner '
      'USING (current_setting(''app.deleting_account'', true) = ''on'') '
      'WITH CHECK (current_setting(''app.deleting_account'', true) = ''on'')',
      t);
    EXECUTE format('CREATE POLICY backup_read ON app.%I FOR SELECT TO app_backup USING (true)', t);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON app.%I FROM app_api', t);
  END LOOP;
END
$$;
