/**
 * Calendário de aulas: quais dias a matéria tem aula, descontando feriados, e o simulador
 * "posso faltar?" sobre as próximas aulas reais.
 *
 * Datas são strings ISO "AAAA-MM-DD" (data local do aluno, sem hora nem fuso): a conta é feita
 * em UTC só para andar de dia em dia, sem risco de horário de verão pular ou repetir um dia.
 */

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

/** Dia da semana ISO: 1 = segunda … 7 = domingo. */
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
  /** holiday e no_classes cancelam aula; exam_week é só informativo. */
  kind: "holiday" | "no_classes" | "exam_week";
}

export interface ClassOccurrence {
  date: IsoDate;
  units: number;
  scheduleId?: string;
}

/**
 * Todas as aulas da grade entre `from` e `to` (inclusive), em ordem, sem as que caem em
 * feriado ou dia sem aula. Limite de 400 dias por chamada (um semestre tem ~140).
 */
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
  /** Quantas das próximas aulas dá para faltar seguidas sem passar do limite. */
  classes: number;
  /** Tempos que essas faltas consomem. */
  units: number;
  /** Data da última aula que dá para faltar (null se nenhuma). */
  untilDate: IsoDate | null;
  /** Primeira aula que já faria passar do limite (null se o semestre acaba antes). */
  firstUnsafe: ClassOccurrence | null;
}

/**
 * "Posso faltar?" sobre as aulas reais: soma os tempos das próximas aulas, em ordem, enquanto
 * couberem no saldo. Aulas geminadas pesam mais; feriados já vieram descontados.
 */
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
