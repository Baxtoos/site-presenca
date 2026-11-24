import { zonedTimeToUtc } from "@presenca/engine";

/**
 * Leitor de iCalendar (RFC 5545) suficiente para o "Exportar calendário" do Moodle: linhas dobradas,
 * parâmetros com aspas, textos escapados, datas em UTC (Z), com TZID (nomes IANA) ou flutuantes
 * (fuso do aluno) e dias inteiros. Ignora o que não é VEVENT. Tem limites para não travar com um
 * arquivo hostil.
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  categories: string[];
  url: string | null;
  start: Date;
  end: Date | null;
  /** DTSTART só com a data (dia inteiro). */
  allDay: boolean;
}

export class IcsError extends Error {
  override name = "IcsError";
}

const MAX_EVENTS = 3000;
const MAX_LINE = 20_000;

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** "DTSTART;TZID=\"America/Sao_Paulo\":20261130T235900" → nome, parâmetros e valor. */
function parseLine(line: string): Property | null {
  let i = 0;
  let inQuotes = false;
  let colon = -1;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let current = "";
  inQuotes = false;
  for (const c of head) {
    if (c === '"') inQuotes = !inQuotes;
    if (c === ";" && !inQuotes) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  const [name, ...rawParams] = parts;
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value };
}

/** Texto do iCal: \n, \, \; e \\. */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** CATEGORIES separa por vírgula não escapada. */
function splitList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && i + 1 < value.length) {
      current += c + value[i + 1];
      i++;
    } else if (c === ",") {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out.map((v) => unescapeText(v).trim()).filter(Boolean);
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** DTSTART/DTEND → instante. `fallbackTz` vale para hora flutuante, dia inteiro e TZID desconhecido. */
function parseDate(prop: Property, fallbackTz: string): { at: Date; allDay: boolean } | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || prop.params.VALUE === "DATE") {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    // Dia inteiro: o prazo é o fim do dia no fuso do aluno.
    return { at: zonedTimeToUtc(`${m[1]}-${m[2]}-${m[3]}`, "23:59", fallbackTz), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    const at = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
    return Number.isNaN(at.getTime()) ? null : { at, allDay: false };
  }
  const tz = prop.params.TZID && validZone(prop.params.TZID) ? prop.params.TZID : fallbackTz;
  return { at: zonedTimeToUtc(`${y}-${mo}-${d}`, `${h}:${mi}`, tz), allDay: false };
}

export function parseIcs(text: string, fallbackTz = "America/Sao_Paulo"): IcsEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new IcsError("O arquivo não é um calendário (.ics).");
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: IcsEvent[] = [];
  let current: Property[] | null = null;
  let depth = 0;
  for (const raw of lines) {
    if (raw.length > MAX_LINE) continue;
    const line = raw.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (current && upper.startsWith("BEGIN:")) {
      depth++; // VALARM dentro do evento
      continue;
    }
    if (current && upper.startsWith("END:") && upper !== "END:VEVENT") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (upper === "END:VEVENT") {
      const event = current ? toEvent(current, fallbackTz) : null;
      if (event) events.push(event);
      if (events.length >= MAX_EVENTS) break;
      current = null;
      continue;
    }
    if (current && depth === 0) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }
  return events;
}

function toEvent(props: Property[], fallbackTz: string): IcsEvent | null {
  const get = (name: string) => props.find((p) => p.name === name);
  const uid = get("UID")?.value.trim();
  const startProp = get("DTSTART");
  if (!uid || !startProp) return null;
  const start = parseDate(startProp, fallbackTz);
  if (!start) return null;
  const endProp = get("DTEND");
  const end = endProp ? parseDate(endProp, fallbackTz) : null;
  const url = get("URL")?.value.trim() ?? null;
  return {
    uid: uid.slice(0, 500),
    summary: unescapeText(get("SUMMARY")?.value ?? "").trim(),
    description: unescapeText(get("DESCRIPTION")?.value ?? "").trim(),
    categories: props.filter((p) => p.name === "CATEGORIES").flatMap((p) => splitList(p.value)),
    url: url && /^https:\/\//i.test(url) ? url : null,
    start: start.at,
    end: end?.at ?? null,
    allDay: start.allDay,
  };
}
