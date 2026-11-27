import { randomBytes } from "node:crypto";
import pg from "pg";

export type AppRole = "app_owner" | "app_api" | "app_worker";

export interface ProvisionOptions {
  adminUrl: string;
  passwords?: Partial<Record<AppRole, string>>;
}

export interface ProvisionResult {
  database: string;
  passwords: Record<AppRole, string>;
  generated: AppRole[];
  urls: Record<AppRole, string>;
}

const LOGIN_ROLES: AppRole[] = ["app_owner", "app_api", "app_worker"];

export function urlForRole(adminUrl: string, role: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

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
      await q("grant app_auth to app_owner");
      const { rowCount: backupExists } = await client.query(
        "select 1 from pg_roles where rolname = 'app_backup'",
      );
      if (!backupExists) {
        await q("create role app_backup nologin nosuperuser nocreatedb nocreaterole nobypassrls");
      }

      // 2. Quem não é superusuário precisa poder "virar" app_owner para criar o schema em nome
      //    dele (PostgreSQL 16+ não dá isso de graça a quem cria o papel).
      if (!superuser) {
        await q(
          version >= 160000
            ? `grant app_owner to current_user with inherit true, set true`
            : `grant app_owner to current_user`,
        );
      }

      await q("create schema if not exists app authorization app_owner");
      await q("alter schema app owner to app_owner");
      await q("grant usage on schema app to app_api, app_worker, app_auth");
      await q(`grant connect on database ${id(db)} to app_owner, app_api, app_worker`);
      await q(`grant create on database ${id(db)} to app_owner`);

      await q("revoke create on schema public from public");

      for (const role of LOGIN_ROLES) {
        await q(`alter role ${id(role)} in database ${id(db)} set search_path = app`);
      }

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

export async function provisionBackupRole(options: {
  adminUrl: string;
  password?: string;
}): Promise<string> {
  if (options.password !== undefined && options.password.length < 16) {
    throw new Error("Senha de app_backup muito curta: use pelo menos 16 caracteres.");
  }
  const password = options.password ?? randomBytes(24).toString("hex");
  const client = new pg.Client({
    connectionString: options.adminUrl,
    application_name: "presenca-provision-backup",
  });
  await client.connect();
  try {
    const lit = (value: string) => client.escapeLiteral(value);
    const id = (name: string) => client.escapeIdentifier(name);
    const {
      rows: [info],
    } = await client.query<{ db: string }>("select current_database() as db");
    const db = info!.db;

    await client.query("begin");
    try {
      const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "select rolsuper, rolbypassrls from pg_roles where rolname = 'app_backup'",
      );
      if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
        throw new Error("O papel app_backup existe com superpoderes. Remova-o e rode de novo.");
      }
      await client.query(
        rows[0]
          ? `alter role app_backup login password ${lit(password)}`
          : `create role app_backup login nosuperuser nocreatedb nocreaterole nobypassrls password ${lit(password)}`,
      );
      await client.query(`grant connect on database ${id(db)} to app_backup`);
      await client.query(`alter role app_backup in database ${id(db)} set search_path = app`);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    return urlForRole(options.adminUrl, "app_backup", password);
  } finally {
    await client.end();
  }
}
