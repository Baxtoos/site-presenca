import { z } from "zod";
import {
  notificationListQuerySchema,
  notificationListSchema,
  notificationParamsSchema,
  notificationPreferencesBodySchema,
  notificationPreferencesSchema,
  pushSubscriptionBodySchema,
  pushUnsubscribeBodySchema,
  unreadCountSchema,
} from "./notifications";
import type { RouteDef } from "./route-types";

const pushDevicesSchema = z.object({ pushDevices: z.number().int() });

export const notificationRoutes = {
  listNotifications: {
    method: "GET",
    path: "/v1/notifications",
    summary: "Central de avisos (mais recentes primeiro), com o total de não lidos",
    tag: "Notificações",
    auth: true,
    request: { query: notificationListQuerySchema },
    responses: { 200: { description: "Avisos", schema: notificationListSchema } },
  },
  readNotification: {
    method: "POST",
    path: "/v1/notifications/:id/read",
    summary: "Marca um aviso como lido",
    tag: "Notificações",
    auth: true,
    request: { params: notificationParamsSchema },
    responses: {
      200: { description: "Lido; devolve o total de não lidos", schema: unreadCountSchema },
      404: { description: "Não encontrado (ou de outra pessoa)" },
    },
  },
  readAllNotifications: {
    method: "POST",
    path: "/v1/notifications/read-all",
    summary: "Marca todos os avisos como lidos",
    tag: "Notificações",
    auth: true,
    responses: { 200: { description: "Tudo lido", schema: unreadCountSchema } },
  },
  testNotification: {
    method: "POST",
    path: "/v1/notifications/test",
    summary: "Manda um aviso de teste para a central e para os aparelhos com push",
    tag: "Notificações",
    auth: true,
    responses: { 202: { description: "Aviso de teste enfileirado", schema: unreadCountSchema } },
  },
  getNotificationPreferences: {
    method: "GET",
    path: "/v1/notification-preferences",
    summary: "Canais, marcos de alerta, lembrete de chamada e horário silencioso",
    tag: "Notificações",
    auth: true,
    responses: { 200: { description: "Preferências", schema: notificationPreferencesSchema } },
  },
  putNotificationPreferences: {
    method: "PUT",
    path: "/v1/notification-preferences",
    summary: "Salva as preferências de notificação",
    tag: "Notificações",
    auth: true,
    request: { body: notificationPreferencesBodySchema },
    responses: { 200: { description: "Salvas", schema: notificationPreferencesSchema } },
  },
  subscribePush: {
    method: "POST",
    path: "/v1/push-subscriptions",
    summary: "Registra o push deste aparelho (e liga o canal push)",
    tag: "Notificações",
    auth: true,
    request: { body: pushSubscriptionBodySchema },
    responses: {
      201: { description: "Registrado", schema: pushDevicesSchema },
      409: { description: "Endereço já registrado em outra conta (PUSH_ENDPOINT_IN_USE)" },
      503: { description: "Servidor sem push configurado (PUSH_UNAVAILABLE)" },
    },
  },
  unsubscribePush: {
    method: "DELETE",
    path: "/v1/push-subscriptions",
    summary: "Remove o push deste aparelho",
    tag: "Notificações",
    auth: true,
    request: { body: pushUnsubscribeBodySchema },
    responses: { 200: { description: "Removido", schema: pushDevicesSchema } },
  },
} as const satisfies Record<string, RouteDef>;
