import {
  type ImportAttendance,
  type SemesterImportBody,
  MAX_IMPORT_ATTENDANCE,
  semesterImportBodySchema,
  SUBJECT_COLORS,
} from "@presenca/contracts";
import { isoWeekday } from "@presenca/engine";
import type { Worksheet } from "exceljs";

/**
 * Planilha que o aluno montou sozinho (não exportada pelo app): lê as abas, descobre como estão
 * organizadas, traduz as marcações ("P", "F", "atestado"...) e monta o semestre para a mesma rota
 * da importação (POST /v1/imports/semester). Tudo no navegador; a API valida de novo.
 *
 * Formatos entendidos, em .xlsx ou .csv:
 * - "lista": uma linha por aula (Data, Matéria, Situação, Tempos, Motivo, Observação). Sem coluna de
 *   matéria, a aba é a matéria; sem coluna de situação, cada linha é uma falta.
 * - "datas nas colunas": uma linha por matéria e uma coluna por data (a chamada clássica).
 * - "datas nas linhas": uma linha por data e uma coluna por matéria.
 */

export type Cell = string | number | Date | null;
export interface Table {
  name: string;
  rows: Cell[][];
}

const MAX_ROWS = 5_000;
const MAX_COLS = 400;

// ---------------------------------------------------------------- leitura do arquivo

export async function readTables(file: ArrayBuffer, fileName: string): Promise<Table[]> {
  if (/\.(csv|txt)$/i.test(fileName)) {
    const base = fileName.replace(/\.[^.]+$/, "").trim() || "Planilha";
    return [{ name: base, rows: parseCsv(decodeText(file)) }];
  }
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(file);
  return workbook.worksheets
    .filter((sheet) => sheet.state === "visible")
    .map((sheet) => ({ name: sheet.name.trim(), rows: sheetRows(sheet) }));
}

function sheetRows(sheet: Worksheet): Cell[][] {
  const rows: Cell[][] = [];
  const lastRow = Math.min(sheet.rowCount, MAX_ROWS);
  const lastCol = Math.min(sheet.columnCount, MAX_COLS);
  for (let r = 1; r <= lastRow; r++) {
    const row: Cell[] = [];
    for (let c = 1; c <= lastCol; c++) row.push(toCell(sheet.getCell(r, c).value));
    rows.push(row);
  }
  return rows;
}

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
    if (o.richText) return toCell(o.richText.map((r) => r.text).join(""));
    if ("result" in o) return toCell(o.result);
    if (typeof o.text === "string") return toCell(o.text);
  }
  return null;
}

/** UTF-8; se aparecer caractere inválido, é o Excel salvando em Windows-1252. */
function decodeText(file: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(file);
  const text = utf8.includes("\uFFFD") ? new TextDecoder("windows-1252").decode(file) : utf8;
  return text.replace(/^\uFEFF/, "");
}

/** CSV com separador ";" (Excel em português), "," (Google Planilhas) ou tabulação. */
export function parseCsv(text: string): Cell[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", ",", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field.trim() === "" ? null : field.trim());
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") quoted = true;
    else if (ch === delimiter) endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endField();
      rows.push(row.slice(0, MAX_COLS));
      row = [];
      if (rows.length >= MAX_ROWS) return rows;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    endField();
    rows.push(row.slice(0, MAX_COLS));
  }
  return rows;
}

// ---------------------------------------------------------------- textos, datas e números

/** Minúsculas, sem acento e com espaços simples: "Falta  Justificada" → "falta justificada". */
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const cellText = (c: Cell | undefined): string =>
  c === null || c === undefined
    ? ""
    : c instanceof Date
      ? c.toISOString().slice(0, 10)
      : String(c).trim();

const MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  mai: 5,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  set: 9,
  sep: 9,
  out: 10,
  oct: 10,
  nov: 11,
  dez: 12,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Data da célula em AAAA-MM-DD. Sem ano ("12/03", "12 mar"), usa o ano de hoje, ou o anterior se
 * a data ainda não chegou.
 */
export function parseDate(cell: Cell | undefined, today: string): string | null {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    return validDate(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
  }
  if (typeof cell !== "string") return null;
  const t = normalize(cell).replace(/^(seg|ter|qua|qui|sex|sab|dom)\w*[,.]?\s*/, "");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (m) return withYear(Number(m[1]), Number(m[2]), m[3], today);
  m = /^(\d{1,2})(?:\s*de)?[\s/.-]*([a-z]{3})[a-z]*\.?(?:(?:\s*de)?[\s/.-]*(\d{2}|\d{4}))?$/.exec(
    t,
  );
  if (m && MONTHS[m[2]!]) return withYear(Number(m[1]), MONTHS[m[2]!]!, m[3], today);
  return null;
}

function withYear(d: number, mo: number, y: string | undefined, today: string): string | null {
  if (y) return validDate(y.length === 2 ? 2000 + Number(y) : Number(y), mo, d);
  const year = Number(today.slice(0, 4));
  const guess = validDate(year, mo, d);
  return guess && guess > today ? validDate(year - 1, mo, d) : guess;
}

const positiveInt = (c: Cell | undefined): number | null => {
  const n = typeof c === "number" ? c : Number(cellText(c).replace(",", "."));
  return Number.isInteger(n) && n > 0 && n <= 6 ? n : null;
};

// ---------------------------------------------------------------- como a aba está organizada

export interface ListColumns {
  date: number;
  subject: number | null;
  status: number | null;
  units: number | null;
  reason: number | null;
  note: number | null;
}

export type Layout =
  | { kind: "list"; header: number; columns: ListColumns }
  | { kind: "dates-across"; header: number; name: number; dates: { col: number; date: string }[] }
  | { kind: "dates-down"; header: number; date: number; subjects: { col: number; name: string }[] }
  | { kind: "none" };

const HEADER_WORDS: Record<keyof Omit<ListColumns, "date">, RegExp> & { date: RegExp } = {
  date: /^(data|dia|date)\b/,
  subject: /^(materia|disciplina|cadeira|unidade curricular|uc|modulo|curso|aula)s?\b/,
  status: /^(situacao|status|presenca|frequencia|chamada|marcacao|registro)/,
  units: /^(tempos?|qtd|quantidade|n[oº°]? de (aulas|tempos|faltas)|aulas|faltas)\b/,
  reason: /^(motivo|justificativa|razao|causa)/,
  note: /^(obs|observac|nota|comentario|anotac|detalhe)/,
};

/** Descobre o formato da aba. Devolve "none" se não achar datas. */
export function detectLayout(table: Table, today: string): Layout {
  const rows = table.rows;
  const isDate = (c: Cell | undefined) => parseDate(c, today) !== null;

  // 1) Uma linha com várias datas: datas nas colunas.
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const dates = (rows[r] ?? [])
      .map((cell, col) => ({ col, date: parseDate(cell, today) }))
      .filter((d): d is { col: number; date: string } => d.date !== null);
    if (dates.length >= 2) {
      const firstDateCol = dates[0]!.col;
      // A coluna dos nomes: a com mais texto à esquerda das datas.
      let name = 0;
      let best = -1;
      for (let c = 0; c < Math.max(firstDateCol, 1); c++) {
        const filled = rows.slice(r + 1).filter((row) => {
          const t = cellText(row[c]);
          return t !== "" && !/^\d+$/.test(t);
        }).length;
        if (filled > best) [name, best] = [c, filled];
      }
      return { kind: "dates-across", header: r, name, dates };
    }
  }

  // 2) Uma coluna com várias datas: lista ou datas nas linhas.
  for (let c = 0; c < Math.min(MAX_COLS, 12); c++) {
    const dateRows = rows.map((row, i) => (isDate(row[c]) ? i : -1)).filter((i) => i >= 0);
    if (dateRows.length < 2) continue;
    const header = dateRows[0]! - 1;
    const headerRow = header >= 0 ? (rows[header] ?? []) : [];
    const headers = headerRow.map((h) => normalize(cellText(h)));
    const data = rows.slice(header + 1);
    const width = Math.max(...rows.map((row) => row.length));

    const columns: ListColumns = {
      date: c,
      subject: null,
      status: null,
      units: null,
      reason: null,
      note: null,
    };
    headers.forEach((h, col) => {
      if (col === c || !h) return;
      for (const key of ["subject", "status", "reason", "note", "units"] as const) {
        if (columns[key] === null && HEADER_WORDS[key].test(h)) {
          // "Faltas" com texto é a situação; com números, os tempos.
          if (key === "units" && /^faltas?\b/.test(h)) {
            const numeric = data.filter((row) => positiveInt(row[col]) !== null).length;
            const text = data.filter((row) => cellText(row[col]) !== "").length;
            if (numeric < text / 2) {
              if (columns.status === null) columns.status = col;
              return;
            }
          }
          columns[key] = col;
          return;
        }
      }
    });
    const named = Object.entries(columns).some(([k, v]) => k !== "date" && v !== null);
    if (named) {
      // Coluna sem nome conhecido ("P/F", "?") cujo conteúdo é só marcação: é a situação.
      const used = new Set(Object.values(columns));
      for (let col = 0; col < width; col++) {
        if (used.has(col)) continue;
        const values = data.map((row) => normalize(cellText(row[col]))).filter(Boolean);
        if (values.length === 0) continue;
        if (columns.status === null && values.every((v) => guessChoice(v).choice !== null)) {
          columns.status = col;
        } else if (columns.units === null && values.every((v) => positiveInt(v) !== null)) {
          columns.units = col;
        }
      }
      return { kind: "list", header, columns };
    }

    // Cabeçalho sem nomes conhecidos: as outras colunas são matérias (datas nas linhas)...
    const subjects = headerRow
      .map((h, col) => ({ col, name: cellText(h) }))
      .filter((s) => s.col !== c && s.name !== "" && !isDate(s.name));
    if (subjects.length >= 1 && header >= 0) {
      return { kind: "dates-down", header, date: c, subjects };
    }
    // ...ou não há cabeçalho: adivinha pelo conteúdo (texto curto e repetido é a situação).
    for (let col = 0; col < width; col++) {
      if (col === c) continue;
      const values = data.map((row) => normalize(cellText(row[col]))).filter(Boolean);
      if (values.length === 0) continue;
      const distinct = new Set(values).size;
      if (columns.status === null && values.every((v) => guessChoice(v).choice !== null)) {
        columns.status = col;
      } else if (columns.units === null && values.every((v) => positiveInt(v) !== null)) {
        columns.units = col;
      } else if (columns.subject === null && distinct <= Math.max(30, values.length / 2)) {
        columns.subject = col;
      } else if (columns.note === null) {
        columns.note = col;
      }
    }
    return { kind: "list", header, columns };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------- registros brutos

/** Marcação quando a lista não tem coluna de situação: cada linha é uma falta. */
export const NO_STATUS = "__sem_situacao__";

export interface RawRecord {
  sheet: string;
  subject: string;
  date: string;
  /** Marcação normalizada (chave do mapa de significados). */
  token: string;
  units: number | null;
  reasonText: string;
  note: string;
}

export function extractRecords(table: Table, layout: Layout, today: string): RawRecord[] {
  const out: RawRecord[] = [];
  const rows = table.rows;
  const push = (r: Omit<RawRecord, "sheet">) => {
    if (r.subject.trim()) out.push({ ...r, sheet: table.name, subject: r.subject.trim() });
  };
  if (layout.kind === "list") {
    const col = layout.columns;
    for (const row of rows.slice(layout.header + 1)) {
      const date = parseDate(row[col.date], today);
      if (!date) continue;
      const status = col.status === null ? NO_STATUS : normalize(cellText(row[col.status]));
      push({
        subject: col.subject === null ? table.name : cellText(row[col.subject]),
        date,
        token: status,
        units: col.units === null ? null : positiveInt(row[col.units]),
        reasonText: col.reason === null ? "" : cellText(row[col.reason]),
        note: col.note === null ? "" : cellText(row[col.note]),
      });
    }
  } else if (layout.kind === "dates-across") {
    for (const row of rows.slice(layout.header + 1)) {
      const subject = cellText(row[layout.name]);
      if (!subject || parseDate(subject, today)) continue;
      for (const { col, date } of layout.dates) {
        const token = normalize(cellText(row[col]));
        if (token) push({ subject, date, token, units: null, reasonText: "", note: "" });
      }
    }
  } else if (layout.kind === "dates-down") {
    for (const row of rows.slice(layout.header + 1)) {
      const date = parseDate(row[layout.date], today);
      if (!date) continue;
      for (const { col, name } of layout.subjects) {
        const token = normalize(cellText(row[col]));
        if (token) push({ subject: name, date, token, units: null, reasonText: "", note: "" });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- o que cada marcação significa

export type Choice = "present" | "absent" | "excused" | "cancelled" | "ignore";

const PRESENT = /^(p|pr|presente|presenca|presente ok|fui|ok|sim|s|v|c|compareceu|✓|✔|☑|√)$/;
const ABSENT = /^(f|fa|falta|faltei|faltou|ausente|aus|a|n|nao|nao fui|ausencia)$/;
const EXCUSED =
  /^(at|atestado|com atestado|falta com atestado|j|fj|aj|justificada|justificado|falta justificada|abonada|abonado|falta abonada|abono)$/;
const CANCELLED =
  /^(cancelada|cancelado|aula cancelada|sem aula|nao houve|nao teve|feriado|recesso|greve|sa|nh)$/;
const IGNORE = /^(-|—|–|\.|\?|_)$/;

/**
 * Palpite para uma marcação. Números: 0 = presença, 1 a 6 = falta de tantos tempos.
 * `null` = ambíguo ("x", "1" numa lista...): o aluno escolhe.
 */
export function guessChoice(token: string): { choice: Choice | null; units: number | null } {
  if (token === NO_STATUS) return { choice: "absent", units: null };
  if (token === "") return { choice: "ignore", units: null };
  if (token === "x") return { choice: null, units: null };
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    if (n === 0) return { choice: "present", units: null };
    if (n <= 6) return { choice: "absent", units: n };
    return { choice: null, units: null };
  }
  if (PRESENT.test(token)) return { choice: "present", units: null };
  if (ABSENT.test(token)) return { choice: "absent", units: null };
  if (EXCUSED.test(token)) return { choice: "excused", units: null };
  if (CANCELLED.test(token)) return { choice: "cancelled", units: null };
  if (IGNORE.test(token)) return { choice: "ignore", units: null };
  if (/atestado|justific|abon/.test(token)) return { choice: "excused", units: null };
  if (/^falt|ausen/.test(token)) return { choice: "absent", units: null };
  if (/^presen/.test(token)) return { choice: "present", units: null };
  return { choice: null, units: null };
}

export function guessReason(text: string): ImportAttendance["reason"] {
  const t = normalize(text);
  if (!t) return null;
  if (/saude|medic|atestado|doen|consulta|hospital|exame|dentista|gripe|febre/.test(t))
    return "health";
  if (/transporte|onibus|transito|carro|metro|trem|uber|chuva/.test(t)) return "transport";
  if (/trabalho|emprego|estagio|servico|plantao/.test(t)) return "work";
  if (/pessoal|famil|viagem|casamento|velorio|luto/.test(t)) return "personal";
  return "other";
}

export interface TokenInfo {
  token: string;
  /** Como aparece na planilha (primeira ocorrência). */
  label: string;
  count: number;
}

export function tokensOf(records: RawRecord[]): TokenInfo[] {
  const map = new Map<string, TokenInfo>();
  for (const r of records) {
    const info = map.get(r.token);
    if (info) info.count++;
    else
      map.set(r.token, {
        token: r.token,
        label: r.token === NO_STATUS ? "(linha sem situação)" : r.token,
        count: 1,
      });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------- matérias e semestre

export interface SubjectConfig {
  key: string;
  name: string;
  include: boolean;
  countingMode: "workload" | "class_count" | "manual";
  /** Carga horária (h), número de aulas ou limite de faltas, conforme o modo. */
  amount: number;
  minPercent: number;
  unitsPerClass: number;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
}

export const subjectKey = (name: string) => normalize(name);

/** Configuração inicial de cada matéria: dias da semana em que aparecem registros, tempos etc. */
export function defaultSubjects(
  records: RawRecord[],
  choices: Record<string, Choice | null>,
  today: string,
): SubjectConfig[] {
  const bySubject = new Map<string, { name: string; records: RawRecord[] }>();
  for (const r of records) {
    const key = subjectKey(r.subject);
    const entry = bySubject.get(key) ?? { name: r.subject, records: [] };
    entry.records.push(r);
    bySubject.set(key, entry);
  }
  return [...bySubject.entries()].map(([key, { name, records: list }]) => {
    const counted = list.filter(
      (r) => (choices[r.token] ?? "ignore") !== "ignore" && r.date <= today,
    );
    const perWeekday = new Map<number, number>();
    for (const r of counted) {
      const w = isoWeekday(r.date);
      perWeekday.set(w, (perWeekday.get(w) ?? 0) + 1);
    }
    // Dia que aparece uma vez só costuma ser reposição: fica como aula avulsa.
    const minimum = counted.length <= 3 ? 1 : 2;
    const weekdays = [...perWeekday.entries()]
      .filter(([, n]) => n >= minimum)
      .map(([w]) => w)
      .sort((a, b) => a - b)
      .slice(0, 7);
    const units = list
      .map((r) => r.units ?? guessChoice(r.token).units)
      .filter((n): n is number => n !== null);
    return {
      key,
      name: name.slice(0, 120),
      include: true,
      countingMode: "workload" as const,
      amount: 60,
      minPercent: 75,
      unitsPerClass: unitsPerClassFrom(units),
      weekdays,
      startsAt: "",
      endsAt: "",
    };
  });
}

/**
 * Tempos por aula a partir dos tempos de falta anotados: o maior deles (uma falta menor é parcial),
 * no mínimo 2, o mais comum. Só "1" várias vezes indica matéria de 1 tempo.
 */
function unitsPerClassFrom(units: number[]): number {
  if (units.length >= 3 && units.every((u) => u === 1)) return 1;
  return Math.min(6, Math.max(2, ...units));
}

/** Nome e datas do semestre pelas datas dos registros (1º semestre: fev–jul; 2º: ago–dez). */
export function defaultSemester(records: RawRecord[], today: string) {
  const dates = records.map((r) => r.date).sort();
  const first = dates[0] ?? today;
  const last = dates.at(-1) ?? today;
  const year = first.slice(0, 4);
  const second = Number(first.slice(5, 7)) >= 7;
  const end = second ? `${year}-12-18` : `${year}-07-03`;
  return {
    label: `${year}.${second ? 2 : 1}`,
    startsOn: first,
    endsOn: last > end ? last : end,
  };
}

// ---------------------------------------------------------------- montar o corpo da importação

export interface BuildInput {
  records: RawRecord[];
  choices: Record<string, Choice | null>;
  subjects: SubjectConfig[];
  semester: { label: string; startsOn: string; endsOn: string };
  today: string;
}

export type BuildResult =
  | {
      ok: true;
      body: SemesterImportBody;
      counts: { absences: number; presences: number; cancelled: number; skipped: number };
      warnings: string[];
    }
  | { ok: false; error: string };

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function buildImport(input: BuildInput): BuildResult {
  const { records, choices, semester, today } = input;
  if (Object.values(choices).some((c) => c === null)) {
    return { ok: false, error: "Diga o que significa cada marcação marcada como “Escolha”." };
  }
  const included = input.subjects.filter((s) => s.include);
  if (included.length === 0) return { ok: false, error: "Escolha pelo menos uma matéria." };
  if (included.length > 30) {
    return { ok: false, error: "No máximo 30 matérias por semestre. Desmarque as que sobram." };
  }
  for (const s of included) {
    if (s.weekdays.length > 0 && (!s.startsAt || !s.endsAt)) {
      return {
        ok: false,
        error: `${s.name}: informe o horário das aulas ou desmarque os dias da semana.`,
      };
    }
    if (s.weekdays.length > 0 && toMinutes(s.endsAt) <= toMinutes(s.startsAt)) {
      return { ok: false, error: `${s.name}: o fim da aula precisa ser depois do início.` };
    }
  }

  const index = new Map(included.map((s, i) => [s.key, i]));
  const warnings: string[] = [];
  let future = 0;
  let outside = 0;

  // Uma entrada por aula: horário da grade (se o dia da semana bate) ou aula avulsa do dia.
  interface Slot {
    subjectIndex: number;
    scheduleIndex: number | null;
    date: string;
    scheduled: number;
    missed: number;
    cancelled: boolean;
    excused: boolean;
    reasons: string[];
    notes: string[];
    /** Motivo deduzido da própria marcação ("atestado" → saúde). */
    tokenReason: ImportAttendance["reason"];
  }
  const slots = new Map<string, Slot>();

  for (const r of records) {
    const subjectIndex = index.get(subjectKey(r.subject));
    const choice = choices[r.token] ?? "ignore";
    if (subjectIndex === undefined || choice === "ignore") continue;
    if (r.date > today) {
      future++;
      continue;
    }
    if (r.date < semester.startsOn || r.date > semester.endsOn) {
      outside++;
      continue;
    }
    const subject = included[subjectIndex]!;
    const units = subject.unitsPerClass;
    const tokenUnits = r.units ?? guessChoice(r.token).units;
    const weekdayIndex = subject.weekdays.indexOf(isoWeekday(r.date));
    let key = `${subjectIndex}|${r.date}|${weekdayIndex}`;
    let scheduleIndex: number | null = weekdayIndex >= 0 ? weekdayIndex : null;
    if (scheduleIndex === null || slots.has(key)) {
      key = `${subjectIndex}|${r.date}|extra`;
      scheduleIndex = null;
    }
    const missed =
      choice === "absent" || choice === "excused" ? Math.min(tokenUnits ?? units, 6) : 0;
    const slot = slots.get(key);
    if (!slot) {
      slots.set(key, {
        subjectIndex,
        scheduleIndex,
        date: r.date,
        // Aula avulsa com mais tempos de falta que o normal: a aula tinha esses tempos.
        scheduled: scheduleIndex === null ? Math.max(units, missed) : units,
        missed,
        cancelled: choice === "cancelled",
        excused: choice === "excused",
        reasons: r.reasonText ? [r.reasonText] : [],
        notes: r.note ? [r.note] : [],
        tokenReason: choice === "excused" ? guessReason(r.token) : null,
      });
    } else {
      // Duas linhas da mesma aula avulsa no mesmo dia (o banco guarda uma): soma os tempos.
      slot.scheduled = Math.min(6, slot.scheduled + (scheduleIndex === null ? units : 0));
      slot.missed = Math.min(slot.scheduled, slot.missed + missed);
      slot.cancelled = slot.cancelled && choice === "cancelled";
      slot.excused ||= choice === "excused";
      slot.tokenReason ??= choice === "excused" ? guessReason(r.token) : null;
      if (r.reasonText) slot.reasons.push(r.reasonText);
      if (r.note) slot.notes.push(r.note);
    }
  }

  const attendance: ImportAttendance[] = [];
  const counts = { absences: 0, presences: 0, cancelled: 0, skipped: future + outside };
  for (const s of [...slots.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const reasonText = s.reasons.join("; ");
    const note = [...s.notes, ...(s.reasons.length > 0 ? [`Motivo: ${reasonText}`] : [])]
      .join(" · ")
      .slice(0, 500);
    const base = {
      subjectIndex: s.subjectIndex,
      scheduleIndex: s.scheduleIndex,
      classDate: s.date,
      ...(s.scheduleIndex === null ? { unitsScheduled: s.scheduled } : {}),
      ...(note ? { note } : {}),
    };
    if (s.cancelled && s.missed === 0) {
      attendance.push({ ...base, status: "cancelled", isExcused: false });
      counts.cancelled++;
    } else if (s.missed === 0) {
      attendance.push({ ...base, status: "present", isExcused: false });
      counts.presences++;
    } else {
      const reason = guessReason(reasonText) ?? s.tokenReason;
      counts.absences++;
      attendance.push(
        s.missed >= s.scheduled
          ? { ...base, status: "absent", isExcused: s.excused, reason }
          : {
              ...base,
              status: "partial",
              unitsMissed: s.missed,
              isExcused: s.excused,
              reason,
            },
      );
    }
  }

  if (attendance.length > MAX_IMPORT_ATTENDANCE) {
    return {
      ok: false,
      error: `São ${attendance.length} aulas; o máximo por importação é ${MAX_IMPORT_ATTENDANCE}. Divida a planilha por semestre.`,
    };
  }
  if (future > 0) {
    warnings.push(
      `${future} ${future === 1 ? "registro tem data" : "registros têm data"} no futuro e ${future === 1 ? "fica" : "ficam"} de fora.`,
    );
  }
  if (outside > 0) {
    warnings.push(
      `${outside} ${outside === 1 ? "registro fica" : "registros ficam"} fora das datas do semestre. Aumente o período para incluí-${outside === 1 ? "lo" : "los"}.`,
    );
  }

  const parsed = semesterImportBodySchema.safeParse({
    semester,
    subjects: included.map((s, i) => ({
      name: s.name.trim(),
      code: null,
      professor: null,
      color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
      unitsPerClass: s.unitsPerClass,
      excusedPolicy: "track_only",
      ...(s.countingMode === "workload"
        ? {
            countingMode: "workload",
            workloadHours: s.amount,
            workloadHourMinutes: 60,
            unitMinutes: 50,
            minAttendanceBp: Math.round(s.minPercent * 100),
          }
        : s.countingMode === "class_count"
          ? {
              countingMode: "class_count",
              totalClasses: s.amount,
              minAttendanceBp: Math.round(s.minPercent * 100),
            }
          : { countingMode: "manual", manualMaxUnits: s.amount }),
      schedules: s.weekdays.map((weekday) => ({
        weekday,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        units: s.unitsPerClass,
      })),
    })),
    exceptions: [],
    attendance,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const i = issue?.path[1];
    const subject = issue?.path[0] === "subjects" ? included[Number(i)]?.name : undefined;
    return {
      ok: false,
      error: subject
        ? `${subject}: ${issue?.message ?? "dado inválido"}`
        : `Confira os dados (${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "inválido"}).`,
    };
  }
  return { ok: true, body: parsed.data, counts, warnings };
}
