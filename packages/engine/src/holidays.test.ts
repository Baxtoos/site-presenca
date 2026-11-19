import { describe, expect, it } from "vitest";
import { brazilHolidays, brazilHolidaysBetween, easterSunday } from "./holidays";

describe("feriados nacionais", () => {
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"],
  ])("Páscoa de %i é %s", (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });

  it("2026: datas móveis a partir da Páscoa", () => {
    const byLabel = new Map(brazilHolidays(2026).map((h) => [h.label, h]));
    expect(byLabel.get("Carnaval")).toEqual({
      startsOn: "2026-02-16",
      endsOn: "2026-02-17",
      label: "Carnaval",
      optional: true,
    });
    expect(byLabel.get("Sexta-feira Santa")?.startsOn).toBe("2026-04-03");
    expect(byLabel.get("Corpus Christi")).toMatchObject({ startsOn: "2026-06-04", optional: true });
    expect(byLabel.get("Tiradentes")).toMatchObject({ startsOn: "2026-04-21", optional: false });
  });

  it("Consciência Negra é feriado nacional a partir de 2024", () => {
    expect(brazilHolidays(2023).some((h) => h.startsOn === "2023-11-20")).toBe(false);
    expect(brazilHolidays(2024).some((h) => h.startsOn === "2024-11-20")).toBe(true);
  });

  it("filtra o período do semestre, inclusive virando o ano", () => {
    expect(brazilHolidaysBetween("2026-08-03", "2026-12-18").map((h) => h.label)).toEqual([
      "Independência do Brasil",
      "Nossa Senhora Aparecida",
      "Finados",
      "Proclamação da República",
      "Dia de Zumbi e da Consciência Negra",
    ]);
    expect(brazilHolidaysBetween("2026-12-20", "2027-01-10").map((h) => h.startsOn)).toEqual([
      "2026-12-25",
      "2027-01-01",
    ]);
    // Carnaval de dois dias entra se um dos dias cair no período.
    expect(brazilHolidaysBetween("2026-02-17", "2026-03-01").map((h) => h.label)).toEqual([
      "Carnaval",
    ]);
  });
});
