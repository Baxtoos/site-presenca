import { describe, expect, it } from "vitest";
import { dayLong, monthLong, taskTone, todayIn, windowRange } from "./calendar";
import { isoDateParam, taskReturnPath } from "./tasks";

describe("janelas da linha do tempo", () => {
  const today = "2026-11-29";
  it.each([
    ["hoje", "2026-11-29", "2026-11-29"],
    ["7", "2026-11-29", "2026-12-05"],
    ["30", "2026-11-29", "2026-12-28"],
    ["atrasadas", "2025-10-26", "2026-11-29"],
    ["todas", "2026-05-13", "2027-06-16"],
  ] as const)("%s → %s a %s (dentro do limite de 400 dias)", (window, from, to) => {
    const range = windowRange(window, today);
    expect(range).toEqual({ from, to });
    expect((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000).toBeLessThan(400);
  });
});

describe("estado da tarefa", () => {
  it("pendente no prazo, atrasada, concluída e não concluída", () => {
    expect(taskTone({ status: "pending", overdue: false })).toBe("pending");
    expect(taskTone({ status: "pending", overdue: true })).toBe("overdue");
    expect(taskTone({ status: "completed", overdue: false })).toBe("completed");
    expect(taskTone({ status: "not_completed", overdue: false })).toBe("not_completed");
  });
});

describe("datas por extenso", () => {
  it("dia e mês em português, sem escorregar de dia por fuso", () => {
    expect(dayLong("2026-11-29")).toBe("domingo, 29 de novembro de 2026");
    expect(monthLong("2026-11")).toBe("novembro de 2026");
  });
  it("hoje no fuso da conta (23:30 em São Paulo ainda é o mesmo dia)", () => {
    expect(todayIn("America/Sao_Paulo", new Date("2026-11-30T02:30:00Z"))).toBe("2026-11-29");
    expect(todayIn("Fuso/Inexistente", new Date("2026-11-30T02:30:00Z"))).toBe("2026-11-29");
  });
});

describe("volta do formulário de tarefa", () => {
  it.each([
    ["/calendario?janela=30&mes=2026-12", "/calendario?janela=30&mes=2026-12"],
    ["/tarefas", "/tarefas"],
    ["/tarefas?status=completed", "/tarefas?status=completed"],
    ["/conta", "/calendario"],
    ["https://malicioso.exemplo/calendario", "/calendario"],
    ["//malicioso.exemplo", "/calendario"],
    ["/calendariox", "/calendario"],
    [undefined, "/calendario"],
  ])("%s → %s", (input, expected) => {
    expect(taskReturnPath(input)).toBe(expected);
  });

  it("data inicial só no formato AAAA-MM-DD", () => {
    expect(isoDateParam("2026-11-30")).toBe("2026-11-30");
    expect(isoDateParam("30/11/2026")).toBeUndefined();
    expect(isoDateParam(["2026-11-30"])).toBeUndefined();
  });
});
