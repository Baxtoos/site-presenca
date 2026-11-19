import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readSpreadsheet } from "./spreadsheet-import";

/**
 * Planilha de verdade, baixada da API no teste de integração (spreadsheet-import.int.spec.ts):
 * semestre 2026.1 com Cálculo II (carga horária, roxa, 2 horários) e Laboratório de Redes
 * (limite manual de 4, atestado desconta), feriado de Tiradentes e 8 registros de todo tipo.
 */
const FIXTURE = readFileSync(new URL("./__fixtures__/semestre-exportado.xlsx", import.meta.url));

const toArrayBuffer = (buf: Buffer | ArrayBuffer): ArrayBuffer =>
  buf instanceof ArrayBuffer
    ? buf
    : (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);

/** Abre a planilha, aplica a mudança e devolve o arquivo novo. */
async function edited(change: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(FIXTURE));
  change(wb);
  return toArrayBuffer(await wb.xlsx.writeBuffer());
}

describe("readSpreadsheet", () => {
  it("planilha nova: lê tudo da aba oculta, exatamente", async () => {
    const r = await readSpreadsheet(toArrayBuffer(FIXTURE));
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toBe("completa");
    expect(r.warnings).toEqual([]);
    expect(r.body.semester).toEqual({
      label: "2026.1",
      startsOn: "2026-03-02",
      endsOn: "2026-07-10",
    });
    expect(r.body.subjects.map((s) => s.name)).toEqual(["Cálculo II", "Laboratório de Redes"]);
    expect(r.body.exceptions).toHaveLength(1);
    expect(r.body.attendance).toHaveLength(8);
    expect(r.body.attendance.map((a) => a.status).sort()).toEqual([
      "absent",
      "absent",
      "absent",
      "absent",
      "absent",
      "cancelled",
      "partial",
      "present",
    ]);
  });

  it("planilha nova editada no Excel: avisa que o Histórico mudou e usa os dados originais", async () => {
    const file = await edited((wb) => wb.getWorksheet("Historico")!.spliceRows(2, 1));
    const r = await readSpreadsheet(file);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toBe("completa");
    expect(r.body.attendance).toHaveLength(8);
    expect(r.warnings).toEqual([expect.stringMatching(/Histórico tem 5 faltas.*original tem 6/)]);
  });

  it("planilha antiga (sem a aba oculta): monta matérias, grade e faltas pelas abas visíveis", async () => {
    const file = await edited((wb) => wb.removeWorksheet(wb.getWorksheet("Dados")!.id));
    const r = await readSpreadsheet(file);
    if (!r.ok) throw new Error(r.error);
    expect(r.source).toBe("abas");
    expect(r.warnings[0]).toMatch(/não guarda as presenças nem os feriados/);
    // Datas estimadas pelo nome (2026.1 → fevereiro a julho).
    expect(r.body.semester).toEqual({
      label: "2026.1",
      startsOn: "2026-02-02",
      endsOn: "2026-07-03",
    });
    expect(r.body.exceptions).toEqual([]);

    const [calc, lab] = r.body.subjects;
    expect(calc).toMatchObject({
      name: "Cálculo II",
      professor: "Prof. Andrade",
      color: "violet",
      countingMode: "workload",
      workloadHours: 60,
      workloadHourMinutes: 60,
      unitMinutes: 50,
      minAttendanceBp: 7500,
      unitsPerClass: 2,
      excusedPolicy: "track_only",
      schedules: [
        { weekday: 1, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
        { weekday: 3, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
      ],
    });
    expect(lab).toMatchObject({
      name: "Laboratório de Redes",
      professor: null,
      countingMode: "manual",
      manualMaxUnits: 4,
      // A falta "Abonada" mostra que o atestado descontava do limite.
      excusedPolicy: "deduct",
      schedules: [{ weekday: 5, startsAt: "08:00", endsAt: "09:40", units: 2 }],
    });

    // Só faltas (presenças não estão nas abas visíveis), com horário, parcial e aula extra.
    const byDate = Object.fromEntries(r.body.attendance.map((a) => [a.classDate, a]));
    expect(r.body.attendance).toHaveLength(6);
    expect(byDate["2026-03-04"]).toMatchObject({
      subjectIndex: 0,
      scheduleIndex: 1,
      status: "absent",
      reason: "transport",
      note: "Ônibus atrasou",
    });
    expect(byDate["2026-03-09"]).toMatchObject({
      scheduleIndex: 0,
      status: "partial",
      unitsMissed: 1,
    });
    expect(byDate["2026-03-14"]).toMatchObject({
      scheduleIndex: null,
      status: "absent",
      unitsScheduled: 3,
    });
    expect(byDate["2026-03-06"]).toMatchObject({
      subjectIndex: 1,
      scheduleIndex: 0,
      isExcused: true,
      reason: "health",
    });
  });

  it("recusa arquivo que não é a planilha do app", async () => {
    const other = new ExcelJS.Workbook();
    other.addWorksheet("Planilha1").getCell("A1").value = "qualquer coisa";
    const r = await readSpreadsheet(toArrayBuffer(await other.xlsx.writeBuffer()));
    expect(r).toEqual({
      ok: false,
      foreign: true,
      error: expect.stringMatching(/não parece ter sido exportada/),
    });

    const notXlsx = await readSpreadsheet(new TextEncoder().encode("a,b,c\n1,2,3").buffer);
    expect(notXlsx).toEqual({
      ok: false,
      error: expect.stringMatching(/precisa ser uma planilha/),
    });
  });

  it("aba oculta corrompida: cai para as abas visíveis", async () => {
    const file = await edited((wb) => {
      wb.getWorksheet("Dados")!.getCell("A2").value = "{quebrado";
    });
    const r = await readSpreadsheet(file);
    expect(r.ok && r.source).toBe("abas");
  });
});
