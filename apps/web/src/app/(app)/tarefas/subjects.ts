import { semestersResponseSchema, subjectsResponseSchema } from "@presenca/contracts";
import { apiGet } from "@/lib/api-server";

/** Matérias do semestre atual (para vincular e filtrar tarefas). */
export async function currentSubjects(): Promise<{ id: string; name: string }[]> {
  const { semesters } = await apiGet("/v1/semesters", semestersResponseSchema);
  const current = semesters.find((s) => s.isCurrent);
  if (!current) return [];
  const { subjects } = await apiGet(`/v1/semesters/${current.id}/subjects`, subjectsResponseSchema);
  return subjects.map((s) => ({ id: s.id, name: s.name }));
}
