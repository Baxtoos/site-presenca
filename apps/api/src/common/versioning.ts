import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { AcademicErrorCode } from "@presenca/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

export function parseIfMatch(header: string | undefined): number {
  if (header === undefined || header.trim() === "") {
    throw new HttpException(
      {
        code: AcademicErrorCode.versionRequired,
        detail: "Envie o cabeçalho If-Match com a versão que você está editando.",
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header.trim());
  if (!match) {
    throw new BadRequestException({ detail: 'If-Match inválido: use a versão do ETag, ex.: "3".' });
  }
  return Number(match[1]);
}

export const IfMatchVersion = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  parseIfMatch(ctx.switchToHttp().getRequest<FastifyRequest>().headers["if-match"]),
);

export function setEtag(reply: FastifyReply, version: number): void {
  void reply.header("etag", `"${version}"`);
}

export function versionMismatch(): HttpException {
  return new HttpException(
    {
      code: AcademicErrorCode.versionMismatch,
      detail: "Isto foi alterado em outro lugar depois que você abriu. Recarregue e tente de novo.",
    },
    HttpStatus.PRECONDITION_FAILED,
  );
}

export async function assertVersioned<T>(
  rows: T[],
  exists: () => Promise<boolean>,
  notFoundDetail = "Não encontrado.",
): Promise<T> {
  if (rows[0] !== undefined) return rows[0];
  if (await exists()) throw versionMismatch();
  throw new NotFoundException({ detail: notFoundDetail });
}
