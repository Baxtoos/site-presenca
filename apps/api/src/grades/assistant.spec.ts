import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env";
import { AI_TURN_JSON_SCHEMA, gradingAiFactory } from "./assistant.service";

// Palavras do JSON Schema que o responseJsonSchema do Gemini aceita (tipos do @google/genai 3.6).
const GEMINI_KEYWORDS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

function keywords(node: unknown, out = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return out;
  const s = node as Record<string, unknown>;
  for (const k of Object.keys(s)) out.add(k);
  for (const child of Object.values(s.properties ?? {})) keywords(child, out);
  for (const k of ["items", "additionalProperties"])
    if (typeof s[k] === "object") keywords(s[k], out);
  for (const k of ["anyOf", "oneOf", "prefixItems"])
    if (Array.isArray(s[k])) for (const c of s[k]) keywords(c, out);
  return out;
}

describe("formato pedido ao Gemini", () => {
  it("usa só palavras do JSON Schema que o Gemini aceita", () => {
    const unsupported = [...keywords(AI_TURN_JSON_SCHEMA)].filter((k) => !GEMINI_KEYWORDS.has(k));
    expect(unsupported).toEqual([]);
    expect(AI_TURN_JSON_SCHEMA).toMatchObject({ type: "object" });
  });
});

describe("cliente do Gemini", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { GEMINI_API_KEY: "chave-falsa", GRADING_AI_MODEL: "gemini-teste" } as Env;
  const reply = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("sem chave fica desligado", () => {
    expect(gradingAiFactory({ ...env, GEMINI_API_KEY: undefined })).toBeNull();
  });

  it("manda sistema, histórico (assistant → model) e o schema; lê o JSON sem os pensamentos", async () => {
    const fetchMock = reply({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ text: "pensando…", thought: true }, { text: '{"kind":"question"}' }],
          },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await gradingAiFactory(env)!.generate({
      system: "regras",
      messages: [
        { role: "user", content: "oi" },
        { role: "assistant", content: "olá" },
      ],
      schema: { type: "object" },
    });
    expect(out).toEqual({ kind: "question" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-teste:generateContent",
    );
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("chave-falsa");
    expect(JSON.parse(init.body as string)).toMatchObject({
      systemInstruction: { parts: [{ text: "regras" }] },
      contents: [
        { role: "user", parts: [{ text: "oi" }] },
        { role: "model", parts: [{ text: "olá" }] },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object" },
      },
    });
  });

  it.each([
    ["bloqueado (sem candidato)", { promptFeedback: { blockReason: "SAFETY" } }],
    ["parado por segurança", { candidates: [{ finishReason: "SAFETY" }] }],
    [
      "cortado",
      { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"ki' }] } }] },
    ],
    [
      "texto que não é JSON",
      { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "oi" }] } }] },
    ],
  ])("%s → null (a tela cai no editor)", async (_, body) => {
    vi.stubGlobal("fetch", reply(body));
    await expect(
      gradingAiFactory(env)!.generate({ system: "", messages: [], schema: {} }),
    ).resolves.toBeNull();
  });

  it("erro HTTP vira exceção (o serviço devolve fallback)", async () => {
    vi.stubGlobal("fetch", reply({ error: {} }, 429));
    await expect(
      gradingAiFactory(env)!.generate({ system: "", messages: [], schema: {} }),
    ).rejects.toThrow("429");
  });
});
