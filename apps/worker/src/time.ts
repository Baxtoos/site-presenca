export {
  localParts,
  zonedTimeToUtc,
  formatLocalDateTimeBR,
  type LocalParts,
} from "@presenca/engine";
import { localParts, zonedTimeToUtc } from "@presenca/engine";

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export function inQuietWindow(minutes: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

export function quietWindowEnd(now: Date, tz: string, end: string): Date {
  const local = localParts(now, tz);
  const date = local.minutes < toMinutes(end) ? local.date : addDaysIso(local.date, 1);
  return zonedTimeToUtc(date, end, tz);
}

const MINUTE = 60_000;
export const MAX_ATTEMPTS = 6;

export function retryDelayMs(attempts: number): number {
  return Math.min(MINUTE * 2 ** Math.max(0, attempts - 1), 6 * 60 * MINUTE);
}
