import { app } from "./_shared";

export const userStatus = app.enum("user_status", ["active", "disabled", "pending_deletion"]);
export const tokenPurpose = app.enum("token_purpose", [
  "verify_email",
  "reset_password",
  "magic_link",
  /** Cadastro pendente: a conta só é criada quando a pessoa confirma o e-mail (migration 0009). */
  "register",
  /** Exclusão de conta confirmada por e-mail, para quem não tem senha (migration 0009). */
  "delete_account",
  /** Ligar o segundo fator em conta sem senha, confirmado por e-mail (migration 0010). */
  "mfa_enable",
]);

export const semesterStatus = app.enum("semester_status", ["active", "archived"]);
export const countingMode = app.enum("counting_mode", ["class_count", "workload", "manual"]);
export const excusedPolicy = app.enum("excused_policy", ["track_only", "deduct"]);
export const exceptionKind = app.enum("exception_kind", ["holiday", "no_classes", "exam_week"]);

export const attendanceStatus = app.enum("attendance_status", [
  "present",
  "absent",
  "partial",
  "cancelled",
]);
export const absenceReason = app.enum("absence_reason", [
  "health",
  "work",
  "transport",
  "personal",
  "other",
]);
export const auditAction = app.enum("audit_action", ["insert", "update", "delete"]);

export const templateKind = app.enum("template_kind", ["semester", "subject"]);

export const checkinMode = app.enum("checkin_mode", ["off", "daily", "weekly"]);
export const notificationKind = app.enum("notification_kind", [
  "threshold",
  "checkin_reminder",
  "system",
  "task_due",
]);
export const notificationChannel = app.enum("notification_channel", ["email", "push", "in_app"]);
export const notificationStatus = app.enum("notification_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
]);

/** Tarefas e entregas: pendente até o aluno marcar se concluiu ou não. */
export const taskStatus = app.enum("task_status", ["pending", "completed", "not_completed"]);
/** De onde veio a tarefa: digitada pelo aluno ou importada (Moodle). */
export const taskSource = app.enum("task_source", ["manual", "moodle_ics", "moodle_api"]);
/** Quem definiu o status: o aluno (sempre vence) ou a sincronização. */
export const taskStatusSource = app.enum("task_status_source", ["user", "sync"]);
