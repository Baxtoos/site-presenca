import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessCheckSchema = z.object({
  status: z.enum(["up", "down"]),
  latencyMs: z.number().nonnegative().optional(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.record(z.string(), readinessCheckSchema),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
