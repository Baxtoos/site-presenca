import { z } from "zod";

/**
 * Formato padrão de erro da API (RFC 9457, application/problem+json).
 * `code` é estável e pode ser usado pelo front para decidir a mensagem.
 */
export const problemSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  detail: z.string().optional(),
  requestId: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});
export type Problem = z.infer<typeof problemSchema>;
