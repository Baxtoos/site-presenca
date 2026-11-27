import { createHash } from "node:crypto";
import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AttendanceErrorCode } from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { and, eq, lt, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

const KEY_FORMAT = /^[A-Za-z0-9._:-]{8,128}$/;

export function parseIdempotencyKey(header: string | string[] | undefined): string {
  if (header === undefined || (typeof header === "string" && header.trim() === "")) {
    throw new HttpException(
      {
        code: AttendanceErrorCode.idempotencyKeyRequired,
        detail: "Envie o cabeçalho Idempotency-Key com um identificador único desta ação.",
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  if (Array.isArray(header)) {
    throw new BadRequestException({ detail: "Envie um único cabeçalho Idempotency-Key." });
  }
  const key = header.trim();
  if (!KEY_FORMAT.test(key)) {
    throw new BadRequestException({
      detail: "Idempotency-Key inválida: use de 8 a 128 caracteres (letras, números, . _ : -).",
    });
  }
  return key;
}

export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  parseIdempotencyKey(ctx.switchToHttp().getRequest<FastifyRequest>().headers["idempotency-key"]),
);

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

const TTL_HOURS = 24;

@Injectable()
export class IdempotencyService {
  async run<T>(
    tx: Tx,
    key: string,
    requestBody: unknown,
    action: () => Promise<{ status: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    const { idempotencyKeys } = schema;
    const requestHash = createHash("sha256").update(stableStringify(requestBody)).digest();

    await tx
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, sql`app.current_user_id()`),
          eq(idempotencyKeys.key, key),
          lt(idempotencyKeys.createdAt, sql`now() - make_interval(hours => ${TTL_HOURS})`),
        ),
      );

    const inserted = await tx
      .insert(idempotencyKeys)
      .values({ userId: sql`app.current_user_id()`, key, requestHash, statusCode: 201 })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (inserted.length === 0) {
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(eq(idempotencyKeys.userId, sql`app.current_user_id()`), eq(idempotencyKeys.key, key)),
        );
      if (!existing) throw new Error("idempotency_keys: linha sumiu entre o conflito e a leitura");
      if (!existing.requestHash.equals(requestHash)) {
        throw new UnprocessableEntityException({
          code: AttendanceErrorCode.idempotencyKeyReused,
          detail:
            "Esta Idempotency-Key já foi usada com outro conteúdo. Gere uma chave nova para uma nova ação.",
        });
      }
      return { status: existing.statusCode, body: existing.responseBody as T, replayed: true };
    }

    const result = await action();
    await tx
      .update(idempotencyKeys)
      .set({ statusCode: result.status, responseBody: result.body })
      .where(
        and(eq(idempotencyKeys.userId, sql`app.current_user_id()`), eq(idempotencyKeys.key, key)),
      );
    return { ...result, replayed: false };
  }
}
