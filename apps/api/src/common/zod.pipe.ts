import { type PipeTransform, UnprocessableEntityException } from "@nestjs/common";
import { z } from "zod";

// Mensagens de validação em português.
z.config(z.locales.pt());

/**
 * Valida (e converte) corpo, query ou parâmetros com um schema de packages/contracts.
 * Uso: `@Body(new ZodPipe(createSemesterSchema)) body: CreateSemester`.
 */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        errors: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
