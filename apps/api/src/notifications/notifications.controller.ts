import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  type NotificationList,
  notificationListQuerySchema,
  notificationParamsSchema,
  type NotificationPreferences,
  type NotificationPreferencesBody,
  notificationPreferencesBodySchema,
  type PushSubscriptionBody,
  pushSubscriptionBodySchema,
  pushUnsubscribeBodySchema,
  type UnreadCount,
} from "@presenca/contracts";
import { type AuthContext, CurrentAuth } from "../auth/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { NotificationsService } from "./notifications.service";

@Controller("v1")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("notifications")
  list(
    @Query(new ZodPipe(notificationListQuerySchema)) query: { limit: number; cursor?: string },
  ): Promise<NotificationList> {
    return this.notifications.list(query.limit, query.cursor);
  }

  @Post("notifications/read-all")
  @HttpCode(200)
  readAll(): Promise<UnreadCount> {
    return this.notifications.readAll();
  }

  @Post("notifications/test")
  @HttpCode(202)
  test(@CurrentAuth() auth: AuthContext): Promise<UnreadCount> {
    return this.notifications.test(auth.userId);
  }

  @Post("notifications/:id/read")
  @HttpCode(200)
  read(@Param(new ZodPipe(notificationParamsSchema)) { id }: { id: string }): Promise<UnreadCount> {
    return this.notifications.read(id);
  }

  @Get("notification-preferences")
  getPreferences(): Promise<NotificationPreferences> {
    return this.notifications.getPreferences();
  }

  @Put("notification-preferences")
  putPreferences(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(notificationPreferencesBodySchema)) body: NotificationPreferencesBody,
  ): Promise<NotificationPreferences> {
    return this.notifications.putPreferences(auth.userId, body);
  }

  @Post("push-subscriptions")
  subscribePush(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(pushSubscriptionBodySchema)) body: PushSubscriptionBody,
    @Headers("user-agent") userAgent: string | undefined,
  ): Promise<{ pushDevices: number }> {
    return this.notifications.subscribePush(auth.userId, body, userAgent);
  }

  @Delete("push-subscriptions")
  @HttpCode(200)
  unsubscribePush(
    @Body(new ZodPipe(pushUnsubscribeBodySchema)) body: { endpoint: string },
  ): Promise<{ pushDevices: number }> {
    return this.notifications.unsubscribePush(body.endpoint);
  }
}
