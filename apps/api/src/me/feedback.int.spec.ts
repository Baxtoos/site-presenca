import { problemSchema } from "@presenca/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthTestEnv,
  Browser,
  registerAndConfirm,
  startAuthTestEnv,
} from "../test/auth-harness";

let env: AuthTestEnv;
beforeAll(async () => {
  env = await startAuthTestEnv();
});
afterAll(async () => {
  await env?.stop();
});

let seq = 0;
async function student() {
  const b = new Browser(env.app);
  const email = `sugestao.${Date.now()}.${++seq}@exemplo.com`;
  await registerAndConfirm(env, b, {
    email,
    password: "senha-forte-das-sugestoes",
    fullName: "Lia <b>Sugere</b>",
  });
  return { b, email };
}

describe("sugestões e problemas", () => {
  it("vira um e-mail para o responsável, com responder para o aluno", async () => {
    const { b, email } = await student();
    const res = await b.request(
      "POST",
      "/v1/feedback",
      { kind: "problema", message: "A aula de Cálculo\naparece no dia errado <script>." },
      { headers: { "user-agent": "Navegador de Teste" } },
    );
    expect(res.statusCode).toBe(202);
    await env.drain();
    const mail = env.mail.lastTo("dono@exemplo.com");
    expect(mail?.subject).toBe("[Problema] A aula de Cálculo");
    expect(mail?.replyTo).toBe(email);
    expect(mail?.text).toContain("aparece no dia errado");
    expect(mail?.text).toContain("Navegador de Teste");
    expect(mail?.html).not.toContain("<script>");
    expect(mail?.html).not.toContain("<b>Sugere</b>");
  });

  it("recusa mensagem curta demais e pede login", async () => {
    const { b } = await student();
    const short = await b.request("POST", "/v1/feedback", { kind: "sugestao", message: "oi" });
    expect(short.statusCode).toBe(422);
    expect(problemSchema.parse(short.json()).errors?.[0]?.path).toBe("message");
    const anon = await new Browser(env.app).request("POST", "/v1/feedback", {
      kind: "sugestao",
      message: "Uma sugestão sem estar logado.",
    });
    expect(anon.statusCode).toBe(401);
  });

  it("no máximo 5 por hora por pessoa", async () => {
    const { b } = await student();
    for (let i = 0; i < 5; i++) {
      const ok = await b.request("POST", "/v1/feedback", {
        kind: "outro",
        message: `Mensagem número ${i + 1} de teste.`,
      });
      expect(ok.statusCode).toBe(202);
    }
    const sixth = await b.request("POST", "/v1/feedback", {
      kind: "outro",
      message: "Mensagem número 6 de teste.",
    });
    expect(sixth.statusCode).toBe(429);
  });
});
