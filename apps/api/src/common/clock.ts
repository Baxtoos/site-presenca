import { Injectable } from "@nestjs/common";

@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }

  todayIn(timezone: string): string {
    return localDate(this.now(), timezone);
  }
}

export function localDate(instant: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}
