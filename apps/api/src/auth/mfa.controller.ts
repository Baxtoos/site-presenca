import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  type AcceptedResponse,
  AuthErrorCode,
  type MfaCodeBody,
  mfaCodeBodySchema,
  type MfaEnableBody,
  mfaEnableBodySchema,
  type MfaRecoveryCodesResponse,
  type MfaSetupBody,
  mfaSetupBodySchema,
  type MfaSetupResponse,
  type MfaStatusResponse,
} from "@presenca/contracts";
import { ZodPipe } from "../common/zod.pipe";
import { DbService } from "../database/db.service";
import { RateLimit } from "../rate-limit/rate-limit";
import { AuthService } from "./auth.service";
import { type AuthContext, CurrentAuth } from "./decorators";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";

const MFA_CHANGE = { bucket: "mfa-change", by: "user", limit: 10, windowSeconds: 15 * 60 } as const;

@Controller("v1/me/mfa")
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly db: DbService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  status(@CurrentAuth() auth: AuthContext): Promise<MfaStatusResponse> {
    return this.mfa.status(auth.userId);
  }

  @Post("enable-request")
  @HttpCode(202)
  @RateLimit({ bucket: "mfa-link", by: "user", limit: 3, windowSeconds: 15 * 60 })
  async enableRequest(@CurrentAuth() auth: AuthContext): Promise<AcceptedResponse> {
    const user = await this.db.tx((tx) =>
      tx.query.users.findFirst({ columns: { passwordHash: true } }),
    );
    if (!user) throw new NotFoundException();
    if (user.passwordHash !== null) {
      throw new ConflictException({
        code: "HAS_PASSWORD",
        detail: "Sua conta tem senha: a ativação pede a senha, não um link.",
      });
    }
    return this.auth.requestMfaEnableLink(auth.userId);
  }

  @Post("setup")
  @HttpCode(200)
  @RateLimit(MFA_CHANGE)
  async setup(
    @Body(new ZodPipe(mfaSetupBodySchema)) body: MfaSetupBody,
    @CurrentAuth() auth: AuthContext,
  ): Promise<MfaSetupResponse> {
    const user = await this.db.tx((tx) =>
      tx.query.users.findFirst({ columns: { email: true, passwordHash: true } }),
    );
    if (!user) throw new NotFoundException();
    if (await this.mfa.isEnabled(auth.userId)) {
      throw new ConflictException({
        code: "MFA_ALREADY_ENABLED",
        detail: "O segundo fator já está ligado.",
      });
    }
    if (user.passwordHash === null) {
      const ok =
        typeof body.token === "string" &&
        (await this.auth.consumeMfaEnableToken(body.token, auth.userId));
      if (!ok) {
        throw new ForbiddenException({
          code: AuthErrorCode.mfaConfirmationRequired,
          detail: "Abra o link enviado ao seu e-mail para ligar a verificação em duas etapas.",
        });
      }
    }
    return this.mfa.setup(auth.userId, user.email);
  }

  @Post("enable")
  @HttpCode(200)
  @RateLimit(MFA_CHANGE)
  async enable(
    @Body(new ZodPipe(mfaEnableBodySchema)) body: MfaEnableBody,
    @CurrentAuth() auth: AuthContext,
  ): Promise<MfaRecoveryCodesResponse> {
    const user = await this.db.tx((tx) =>
      tx.query.users.findFirst({ columns: { passwordHash: true } }),
    );
    if (!user) throw new NotFoundException();
    if (user.passwordHash !== null) {
      const ok =
        typeof body.password === "string" &&
        (await this.passwords.verify(user.passwordHash, body.password));
      if (!ok) {
        throw new UnauthorizedException({
          code: AuthErrorCode.invalidCredentials,
          detail: "Senha incorreta.",
        });
      }
    }
    return { recoveryCodes: await this.mfa.enable(auth.userId, body.code) };
  }

  @Post("disable")
  @HttpCode(204)
  @RateLimit(MFA_CHANGE)
  async disable(
    @Body(new ZodPipe(mfaCodeBodySchema)) body: MfaCodeBody,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.mfa.disable(auth.userId, body.code);
  }

  @Post("recovery-codes")
  @HttpCode(200)
  @RateLimit(MFA_CHANGE)
  async recoveryCodes(
    @Body(new ZodPipe(mfaCodeBodySchema)) body: MfaCodeBody,
    @CurrentAuth() auth: AuthContext,
  ): Promise<MfaRecoveryCodesResponse> {
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(auth.userId, body.code) };
  }
}
