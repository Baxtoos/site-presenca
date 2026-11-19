import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { BackgroundTasks } from "../common/background-tasks";
import { ClockService } from "../common/clock";
import { ENV, type Env } from "../config/env";
import { FeedbackController } from "../me/feedback.controller";
import { MeController } from "../me/me.controller";
import { RateLimitGuard, RateLimitService } from "../rate-limit/rate-limit";
import { AuthController } from "./auth.controller";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { createGoogleOAuth, GOOGLE_OAUTH } from "./google.provider";
import { MfaController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";

@Module({
  controllers: [AuthController, MeController, MfaController, FeedbackController],
  providers: [
    AuthRepository,
    AuthService,
    BackgroundTasks,
    ClockService,
    MfaService,
    PasswordService,
    RateLimitService,
    SessionService,
    { provide: GOOGLE_OAUTH, inject: [ENV], useFactory: (env: Env) => createGoogleOAuth(env) },
    // Ordem importa: primeiro identifica a sessão, depois aplica os limites (alguns são por usuário).
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [BackgroundTasks, SessionService],
})
export class AuthModule {}
