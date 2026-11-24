import { z } from "zod";

/**
 * Conector do Moodle. O aluno cola o link "Exportar calendário → Obter URL do calendário" (.ics) e,
 * se quiser, o endereço do Moodle e a chave de segurança (wstoken). A API nunca devolve o link
 * nem a chave: só o domínio e se há chave.
 */

const httpsUrl = (what: string, max = 2000) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use um link de ${what} com até ${max} caracteres.` })
    .pipe(
      z.url({
        protocol: /^https$/,
        hostname: z.regexes.domain,
        error: `Cole o link completo de ${what}, começando com https://.`,
      }),
    );

export const moodleConnectBodySchema = z
  .object({
    /**
     * Obrigatório na primeira conexão; depois, só para trocar o link. O https e o endereço público
     * são exigidos pela busca no servidor (proteção contra SSRF), que dá a mensagem certa.
     */
    icsUrl: z
      .string()
      .trim()
      .max(2000, { error: "Use um link com até 2000 caracteres." })
      .pipe(
        z.url({
          protocol: /^https?$/,
          error: "Cole o link completo do calendário, começando com https://.",
        }),
      )
      .optional(),
    /** Endereço do Moodle (necessário com a chave). null tira. */
    baseUrl: httpsUrl("endereço do Moodle", 300).nullable().optional(),
    /** Chave de segurança (Moodle mobile web service). null tira. */
    wstoken: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{16,128}$/, {
        error: "A chave de segurança tem só letras e números (copie inteira).",
      })
      .nullable()
      .optional(),
    syncEnabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { error: "Nada para salvar." });
export type MoodleConnectBody = z.infer<typeof moodleConnectBodySchema>;

export const moodleCourseSchema = z.object({
  id: z.uuid(),
  /** Código da turma como veio do Moodle (ex.: "SI.TESD5 - 2026-2"). */
  courseKey: z.string(),
  subjectId: z.uuid().nullable(),
  subjectName: z.string().nullable(),
  ignored: z.boolean(),
  /** Tarefas importadas desta turma. */
  taskCount: z.number().int(),
  version: z.number().int(),
});
export type MoodleCourse = z.infer<typeof moodleCourseSchema>;

export const moodleConnectionSchema = z.object({
  icsHost: z.string(),
  baseUrlHost: z.string().nullable(),
  hasToken: z.boolean(),
  syncEnabled: z.boolean(),
  lastSyncAt: z.iso.datetime({ offset: true }).nullable(),
  lastSyncError: z.string().nullable(),
  nextSyncAt: z.iso.datetime({ offset: true }),
  importedCount: z.number().int(),
  courses: z.array(moodleCourseSchema),
  version: z.number().int(),
});
export type MoodleConnection = z.infer<typeof moodleConnectionSchema>;

export const moodleStatusSchema = z.object({
  /** false: o servidor está sem a chave de cifragem (a integração fica desligada). */
  available: z.boolean(),
  connection: moodleConnectionSchema.nullable(),
});
export type MoodleStatus = z.infer<typeof moodleStatusSchema>;

export const moodleSyncResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  completed: z.number().int(),
  courses: z.number().int(),
  /** Sincronização parcial (o .ics veio, a consulta com a chave falhou). */
  warning: z.string().nullable(),
  status: moodleStatusSchema,
});
export type MoodleSyncResult = z.infer<typeof moodleSyncResultSchema>;

export const moodleCourseParamsSchema = z.object({ id: z.uuid({ error: "Turma inválida." }) });

export const moodleCourseBodySchema = z
  .object({
    subjectId: z.uuid({ error: "Matéria inválida." }).nullable(),
    ignored: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { error: "Nada para alterar." });
export type MoodleCourseBody = z.infer<typeof moodleCourseBodySchema>;

export const moodleDisconnectQuerySchema = z.object({
  /** true: as tarefas importadas viram manuais. false: apaga as futuras pendentes. */
  keepTasks: z.enum(["true", "false"]).default("true"),
});

export const MoodleErrorCode = {
  unavailable: "MOODLE_UNAVAILABLE",
  invalid: "MOODLE_INVALID",
  notConnected: "MOODLE_NOT_CONNECTED",
} as const;
