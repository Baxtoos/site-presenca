import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export interface AuthContext {
  userId: string;
  sessionId: string;
  emailVerified: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido pelo SessionGuard em rotas autenticadas. */
    auth?: AuthContext;
  }
}

export const IS_PUBLIC = "auth:public";
export const REQUIRE_VERIFIED = "auth:require-verified";

/** Rota sem sessão (login, cadastro, saúde). Por padrão, toda rota exige sessão. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Exige e-mail verificado (ex.: compartilhar grade, alertas por e-mail). */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED, true);

/** Injeta o contexto da sessão atual no handler. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<FastifyRequest>().auth;
  if (!auth) throw new Error("@CurrentAuth() usado numa rota pública");
  return auth;
});
