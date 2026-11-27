import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export interface AuthContext {
  userId: string;
  sessionId: string;
  emailVerified: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const IS_PUBLIC = "auth:public";
export const REQUIRE_VERIFIED = "auth:require-verified";

export const Public = () => SetMetadata(IS_PUBLIC, true);

export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED, true);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<FastifyRequest>().auth;
  if (!auth) throw new Error("@CurrentAuth() usado numa rota pública");
  return auth;
});
