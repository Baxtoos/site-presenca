import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  SPREADSHEET_CHUNK,
  SPREADSHEET_DATA_SHEET,
  SPREADSHEET_FORMAT,
  SUBJECT_COLORS,
  type SpreadsheetData,
  spreadsheetDataSchema,
} from "@presenca/contracts";
import { schema } from "@presenca/db";
import { isoWeekday, summarize } from "@presenca/engine";
import { and, asc, eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { DbService } from "../database/db.service";
import { subjectToTemplate } from "../sharing/sharing.mapper";
import { NO_ATTENDANCE, rulesFromRow } from "./mappers";

const WEEKDAY_NAMES: Record<number, string> = {
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
  7: "Domingo",
};

const REASON_LABELS: Record<string, string> = {
  health: "Saúde",
  transport: "Transporte",
  work: "Trabalho",
  personal: "Pessoal",
  academic: "Acadêmico",
  other: "Outro",
};

/** Tipado pelas cores do contrato: uma cor nova ou renomeada quebra a compilação aqui. */
const SUBJECT_TINTS: Record<(typeof SUBJECT_COLORS)[number], string> = {
  blue: "FFE2ECF5",
  teal: "FFDDF2EE",
  green: "FFE1F2E7",
  amber: "FFFBF1CF",
  orange: "FFFBE5D6",
  rose: "FFF8DEDB",
  violet: "FFEDE4F7",
  slate: "FFEEF2F6",
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD9E0E8" } },
  bottom: { style: "thin", color: { argb: "FFD9E0E8" } },
  left: { style: "thin", color: { argb: "FFD9E0E8" } },
  right: { style: "thin", color: { argb: "FFD9E0E8" } },
};

function statusLabelForFormula(
  unitsCounted: number,
  maxAbsenceUnits: number,
  consumptionRatio: number,
): string {
  if (unitsCounted > maxAbsenceUnits) return "Reprovado";
  if (unitsCounted === maxAbsenceUnits) return "Limite atingido";
  if (consumptionRatio >= 0.75) return "Crítico";
  if (consumptionRatio >= 0.5) return "Atenção";
  return "Seguro";
}

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function autoFitColumns(sheet: ExcelJS.Worksheet, maxCol: number, minWidth = 11, maxWidth = 38) {
  for (let colIdx = 1; colIdx <= maxCol; colIdx++) {
    const col = sheet.getColumn(colIdx);
    let longest = minWidth;
    col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      // Ignora títulos mesclados nas duas primeiras linhas.
      if (rowNumber <= 2 && sheet.name === "Resumo") return;
      const val = cell.value;
      let text = "";
      if (val === null || val === undefined) {
        text = "";
      } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        text = String(val);
      } else if (val instanceof Date) {
        text = "00/00/0000";
      } else if (typeof val === "object" && "result" in val) {
        const res = val.result;
        text =
          typeof res === "string" || typeof res === "number" || typeof res === "boolean"
            ? String(res)
            : "";
      }
      for (const line of text.split("\n")) {
        if (line.length + 3 > longest) longest = line.length + 3;
      }
    });
    col.width = Math.min(maxWidth, Math.max(minWidth, longest));
  }
}

export interface GeneratedExcel {
  buffer: Buffer;
  filename: string;
}

@Injectable()
export class ExcelExportService {
  private readonly logger = new Logger(ExcelExportService.name);

  constructor(private readonly db: DbService) {}

  async exportSemester(semesterId: string): Promise<GeneratedExcel> {
    const data = await this.db.tx(async (tx) => {
      const user = await tx.query.users.findFirst();
      const semester = await tx.query.semesters.findFirst({
        where: eq(schema.semesters.id, semesterId),
      });
      if (!user || !semester) throw new NotFoundException({ detail: "Semestre não encontrado." });

      const subjects = await tx
        .select()
        .from(schema.subjects)
        .where(eq(schema.subjects.semesterId, semesterId))
        .orderBy(asc(schema.subjects.name));

      const subjectIds = subjects.map((s) => s.id);
      if (subjectIds.length === 0) {
        return {
          user,
          semester,
          subjects,
          schedules: [],
          totalsRows: [],
          logs: [],
          allLogs: [],
          exceptions: [],
        };
      }

      const schedules = await tx
        .select()
        .from(schema.subjectSchedules)
        .where(inArray(schema.subjectSchedules.subjectId, subjectIds))
        .orderBy(asc(schema.subjectSchedules.startsAt), asc(schema.subjectSchedules.weekday));

      const totalsRows = await tx
        .select()
        .from(schema.subjectTotals)
        .where(inArray(schema.subjectTotals.subjectId, subjectIds));

      const logs = await tx
        .select()
        .from(schema.attendanceLogs)
        .where(
          and(
            inArray(schema.attendanceLogs.subjectId, subjectIds),
            inArray(schema.attendanceLogs.status, ["absent", "partial"]),
          ),
        )
        .orderBy(asc(schema.attendanceLogs.classDate), asc(schema.attendanceLogs.createdAt));

      // Para a aba oculta "Dados" (reimportar a planilha): todos os registros e os feriados.
      const allLogs = await tx
        .select()
        .from(schema.attendanceLogs)
        .where(inArray(schema.attendanceLogs.subjectId, subjectIds))
        .orderBy(asc(schema.attendanceLogs.classDate));
      const exceptions = await tx
        .select()
        .from(schema.calendarExceptions)
        .where(eq(schema.calendarExceptions.semesterId, semesterId))
        .orderBy(asc(schema.calendarExceptions.startsOn));

      return { user, semester, subjects, schedules, totalsRows, logs, allLogs, exceptions };
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Monitor de Presenças";
    workbook.created = new Date();

    const totalsBySubject = new Map(
      data.totalsRows.map((t) => [
        t.subjectId,
        {
          unitsCounted: t.unitsCounted,
          unitsExcused: t.unitsExcused,
          unitsHeld: t.unitsHeld,
        },
      ]),
    );
    const subjectById = new Map(data.subjects.map((s) => [s.id, s]));

    // =========================================================================
    // Aba 1: Resumo
    // =========================================================================
    const resumo = workbook.addWorksheet("Resumo", {
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
      },
      views: [{ state: "frozen", ySplit: 4 }],
    });

    resumo.mergeCells("A1:L1");
    const titleCell = resumo.getCell("A1");
    titleCell.value = `Relatório de Frequência · ${data.semester.label}`;
    titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5C8C" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    resumo.getRow(1).height = 28;

    const todayBr = formatBrDate(new Date().toISOString().slice(0, 10));
    resumo.mergeCells("A2:F2");
    resumo.mergeCells("G2:L2");
    const studentCell = resumo.getCell("A2");
    studentCell.value = `Aluno: ${data.user.fullName}${data.user.course ? ` · ${data.user.course}` : ""}`;
    studentCell.font = { size: 10, color: { argb: "FF15212C" } };
    studentCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F6" } };

    const instCell = resumo.getCell("G2");
    instCell.value = `Faculdade: ${data.user.institution ?? "—"} · Exportado em ${todayBr}`;
    instCell.font = { size: 10, color: { argb: "FF15212C" } };
    instCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F6" } };
    instCell.alignment = { horizontal: "right" };
    resumo.getRow(2).height = 20;

    const headers = [
      "Matéria",
      "Professor",
      "Carga / aulas",
      "Total aulas",
      "Presença mín.",
      "Faltas contab.",
      "Faltas abon.",
      "Limite",
      "Saldo",
      "% presença",
      "Consumo",
      "Status",
      "Minutos totais (aux)",
      "Minutos/aula (aux)",
    ];
    const headerRow = resumo.getRow(4);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: "FF15212C" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E0E8" } };
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: "middle", horizontal: i >= 3 && i <= 10 ? "right" : "left" };
    });
    headerRow.height = 22;
    resumo.getColumn(13).hidden = true;
    resumo.getColumn(14).hidden = true;

    data.subjects.forEach((subject, idx) => {
      const r = 5 + idx;
      const row = resumo.getRow(r);
      const totals = totalsBySubject.get(subject.id) ?? NO_ATTENDANCE;
      const summary = summarize(rulesFromRow(subject), totals);
      const totalUnits = summary.totalUnits ?? 0;
      const minPct = subject.minAttendanceBp / 10_000;
      const consumptionRatio =
        summary.maxAbsenceUnits === 0
          ? summary.absentUnits > 0
            ? 1
            : 0
          : summary.absentUnits / summary.maxAbsenceUnits;
      const presenceRatio =
        totalUnits === 0
          ? 0
          : Math.floor(((totalUnits - summary.absentUnits) / totalUnits) * 1000) / 1000;
      const statusText = statusLabelForFormula(
        summary.absentUnits,
        summary.maxAbsenceUnits,
        consumptionRatio,
      );

      let cargaLabel = "Limite manual";
      let auxTotalMinutes = totalUnits;
      let auxUnitMinutes = 1;
      if (subject.countingMode === "workload") {
        cargaLabel = `${Number(subject.workloadHours)} h`;
        auxTotalMinutes = Number(subject.workloadHours) * (subject.workloadHourMinutes ?? 60);
        auxUnitMinutes = subject.unitMinutes ?? 50;
      } else if (subject.countingMode === "class_count") {
        cargaLabel = `${subject.totalClasses} aulas`;
        auxTotalMinutes = totalUnits;
        auxUnitMinutes = 1;
      }

      row.getCell(1).value = subject.name;
      row.getCell(2).value = subject.professor ?? "—";
      row.getCell(3).value = cargaLabel;
      row.getCell(4).value = totalUnits;
      row.getCell(5).value = minPct;
      row.getCell(5).numFmt = "0%";

      row.getCell(6).value = {
        formula: `SUMIFS(Historico!D:D, Historico!C:C, A${r}, Historico!F:F, "Contabilizada*")`,
        result: summary.absentUnits,
      };
      row.getCell(7).value = {
        formula: `SUMIFS(Historico!D:D, Historico!C:C, A${r}, Historico!F:F, "Abonada")`,
        result: summary.excusedUnits,
      };

      if (subject.countingMode === "manual") {
        row.getCell(8).value = summary.maxAbsenceUnits;
        row.getCell(8).note = "Limite manual definido diretamente na matéria.";
      } else {
        row.getCell(8).value = {
          formula: `ROUNDDOWN(ROUND(M${r}*(1-E${r})/N${r}, 6), 0)`,
          result: summary.maxAbsenceUnits,
        };
      }

      row.getCell(9).value = {
        formula: `H${r}-F${r}`,
        result: summary.remainingUnits,
      };
      row.getCell(10).value = {
        formula: `IF(D${r}=0, 0, ROUNDDOWN((D${r}-F${r})/D${r}, 3))`,
        result: presenceRatio,
      };
      row.getCell(10).numFmt = "0.0%";

      row.getCell(11).value = {
        formula: `IF(H${r}=0, IF(F${r}>0, 1, 0), F${r}/H${r})`,
        result: consumptionRatio,
      };
      row.getCell(11).numFmt = "0%";

      row.getCell(12).value = {
        formula: `IF(F${r}>H${r},"Reprovado",IF(F${r}=H${r},"Limite atingido",IF(K${r}>=0.75,"Crítico",IF(K${r}>=0.5,"Atenção","Seguro"))))`,
        result: statusText,
      };

      row.getCell(13).value = auxTotalMinutes;
      row.getCell(14).value = auxUnitMinutes;

      const isZebra = idx % 2 === 1;
      for (let c = 1; c <= 12; c++) {
        const cell = row.getCell(c);
        cell.border = THIN_BORDER;
        if (isZebra) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6F8" } };
        }
      }
    });

    const lastSubjectRow = Math.max(5, 4 + data.subjects.length);
    if (data.subjects.length > 0) {
      resumo.addConditionalFormatting({
        ref: `J5:L${lastSubjectRow}`,
        rules: [
          {
            type: "expression",
            priority: 1,
            formulae: ['$L5="Reprovado"'],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF8DEDB" } },
              font: { bold: true, color: { argb: "FFAE2A22" } },
            },
          },
          {
            type: "expression",
            priority: 2,
            formulae: ['$L5="Limite atingido"'],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF8DEDB" } },
              font: { bold: true, color: { argb: "FFAE2A22" } },
            },
          },
          {
            type: "expression",
            priority: 3,
            formulae: ['$L5="Crítico"'],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFBE5D6" } },
              font: { bold: true, color: { argb: "FFB8521A" } },
            },
          },
          {
            type: "expression",
            priority: 4,
            formulae: ['$L5="Atenção"'],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFBF1CF" } },
              font: { bold: true, color: { argb: "FF946F00" } },
            },
          },
          {
            type: "expression",
            priority: 5,
            formulae: ['$L5="Seguro"'],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFE1F2E7" } },
              font: { bold: true, color: { argb: "FF2C7A4B" } },
            },
          },
        ],
      });
    }

    // Legenda de cores abaixo da tabela
    const legendRowIdx = lastSubjectRow + 2;
    resumo.mergeCells(`A${legendRowIdx}:L${legendRowIdx}`);
    const legendCell = resumo.getCell(`A${legendRowIdx}`);
    legendCell.value =
      "Legenda de status: Seguro (< 50% do limite) · Atenção (50% a 74%) · Crítico (75% a 99%) · Limite atingido (100%, sem margem) · Reprovado (acima do limite)";
    legendCell.font = { italic: true, size: 9, color: { argb: "FF56657A" } };

    autoFitColumns(resumo, 12);

    // =========================================================================
    // Aba 2: Historico (Histórico Detalhado)
    // =========================================================================
    const historico = workbook.addWorksheet("Historico", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    const histHeaders = [
      "Data",
      "Dia da semana",
      "Matéria",
      "Aulas perdidas",
      "Horas perdidas",
      "Tipo",
      "Motivo",
      "Observações",
    ];
    const histHeaderRow = historico.getRow(1);
    histHeaders.forEach((h, i) => {
      const cell = histHeaderRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5C8C" } };
      cell.border = THIN_BORDER;
    });
    histHeaderRow.height = 22;
    historico.autoFilter = "A1:H1";

    data.logs.forEach((log, idx) => {
      const subject = subjectById.get(log.subjectId);
      if (!subject) return;
      const r = 2 + idx;
      const row = historico.getRow(r);
      const weekday = isoWeekday(log.classDate);
      const unitMins = subject.unitMinutes ?? 60;
      const hoursLost = Math.round(((log.unitsMissed * unitMins) / 60) * 100) / 100;
      const tipo = !log.isExcused
        ? "Contabilizada"
        : subject.excusedPolicy === "deduct"
          ? "Abonada"
          : "Contabilizada · atestado";

      const dateCell = row.getCell(1);
      dateCell.value = new Date(`${log.classDate}T12:00:00Z`);
      dateCell.numFmt = "dd/mm/yyyy";

      row.getCell(2).value = WEEKDAY_NAMES[weekday] ?? "";
      row.getCell(3).value = subject.name;
      row.getCell(4).value = log.unitsMissed;
      row.getCell(5).value = hoursLost;
      row.getCell(5).numFmt = '0.0" h"';
      row.getCell(6).value = tipo;
      row.getCell(7).value = log.reason ? (REASON_LABELS[log.reason] ?? log.reason) : "";
      row.getCell(8).value = log.note ?? "";

      for (let c = 1; c <= 8; c++) {
        row.getCell(c).border = THIN_BORDER;
      }
    });

    const lastLogRow = Math.max(2, 1 + data.logs.length);
    historico.addConditionalFormatting({
      ref: `A2:H${lastLogRow}`,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: ["MOD(ROW(),2)=0"],
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFF4F6F8" } },
          },
        },
      ],
    });

    autoFitColumns(historico, 8);

    // =========================================================================
    // Aba 3: Grade Horária
    // =========================================================================
    const grade = workbook.addWorksheet("Grade Horária", {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
      views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
    });

    const gradeHeaders = ["Horário", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const gradeHeaderRow = grade.getRow(1);
    gradeHeaders.forEach((h, i) => {
      const cell = gradeHeaderRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5C8C" } };
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    gradeHeaderRow.height = 22;

    const slotTimes = [
      ...new Set(data.schedules.map((s) => `${s.startsAt.slice(0, 5)} – ${s.endsAt.slice(0, 5)}`)),
    ].sort();

    slotTimes.forEach((slotTime, idx) => {
      const r = 2 + idx;
      const row = grade.getRow(r);
      row.height = 42;
      const timeCell = row.getCell(1);
      timeCell.value = slotTime;
      timeCell.font = { bold: true, size: 10 };
      timeCell.alignment = { vertical: "middle", horizontal: "center" };
      timeCell.border = THIN_BORDER;

      for (let weekday = 1; weekday <= 6; weekday++) {
        const colIdx = weekday + 1;
        const cell = row.getCell(colIdx);
        cell.border = THIN_BORDER;
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

        const matching = data.schedules.filter(
          (s) =>
            s.weekday === weekday &&
            `${s.startsAt.slice(0, 5)} – ${s.endsAt.slice(0, 5)}` === slotTime,
        );
        if (matching.length > 0) {
          const firstSubject = subjectById.get(matching[0]!.subjectId);
          const lines = matching.map((s) => {
            const subj = subjectById.get(s.subjectId);
            const parts = [subj?.name ?? "Matéria"];
            const loc = [s.room, s.building].filter(Boolean).join(" · ");
            if (loc) parts.push(loc);
            const prof = s.professor ?? subj?.professor;
            if (prof) parts.push(prof);
            return parts.join("\n");
          });
          cell.value = lines.join("\n---\n");
          const tint =
            (firstSubject?.color
              ? SUBJECT_TINTS[firstSubject.color as (typeof SUBJECT_COLORS)[number]]
              : undefined) ?? "FFE2ECF5";
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
        }
      }
    });

    autoFitColumns(grade, 7, 15, 32);

    this.addDataSheet(workbook, data);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const slug =
      data.semester.label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "semestre";

    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `presenca_${slug}.xlsx`,
    };
  }

  /**
   * Aba "muito oculta" com o semestre completo em JSON (o mesmo formato da importação), para o
   * site reconstruir tudo ao receber a planilha de volta: regras, grade, feriados e registros.
   * Não aparece no Excel; se o semestre passar dos limites da importação, a aba fica de fora.
   */
  private addDataSheet(
    workbook: ExcelJS.Workbook,
    data: {
      semester: { label: string; startsOn: string; endsOn: string };
      subjects: (typeof schema.subjects.$inferSelect)[];
      schedules: (typeof schema.subjectSchedules.$inferSelect)[];
      allLogs: (typeof schema.attendanceLogs.$inferSelect)[];
      exceptions: (typeof schema.calendarExceptions.$inferSelect)[];
    },
  ): void {
    const subjectIndex = new Map(data.subjects.map((s, i) => [s.id, i]));
    // Mesma ordem dos horários que subjectToTemplate usa: o índice aponta o horário certo.
    const scheduleIndex = new Map<string, number>();
    for (const s of data.subjects) {
      data.schedules
        .filter((x) => x.subjectId === s.id)
        .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt))
        .forEach((x, i) => scheduleIndex.set(x.id, i));
    }
    const payload: SpreadsheetData = {
      format: SPREADSHEET_FORMAT,
      version: 1,
      data: {
        semester: {
          label: data.semester.label,
          startsOn: data.semester.startsOn,
          endsOn: data.semester.endsOn,
        },
        subjects: data.subjects.map((s) =>
          subjectToTemplate(
            s,
            data.schedules.filter((x) => x.subjectId === s.id),
          ),
        ),
        exceptions: data.exceptions
          .filter((e) => e.subjectId === null || subjectIndex.has(e.subjectId))
          .map((e) => ({
            startsOn: e.startsOn,
            endsOn: e.endsOn,
            kind: e.kind,
            label: e.label,
            subjectIndex: e.subjectId === null ? null : subjectIndex.get(e.subjectId)!,
          })),
        // A planilha leva só presença; a regra de notas não vai.
        gradings: [],
        attendance: data.allLogs
          .filter((l) => subjectIndex.has(l.subjectId))
          .map((l) => ({
            subjectIndex: subjectIndex.get(l.subjectId)!,
            scheduleIndex: l.scheduleId ? (scheduleIndex.get(l.scheduleId) ?? null) : null,
            classDate: l.classDate,
            status: l.status,
            ...(l.scheduleId ? {} : { unitsScheduled: l.unitsScheduled }),
            ...(l.status === "partial" ? { unitsMissed: l.unitsMissed } : {}),
            isExcused: l.isExcused,
            reason: l.reason,
            ...(l.note ? { note: l.note } : {}),
            ...(l.content ? { content: l.content } : {}),
          })),
      },
    };
    const parsed = spreadsheetDataSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(`aba de dados fora da planilha: ${parsed.error.issues[0]?.message ?? "?"}`);
      return;
    }
    const sheet = workbook.addWorksheet(SPREADSHEET_DATA_SHEET, { state: "veryHidden" });
    sheet.getCell("A1").value =
      "Dados do Monitor de Presenças para reimportar esta planilha. Não edite esta aba.";
    const json = JSON.stringify(parsed.data);
    for (let i = 0, row = 2; i < json.length; i += SPREADSHEET_CHUNK, row++) {
      sheet.getCell(`A${row}`).value = json.slice(i, i + SPREADSHEET_CHUNK);
    }
  }
}
