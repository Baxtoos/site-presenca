import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { startTestDb, type TestDb } from "@presenca/db/testing";
import { GenericContainer } from "testcontainers";
import { GOOGLE_OAUTH, type GoogleOAuth, type GoogleProfile } from "../auth/google.provider";
import { BackgroundTasks } from "../common/background-tasks";
import { ClockService } from "../common/clock";
import { CaptureMailer, MAILER } from "../mail/mailer";
import { buildTestApp, TEST_ORIGIN } from "./build-test-app";

/** Google simulado: devolve o perfil configurado para o código "codigo-valido". */
export class FakeGoogle implements GoogleOAuth {
  profile: GoogleProfile = {
    sub: "google-sub-1",
    email: "g@exemplo.com",
    emailVerified: true,
    name: "G",
  };

  authorizationUrl(state: string, codeVerifier: string): URL {
    const url = new URL("https://accounts.google.test/o/oauth2/auth");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge_for", codeVerifier.slice(0, 4));
    return url;
  }

  async exchange(code: string): Promise<GoogleProfile> {
    if (code !== "codigo-valido") throw new Error("código inválido");
    return this.profile;
  }
}

/** Relógio de teste: "agora" fixo, que cada teste pode mover. Padrão: 18/11/2026 12:00 em São Paulo (quarta). */
export class FakeClock extends ClockService {
  instant = new Date("2026-11-18T15:00:00Z");

  override now(): Date {
    return this.instant;
  }
}

export interface AuthTestEnv {
  clock: FakeClock;
  app: NestFastifyApplication;
  db: TestDb;
  mail: CaptureMailer;
  google: FakeGoogle;
  /** Espera as tarefas em segundo plano (envio de e-mail) terminarem. */
  drain(): Promise<void>;
  stop(): Promise<void>;
}

/** Sobe Postgres + Valkey reais e a API completa contra eles. */
export async function startAuthTestEnv(): Promise<AuthTestEnv> {
  const [db, redis] = await Promise.all([
    startTestDb(),
    new GenericContainer("valkey/valkey:8-alpine").withExposedPorts(6379).start(),
  ]);
  const mail = new CaptureMailer();
  const google = new FakeGoogle();
  const clock = new FakeClock();
  const app = await buildTestApp({
    fullApp: true,
    env: {
      DATABASE_URL: db.urls.app_api,
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    },
    override: (builder) =>
      builder
        .overrideProvider(MAILER)
        .useValue(mail)
        .overrideProvider(GOOGLE_OAUTH)
        .useValue(google)
        .overrideProvider(ClockService)
        .useValue(clock),
  });
  const tasks = app.get(BackgroundTasks);
  return {
    app,
    db,
    clock,
    mail,
    google,
    drain: () => tasks.drain(),
    async stop() {
      await app.close();
      await Promise.all([db.stop(), redis.stop()]);
    },
  };
}

let ipCounter = 0;

/**
 * Um "navegador": guarda cookies entre requisições e manda Origin do app nas escritas.
 * Cada cliente tem um IP próprio, para os limites por IP de um teste não afetarem outro.
 */
export class Browser {
  readonly cookies = new Map<string, string>();
  readonly ip = `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

  constructor(private readonly app: NestFastifyApplication) {}

  async request(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    options: { origin?: string | null; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = { ...options.headers };
    const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
    if (origin !== null) headers.origin = origin;
    if (this.cookies.size > 0) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const response = await this.app.inject({
      method,
      url,
      headers,
      remoteAddress: this.ip,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    for (const c of response.cookies as Array<{
      name: string;
      value: string;
      expires?: Date;
      maxAge?: number;
    }>) {
      const expired =
        c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now());
      if (expired || c.value === "") this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return response;
  }
}

/** Extrai o token do último e-mail enviado para o endereço. */
export function tokenFromMail(mail: CaptureMailer, to: string): string {
  const message = mail.lastTo(to);
  const token = message?.text.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error(`nenhum link com token no e-mail para ${to}`);
  return token;
}
