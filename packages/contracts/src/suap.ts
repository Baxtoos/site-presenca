import { z } from "zod";
import { isoDateSchema, timeSchema } from "./academic";

/**
 * Retrato do SUAP (IFSP e outros institutos com o mesmo sistema), montado no navegador do aluno
 * pelo favorito "Enviar para o Monitor" a partir das páginas que ele já vê logado: boletim e, de
 * cada turma, as aulas lançadas (com faltas por dia) e o horário. O Monitor nunca recebe a senha.
 */

export const suapLessonSchema = z.object({
  date: isoDateSchema,
  /** "Nº Aulas" do dia (tempos de 50 min). */
  units: z.number().int().min(1).max(12),
  /** "Nº Faltas" do dia. Aula futura vem com 0. */
  absences: z.number().int().min(0).max(12),
  /** "Faltas Abonadas" = Sim. */
  excused: z.boolean(),
  /** Conteúdo da aula (só nas faltas, para a anotação). */
  content: z.string().max(300).default(""),
});
export type SuapLesson = z.infer<typeof suapLessonSchema>;

/** Um tempo da grade (ex.: terça 08:50–09:40); a API junta os tempos seguidos num horário só. */
export const suapSlotSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startsAt: timeSchema,
  endsAt: timeSchema,
});
export type SuapSlot = z.infer<typeof suapSlotSchema>;

export const suapSubjectSchema = z.object({
  /** Número do diário (turma virtual). */
  diario: z.string().regex(/^\d{1,12}$/),
  /** Sigla da disciplina, ex.: "SLTESO1". Vira o código da matéria e identifica nas atualizações. */
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  plannedUnits: z.number().int().min(0).max(2000).nullable(),
  deliveredUnits: z.number().int().min(0).max(2000).nullable(),
  absences: z.number().int().min(0).max(2000).nullable(),
  frequencyPct: z.number().min(0).max(100).nullable(),
  professor: z.string().trim().max(120).nullable(),
  location: z.string().trim().max(300).nullable(),
  slots: z.array(suapSlotSchema).max(60),
  lessons: z.array(suapLessonSchema).max(400),
});
export type SuapSubject = z.infer<typeof suapSubjectSchema>;

export const SUAP_FORMAT = "suap";

export const suapSnapshotSchema = z.object({
  format: z.literal(SUAP_FORMAT),
  version: z.literal(1),
  /** Endereço do SUAP lido (ex.: suap.ifsp.edu.br). */
  host: z.string().max(100),
  /** Período letivo, ex.: "2026_2". */
  period: z.string().regex(/^\d{4}_[12]$/),
  subjects: z.array(suapSubjectSchema).min(1).max(30),
});
export type SuapSnapshot = z.infer<typeof suapSnapshotSchema>;

export const suapSyncBodySchema = z.object({
  /** Semestre a atualizar; null cria um novo. */
  semesterId: z.uuid().nullable(),
  /** Nome do semestre novo (padrão: "2026.2"). */
  label: z.string().trim().min(1).max(60).optional(),
  snapshot: suapSnapshotSchema,
});
export type SuapSyncBody = z.infer<typeof suapSyncBodySchema>;

export const suapSyncResultSchema = z.object({
  semesterId: z.uuid(),
  label: z.string(),
  createdSemester: z.boolean(),
  subjectsCreated: z.number().int(),
  /** Aulas lançadas no SUAP que viraram registros novos. */
  created: z.number().int(),
  /** Registros que já existiam e foram corrigidos pelo SUAP. */
  updated: z.number().int(),
  unchanged: z.number().int(),
  /** Aulas futuras já lançadas (não viram registro; ficam na grade). */
  future: z.number().int(),
});
export type SuapSyncResult = z.infer<typeof suapSyncResultSchema>;
