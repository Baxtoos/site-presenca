import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  type AcceptedResponse,
  type EmailBody,
  emailBodySchema,
  type LoginBody,
  loginBodySchema,
  type MeResponse,
  type RegisterBody,
  registerBodySchema,
  type ResetPasswordBody,
  resetPasswordBodySchema,
  type TokenBody,
  tokenBodySchema,
} from "@presenca/contracts";
import { generateCodeVerifier, generateState } from "arctic";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodPipe } from "../common/zod.pipe";
import { ENV, type Env } from "../config/env";
import { RateLimit } from "../rate-limit/rate-limit";
import { AuthService, GoogleLoginError } from "./auth.service";
import { type AuthContext, CurrentAuth, Public } from "./decorators";
import { GOOGLE_OAUTH, type GoogleOAuth } from "./google.provider";
import { safeEqual } from "./tokens";

const HOUR = 3600;
const OAUTH_COOKIE = "__Host-oauth";

/** Limites de tentativa por rota (janela fixa, contadores no Redis). */
const LIMITS = {
  // 10/h por IP: redes de universidade põem muitos alunos atrás do mesmo IP.
  register: { bucket: "register", by: "ip", limit: 10, windowSeconds: HOUR },
  loginPerAccount: { bucket: "login", by: "ip+email", limit: 5, windowSeconds: 60 },
  loginPerIp: { bucket: "login-ip", by: "ip", limit: 30, windowSeconds: 60 },
  emailPerAddress: { bucket: "email-link", by: "email", limit: 3, windowSeconds: 15 * 60 },
  emailPerIp: { bucket: "email-link-ip", by: "ip", limit: 10, windowSeconds: 15 * 60 },
  tokenPerIp: { bucket: "token", by: "ip", limit: 20, windowSeconds: 10 * 60 },
  resendPerUser: { bucket: "verify-resend", by: "user", limit: 3, windowSeconds: 15 * 60 },
  googlePerIp: { bucket: "google", by: "ip", limit: 20, windowSeconds: 10 * 60 },
} as const;

@Controller("v1/auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    @Inject(GOOGLE_OAUTH) private readonly google: GoogleOAuth | null,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post("register")
  @HttpCode(202)
  @RateLimit(LIMITS.register, LIMITS.emailPerAddress)
  register(@Body(new ZodPipe(registerBodySchema)) body: RegisterBody): Promise<AcceptedResponse> {
    return this.auth.register(body);
  }

  @Public()
  @Post("register/confirm")
  @HttpCode(200)
  @RateLimit(LIMITS.tokenPerIp)
  confirmRegistration(
    @Body(new ZodPipe(tokenBodySchema)) body: TokenBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    return this.auth.confirmRegistration(body.token, request, reply);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @RateLimit(LIMITS.loginPerAccount, LIMITS.loginPerIp)
  login(
    @Body(new ZodPipe(loginBodySchema)) body: LoginBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    return this.auth.login(body, request, reply);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(auth.userId, auth.sessionId, reply);
  }

  @Public()
  @Post("magic-link")
  @HttpCode(202)
  @RateLimit(LIMITS.emailPerAddress, LIMITS.emailPerIp)
  magicLink(@Body(new ZodPipe(emailBodySchema)) body: EmailBody): Promise<AcceptedResponse> {
    return this.auth.requestMagicLink(body.email);
  }

  @Public()
  @Post("magic-link/consume")
  @HttpCode(200)
  @RateLimit(LIMITS.tokenPerIp)
  consumeMagicLink(
    @Body(new ZodPipe(tokenBodySchema)) body: TokenBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    return this.auth.consumeMagicLink(body.token, request, reply);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(204)
  @RateLimit(LIMITS.tokenPerIp)
  async verifyEmail(@Body(new ZodPipe(tokenBodySchema)) body: TokenBody): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  @Post("verify-email/resend")
  @HttpCode(202)
  @RateLimit(LIMITS.resendPerUser)
  resendVerification(@CurrentAuth() auth: AuthContext): Promise<AcceptedResponse> {
    return this.auth.resendVerification(auth.userId, auth.emailVerified);
  }

  @Public()
  @Post("password/forgot")
  @HttpCode(202)
  @RateLimit(LIMITS.emailPerAddress, LIMITS.emailPerIp)
  forgotPassword(@Body(new ZodPipe(emailBodySchema)) body: EmailBody): Promise<AcceptedResponse> {
    return this.auth.forgotPassword(body.email);
  }

  @Public()
  @Post("password/reset")
  @HttpCode(200)
  @RateLimit(LIMITS.tokenPerIp)
  resetPassword(
    @Body(new ZodPipe(resetPasswordBodySchema)) body: ResetPasswordBody,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    return this.auth.resetPassword(body, request, reply);
  }

  // ---------------------------------------------------------------- Google (redirecionamentos)

  @Public()
  @Get("google")
  @RateLimit(LIMITS.googlePerIp)
  googleStart(@Res() reply: FastifyReply) {
    if (!this.google) return this.redirectToApp(reply, "google_indisponivel");
    const state = generateState();
    const verifier = generateCodeVerifier();
    // state e code_verifier ficam num cookie curto, só deste navegador (PKCE + proteção de CSRF).
    void reply.setCookie(OAUTH_COOKIE, `${state}.${verifier}`, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return reply.redirect(this.google.authorizationUrl(state, verifier).toString(), 302);
  }

  @Public()
  @Get("google/callback")
  @RateLimit(LIMITS.googlePerIp)
  async googleCallback(
    @Query() query: Record<string, string | undefined>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const saved = request.cookies[OAUTH_COOKIE];
    void reply.clearCookie(OAUTH_COOKIE, {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });

    if (!this.google) return this.redirectToApp(reply, "google_indisponivel");
    if (query.error) return this.redirectToApp(reply, "google_cancelado");

    const [savedState, verifier] = saved?.split(".") ?? [];
    if (
      !query.code ||
      !query.state ||
      !savedState ||
      !verifier ||
      !safeEqual(query.state, savedState)
    ) {
      return this.redirectToApp(reply, "google_sessao_expirada");
    }

    try {
      const profile = await this.google.exchange(query.code, verifier);
      await this.auth.loginWithGoogle(profile, request, reply);
      return reply.redirect(`${this.env.WEB_ORIGIN}/`, 302);
    } catch (error) {
      if (error instanceof GoogleLoginError) return this.redirectToApp(reply, error.code);
      this.logger.error(error instanceof Error ? error : String(error));
      return this.redirectToApp(reply, "google_falhou");
    }
  }

  private redirectToApp(reply: FastifyReply, errorCode: string) {
    return reply.redirect(
      `${this.env.WEB_ORIGIN}/entrar?erro=${encodeURIComponent(errorCode)}`,
      302,
    );
  }
}
