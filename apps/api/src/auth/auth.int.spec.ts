import { meResponseSchema, problemSchema, sessionsResponseSchema } from "@presenca/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestEnv,
  Browser,
  registerAndConfirm,
  startAuthTestEnv,
  tokenFromMail,
} from "../test/auth-harness";

let env: AuthTestEnv;
beforeAll(async () => {
  env = await startAuthTestEnv();
});
afterAll(async () => {
  await env?.stop();
});

let seq = 0;
const uniqueEmail = (prefix = "aluno") => `${prefix}.${Date.now()}.${++seq}@exemplo.com`;
const PASSWORD = "senha-forte-do-teste-1";

const browser = () => new Browser(env.app);

/** Conta com senha, criada pelo fluxo completo (pedido + link do e-mail). */
async function registered(email = uniqueEmail()) {
  const b = browser();
  const res = await registerAndConfirm(env, b, {
    email,
    password: PASSWORD,
    fullName: "Ana Teste",
  });
  expect(res.statusCode).toBe(200);
  return { b, email, me: meResponseSchema.parse(res.json()) };
}

/** Conta antiga com e-mail ainda não confirmado (de antes da confirmação no cadastro). */
async function legacyUnverified() {
  const account = await registered();
  await env.db.admin.query("update app.users set email_verified_at = null where id = $1", [
    account.me.id,
  ]);
  return account;
}

/** Conta sem senha, criada pelo link de acesso. */
async function passwordless() {
  const email = uniqueEmail("semsenha");
  await browser().request("POST", "/v1/auth/magic-link", { email });
  await env.drain();
  const b = browser();
  const res = await b.request("POST", "/v1/auth/magic-link/consume", {
    token: tokenFromMail(env.mail, email),
  });
  expect(res.statusCode).toBe(200);
  return { b, email, me: meResponseSchema.parse(res.json()) };
}

const problem = (res: { json: () => unknown }) => problemSchema.parse(res.json());

const userCount = async (email: string) =>
  (
    await env.db.admin.query<{ n: string }>(
      "select count(*) as n from app.users where email = $1",
      [email],
    )
  ).rows[0]!.n;

describe("cadastro com confirmação por e-mail", () => {
  it("o pedido não cria conta nem sessão; a conta nasce no link, já verificada", async () => {
    const email = uniqueEmail();
    const b = browser();
    const res = await b.request("POST", "/v1/auth/register", {
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      fullName: "  Ana Teste ",
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "accepted" });
    expect(b.cookies.has("__Host-sid")).toBe(false);
    await env.drain();
    expect(await userCount(email)).toBe("0");

    const message = env.mail.lastTo(email);
    expect(message?.subject).toBe("Confirme seu e-mail para criar a conta");
    expect(message?.text).toContain("http://localhost:3000/cadastro/confirmar?token=");
    expect(message?.text).not.toContain(PASSWORD);

    const confirm = await b.request("POST", "/v1/auth/register/confirm", {
      token: tokenFromMail(env.mail, email),
    });
    expect(confirm.statusCode).toBe(200);
    const me = meResponseSchema.parse(confirm.json());
    expect(me).toMatchObject({
      email,
      fullName: "Ana Teste",
      emailVerified: true,
      hasPassword: true,
    });
    const cookie = (confirm.cookies as Array<Record<string, unknown>>).find(
      (c) => c.name === "__Host-sid",
    );
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(cookie).not.toHaveProperty("domain");
    expect((await b.request("GET", "/v1/me")).json()).toMatchObject({ id: me.id });

    // A senha escolhida no formulário é a da conta.
    expect(
      (await browser().request("POST", "/v1/auth/login", { email, password: PASSWORD })).statusCode,
    ).toBe(200);
  });

  it("o link de cadastro só funciona uma vez", async () => {
    const email = uniqueEmail();
    await browser().request("POST", "/v1/auth/register", {
      email,
      password: PASSWORD,
      fullName: "Ana",
    });
    await env.drain();
    const token = tokenFromMail(env.mail, email);
    expect(
      (await browser().request("POST", "/v1/auth/register/confirm", { token })).statusCode,
    ).toBe(200);
    const again = await browser().request("POST", "/v1/auth/register/confirm", { token });
    expect(again.statusCode).toBe(400);
    expect(problem(again).code).toBe("INVALID_TOKEN");
    expect(await userCount(email)).toBe("1");
  });

  it("e-mail já cadastrado: mesma resposta, conta intacta e o dono recebe um aviso", async () => {
    const { email, me } = await registered();
    const b = browser();
    const res = await b.request("POST", "/v1/auth/register", {
      email: email.toUpperCase(),
      password: "senha-do-invasor-123",
      fullName: "Outra Pessoa",
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "accepted" });
    expect(b.cookies.has("__Host-sid")).toBe(false);
    await env.drain();

    const message = env.mail.lastTo(email);
    expect(message?.subject).toBe("Você já tem uma conta no Monitor de Presenças");
    expect(() => tokenFromMail(env.mail, email)).toThrow();

    // Ninguém trocou a senha nem o nome da conta.
    const login = await browser().request("POST", "/v1/auth/login", { email, password: PASSWORD });
    expect(login.json()).toMatchObject({ id: me.id, fullName: "Ana Teste" });
    expect(
      (
        await browser().request("POST", "/v1/auth/login", {
          email,
          password: "senha-do-invasor-123",
        })
      ).statusCode,
    ).toBe(401);
  });

  it("só o último link pedido vale", async () => {
    const email = uniqueEmail();
    const ask = (fullName: string) =>
      browser().request("POST", "/v1/auth/register", { email, password: PASSWORD, fullName });
    await ask("Primeiro Nome");
    await env.drain();
    const first = tokenFromMail(env.mail, email);
    await ask("Segundo Nome");
    await env.drain();
    const second = tokenFromMail(env.mail, email);

    expect(
      (await browser().request("POST", "/v1/auth/register/confirm", { token: first })).statusCode,
    ).toBe(400);
    const ok = await browser().request("POST", "/v1/auth/register/confirm", { token: second });
    expect(ok.json()).toMatchObject({ fullName: "Segundo Nome" });
  });

  it("leva o caminho de volta no link e recusa caminhos para fora do app", async () => {
    const email = uniqueEmail();
    const ok = await browser().request("POST", "/v1/auth/register", {
      email,
      password: PASSWORD,
      fullName: "Ana",
      next: "/importar/ABCD2345",
    });
    expect(ok.statusCode).toBe(202);
    await env.drain();
    expect(env.mail.lastTo(email)?.text).toContain("next=%2Fimportar%2FABCD2345");

    const evil = await browser().request("POST", "/v1/auth/register", {
      email: uniqueEmail(),
      password: PASSWORD,
      fullName: "Ana",
      next: "//outro-site.com",
    });
    expect(evil.statusCode).toBe(422);
  });

  it("recusa senha curta com a mensagem no campo", async () => {
    const res = await browser().request("POST", "/v1/auth/register", {
      email: uniqueEmail(),
      password: "curta",
      fullName: "Ana",
    });
    expect(res.statusCode).toBe(422);
    expect(problem(res).errors).toEqual([
      { path: "password", message: "A senha precisa ter pelo menos 12 caracteres." },
    ]);
  });
});

describe("verificação de e-mail (contas antigas)", () => {
  it("confirma o e-mail pelo link, que só funciona uma vez", async () => {
    const { b, email } = await legacyUnverified();
    expect((await b.request("POST", "/v1/auth/verify-email/resend")).statusCode).toBe(202);
    await env.drain();
    expect(env.mail.lastTo(email)?.subject).toBe("Confirme seu e-mail");
    const token = tokenFromMail(env.mail, email);

    expect((await browser().request("POST", "/v1/auth/verify-email", { token })).statusCode).toBe(
      204,
    );
    expect((await b.request("GET", "/v1/me")).json()).toMatchObject({ emailVerified: true });

    const again = await browser().request("POST", "/v1/auth/verify-email", { token });
    expect(again.statusCode).toBe(400);
    expect(problem(again).code).toBe("INVALID_TOKEN");
  });
});

describe("login e logout", () => {
  it("e-mail inexistente e senha errada dão exatamente a mesma resposta", async () => {
    const { email } = await registered();
    const wrongPassword = await browser().request("POST", "/v1/auth/login", {
      email,
      password: "senha-errada-123",
    });
    const unknownEmail = await browser().request("POST", "/v1/auth/login", {
      email: uniqueEmail("ninguem"),
      password: "senha-errada-123",
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    const { requestId: _a, ...a } = problem(wrongPassword);
    const { requestId: _b, ...b } = problem(unknownEmail);
    expect(a).toEqual(b);
    expect(a.code).toBe("INVALID_CREDENTIALS");
  });

  it("abre sessão com a senha certa", async () => {
    const { email, me } = await registered();
    const b = browser();
    const res = await b.request("POST", "/v1/auth/login", { email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: me.id });
    expect((await b.request("GET", "/v1/me")).statusCode).toBe(200);
  });

  it("sem cookie, ou com cookie inválido, a rota exige login (e o cookie ruim é apagado)", async () => {
    expect((await browser().request("GET", "/v1/me")).statusCode).toBe(401);
    const b = browser();
    b.cookies.set("__Host-sid", "x".repeat(43));
    const res = await b.request("GET", "/v1/me");
    expect(res.statusCode).toBe(401);
    expect(b.cookies.has("__Host-sid")).toBe(false);
  });

  it("logout encerra a sessão no servidor: o cookie antigo para de funcionar", async () => {
    const { b } = await registered();
    const stolen = b.cookies.get("__Host-sid")!;
    expect((await b.request("POST", "/v1/auth/logout")).statusCode).toBe(204);
    expect(b.cookies.has("__Host-sid")).toBe(false);

    const attacker = browser();
    attacker.cookies.set("__Host-sid", stolen);
    expect((await attacker.request("GET", "/v1/me")).statusCode).toBe(401);
  });

  it("escrita com cookie de sessão sem Origin, ou de outro site, é recusada (CSRF)", async () => {
    const { b } = await registered();
    const noOrigin = await b.request("POST", "/v1/auth/logout", undefined, { origin: null });
    const evil = await b.request("POST", "/v1/auth/logout", undefined, {
      origin: "https://site-malicioso.exemplo",
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(evil.statusCode).toBe(403);
    expect((await b.request("GET", "/v1/me")).statusCode).toBe(200);
  });
});

describe("sessões em vários dispositivos", () => {
  it("lista as sessões, marca a atual e encerra a de outro dispositivo", async () => {
    const { b: laptop, email } = await registered();
    const phone = browser();
    await phone.request(
      "POST",
      "/v1/auth/login",
      { email, password: PASSWORD },
      {
        headers: { "user-agent": "Celular de teste" },
      },
    );

    const list = sessionsResponseSchema.parse(
      (await laptop.request("GET", "/v1/me/sessions")).json(),
    );
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.filter((s) => s.current)).toHaveLength(1);
    const phoneSession = list.sessions.find((s) => s.userAgent === "Celular de teste")!;
    expect(phoneSession.current).toBe(false);

    expect((await laptop.request("DELETE", `/v1/me/sessions/${phoneSession.id}`)).statusCode).toBe(
      204,
    );
    expect((await phone.request("GET", "/v1/me")).statusCode).toBe(401);
    expect((await laptop.request("GET", "/v1/me")).statusCode).toBe(200);
  });

  it("não encerra sessão de outra pessoa (vira 404)", async () => {
    const alice = await registered();
    const bob = await registered();
    const bobSessions = sessionsResponseSchema.parse(
      (await bob.b.request("GET", "/v1/me/sessions")).json(),
    );
    const res = await alice.b.request("DELETE", `/v1/me/sessions/${bobSessions.sessions[0]!.id}`);
    expect(res.statusCode).toBe(404);
    expect((await bob.b.request("GET", "/v1/me")).statusCode).toBe(200);
  });
});

describe("esqueci a senha", () => {
  it("responde igual exista ou não a conta, e só envia e-mail se existir", async () => {
    const unknown = uniqueEmail("ninguem");
    const res = await browser().request("POST", "/v1/auth/password/forgot", { email: unknown });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "accepted" });
    await env.drain();
    expect(env.mail.lastTo(unknown)).toBeUndefined();
  });

  it("redefine a senha, encerra todas as sessões e o link não serve de novo", async () => {
    const { b: oldDevice, email } = await registered();
    await browser().request("POST", "/v1/auth/password/forgot", { email });
    await env.drain();
    const token = tokenFromMail(env.mail, email);

    const b = browser();
    const NEW_PASSWORD = "nova-senha-bem-forte-2";
    const res = await b.request("POST", "/v1/auth/password/reset", {
      token,
      password: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ emailVerified: true });
    expect((await b.request("GET", "/v1/me")).statusCode).toBe(200);

    expect((await oldDevice.request("GET", "/v1/me")).statusCode).toBe(401);
    expect(
      (await browser().request("POST", "/v1/auth/login", { email, password: PASSWORD })).statusCode,
    ).toBe(401);
    expect(
      (await browser().request("POST", "/v1/auth/login", { email, password: NEW_PASSWORD }))
        .statusCode,
    ).toBe(200);

    const reuse = await browser().request("POST", "/v1/auth/password/reset", {
      token,
      password: "outra-senha-forte-3",
    });
    expect(problem(reuse).code).toBe("INVALID_TOKEN");
  });
});

describe("magic link", () => {
  it("cria a conta já verificada quando o e-mail não existe", async () => {
    const email = uniqueEmail("ana.ribeiro");
    await browser().request("POST", "/v1/auth/magic-link", { email });
    await env.drain();
    expect(env.mail.lastTo(email)?.subject).toBe("Crie sua conta");

    const b = browser();
    const res = await b.request("POST", "/v1/auth/magic-link/consume", {
      token: tokenFromMail(env.mail, email),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email, emailVerified: true, hasPassword: false });
    expect(meResponseSchema.parse(res.json()).fullName).toMatch(/^Ana Ribeiro/);
  });

  it("entra numa conta existente e confirma o e-mail dela", async () => {
    const { email, me } = await registered();
    await browser().request("POST", "/v1/auth/magic-link", { email });
    await env.drain();
    expect(env.mail.lastTo(email)?.subject).toBe("Seu link de acesso");

    const b = browser();
    const token = tokenFromMail(env.mail, email);
    const res = await b.request("POST", "/v1/auth/magic-link/consume", { token });
    expect(res.json()).toMatchObject({ id: me.id, emailVerified: true });
    expect(
      (await browser().request("POST", "/v1/auth/magic-link/consume", { token })).statusCode,
    ).toBe(400);
  });
});

describe("limite de tentativas (Redis)", () => {
  it("bloqueia a 6ª tentativa de senha na mesma conta, com Retry-After", async () => {
    const { email } = await registered();
    const attacker = browser();
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      attempts.push(
        await attacker.request("POST", "/v1/auth/login", { email, password: `errada-${i}-xxxx` }),
      );
    }
    expect(attempts.slice(0, 5).map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect(attempts[5]!.statusCode).toBe(429);
    expect(problem(attempts[5]!).code).toBe("RATE_LIMITED");
    expect(Number(attempts[5]!.headers["retry-after"])).toBeGreaterThan(0);

    // Mesmo com a senha certa, a conta fica travada para este IP até a janela acabar.
    const right = await attacker.request("POST", "/v1/auth/login", { email, password: PASSWORD });
    expect(right.statusCode).toBe(429);
    // De outro IP, o dono continua entrando.
    expect(
      (await browser().request("POST", "/v1/auth/login", { email, password: PASSWORD })).statusCode,
    ).toBe(200);
  });
});

describe("conta desativada", () => {
  it("não entra nem com a senha certa, e as sessões abertas param de valer", async () => {
    const { b, email, me } = await registered();
    await env.db.admin.query("update app.users set status = 'disabled' where id = $1", [me.id]);

    expect((await b.request("GET", "/v1/me")).statusCode).toBe(401);
    const res = await browser().request("POST", "/v1/auth/login", { email, password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(problem(res).code).toBe("ACCOUNT_DISABLED");
  });
});

describe("perfil", () => {
  it("atualiza o perfil e conclui o onboarding", async () => {
    const { b } = await registered();
    const res = await b.request("PATCH", "/v1/me", {
      institution: "Universidade Exemplo",
      course: "Engenharia de Computação",
      currentTerm: 4,
      timezone: "America/Manaus",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      currentTerm: 4,
      timezone: "America/Manaus",
      onboarded: true,
    });
  });

  it("recusa fuso horário inexistente", async () => {
    const { b } = await registered();
    const res = await b.request("PATCH", "/v1/me", { timezone: "Marte/Base_Alfa" });
    expect(res.statusCode).toBe(422);
    expect(problem(res).errors?.[0]?.path).toBe("timezone");
  });
});

describe("login com Google", () => {
  async function googleLogin(b: Browser, code = "codigo-valido") {
    const start = await b.request("GET", "/v1/auth/google");
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    return b.request("GET", `/v1/auth/google/callback?code=${code}&state=${state}`);
  }

  it("cria a conta na primeira vez e reconhece a mesma conta Google depois", async () => {
    env.google.profile = {
      sub: `sub-${++seq}`,
      email: uniqueEmail("google"),
      emailVerified: true,
      name: "Gabi Google",
    };
    const first = browser();
    const res = await googleLogin(first);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:3000/");
    const me = meResponseSchema.parse((await first.request("GET", "/v1/me")).json());
    expect(me).toMatchObject({ fullName: "Gabi Google", emailVerified: true, hasPassword: false });

    const second = browser();
    await googleLogin(second);
    expect((await second.request("GET", "/v1/me")).json()).toMatchObject({ id: me.id });
  });

  it("recusa retorno com state diferente do cookie (CSRF no OAuth)", async () => {
    const b = browser();
    await b.request("GET", "/v1/auth/google");
    const res = await b.request("GET", "/v1/auth/google/callback?code=codigo-valido&state=forjado");
    expect(res.headers.location).toBe("http://localhost:3000/entrar?erro=google_sessao_expirada");
    expect(b.cookies.has("__Host-sid")).toBe(false);
  });

  it("não vincula a uma conta com senha que ainda não confirmou o e-mail", async () => {
    const { email } = await legacyUnverified();
    env.google.profile = { sub: `sub-${++seq}`, email, emailVerified: true, name: "Invasor" };
    const res = await googleLogin(browser());
    expect(res.headers.location).toBe("http://localhost:3000/entrar?erro=conta_nao_verificada");
  });

  it("vincula a uma conta com e-mail confirmado e entra nela", async () => {
    const { email, me } = await registered();
    env.google.profile = { sub: `sub-${++seq}`, email, emailVerified: true, name: "Ana" };
    const b = browser();
    await googleLogin(b);
    expect((await b.request("GET", "/v1/me")).json()).toMatchObject({
      id: me.id,
      hasPassword: true,
    });
  });
});

describe("exclusão de conta sem senha (link por e-mail)", () => {
  it("exclui só depois de abrir o link enviado ao e-mail da conta", async () => {
    const { b, email, me } = await passwordless();

    // Sem senha, digitar qualquer coisa não basta: precisa do link.
    const guess = await b.request("DELETE", "/v1/me", { password: "qualquer-coisa-123" });
    expect(guess.statusCode).toBe(400);
    expect(problem(guess).code).toBe("INVALID_TOKEN");

    expect((await b.request("POST", "/v1/me/delete-request")).statusCode).toBe(202);
    await env.drain();
    const message = env.mail.lastTo(email);
    expect(message?.subject).toBe("Confirme a exclusão da sua conta");
    expect(message?.text).toContain("http://localhost:3000/conta/excluir?token=");
    const token = tokenFromMail(env.mail, email);

    expect((await b.request("DELETE", "/v1/me", { token })).statusCode).toBe(204);
    expect((await b.request("GET", "/v1/me")).statusCode).toBe(401);
    expect(await userCount(email)).toBe("0");
    expect(me.hasPassword).toBe(false);
  });

  it("o link de uma conta não exclui outra", async () => {
    const vitima = await passwordless();
    const atacante = await passwordless();
    await atacante.b.request("POST", "/v1/me/delete-request");
    await env.drain();
    const tokenDoAtacante = tokenFromMail(env.mail, atacante.email);

    const res = await vitima.b.request("DELETE", "/v1/me", { token: tokenDoAtacante });
    expect(res.statusCode).toBe(400);
    expect((await vitima.b.request("GET", "/v1/me")).statusCode).toBe(200);
  });

  it("o link vale 15 minutos", async () => {
    const { b, email } = await passwordless();
    await b.request("POST", "/v1/me/delete-request");
    await env.drain();
    const token = tokenFromMail(env.mail, email);
    await env.db.admin.query(
      "update app.auth_tokens set created_at = now() - interval '16 minutes', expires_at = now() - interval '1 minute' where purpose = 'delete_account' and email = $1",
      [email],
    );
    expect((await b.request("DELETE", "/v1/me", { token })).statusCode).toBe(400);
    expect((await b.request("GET", "/v1/me")).statusCode).toBe(200);
  });

  it("conta com senha confirma pela senha, não por link", async () => {
    const { b } = await registered();
    const res = await b.request("POST", "/v1/me/delete-request");
    expect(res.statusCode).toBe(409);
    expect(problem(res).code).toBe("HAS_PASSWORD");
  });
});
