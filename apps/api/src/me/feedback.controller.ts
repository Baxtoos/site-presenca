import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { type AcceptedResponse, type FeedbackBody, feedbackBodySchema } from "@presenca/contracts";
import { feedbackMessage } from "@presenca/emails";
import type { FastifyRequest } from "fastify";
import { type AuthContext, CurrentAuth } from "../auth/decorators";
import { BackgroundTasks } from "../common/background-tasks";
import { ZodPipe } from "../common/zod.pipe";
import { ENV, type Env } from "../config/env";
import { DbService } from "../database/db.service";
import { MAILER, type Mailer } from "../mail/mailer";
import { RateLimit } from "../rate-limit/rate-limit";

@Controller("v1/feedback")
export class FeedbackController {
  constructor(
    private readonly db: DbService,
    private readonly tasks: BackgroundTasks,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @HttpCode(202)
  @RateLimit({ bucket: "feedback", by: "user", limit: 5, windowSeconds: 3600 })
  async send(
    @Body(new ZodPipe(feedbackBodySchema)) body: FeedbackBody,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<AcceptedResponse> {
    const to = this.env.FEEDBACK_TO;
    if (!to) {
      throw new ServiceUnavailableException({
        code: "FEEDBACK_UNAVAILABLE",
        detail: "O envio de sugestões ainda não está disponível.",
      });
    }
    const user = await this.db.asUser(auth.userId, (tx) =>
      tx.query.users.findFirst({ columns: { email: true, fullName: true } }),
    );
    if (user) {
      const message = feedbackMessage({
        kind: body.kind,
        message: body.message,
        name: user.fullName,
        email: user.email,
        page: body.page,
        version: this.env.APP_VERSION,
        userAgent: request.headers["user-agent"]?.slice(0, 200),
        appUrl: this.env.WEB_ORIGIN,
      });
      this.tasks.run("sugestão", () => this.mailer.send({ to, replyTo: user.email, ...message }));
    }
    return { status: "accepted" };
  }
}
