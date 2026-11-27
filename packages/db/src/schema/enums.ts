import { app } from "./_shared";

export const userStatus = app.enum("user_status", ["active", "disabled", "pending_deletion"]);
export const tokenPurpose = app.enum("token_purpose", [
  "verify_email",
  "reset_password",
  "magic_link",
  "register",
  "delete_account",
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
  "no_call",
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
  "grade_posted",
]);
export const notificationChannel = app.enum("notification_channel", ["email", "push", "in_app"]);
export const notificationStatus = app.enum("notification_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
]);

export const taskStatus = app.enum("task_status", ["pending", "completed", "not_completed"]);
export const taskSource = app.enum("task_source", ["manual", "moodle_ics", "moodle_api"]);
export const taskStatusSource = app.enum("task_status_source", ["user", "sync"]);
