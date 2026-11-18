import { randomBytes } from "node:crypto";
import pg from "pg";

export type AppRole = "app_owner" | "app_api" | "app_worker";

export interface ProvisionOptions {
  /**
   * Conexão de administração do banco JÁ EXISTENTE (ex.: o `neondb_owner` do Neon). Não precisa
   * ser superusuário: basta poder criar papéis (CREATEROLE) e ser dono do banco.
   */
  adminUrl: string;
  /** Senhas já escolhidas. As que faltarem são geradas (48 caracteres hexadecimais). */
  passwords?: Partial<Record<AppRole, string>>;
}

export interface ProvisionResult {
  database: string;
  passwords: Record<AppRole, string>;
  /** Papéis cuja senha foi gerada agora (as outras vieram de `passwords`). */
  generated: AppRole[];
  /** URLs de conexão de cada papel, no mesmo servidor e banco da conexão de administração. */
  urls: Record<AppRole, string>;
}

const LOGIN_ROLES: AppRole[] = ["app_owner", "app_api", "app_worker"];

/** Mesma conexão, outro usuário. Mantém host, porta, banco e parâmetros (ex.: sslmode). */
export function urlForRole(adminUrl: string, role: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

/**
 * Cria (ou atualiza) os papéis e o schema do app num banco gerenciado, onde o script de
 * `infra/postgres/init` não roda. É o equivalente em produção ao que o Docker faz no
 * desenvolvimento, e pode rodar de novo sem estragar nada (também serve para trocar as senhas).
 *
 * - app_owner: dono do schema `app`; só as migrations usam.
 * - app_api / app_worker: os papéis que a API e o worker usam; sem DDL e sem BYPASSRLS.
 * - app_auth: SEM login; dono das funções SECURITY DEFINER de autenticação (migration 0003).
 * As permissões por tabela vêm das migrations.
 */
export async function provisionRoles(options: ProvisionOptions): Promise<ProvisionResult> {
  const passwords = {} as Record<AppRole, string>;
  const generated: AppRole[] = [];
  for (const role of LOGIN_ROLES) {
    const given = options.passwords?.[role];
    if (given !== undefined && given.length < 16) {
      throw new Error(`Senha de ${role} muito curta: use pelo menos 16 caracteres.`);
    }
    if (given === undefined) generated.push(role);
    passwords[role] = given ?? randomBytes(24).toString("hex");
  }

  const client = new pg.Client({
    connectionString: options.adminUrl,
    application_name: "presenca-provision",
  });
  await client.connect();
  try {
    const q = (text: string) => client.query(text);
    const id = (name: string) => client.escapeIdentifier(name);
    const lit = (value: string) => client.escapeLiteral(value);

    const {
      rows: [info],
    } = await client.query<{ db: string; superuser: boolean; version: number }>(
      `select current_database() as db,
              (select rolsuper from pg_roles where rolname = current_user) as superuser,
              current_setting('server_version_num')::int as version`,
    );
    const { db, superuser, version } = info!;

    await q("begin");
    try {
      // 1. Papéis. Existente: confere que continua sem superpoderes e só troca a senha (quem
      //    administra sem ser superusuário não pode mexer em atributos como BYPASSRLS).
      for (const role of LOGIN_ROLES) {
        const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          "select rolsuper, rolbypassrls from pg_roles where rolname = $1",
          [role],
        );
        const password = `password ${lit(passwords[role])}`;
        if (rows[0]) {
          if (rows[0].rolsuper || rows[0].rolbypassrls) {
            throw new Error(
              `O papel ${role} já existe com superpoderes (superuser/bypassrls). Remova-o e rode de novo.`,
            );
          }
          await q(`alter role ${id(role)} login ${password}`);
        } else {
          await q(
            `create role ${id(role)} login nosuperuser nocreatedb nocreaterole nobypassrls ${password}`,
          );
        }
      }
      const { rowCount: authExists } = await client.query(
        "select 1 from pg_roles where rolname = 'app_auth'",
      );
      if (!authExists) {
        await q("create role app_auth nologin nosuperuser nocreatedb nocreaterole nobypassrls");
      }
      // As migrations (app_owner) passam a propriedade das funções de auth para app_auth.
      await q("grant app_auth to app_owner");

      // 2. Quem não é superusuário precisa poder "virar" app_owner para criar o schema em nome
      //    dele (PostgreSQL 16+ não dá isso de graça a quem cria o papel).
      if (!superuser) {
        await q(
          version >= 160000
            ? `grant app_owner to current_user with inherit true, set true`
            : `grant app_owner to current_user`,
        );
      }

      // 3. Schema do app, só do app_owner.
      await q("create schema if not exists app authorization app_owner");
      await q("alter schema app owner to app_owner");
      await q("grant usage on schema app to app_api, app_worker, app_auth");
      await q(`grant connect on database ${id(db)} to app_owner, app_api, app_worker`);
      // As migrations guardam o histórico no schema "migrations", que o app_owner cria.
      await q(`grant create on database ${id(db)} to app_owner`);

      // 4. Nada de objetos soltos no schema public.
      await q("revoke create on schema public from public");

      // 5. Os papéis enxergam o schema app sem prefixo (as migrations e a API contam com isso).
      for (const role of LOGIN_ROLES) {
        await q(`alter role ${id(role)} in database ${id(db)} set search_path = app`);
      }

      // 6. Tabelas criadas pelo app_owner nas migrations já nascem com DML liberado para a API.
      //    O RLS (forçado em cada tabela) decide quais linhas ela enxerga.
      await q(
        `alter default privileges for role app_owner in schema app
           grant select, insert, update, delete on tables to app_api`,
      );
      await q(
        `alter default privileges for role app_owner in schema app
           grant usage, select on sequences to app_api`,
      );
      await q("commit");
    } catch (error) {
      await q("rollback").catch(() => undefined);
      throw error;
    }

    return {
      database: db,
      passwords,
      generated,
      urls: {
        app_owner: urlForRole(options.adminUrl, "app_owner", passwords.app_owner),
        app_api: urlForRole(options.adminUrl, "app_api", passwords.app_api),
        app_worker: urlForRole(options.adminUrl, "app_worker", passwords.app_worker),
      },
    };
  } finally {
    await client.end();
  }
}
