import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthErrorCode } from "@presenca/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requestContext } from "../common/request-context";
import { IS_PUBLIC, REQUIRE_VERIFIED } from "./decorators";
import { SESSION_COOKIE, SessionService } from "./session.service";

/**
 * Guard global: toda rota exige sessão, a menos que seja marcada com @Public().
 * Resolve o cookie, preenche request.auth e o contexto da requisição (que identifica as
 * transações do banco) e renova a sessão quando necessário.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const token = request.cookies[SESSION_COOKIE];
    const session = await this.sessions.resolve(token);
    if (!session || !token) {
      if (token) this.sessions.clearCookie(reply);
      throw new UnauthorizedException();
    }

    request.auth = {
      userId: session.userId,
      sessionId: session.sessionId,
      emailVerified: session.emailVerified,
    };
    const ctx = requestContext.get();
    if (ctx) ctx.userId = session.userId;
    request.log = request.log.child({ userId: session.userId });

    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED, targets) &&
      !session.emailVerified
    ) {
      throw new ForbiddenException({
        code: AuthErrorCode.emailNotVerified,
        detail: "Confirme seu e-mail para usar este recurso.",
      });
    }

    await this.sessions.touch(session, reply, token);
    return true;
  }
}
