import { resolve } from "node:path";
import { createDb, schema, withUser, type Tx } from "../index";

if (process.env.NODE_ENV === "production") {
  console.error("O seed é só para desenvolvimento.");
  process.exit(1);
}
try {
  process.loadEnvFile(resolve(__dirname, "../../../../.env"));
} catch {}

const DEMO_USER_ID = "01960000-0000-7000-8000-000000000001";
const DEMO_EMAIL = "demo@presenca.local";
const SEMESTER = { label: "2026.2", startsOn: "2026-08-03", endsOn: "2026-12-18" };
const TODAY = new Date().toISOString().slice(0, 10);

const HOLIDAYS = [
  { date: "2026-09-07", label: "Independência do Brasil" },
  { date: "2026-10-12", label: "Nossa Senhora Aparecida" },
  { date: "2026-11-02", label: "Finados" },
  { date: "2026-11-20", label: "Dia da Consciência Negra" },
];

type SubjectSeed = {
  values: Omit<typeof schema.subjects.$inferInsert, "userId" | "semesterId">;
  schedules: { weekday: number; startsAt: string; endsAt: string; units: number; room: string }[];
  absences: number[];
  excused?: number[];
};

const SUBJECTS: SubjectSeed[] = [
  {
    values: {
      name: "Cálculo II",
      code: "MAT0202",
      professor: "Prof. Andrade",
      color: "blue",
      countingMode: "workload",
      workloadHours: "60",
      workloadHourMinutes: 60,
      unitMinutes: 50,
      unitsPerClass: 2,
      minAttendanceBp: 7500,
    },
    schedules: [
      { weekday: 1, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
      { weekday: 3, startsAt: "19:00", endsAt: "20:40", units: 2, room: "B-204" },
    ],
    absences: [3, 11, 19],
  },
  {
    values: {
      name: "Algoritmos e Estruturas de Dados",
      code: "COMP0110",
      professor: "Prof. Souza",
      color: "violet",
      countingMode: "workload",
      workloadHours: "80",
      workloadHourMinutes: 60,
      unitMinutes: 50,
      unitsPerClass: 2,
      minAttendanceBp: 7500,
    },
    schedules: [
      { weekday: 2, startsAt: "19:00", endsAt: "20:40", units: 2, room: "Lab 3" },
      { weekday: 4, startsAt: "19:00", endsAt: "20:40", units: 2, room: "Lab 3" },
    ],
    absences: [1, 6, 9, 14, 17, 22, 25],
  },
  {
    values: {
      name: "Física Experimental I",
      code: "FIS0151",
      professor: "Profa. Lima",
      color: "amber",
      countingMode: "class_count",
      totalClasses: 36,
      unitsPerClass: 1,
      minAttendanceBp: 8500,
    },
    schedules: [{ weekday: 5, startsAt: "19:00", endsAt: "19:50", units: 1, room: "Lab Física" }],
    absences: [2, 5, 8, 12],
    excused: [5],
  },
  {
    values: {
      name: "Estatística",
      code: "EST0101",
      professor: "Profa. Reis",
      color: "teal",
      countingMode: "class_count",
      totalClasses: 40,
      unitsPerClass: 1,
      minAttendanceBp: 8000,
    },
    schedules: [{ weekday: 6, startsAt: "08:00", endsAt: "08:50", units: 1, room: "A-101" }],
    absences: [0, 1, 3, 5, 7, 9, 11, 13],
  },
];

function occurrences(weekday: number): string[] {
  const dates: string[] = [];
  const end = TODAY < SEMESTER.endsOn ? TODAY : SEMESTER.endsOn;
  for (
    let d = new Date(`${SEMESTER.startsOn}T12:00:00Z`);
    d.toISOString().slice(0, 10) <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (iso === weekday) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function seedSubject(tx: Tx, semesterId: string, seed: SubjectSeed): Promise<number> {
  const [subject] = await tx
    .insert(schema.subjects)
    .values({ ...seed.values, userId: DEMO_USER_ID, semesterId })
    .returning({ id: schema.subjects.id });

  const slots: { date: string; scheduleId: string; units: number }[] = [];
  for (const s of seed.schedules) {
    const [schedule] = await tx
      .insert(schema.subjectSchedules)
      .values({ ...s, userId: DEMO_USER_ID, subjectId: subject!.id })
      .returning({ id: schema.subjectSchedules.id });
    for (const date of occurrences(s.weekday)) {
      slots.push({ date, scheduleId: schedule!.id, units: s.units });
    }
  }
  slots.sort((a, b) => a.date.localeCompare(b.date));

  const holidays = new Set(HOLIDAYS.map((h) => h.date));
  let classIndex = 0;
  const rows = slots.map((slot) => {
    const base = {
      userId: DEMO_USER_ID,
      subjectId: subject!.id,
      scheduleId: slot.scheduleId,
      classDate: slot.date,
      unitsScheduled: slot.units,
    };
    if (holidays.has(slot.date)) return { ...base, status: "cancelled" as const, unitsMissed: 0 };
    const i = classIndex++;
    if (!seed.absences.includes(i)) return { ...base, status: "present" as const, unitsMissed: 0 };
    const excused = seed.excused?.includes(i) ?? false;
    return {
      ...base,
      status: "absent" as const,
      unitsMissed: slot.units,
      isExcused: excused,
      reason: excused ? ("health" as const) : ("personal" as const),
      note: excused ? "Atestado médico entregue na secretaria." : null,
    };
  });
  if (rows.length > 0) await tx.insert(schema.attendanceLogs).values(rows);
  return rows.length;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida (veja .env.example)");
  const handle = createDb({ connectionString: url, applicationName: "presenca-seed" });

  try {
    const summary = await withUser(
      handle.db,
      { userId: DEMO_USER_ID, requestId: "seed" },
      async (tx) => {
        const existing = await tx.query.users.findFirst({ columns: { id: true } });
        if (existing) return null;

        await tx.insert(schema.users).values({
          id: DEMO_USER_ID,
          email: DEMO_EMAIL,
          fullName: "Ana Ribeiro (demo)",
          institution: "Universidade Exemplo",
          course: "Engenharia de Computação",
          currentTerm: 4,
          emailVerifiedAt: new Date(),
          onboardedAt: new Date(),
        });
        await tx.insert(schema.notificationPreferences).values({ userId: DEMO_USER_ID });

        const [semester] = await tx
          .insert(schema.semesters)
          .values({ ...SEMESTER, userId: DEMO_USER_ID, isCurrent: true })
          .returning({ id: schema.semesters.id });

        await tx.insert(schema.calendarExceptions).values(
          HOLIDAYS.map((h) => ({
            userId: DEMO_USER_ID,
            semesterId: semester!.id,
            startsOn: h.date,
            endsOn: h.date,
            kind: "holiday" as const,
            label: h.label,
          })),
        );

        let logs = 0;
        for (const subject of SUBJECTS) logs += await seedSubject(tx, semester!.id, subject);
        return { subjects: SUBJECTS.length, logs };
      },
    );

    if (summary === null) {
      console.log(
        `Seed já aplicado (${DEMO_EMAIL}). Para recomeçar: pnpm infra:reset && pnpm db:setup`,
      );
    } else {
      console.log(
        `Seed aplicado: ${DEMO_EMAIL}, semestre ${SEMESTER.label}, ${summary.subjects} matérias, ${summary.logs} registros de aula.`,
      );
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error("Falha no seed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
