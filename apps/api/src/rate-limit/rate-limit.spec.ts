import { describe, expect, it } from "vitest";
import { formatWait } from "./rate-limit";

describe("formatWait", () => {
  it("usa segundos abaixo de 1 minuto e minutos (para cima) a partir daí", () => {
    expect(formatWait(1)).toBe("1 segundo");
    expect(formatWait(45)).toBe("45 segundos");
    expect(formatWait(60)).toBe("1 minuto");
    expect(formatWait(61)).toBe("2 minutos");
    expect(formatWait(420)).toBe("7 minutos");
  });
});
