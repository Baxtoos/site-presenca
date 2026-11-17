import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "precisa ser uma URL postgres://"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
