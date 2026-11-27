import type { SuapLesson, SuapSlot, SuapSubject } from "@presenca/contracts";

const SMALL = new Set([
  "a",
  "o",
  "as",
  "os",
  "e",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "na",
  "no",
  "para",
  "por",
  "com",
]);
export function prettyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .split(" ")
    .map((word, i) => {
      if (i > 0 && SMALL.has(word)) return word;
      if (
        /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(word) ||
        /^[^aeiouáéíóúâêôãõ]{2,4}$/.test(word)
      ) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function roomFrom(location: string | null): string | null {
  if (!location) return null;
  const codes = [...location.matchAll(/(?:^|\s|e\s)([A-Z]{1,3}-?\d{1,4}[A-Z]?)\s+-/g)].map(
    (m) => m[1]!,
  );
  const room = (codes.length > 0 ? [...new Set(codes)].join(" / ") : location).slice(0, 40).trim();
  return room || null;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export interface MergedSchedule {
  weekday: number;
  startsAt: string;
  endsAt: string;
  units: number;
}

export function mergeSlots(slots: SuapSlot[]): MergedSchedule[] {
  const sorted = [...slots]
    .filter((s) => minutes(s.endsAt) > minutes(s.startsAt))
    .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
  const out: MergedSchedule[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (
      last &&
      last.weekday === s.weekday &&
      minutes(s.startsAt) - minutes(last.endsAt) <= 20 &&
      minutes(s.startsAt) >= minutes(last.startsAt)
    ) {
      if (minutes(s.endsAt) > minutes(last.endsAt)) last.endsAt = s.endsAt;
      last.units = Math.min(6, last.units + 1);
    } else {
      out.push({ weekday: s.weekday, startsAt: s.startsAt, endsAt: s.endsAt, units: 1 });
    }
  }
  return out.slice(0, 14);
}

export function lessonsByDate(lessons: SuapLesson[]): SuapLesson[] {
  const byDate = new Map<string, SuapLesson>();
  for (const l of lessons) {
    const prev = byDate.get(l.date);
    if (!prev) byDate.set(l.date, { ...l });
    else {
      prev.units += l.units;
      prev.absences += l.absences;
      prev.excused ||= l.excused;
      if (!prev.content && l.content) prev.content = l.content;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
}

export function rulesFor(subject: SuapSubject, schedules: MergedSchedule[]) {
  const perMeeting =
    mostCommon(subject.lessons.map((l) => l.units).filter((u) => u <= 6)) ??
    mostCommon(schedules.map((s) => s.units)) ??
    2;
  const planned =
    subject.plannedUnits && subject.plannedUnits > 0
      ? subject.plannedUnits
      : subject.lessons.reduce((sum, l) => sum + l.units, 0);
  if (planned <= 0) {
    return { unitsPerClass: perMeeting, countingMode: "manual" as const, manualMaxUnits: 0 };
  }
  const divisible = planned % perMeeting === 0;
  const unitsPerClass = divisible ? perMeeting : 1;
  return {
    unitsPerClass,
    countingMode: "class_count" as const,
    totalClasses: Math.min(1000, planned / unitsPerClass),
    minAttendanceBp: 7500,
  };
}

export function attendanceFrom(lesson: SuapLesson) {
  const unitsScheduled = Math.min(6, Math.max(1, lesson.units));
  const unitsMissed = Math.min(unitsScheduled, lesson.absences);
  const status: "present" | "absent" | "partial" =
    unitsMissed === 0 ? "present" : unitsMissed >= unitsScheduled ? "absent" : "partial";
  return {
    status,
    unitsScheduled,
    unitsMissed,
    isExcused: unitsMissed > 0 && lesson.excused,
  };
}

export function semesterRange(period: string, lessonDates: string[]) {
  const [year, half] = period.split("_");
  const [stdStart, stdEnd] =
    half === "1" ? [`${year}-02-02`, `${year}-07-03`] : [`${year}-08-03`, `${year}-12-18`];
  const sorted = [...lessonDates].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  return {
    label: `${year}.${half}`,
    startsOn: first ?? stdStart,
    endsOn: last && last > stdEnd ? last : stdEnd,
  };
}
