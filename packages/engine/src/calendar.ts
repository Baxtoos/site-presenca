export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: IsoDate): Date {
  if (!ISO_DATE.test(date)) throw new RangeError(`data inválida: ${date}`);
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`data inválida: ${date}`);
  }
  return d;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoWeekday(date: IsoDate): number {
  const day = toUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export interface ScheduleSlot {
  id?: string;
  weekday: number;
  units: number;
  validFrom?: IsoDate | null;
  validUntil?: IsoDate | null;
}

export interface CalendarException {
  startsOn: IsoDate;
  endsOn: IsoDate;
  kind: "holiday" | "no_classes" | "exam_week";
}

export interface ClassOccurrence {
  date: IsoDate;
  units: number;
  scheduleId?: string;
}

export function classOccurrences(params: {
  schedules: readonly ScheduleSlot[];
  exceptions: readonly CalendarException[];
  from: IsoDate;
  to: IsoDate;
}): ClassOccurrence[] {
  const { schedules, exceptions, from, to } = params;
  if (from > to) return [];
  const span = (toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000;
  if (span > 400) throw new RangeError("intervalo maior que 400 dias");

  const blocking = exceptions.filter((e) => e.kind !== "exam_week");
  const result: ClassOccurrence[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (blocking.some((e) => e.startsOn <= date && date <= e.endsOn)) continue;
    const weekday = isoWeekday(date);
    for (const slot of schedules) {
      if (slot.weekday !== weekday) continue;
      if (slot.validFrom && date < slot.validFrom) continue;
      if (slot.validUntil && date > slot.validUntil) continue;
      result.push({ date, units: slot.units, ...(slot.id ? { scheduleId: slot.id } : {}) });
    }
  }
  return result;
}

export interface SkipPlan {
  classes: number;
  units: number;
  untilDate: IsoDate | null;
  firstUnsafe: ClassOccurrence | null;
}

export function planSkips(remainingUnits: number, upcoming: readonly ClassOccurrence[]): SkipPlan {
  let used = 0;
  let classes = 0;
  let untilDate: IsoDate | null = null;
  for (const occurrence of upcoming) {
    if (used + occurrence.units > remainingUnits) {
      return { classes, units: used, untilDate, firstUnsafe: occurrence };
    }
    used += occurrence.units;
    classes += 1;
    untilDate = occurrence.date;
  }
  return { classes, units: used, untilDate, firstUnsafe: null };
}

export function monthRange(month: string): { first: IsoDate; last: IsoDate } {
  const first = `${month}-01`;
  const d = toUtc(first);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { first, last: last.toISOString().slice(0, 10) };
}

export function shiftMonth(month: string, delta: number): string {
  const d = toUtc(`${month}-01`);
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

export interface MonthGrid {
  month: string;
  first: IsoDate;
  last: IsoDate;
  gridFrom: IsoDate;
  gridTo: IsoDate;
  weeks: IsoDate[][];
}

export function monthGrid(month: string): MonthGrid {
  const { first, last } = monthRange(month);
  const gridFrom = addDays(first, 1 - isoWeekday(first));
  const gridTo = addDays(last, 7 - isoWeekday(last));
  const weeks: IsoDate[][] = [];
  for (let start = gridFrom; start <= gridTo; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return { month, first, last, gridFrom, gridTo, weeks };
}
