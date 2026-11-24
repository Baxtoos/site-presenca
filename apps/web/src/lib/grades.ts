import type { GradeStatusDto } from "@presenca/contracts";

/** Cor de cada situação da nota (selo na matéria e na aba Notas). */
export const GRADE_STATUS_STYLE: Record<GradeStatusDto, string> = {
  aprovado_por_nota: "bg-ok-soft text-ok",
  em_curso: "bg-accent-soft text-accent",
  em_exame: "bg-warn-soft text-warn",
  sem_chance_direta: "bg-warn-soft text-warn",
  reprovado_por_nota: "bg-fail-soft text-fail",
};
