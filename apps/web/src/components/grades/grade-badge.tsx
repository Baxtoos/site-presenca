import { GRADE_STATUS_LABEL, type GradeStatusDto } from "@presenca/contracts";
import { GRADE_STATUS_STYLE } from "@/lib/grades";

export function GradeBadge({ status }: { status: GradeStatusDto }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${GRADE_STATUS_STYLE[status]}`}
      data-testid="selo-nota"
    >
      Nota: {GRADE_STATUS_LABEL[status]}
    </span>
  );
}
