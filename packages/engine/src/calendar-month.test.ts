import { describe, expect, it } from "vitest";
import { isoWeekday, monthGrid, monthRange, shiftMonth } from "./calendar";
import { localParts, zonedTimeToUtc } from "./timezone";

describe("grade do mês (segunda a domingo)", () => {
  it("novembro de 2026: começa no domingo, a grade abre na segunda anterior", () => {
    const g = monthGrid("2026-11");
    expect(g.first).toBe("2026-11-01");
    expect(isoWeekday(g.first)).toBe(7);
    expect(g.gridFrom).toBe("2026-10-26");
    expect(g.gridTo).toBe("2026-12-06");
    expect(g.weeks).toHaveLength(6);
    expect(g.weeks.every((w) => w.length === 7 && isoWeekday(w[0]!) === 1)).toBe(true);
  });

  it("fevereiro de 2027 começando na segunda cabe em 4 semanas; 2028 é bissexto", () => {
    expect(monthGrid("2027-02").weeks).toHaveLength(4);
    expect(monthRange("2028-02").last).toBe("2028-02-29");
    expect(monthRange("2027-02").last).toBe("2027-02-28");
  });

  it("todos os meses de 2026 a 2030: dias contínuos, todos os dias do mês presentes", () => {
    for (let m = "2026-01"; m <= "2030-12"; m = shiftMonth(m, 1)) {
      const g = monthGrid(m);
      const days = g.weeks.flat();
      expect(days[0]).toBe(g.gridFrom);
      expect(days.at(-1)).toBe(g.gridTo);
      expect(days).toContain(g.first);
      expect(days).toContain(g.last);
      expect(days.length % 7).toBe(0);
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("andar meses vira o ano nos dois sentidos", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", -13)).toBe("2025-10");
  });
});

describe("fuso nas bordas do dia", () => {
  it("23:59 de domingo em São Paulo é segunda em UTC, mas o dia local continua domingo", () => {
    const due = zonedTimeToUtc("2026-11-29", "23:59", "America/Sao_Paulo");
    expect(due.toISOString()).toBe("2026-11-30T02:59:00.000Z");
    expect(localParts(due, "America/Sao_Paulo")).toMatchObject({
      date: "2026-11-29",
      time: "23:59",
      weekday: 7,
    });
  });

  it("00:00 de segunda fica na segunda", () => {
    const due = zonedTimeToUtc("2026-11-30", "00:00", "America/Sao_Paulo");
    expect(localParts(due, "America/Sao_Paulo").date).toBe("2026-11-30");
  });

  it("fuso com horário de verão (Nova York, troca em 1º/11/2026) mantém a hora local", () => {
    for (const [date, time] of [
      ["2026-10-31", "23:59"],
      ["2026-11-01", "23:59"],
      ["2026-11-02", "08:00"],
    ] as const) {
      const instant = zonedTimeToUtc(date, time, "America/New_York");
      expect(localParts(instant, "America/New_York")).toMatchObject({ date, time });
    }
  });
});
