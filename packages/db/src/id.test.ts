import { describe, expect, it } from "vitest";
import { newId } from "./id";

describe("newId", () => {
  it("gera UUID v7 válido", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("é ordenável por tempo", () => {
    const a = newId(1_700_000_000_000);
    const b = newId(1_700_000_000_001);
    expect(b > a).toBe(true);
  });

  it("não repete", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId(1)));
    expect(ids.size).toBe(1000);
  });
});
