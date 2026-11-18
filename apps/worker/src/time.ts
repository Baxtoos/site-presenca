/** Horas e datas no fuso de cada aluno, sem biblioteca (Intl). */

const FALLBACK_TZ = "America/Sao_Paulo";

export interface LocalParts {
  /** "AAAA-MM-DD" */
  date: string;
  /** "HH:MM" (24 h) */
  time: string;
  /** Minutos desde a meia-noite local. */
  minutes: number;
  /** ISO: 1 = segunda … 7 = domingo. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        weekday: "short",
      });
    } catch {
      // Fuso inválido no cadastro: usa o padrão do app em vez de derrubar o worker.
      return formatter(FALLBACK_TZ);
    }
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function parts(instant: Date, tz: string) {
  const map = Object.fromEntries(
    formatter(tz)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return map as Record<"year" | "month" | "day" | "hour" | "minute" | "second" | "weekday", string>;
}

export function localParts(instant: Date, tz: string): LocalParts {
  const p = parts(instant, tz);
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${String(hour).padStart(2, "0")}:${p.minute}`,
    minutes: hour * 60 + minute,
    weekday: WEEKDAY[p.weekday] ?? 1,
  };
}

/** Diferença entre o relógio local e o UTC num instante (ms). */
function offsetMs(instant: Date, tz: string): number {
  const p = parts(instant, tz);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante em que o relógio do fuso marca `date` `time` (ex.: 2026-11-18 07:00 em São Paulo). */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Duas passadas acertam também os dias de mudança de horário de verão.
  let guess = wall - offsetMs(new Date(wall), tz);
  guess = wall - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** Dentro do horário silencioso? Aceita janelas que viram a noite (22:00–07:00). */
export function inQuietWindow(minutes: number, start: string, end: string): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Próximo instante (a partir de agora) em que o relógio local marca o fim do silêncio. */
export function quietWindowEnd(now: Date, tz: string, end: string): Date {
  const local = localParts(now, tz);
  const date = local.minutes < toMinutes(end) ? local.date : addDaysIso(local.date, 1);
  return zonedTimeToUtc(date, end, tz);
}

const MINUTE = 60_000;
export const MAX_ATTEMPTS = 6;

/** Espera antes da próxima tentativa: 1, 2, 4, 8, 16 min… (no máximo 6 h). */
export function retryDelayMs(attempts: number): number {
  return Math.min(MINUTE * 2 ** Math.max(0, attempts - 1), 6 * 60 * MINUTE);
}
