import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  AuthErrorCode,
  type MfaCodeBody,
  mfaCodeBodySchema,
  type MfaEnableBody,
  mfaEnableBodySchema,
  type MfaRecoveryCodesResponse,
  type MfaSetupResponse,
  type MfaStatusResponse,
} from "@presenca/contracts";
import { ZodPipe } from "../common/zod.pipe";
import { DbService } from "../database/db.service";
import { RateLimit } from "../rate-limit/rate-limit";
import { type AuthContext, CurrentAuth } from "./decorators";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";

const MFA_CHANGE = { bucket: "mfa-change", by: "user", limit: 10, windowSeconds: 15 * 60 } as const;

/** Segundo fator na página Conta: situação, ativar, desligar e códigos de recuperação. */
@Controller("v1/me/mfa")
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly db: DbService,
    private readonly passwords: PasswordService,
  ) {}

  @Get()
  status(@CurrentAuth() auth: AuthContext): Promise<MfaStatusResponse> {
    return this.mfa.status(auth.userId);
  }

  @Post("setup")
  @HttpCode(200)
  @RateLimit(MFA_CHANGE)
  async setup(@CurrentAuth() auth: AuthContext): Promise<MfaSetupResponse> {
    const user = await this.db.tx((tx) => tx.query.users.findFirst({ columns: { email: true } }));
    if (!user) throw new NotFoundException();
    return this.mfa.setup(auth.userId, user.email);
  }

  /** Ligar o segundo fator é mudar como se entra: conta com senha confirma a senha. */
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
