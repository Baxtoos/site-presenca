import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "./next-path";

describe("safeNext", () => {
  it.each([
    ["/importar/ABCD2345", "/importar/ABCD2345"],
    ["/hoje?data=2026-11-18", "/hoje?data=2026-11-18"],
  ])("aceita caminho interno %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    "https://malicioso.exemplo/",
    "//malicioso.exemplo/x",
    "/\\malicioso.exemplo",
    "javascript:alert(1)",
    "importar/ABCD",
    "",
  ])("recusa %s", (input) => {
    expect(safeNext(input)).toBeNull();
  });

  it("ignora listas e ausência", () => {
    expect(safeNext(["/a", "/b"])).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  it("withNext codifica o destino", () => {
    expect(withNext("/entrar", "/importar/AB12CD34")).toBe("/entrar?next=%2Fimportar%2FAB12CD34");
    expect(withNext("/entrar", null)).toBe("/entrar");
  });
});
