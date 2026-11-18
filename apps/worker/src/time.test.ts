import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  inQuietWindow,
  localParts,
  quietWindowEnd,
  retryDelayMs,
  zonedTimeToUtc,
} from "./time";

describe("localParts", () => {
  it("converte para o relógio do aluno", () => {
    const instant = new Date("2026-11-18T23:30:00Z");
    expect(localParts(instant, "America/Sao_Paulo")).toEqual({
      date: "2026-11-18",
      time: "20:30",
      minutes: 20 * 60 + 30,
      weekday: 3,
    });
    // Em Tóquio já é quinta de manhã.
    expect(localParts(instant, "Asia/Tokyo")).toMatchObject({
      date: "2026-11-19",
      time: "08:30",
      weekday: 4,
    });
  });

  it("meia-noite é 00:00 (não 24:00)", () => {
    expect(localParts(new Date("2026-11-19T03:00:00Z"), "America/Sao_Paulo").time).toBe("00:00");
  });

  it("fuso inválido cai no padrão do app em vez de quebrar", () => {
    expect(localParts(new Date("2026-11-18T15:00:00Z"), "Lugar/Inexistente").time).toBe("12:00");
  });
});

describe("zonedTimeToUtc", () => {
  it("acha o instante de um horário local", () => {
    expect(zonedTimeToUtc("2026-11-18", "07:00", "America/Sao_Paulo").toISOString()).toBe(
      "2026-11-18T10:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-11-18", "07:00", "Asia/Tokyo").toISOString()).toBe(
      "2026-11-17T22:00:00.000Z",
    );
  });

  it("respeita horário de verão (Nova York em julho e em dezembro)", () => {
    expect(zonedTimeToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-12-01", "09:00", "America/New_York").toISOString()).toBe(
      "2026-12-01T14:00:00.000Z",
    );
  });

  it("ida e volta com localParts", () => {
    for (const tz of ["America/Sao_Paulo", "Europe/Lisbon", "Asia/Kolkata", "Pacific/Auckland"]) {
      const instant = zonedTimeToUtc("2026-03-15", "13:45", tz);
      expect(localParts(instant, tz)).toMatchObject({ date: "2026-03-15", time: "13:45" });
    }
  });
});

describe("horário silencioso", () => {
  it("janela no mesmo dia e janela que vira a noite", () => {
    expect(inQuietWindow(13 * 60, "12:00", "14:00")).toBe(true);
    expect(inQuietWindow(14 * 60, "12:00", "14:00")).toBe(false);
    expect(inQuietWindow(23 * 60, "22:00", "07:00")).toBe(true);
    expect(inQuietWindow(3 * 60, "22:00", "07:00")).toBe(true);
    expect(inQuietWindow(7 * 60, "22:00", "07:00")).toBe(false);
    expect(inQuietWindow(12 * 60, "22:00", "07:00")).toBe(false);
  });

  it("fim do silêncio: mesma madrugada ou dia seguinte", () => {
    // 23:30 em São Paulo (02:30Z do dia 19) → acaba às 07:00 do dia 19.
    expect(
      quietWindowEnd(new Date("2026-11-19T02:30:00Z"), "America/Sao_Paulo", "07:00").toISOString(),
    ).toBe("2026-11-19T10:00:00.000Z");
    // 03:00 em São Paulo (06:00Z do dia 19) → acaba às 07:00 do mesmo dia 19.
    expect(
      quietWindowEnd(new Date("2026-11-19T06:00:00Z"), "America/Sao_Paulo", "07:00").toISOString(),
    ).toBe("2026-11-19T10:00:00.000Z");
  });
});

describe("retentativas", () => {
  it("dobra a espera até o teto de 6 h", () => {
    expect([1, 2, 3, 4, 5].map((a) => retryDelayMs(a) / 60_000)).toEqual([1, 2, 4, 8, 16]);
    expect(retryDelayMs(30)).toBe(6 * 60 * 60_000);
  });

  it("addDaysIso atravessa meses e anos", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });
});
