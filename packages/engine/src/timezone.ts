const FALLBACK_TZ = "America/Sao_Paulo";

export interface LocalParts {
  date: string;
  time: string;
  minutes: number;
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

export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall - offsetMs(new Date(wall), tz);
  guess = wall - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

const WEEKDAY_SHORT_BR = ["", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb.", "dom."];

export function formatLocalDateTimeBR(instant: Date, tz: string): string {
  const p = localParts(instant, tz);
  const [, month, day] = p.date.split("-");
  return `${WEEKDAY_SHORT_BR[p.weekday]}, ${day}/${month} às ${p.time}`;
}
