import { DEV_MFA_KEY } from "../config/env";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { startTestDb, type TestDb } from "@presenca/db/testing";
import { GenericContainer } from "testcontainers";
import { GOOGLE_OAUTH, type GoogleOAuth, type GoogleProfile } from "../auth/google.provider";
import { BackgroundTasks } from "../common/background-tasks";
import { ClockService } from "../common/clock";
import { GRADING_AI, type GradingAi } from "../grades/assistant.service";
import { CaptureMailer, MAILER } from "../mail/mailer";
import { buildTestApp, TEST_ORIGIN } from "./build-test-app";

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

export const TEST_VAPID_PUBLIC_KEY =
  "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

export class FakeClock extends ClockService {
  instant = new Date("2026-11-18T15:00:00Z");

  override now(): Date {
    return this.instant;
  }
}

export class FakeGradingAi implements GradingAi {
  readonly calls: { system: string; messages: { role: string; content: unknown }[] }[] = [];
  queue: (Record<string, unknown> | Error | { refusal: true })[] = [];
  async generate(params: { system: string; messages: { role: string; content: unknown }[] }) {
    this.calls.push({ system: params.system, messages: params.messages });
    const next = this.queue.shift();
    if (!next) throw new Error("fila da IA falsa vazia");
    if (next instanceof Error) throw next;
    return "refusal" in next ? null : next;
  }
}

export interface AuthTestEnv {
  ai: FakeGradingAi;
  clock: FakeClock;
  app: NestFastifyApplication;
  db: TestDb;
  mail: CaptureMailer;
  google: FakeGoogle;
  drain(): Promise<void>;
  stop(): Promise<void>;
}

export const TEST_INTEGRATION_KEY = Buffer.alloc(32, 7).toString("base64");

export async function startAuthTestEnv(): Promise<AuthTestEnv> {
  const [db, redis] = await Promise.all([
    startTestDb(),
    new GenericContainer("valkey/valkey:8-alpine").withExposedPorts(6379).start(),
  ]);
  const mail = new CaptureMailer();
  const google = new FakeGoogle();
  const clock = new FakeClock();
  const ai = new FakeGradingAi();
  const app = await buildTestApp({
    fullApp: true,
    env: {
      DATABASE_URL: db.urls.app_api,
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      VAPID_PUBLIC_KEY: TEST_VAPID_PUBLIC_KEY,
      MFA_ENCRYPTION_KEY: DEV_MFA_KEY,
      INTEGRATION_ENCRYPTION_KEY: TEST_INTEGRATION_KEY,
      INTEGRATIONS_ALLOW_INSECURE_FETCH: "true",
      FEEDBACK_TO: "dono@exemplo.com",
    },
    override: (builder) =>
      builder
        .overrideProvider(MAILER)
        .useValue(mail)
        .overrideProvider(GOOGLE_OAUTH)
        .useValue(google)
        .overrideProvider(ClockService)
        .useValue(clock)
        .overrideProvider(GRADING_AI)
        .useValue(ai),
  });
  const tasks = app.get(BackgroundTasks);
  return {
    app,
    ai,
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

export function tokenFromMail(mail: CaptureMailer, to: string): string {
  const message = mail.lastTo(to);
  const token = message?.text.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error(`nenhum link com token no e-mail para ${to}`);
  return token;
}

export async function registerAndConfirm(
  env: AuthTestEnv,
  browser: Browser,
  body: { email: string; password: string; fullName: string; next?: string },
) {
  const requested = await browser.request("POST", "/v1/auth/register", body);
  if (requested.statusCode !== 202) {
    throw new Error(`cadastro recusado (${requested.statusCode}): ${requested.body}`);
  }
  await env.drain();
  const token = tokenFromMail(env.mail, body.email.trim().toLowerCase());
  return browser.request("POST", "/v1/auth/register/confirm", { token });
}
