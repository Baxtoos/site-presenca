import { describe, expect, it } from "vitest";
import { localDate } from "./clock";
import { parseIdempotencyKey, stableStringify } from "./idempotency";

describe("stableStringify", () => {
  it("ignora a ordem das chaves, em qualquer nível", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      stableStringify({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
  });

  it("trata undefined como ausente, mas null como valor", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify({ a: 1, b: null })).not.toBe(stableStringify({ a: 1 }));
  });

  it("corpos diferentes geram strings diferentes", () => {
    expect(stableStringify({ status: "absent" })).not.toBe(stableStringify({ status: "present" }));
  });
});

function failure(fn: () => unknown): { status: number; body: Record<string, unknown> } {
  try {
    fn();
  } catch (error) {
    const e = error as { getStatus: () => number; getResponse: () => Record<string, unknown> };
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error("esperava um erro");
}

describe("parseIdempotencyKey", () => {
  it("aceita UUID e chaves simples", () => {
    expect(parseIdempotencyKey("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    );
    expect(parseIdempotencyKey(" abc12345 ")).toBe("abc12345");
  });

  it.each([undefined, "", "   "])("sem cabeçalho (%j): 428 com código estável", (header) => {
    const { status, body } = failure(() => parseIdempotencyKey(header));
    expect(status).toBe(428);
    expect(body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it.each(["curta", "tem espaço no meio", "x".repeat(129), "a/b/c/d/e/f"])(
    "recusa %j com 400",
    (key) => {
      const { status, body } = failure(() => parseIdempotencyKey(key));
      expect(status).toBe(400);
      expect(String(body.detail)).toContain("inválida");
    },
  );

  it("cabeçalho repetido é recusado", () => {
    expect(failure(() => parseIdempotencyKey(["abc12345", "def67890"])).status).toBe(400);
  });
});

describe("localDate", () => {
  it("usa o dia do fuso do aluno, não o do servidor", () => {
    const instant = new Date("2026-11-18T02:30:00Z");
    expect(localDate(instant, "America/Sao_Paulo")).toBe("2026-11-17");
    expect(localDate(instant, "Europe/Lisbon")).toBe("2026-11-18");
    expect(localDate(instant, "Asia/Tokyo")).toBe("2026-11-18");
  });

  it("fuso inválido cai para UTC em vez de quebrar", () => {
    expect(localDate(new Date("2026-11-18T23:00:00Z"), "Marte/Base")).toBe("2026-11-18");
  });
});
