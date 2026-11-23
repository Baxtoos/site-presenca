import {
  type ImportAttendance,
  type SemesterImportBody,
  semesterImportBodySchema,
  SPREADSHEET_DATA_SHEET,
  spreadsheetDataSchema,
  type SUBJECT_COLORS,
} from "@presenca/contracts";
import { isoWeekday } from "@presenca/engine";
import type { Workbook, Worksheet } from "exceljs";

/**
 * Lê no navegador a planilha exportada pelo Monitor de Presenças e monta o semestre para a API
 * importar (POST /v1/imports/semester). A API valida tudo de novo; aqui é só a leitura.
 *
 * - Planilha nova: aba "muito oculta" `Dados` com tudo (regras, grade, feriados, presenças e
 *   faltas). A importação é exata.
 * - Planilha antiga (sem essa aba): lê Resumo, Histórico e Grade Horária. Presenças e feriados
 *   não existem nelas, e o que falta (datas do semestre, tempos de cada aula) é estimado e avisado.
 */
export type SpreadsheetReading =
  | { ok: true; source: "completa" | "abas"; body: SemesterImportBody; warnings: string[] }
  /** `foreign`: não é planilha do app (a tela oferece ler como planilha própria). */
  | { ok: false; error: string; foreign?: boolean };

const NOT_OURS =
  "Esta planilha não parece ter sido exportada pelo Monitor de Presenças. Use o arquivo baixado no botão Exportar Excel (.xlsx), na página do semestre.";

export async function readSpreadsheet(file: ArrayBuffer): Promise<SpreadsheetReading> {
  // exceljs é grande: só carrega quando alguém escolhe um arquivo.
  const { Workbook: WorkbookClass } = await import("exceljs");
  const workbook = new WorkbookClass();
  try {
    await workbook.xlsx.load(file);
  } catch {
    return {
      ok: false,
      error: "Não consegui abrir o arquivo. Ele precisa ser uma planilha .xlsx.",
    };
  }
  const data = workbook.getWorksheet(SPREADSHEET_DATA_SHEET);
  if (data) {
    const complete = fromDataSheet(workbook, data);
    if (complete) return complete;
  }
  return fromVisibleSheets(workbook);
}

// ---------------------------------------------------------------- planilha nova (aba Dados)

function fromDataSheet(workbook: Workbook, sheet: Worksheet): SpreadsheetReading | null {
  let json = "";
  for (let row = 2; row <= sheet.rowCount; row++) json += cellText(sheet.getCell(`A${row}`));
  let parsed;
  try {
    parsed = spreadsheetDataSchema.safeParse(JSON.parse(json));
  } catch {
    return null;
  }
  // Aba corrompida (editada à mão): tenta as abas visíveis.
  if (!parsed.success) return null;
  const body = parsed.data.data;
  const warnings: string[] = [];

  // Edições feitas no Excel na aba Histórico não entram: avisa se ela não bate com os dados.
  const historico = workbook.getWorksheet("Historico");
  if (historico) {
    const visible = historyRows(historico).length;
    const exported = body.attendance.filter(
      (a) => a.status === "absent" || a.status === "partial",
    ).length;
    if (visible !== exported) {
      warnings.push(
        `A aba Histórico tem ${visible} ${visible === 1 ? "falta" : "faltas"} e a exportação original tem ${exported}. A importação usa os dados originais da exportação: mudanças feitas no Excel não entram.`,
      );
    }
  }
  return { ok: true, source: "completa", body, warnings };
}

// ---------------------------------------------------------------- planilha antiga (abas visíveis)

const REASONS: Record<string, ImportAttendance["reason"]> = {
  saúde: "health",
  trabalho: "work",
  transporte: "transport",
  pessoal: "personal",
  outro: "other",
};

/** Cor de fundo da Grade Horária → cor da matéria (mesma tabela da exportação). */
const TINT_TO_COLOR: Record<string, (typeof SUBJECT_COLORS)[number]> = {
  FFE2ECF5: "blue",
  FFDDF2EE: "teal",
  FFE1F2E7: "green",
  FFFBF1CF: "amber",
  FFFBE5D6: "orange",
  FFF8DEDB: "rose",
  FFEDE4F7: "violet",
  FFEEF2F6: "slate",
};

type Rules =
  | { countingMode: "class_count"; totalClasses: number; minAttendanceBp: number }
  | {
      countingMode: "workload";
      workloadHours: number;
      workloadHourMinutes: 45 | 50 | 60;
      unitMinutes: number;
      minAttendanceBp: number;
    }
  | { countingMode: "manual"; manualMaxUnits: number; totalClasses: null };

interface DraftSchedule {
  weekday: number;
  startsAt: string;
  endsAt: string;
  room: string | null;
  building: string | null;
  professor: string | null;
}

interface DraftSubject {
  name: string;
  professor: string | null;
  rules: Rules;
  /** Tempos por aula informados pela planilha (só no modo por número de aulas). */
  unitsPerClass: number | null;
  color: (typeof SUBJECT_COLORS)[number] | null;
  schedules: DraftSchedule[];
}

function fromVisibleSheets(workbook: Workbook): SpreadsheetReading {
  const resumo = workbook.getWorksheet("Resumo");
  if (!resumo || cellText(resumo.getCell("A4")) !== "Matéria")
    return { ok: false, error: NOT_OURS, foreign: true };
  const warnings: string[] = [
    "Planilha exportada antes da importação existir: ela não guarda as presenças nem os feriados, só as faltas. Confira as datas e as aulas de cada dia depois de importar.",
  ];

  const title = cellText(resumo.getCell("A1"));
  const label = /·\s*(.+)$/.exec(title)?.[1]?.trim().slice(0, 60) || "Semestre importado";

  // ---- matérias (aba Resumo, da linha 5 até a primeira linha vazia)
  const drafts: DraftSubject[] = [];
  for (let row = 5; row <= resumo.rowCount; row++) {
    const name = cellText(resumo.getCell(row, 1)).trim();
    if (!name || name.startsWith("Legenda")) break;
    const professor = cellText(resumo.getCell(row, 2)).trim();
    const carga = cellText(resumo.getCell(row, 3)).trim();
    const totalUnits = cellNumber(resumo.getCell(row, 4));
    const minBp = Math.round((cellNumber(resumo.getCell(row, 5)) || 0.75) * 10_000);
    const limit = cellNumber(resumo.getCell(row, 8));
    const auxMinutes = cellNumber(resumo.getCell(row, 13));
    const auxUnit = cellNumber(resumo.getCell(row, 14));

    let rules: Rules;
    let unitsPerClass: number | null = null;
    const hours = /^([\d.,]+)\s*h$/.exec(carga);
    const classes = /^(\d+)\s*aulas?$/.exec(carga);
    if (hours) {
      const workloadHours = Math.round(Number(hours[1]!.replace(",", ".")) * 100) / 100;
      const perHour = workloadHours > 0 ? auxMinutes / workloadHours : 60;
      rules = {
        countingMode: "workload",
        workloadHours,
        workloadHourMinutes: closest(perHour, [45, 50, 60] as const),
        unitMinutes: clamp(Math.round(auxUnit) || 50, 10, 240),
        minAttendanceBp: clamp(minBp, 0, 10_000),
      };
    } else if (classes) {
      const totalClasses = clamp(Number(classes[1]), 1, 1000);
      rules = {
        countingMode: "class_count",
        totalClasses,
        minAttendanceBp: clamp(minBp, 0, 10_000),
      };
      unitsPerClass = clamp(Math.round(totalUnits / totalClasses) || 1, 1, 6);
    } else {
      rules = {
        countingMode: "manual",
        manualMaxUnits: clamp(Math.round(limit), 0, 1000),
        totalClasses: null,
      };
    }
    drafts.push({
      name: name.slice(0, 120),
      professor: professor && professor !== "—" ? professor.slice(0, 120) : null,
      rules,
      unitsPerClass,
      color: null,
      schedules: [],
    });
  }
  if (drafts.length === 0) return { ok: false, error: "A aba Resumo não tem nenhuma matéria." };
  const byName = new Map(drafts.map((d) => [d.name.toLowerCase(), d]));

  // ---- grade (aba Grade Horária): "19:00 – 20:40" × Segunda…Sábado
  const grade = workbook.getWorksheet("Grade Horária");
  if (grade) {
    for (let row = 2; row <= grade.rowCount; row++) {
      const time = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(
        cellText(grade.getCell(row, 1)),
      );
      if (!time) continue;
      const startsAt = `${time[1]!.padStart(2, "0")}:${time[2]}`;
      const endsAt = `${time[3]!.padStart(2, "0")}:${time[4]}`;
      for (let col = 2; col <= 7; col++) {
        const cell = grade.getCell(row, col);
        const text = cellText(cell).trim();
        if (!text) continue;
        const tint = (cell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
        for (const block of text.split(/\n---\n/)) {
          const [rawName, ...rest] = block.split("\n").map((l) => l.trim());
          const subject = byName.get((rawName ?? "").toLowerCase());
          if (!subject) continue;
          if (!subject.color && tint && TINT_TO_COLOR[tint]) subject.color = TINT_TO_COLOR[tint];
          // Depois do nome: "sala · prédio" e/ou professor (se for o da matéria, não repete).
          let location: string | undefined;
          let professor: string | undefined;
          if (rest.length >= 2) [location, professor] = rest;
          else if (rest.length === 1) {
            if (rest[0] === subject.professor) professor = rest[0];
            else location = rest[0];
          }
          const [room, building] = (location ?? "").split(" · ").map((s) => s.trim() || null);
          subject.schedules.push({
            weekday: col - 1,
            startsAt,
            endsAt,
            room: room?.slice(0, 40) ?? null,
            building: building?.slice(0, 40) ?? null,
            professor:
              professor && professor !== subject.professor ? professor.slice(0, 120) : null,
          });
        }
      }
    }
  } else {
    warnings.push("A planilha não tem a aba Grade Horária: as matérias entram sem horários.");
  }

  // ---- tempos de cada aula: vêm do número de aulas, ou da duração do horário
  const subjects = drafts.map((d) => {
    const unitsFor = (s: DraftSchedule) => {
      if (d.unitsPerClass) return d.unitsPerClass;
      const minutes = toMinutes(s.endsAt) - toMinutes(s.startsAt);
      const unit = d.rules.countingMode === "workload" ? d.rules.unitMinutes : 50;
      return clamp(Math.round(minutes / unit) || 1, 1, 6);
    };
    const schedules = d.schedules
      .map((s) => ({ ...s, units: unitsFor(s) }))
      .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
    const unitsPerClass = d.unitsPerClass ?? mostCommon(schedules.map((s) => s.units)) ?? 1;
    return { draft: d, schedules, unitsPerClass };
  });

  // ---- faltas (aba Historico)
  const historico = workbook.getWorksheet("Historico");
  const attendance: ImportAttendance[] = [];
  const deduct = new Set<number>();
  const used = new Set<string>();
  let unmatched = 0;
  for (const h of historico ? historyRows(historico) : []) {
    const index = subjects.findIndex((s) => s.draft.name.toLowerCase() === h.subject.toLowerCase());
    if (index < 0) {
      unmatched++;
      continue;
    }
    const s = subjects[index]!;
    if (h.kind === "Abonada") deduct.add(index);
    const weekday = isoWeekday(h.date);
    // Horário do dia da semana ainda livre nesta data; sem horário, vira aula extra.
    const scheduleIndex = s.schedules.findIndex(
      (x, i) => x.weekday === weekday && !used.has(`${index}|${h.date}|${i}`),
    );
    const excused = h.kind.startsWith("Abonada") || h.kind.includes("atestado");
    const base = {
      subjectIndex: index,
      classDate: h.date,
      isExcused: excused,
      reason: h.reason,
      ...(h.note ? { note: h.note.slice(0, 500) } : {}),
    };
    if (scheduleIndex >= 0) {
      used.add(`${index}|${h.date}|${scheduleIndex}`);
      const units = s.schedules[scheduleIndex]!.units;
      attendance.push(
        h.units >= units
          ? { ...base, scheduleIndex, status: "absent" }
          : { ...base, scheduleIndex, status: "partial", unitsMissed: clamp(h.units, 1, 5) },
      );
    } else {
      attendance.push({
        ...base,
        scheduleIndex: null,
        status: "absent",
        unitsScheduled: clamp(h.units, 1, 6),
      });
    }
  }
  if (unmatched > 0) {
    warnings.push(
      `${unmatched} ${unmatched === 1 ? "linha do Histórico aponta" : "linhas do Histórico apontam"} para uma matéria que não está no Resumo e ${unmatched === 1 ? "ficou" : "ficaram"} de fora.`,
    );
  }

  // ---- datas do semestre: pelo nome (2026.1 / 2026.2), cobrindo as faltas registradas
  const dates = attendance.map((a) => a.classDate).sort();
  const guess = semesterGuess(label, dates[0], dates.at(-1));

  const body = semesterImportBodySchema.safeParse({
    semester: { label, ...guess },
    subjects: subjects.map((s, i) => ({
      name: s.draft.name,
      code: null,
      professor: s.draft.professor,
      color: s.draft.color,
      unitsPerClass: s.unitsPerClass,
      excusedPolicy: deduct.has(i) ? "deduct" : "track_only",
      ...s.draft.rules,
      schedules: s.schedules.slice(0, 14),
    })),
    exceptions: [],
    attendance,
  });
  if (!body.success) {
    const issue = body.error.issues[0];
    return {
      ok: false,
      error: `Não consegui entender a planilha (${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "dado inválido"}).`,
    };
  }
  return { ok: true, source: "abas", body: body.data, warnings };
}

// ---------------------------------------------------------------- utilitários

interface HistoryRow {
  date: string;
  subject: string;
  units: number;
  kind: string;
  reason: ImportAttendance["reason"];
  note: string;
}

/** Linhas da aba Historico: data, dia, matéria, tempos, horas, tipo, motivo, observações. */
function historyRows(sheet: Worksheet): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (let row = 2; row <= sheet.rowCount; row++) {
    const date = cellDate(sheet.getCell(row, 1));
    const subject = cellText(sheet.getCell(row, 3)).trim();
    const units = Math.round(cellNumber(sheet.getCell(row, 4)));
    if (!date || !subject || units <= 0) continue;
    rows.push({
      date,
      subject,
      units,
      kind: cellText(sheet.getCell(row, 6)).trim(),
      reason: REASONS[cellText(sheet.getCell(row, 7)).trim().toLowerCase()] ?? null,
      note: cellText(sheet.getCell(row, 8)).trim(),
    });
  }
  return rows;
}

type Cell = ReturnType<Worksheet["getCell"]>;

function cellText(cell: Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    const r = o.result;
    if (typeof r === "string" || typeof r === "number" || typeof r === "boolean") return String(r);
    if (typeof o.text === "string") return o.text;
  }
  return "";
}

function cellNumber(cell: Cell): number {
  const v = cell.value as unknown;
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as { result?: unknown }).result === "number") {
    return (v as { result: number }).result;
  }
  const n = Number(cellText(cell).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Data da célula como AAAA-MM-DD (Date do Excel, ou texto dd/mm/aaaa). */
function cellDate(cell: Cell): string | null {
  const v = cell.value as unknown;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cellText(cell).trim());
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function closest<T extends number>(value: number, options: readonly T[]): T {
  return options.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best));
}

function mostCommon(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** "2026.1" → fev–jul; "2026.2" → ago–dez; sempre cobrindo a primeira e a última falta. */
function semesterGuess(
  label: string,
  first: string | undefined,
  last: string | undefined,
): { startsOn: string; endsOn: string } {
  const m = /(\d{4})\D*([12])/.exec(label);
  let startsOn: string;
  let endsOn: string;
  if (m) {
    const year = m[1]!;
    [startsOn, endsOn] =
      m[2] === "1" ? [`${year}-02-02`, `${year}-07-03`] : [`${year}-08-03`, `${year}-12-18`];
  } else {
    const today = new Date().toISOString().slice(0, 10);
    startsOn = first ?? today;
    endsOn = last ?? today;
  }
  if (first && first < startsOn) startsOn = first;
  if (last && last > endsOn) endsOn = last;
  return { startsOn, endsOn };
}
