import {
  meResponseSchema,
  mfaRecoveryCodesResponseSchema,
  mfaSetupResponseSchema,
  mfaStatusResponseSchema,
  problemSchema,
} from "@presenca/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestEnv,
  Browser,
  registerAndConfirm,
  startAuthTestEnv,
  tokenFromMail,
} from "../test/auth-harness";
import { base32Decode, stepAt, totpCode } from "./totp";

let env: AuthTestEnv;
beforeAll(async () => {
  env = await startAuthTestEnv();
});
afterAll(async () => {
  await env?.stop();
});

let seq = 0;
const PASSWORD = "senha-forte-do-segundo-fator";
const browser = () => new Browser(env.app);
const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());
const email = () => `mfa.${Date.now()}.${++seq}@exemplo.com`;

/** Código do app autenticador no relógio (falso) da API, com deslocamento em passos de 30 s. */
const codeFor = (secret: string, offsetSteps = 0) =>
  totpCode(base32Decode(secret), stepAt(env.clock.now().getTime()) + offsetSteps);

/** Avança o relógio da API um passo: um código novo passa a valer. */
const nextStep = () => {
  env.clock.instant = new Date(env.clock.instant.getTime() + 30_000);
};

async function accountWithMfa() {
  const address = email();
  const b = browser();
  const reg = await registerAndConfirm(env, b, {
    email: address,
    password: PASSWORD,
    fullName: "Bia Dois Fatores",
  });
  expect(reg.statusCode).toBe(200);
  const setup = mfaSetupResponseSchema.parse((await b.request("POST", "/v1/me/mfa/setup")).json());
  const enable = await b.request("POST", "/v1/me/mfa/enable", {
    code: codeFor(setup.secret),
    password: PASSWORD,
  });
  expect(enable.statusCode).toBe(200);
  const { recoveryCodes } = mfaRecoveryCodesResponseSchema.parse(enable.json());
  nextStep();
  return { b, email: address, secret: setup.secret, recoveryCodes };
}

async function loginWithPassword(address: string) {
  const b = browser();
  const res = await b.request("POST", "/v1/auth/login", { email: address, password: PASSWORD });
  return { b, res };
}

describe("ativar o segundo fator", () => {
  it("gera o segredo, liga com um código e devolve 10 códigos de recuperação", async () => {
    const b = browser();
    await registerAndConfirm(env, b, { email: email(), password: PASSWORD, fullName: "Caio" });

    const before = mfaStatusResponseSchema.parse((await b.request("GET", "/v1/me/mfa")).json());
    expect(before).toEqual({ available: true, enabled: false, recoveryCodesLeft: 0 });

    const setup = mfaSetupResponseSchema.parse(
      (await b.request("POST", "/v1/me/mfa/setup")).json(),
    );
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);

    // Pendente não conta como ligado.
    expect((await b.request("GET", "/v1/me/mfa")).json()).toMatchObject({ enabled: false });

    const wrong = await b.request("POST", "/v1/me/mfa/enable", {
      code: "000000",
      password: PASSWORD,
    });
    expect(problem(wrong).code).toBe("MFA_INVALID_CODE");

    const res = await b.request("POST", "/v1/me/mfa/enable", {
      code: codeFor(setup.secret),
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    const { recoveryCodes } = mfaRecoveryCodesResponseSchema.parse(res.json());
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await b.request("GET", "/v1/me/mfa")).json()).toEqual({
      available: true,
      enabled: true,
      recoveryCodesLeft: 10,
    });

    // O segredo fica cifrado no banco (nem em base32, nem em bytes puros).
    const { rows } = await env.db.admin.query<{ secret_ciphertext: Buffer }>(
      "select secret_ciphertext from app.user_mfa order by created_at desc limit 1",
    );
    const stored = rows[0]!.secret_ciphertext;
    expect(stored.includes(base32Decode(setup.secret))).toBe(false);
    expect(stored.toString()).not.toContain(setup.secret);
  });

  it("conta com senha precisa confirmar a senha para ligar", async () => {
    const b = browser();
    await registerAndConfirm(env, b, { email: email(), password: PASSWORD, fullName: "Davi" });
    const setup = mfaSetupResponseSchema.parse(
      (await b.request("POST", "/v1/me/mfa/setup")).json(),
    );
    const res = await b.request("POST", "/v1/me/mfa/enable", { code: codeFor(setup.secret) });
    expect(res.statusCode).toBe(401);
    expect((await b.request("GET", "/v1/me/mfa")).json()).toMatchObject({ enabled: false });
  });
});

describe("login com segundo fator", () => {
  it("senha certa não abre sessão: pede o código, que abre", async () => {
    const { email: address, secret } = await accountWithMfa();
    const { b, res } = await loginWithPassword(address);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mfaRequired: true });
    expect(b.cookies.has("__Host-sid")).toBe(false);
    expect(b.cookies.has("__Host-mfa")).toBe(true);
    expect((await b.request("GET", "/v1/me")).statusCode).toBe(401);

    const wrong = await b.request("POST", "/v1/auth/mfa/verify", { code: "123456" });
    expect(problem(wrong).code).toBe("MFA_INVALID_CODE");

    const ok = await b.request("POST", "/v1/auth/mfa/verify", { code: codeFor(secret) });
    expect(ok.statusCode).toBe(200);
    expect(meResponseSchema.parse(ok.json()).email).toBe(address);
    expect(b.cookies.has("__Host-mfa")).toBe(false);
    expect((await b.request("GET", "/v1/me")).statusCode).toBe(200);
  });

  it("o mesmo código não serve duas vezes", async () => {
    const { email: address, secret } = await accountWithMfa();
    const code = codeFor(secret);
    const first = await loginWithPassword(address);
    expect((await first.b.request("POST", "/v1/auth/mfa/verify", { code })).statusCode).toBe(200);

    const second = await loginWithPassword(address);
    const replay = await second.b.request("POST", "/v1/auth/mfa/verify", { code });
    expect(problem(replay).code).toBe("MFA_INVALID_CODE");
    nextStep();
    const fresh = await second.b.request("POST", "/v1/auth/mfa/verify", { code: codeFor(secret) });
    expect(fresh.statusCode).toBe(200);
  });

  it("cinco códigos errados encerram a tentativa de login", async () => {
    const { email: address, secret } = await accountWithMfa();
    const { b } = await loginWithPassword(address);
    for (let i = 0; i < 4; i++) {
      const res = await b.request("POST", "/v1/auth/mfa/verify", { code: "000000" });
      expect(problem(res).code).toBe("MFA_INVALID_CODE");
    }
    const fifth = await b.request("POST", "/v1/auth/mfa/verify", { code: "000000" });
    expect(problem(fifth).code).toBe("MFA_CHALLENGE_EXPIRED");
    const late = await b.request("POST", "/v1/auth/mfa/verify", { code: codeFor(secret) });
    expect(problem(late).code).toBe("MFA_CHALLENGE_EXPIRED");
  });

  it("sem o desafio do login, o código não abre nada", async () => {
    const { secret } = await accountWithMfa();
    const res = await browser().request("POST", "/v1/auth/mfa/verify", { code: codeFor(secret) });
    expect(problem(res).code).toBe("MFA_CHALLENGE_EXPIRED");
  });

  it("código de recuperação entra uma vez só", async () => {
    const { b: owner, email: address, recoveryCodes } = await accountWithMfa();
    const code = recoveryCodes[0]!;
    const first = await loginWithPassword(address);
    // Aceita minúsculas e sem hífen.
    const ok = await first.b.request("POST", "/v1/auth/mfa/verify", {
      code: code.replace("-", "").toLowerCase(),
    });
    expect(ok.statusCode).toBe(200);
    expect((await owner.request("GET", "/v1/me/mfa")).json()).toMatchObject({
      recoveryCodesLeft: 9,
    });

    const second = await loginWithPassword(address);
    const again = await second.b.request("POST", "/v1/auth/mfa/verify", { code });
    expect(problem(again).code).toBe("MFA_INVALID_CODE");
  });

  it("link de acesso por e-mail também pede o código", async () => {
    const { email: address, secret } = await accountWithMfa();
    await browser().request("POST", "/v1/auth/magic-link", { email: address });
    await env.drain();
    const b = browser();
    const res = await b.request("POST", "/v1/auth/magic-link/consume", {
      token: tokenFromMail(env.mail, address),
    });
    expect(res.json()).toEqual({ mfaRequired: true });
    expect(b.cookies.has("__Host-sid")).toBe(false);
    expect(
      (await b.request("POST", "/v1/auth/mfa/verify", { code: codeFor(secret) })).statusCode,
    ).toBe(200);
  });

  it("nova senha pelo e-mail troca a senha e derruba as sessões, mas entrar pede o código", async () => {
    const { b: oldDevice, email: address, secret } = await accountWithMfa();
    await browser().request("POST", "/v1/auth/password/forgot", { email: address });
    await env.drain();
    const b = browser();
    const res = await b.request("POST", "/v1/auth/password/reset", {
      token: tokenFromMail(env.mail, address),
      password: "outra-senha-forte-com-mfa",
    });
    expect(res.json()).toEqual({ mfaRequired: true });
    expect((await oldDevice.request("GET", "/v1/me")).statusCode).toBe(401);
    expect(
      (await b.request("POST", "/v1/auth/mfa/verify", { code: codeFor(secret) })).statusCode,
    ).toBe(200);
  });

  it("Google também pede o código (volta para a tela de verificação)", async () => {
    const { email: address } = await accountWithMfa();
    env.google.profile = {
      sub: `sub-mfa-${++seq}`,
      email: address,
      emailVerified: true,
      name: "Bia",
    };
    const b = browser();
    const start = await b.request("GET", "/v1/auth/google");
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const res = await b.request(
      "GET",
      `/v1/auth/google/callback?code=codigo-valido&state=${state}`,
    );
    expect(res.headers.location).toBe("http://localhost:3000/entrar/verificacao");
    expect(b.cookies.has("__Host-sid")).toBe(false);
    expect(b.cookies.has("__Host-mfa")).toBe(true);
  });
});

describe("desligar e trocar códigos", () => {
  it("desligar pede um código; depois, a senha basta de novo", async () => {
    const { b, email: address, secret } = await accountWithMfa();
    const wrong = await b.request("POST", "/v1/me/mfa/disable", { code: "000000" });
    expect(problem(wrong).code).toBe("MFA_INVALID_CODE");
    expect(
      (await b.request("POST", "/v1/me/mfa/disable", { code: codeFor(secret) })).statusCode,
    ).toBe(204);
    const { res } = await loginWithPassword(address);
    expect(meResponseSchema.safeParse(res.json()).success).toBe(true);
  });

  it("códigos novos invalidam os antigos", async () => {
    const { b, email: address, secret, recoveryCodes } = await accountWithMfa();
    const res = await b.request("POST", "/v1/me/mfa/recovery-codes", { code: codeFor(secret) });
    const fresh = mfaRecoveryCodesResponseSchema.parse(res.json()).recoveryCodes;
    expect(fresh).toHaveLength(10);

    const { b: other } = await loginWithPassword(address);
    const old = await other.request("POST", "/v1/auth/mfa/verify", { code: recoveryCodes[1]! });
    expect(problem(old).code).toBe("MFA_INVALID_CODE");
    expect(
      (await other.request("POST", "/v1/auth/mfa/verify", { code: fresh[0]! })).statusCode,
    ).toBe(200);
  });

  it("cada conta só vê e mexe no próprio segundo fator", async () => {
    await accountWithMfa();
    const b = browser();
    await registerAndConfirm(env, b, { email: email(), password: PASSWORD, fullName: "Eva" });
    expect((await b.request("GET", "/v1/me/mfa")).json()).toMatchObject({ enabled: false });
    const disable = await b.request("POST", "/v1/me/mfa/disable", { code: "000000" });
    expect(problem(disable).code).toBe("MFA_INVALID_CODE");
  });
});
