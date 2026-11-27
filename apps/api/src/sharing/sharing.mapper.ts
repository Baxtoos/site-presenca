import {
  type SemesterTemplatePayload,
  type SharedTemplate,
  type SubjectTemplatePayload,
  type TemplatePreview,
  type TemplateSubject,
  templateSubjectSchema,
} from "@presenca/contracts";
import { schema } from "@presenca/db";
import { maxAbsenceUnits, type SubjectRules } from "@presenca/engine";

type SubjectRow = typeof schema.subjects.$inferSelect;
type ScheduleRow = typeof schema.subjectSchedules.$inferSelect;
type TemplateRow = typeof schema.sharedTemplates.$inferSelect;

const hhmm = (t: string) => t.slice(0, 5);

export function subjectToTemplate(row: SubjectRow, schedules: ScheduleRow[]): TemplateSubject {
  const base = {
    name: row.name,
    code: row.code,
    professor: row.professor,
    color: row.color as TemplateSubject["color"],
    unitsPerClass: row.unitsPerClass,
    excusedPolicy: row.excusedPolicy,
    schedules: schedules
      .slice()
      .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt))
      .map((s) => ({
        weekday: s.weekday,
        startsAt: hhmm(s.startsAt),
        endsAt: hhmm(s.endsAt),
        units: s.units,
        room: s.room,
        building: s.building,
        professor: s.professor,
        validFrom: s.validFrom,
        validUntil: s.validUntil,
      })),
  };
  const rules =
    row.countingMode === "class_count"
      ? {
          countingMode: "class_count",
          totalClasses: row.totalClasses,
          minAttendanceBp: row.minAttendanceBp,
        }
      : row.countingMode === "workload"
        ? {
            countingMode: "workload",
            workloadHours: Number(row.workloadHours),
            workloadHourMinutes: row.workloadHourMinutes,
            unitMinutes: row.unitMinutes,
            minAttendanceBp: row.minAttendanceBp,
          }
        : {
            countingMode: "manual",
            manualMaxUnits: row.manualMaxUnits,
            totalClasses: row.totalClasses,
          };
  return templateSubjectSchema.parse({ ...base, ...rules });
}

export function rulesFromTemplate(s: TemplateSubject): SubjectRules {
  switch (s.countingMode) {
    case "class_count":
      return {
        mode: "class_count",
        totalClasses: s.totalClasses,
        unitsPerClass: s.unitsPerClass,
        minAttendanceBp: s.minAttendanceBp,
      };
    case "workload":
      return {
        mode: "workload",
        workloadHours: s.workloadHours,
        workloadHourMinutes: s.workloadHourMinutes,
        unitMinutes: s.unitMinutes,
        unitsPerClass: s.unitsPerClass,
        minAttendanceBp: s.minAttendanceBp,
      };
    case "manual":
      return {
        mode: "manual",
        manualMaxUnits: s.manualMaxUnits,
        unitsPerClass: s.unitsPerClass,
        ...(s.totalClasses ? { totalClasses: s.totalClasses } : {}),
      };
  }
}

function previewSubject(
  s: TemplateSubject,
  hasGrading = false,
): TemplatePreview["subjects"][number] {
  return {
    name: s.name,
    hasGrading,
    professor: s.professor ?? null,
    color: s.color ?? null,
    unitsPerClass: s.unitsPerClass,
    maxAbsenceUnits: maxAbsenceUnits(rulesFromTemplate(s)),
    schedules: s.schedules.map((x) => ({
      weekday: x.weekday,
      startsAt: x.startsAt,
      endsAt: x.endsAt,
      room: x.room ?? null,
    })),
  };
}

export function toPreview(
  head: Pick<
    TemplatePreview,
    "code" | "kind" | "title" | "institution" | "course" | "usesCount" | "expiresAt"
  >,
  payload: SemesterTemplatePayload | SubjectTemplatePayload,
): TemplatePreview {
  if ("semester" in payload) {
    return {
      ...head,
      semester: payload.semester,
      subjects: payload.subjects.map((s, i) =>
        previewSubject(
          s,
          payload.gradings.some((g) => g.subjectIndex === i),
        ),
      ),
      exceptions: payload.exceptions.map((e) => ({
        startsOn: e.startsOn,
        endsOn: e.endsOn,
        label: e.label,
      })),
    };
  }
  return {
    ...head,
    semester: null,
    subjects: [previewSubject(payload.subject, payload.grading !== null)],
    exceptions: [],
  };
}

export function toSharedTemplate(row: TemplateRow, now: Date): SharedTemplate {
  const status: SharedTemplate["status"] = row.revokedAt
    ? "revoked"
    : row.expiresAt && row.expiresAt <= now
      ? "expired"
      : row.maxUses !== null && row.usesCount >= row.maxUses
        ? "exhausted"
        : "active";
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    title: row.title,
    institution: row.institution,
    course: row.course,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxUses: row.maxUses,
    usesCount: row.usesCount,
    status,
    createdAt: row.createdAt.toISOString(),
  };
}
