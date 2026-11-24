import {
  createTaskBodySchema,
  taskListQuerySchema,
  updateTaskBodySchema,
} from "@presenca/contracts";
import { describe, expect, it } from "vitest";
import { decodeTaskCursor, encodeTaskCursor } from "./tasks.service";

const base = { title: "Lista 3", dueAt: "2026-11-30T23:59" };

describe("contratos de tarefas", () => {
  it("antecedência: padrão 24 h, null desliga o aviso, fora da lista recusa", () => {
    expect(createTaskBodySchema.parse(base).remindBeforeMinutes).toBe(1440);
    expect(
      createTaskBodySchema.parse({ ...base, remindBeforeMinutes: null }).remindBeforeMinutes,
    ).toBeNull();
    expect(createTaskBodySchema.safeParse({ ...base, remindBeforeMinutes: 45 }).success).toBe(
      false,
    );
    expect(updateTaskBodySchema.parse({ remindBeforeMinutes: null })).toEqual({
      remindBeforeMinutes: null,
    });
  });

  it.each([
    ["https://moodle.exemplo.edu.br/mod/assign/view.php?id=1", true],
    ["  https://ava.exemplo.com/atividade  ", true],
    ["http://moodle.exemplo.edu.br/a", false],
    ["javascript:alert(1)", false],
    ["https://localhost/a", false],
    ["https://192.168.0.1/a", false],
    [`https://exemplo.com/${"a".repeat(2000)}`, false],
  ])("link da atividade %s → aceito: %s", (externalUrl, ok) => {
    const parsed = createTaskBodySchema.safeParse({ ...base, externalUrl });
    expect(parsed.success).toBe(ok);
    if (ok) expect(parsed.data?.externalUrl).toBe(externalUrl.trim());
  });

  it("link vazio vira null (para tirar o link numa edição)", () => {
    expect(updateTaskBodySchema.parse({ externalUrl: "" })).toEqual({ externalUrl: null });
  });

  it("intervalo de datas: até 400 dias e na ordem certa", () => {
    expect(taskListQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-30" }).success).toBe(
      true,
    );
    expect(taskListQuerySchema.safeParse({ from: "2026-11-30", to: "2026-11-01" }).success).toBe(
      false,
    );
    expect(taskListQuerySchema.safeParse({ from: "2026-01-01", to: "2027-02-05" }).success).toBe(
      false,
    );
    expect(taskListQuerySchema.safeParse({ from: "30/11/2026" }).success).toBe(false);
  });

  it("cursor: ida e volta; lixo é recusado", () => {
    const id = "01a20ab4-4a44-7eee-bcd5-9288a954bc90";
    const cursor = encodeTaskCursor("2026-11-30T02:59:00.000Z", id);
    expect(decodeTaskCursor(cursor)).toEqual({ dueAt: "2026-11-30T02:59:00.000Z", id });
    expect(decodeTaskCursor("bGl4bw")).toBeUndefined();
  });
});
