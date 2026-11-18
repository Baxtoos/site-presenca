import type { MeResponse } from "@presenca/contracts";
import type { schema } from "@presenca/db";

type UserRow = typeof schema.users.$inferSelect;

export function toMe(user: UserRow): MeResponse {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    fullName: user.fullName,
    institution: user.institution,
    course: user.course,
    currentTerm: user.currentTerm,
    timezone: user.timezone,
    onboarded: user.onboardedAt !== null,
    hasPassword: user.passwordHash !== null,
  };
}

/** Nome provisório para contas criadas sem formulário (magic link): "ana.ribeiro@x" → "Ana Ribeiro". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return (words.join(" ") || "Estudante").slice(0, 120);
}

/** O Postgres sinaliza violação de unicidade com o código 23505 (o Drizzle embrulha em `cause`). */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  return candidates.some(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      (e as { code?: string }).code === "23505" &&
      (e as { constraint?: string }).constraint === constraint,
  );
}
