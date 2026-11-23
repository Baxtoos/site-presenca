import { z } from "zod";
import { timeSchema } from "./academic";

// ---------------------------------------------------------------- conteúdo dos avisos

export const THRESHOLD_PCTS = [50, 75, 90, 100] as const;
export const thresholdPctSchema = z.union(THRESHOLD_PCTS.map((p) => z.literal(p)));

export const notificationKindSchema = z.enum(["threshold", "checkin_reminder", "system"]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** Dados guardados em `notification_logs.payload`. O texto é montado na hora de mostrar/enviar. */
export const thresholdPayloadSchema = z.object({
  subjectName: z.string(),
  thresholdPct: thresholdPctSchema,
  absentUnits: z.number().int(),
  maxUnits: z.number().int(),
  remainingUnits: z.number().int(),
  remainingClasses: z.number().int(),
});
export type ThresholdPayload = z.infer<typeof thresholdPayloadSchema>;

/** Uma aula sem registro, para marcar direto pela notificação (botões Fui / Faltei). */
export const pendingClassSchema = z.object({
  subjectId: z.uuid(),
  scheduleId: z.uuid(),
  classDate: z.iso.date(),
  name: z.string(),
});
export type PendingClass = z.infer<typeof pendingClassSchema>;

/** Até quantas aulas do dia o lembrete leva para marcar pela notificação. */
export const CHECKIN_ACTION_LIMIT = 6;

export const checkinPayloadSchema = z.object({
  /** Aulas da grade sem registro. */
  count: z.number().int().min(1),
  scope: z.enum(["today", "week"]),
  /** Só no lembrete do dia, com poucas aulas: quais são (para os botões da notificação). */
  classes: z.array(pendingClassSchema).max(CHECKIN_ACTION_LIMIT).optional(),
});
export type CheckinPayload = z.infer<typeof checkinPayloadSchema>;

export const systemPayloadSchema = z.object({ title: z.string(), body: z.string() });

export interface NotificationContent {
  title: string;
  body: string;
  /** Caminho no app para abrir ao tocar no aviso. */
  url: string;
}

const units = (n: number) => `${n} ${n === 1 ? "aula" : "aulas"}`;
const days = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;
const classes = (n: number) => `${n} ${n === 1 ? "aula" : "aulas"}`;

/**
 * Texto de um aviso, igual na central, no push e no assunto do e-mail.
 * Payload inválido (dado antigo ou corrompido) vira um aviso genérico em vez de quebrar a tela.
 */
export function notificationContent(
  kind: NotificationKind,
  payload: unknown,
  subjectId: string | null,
): NotificationContent {
  if (kind === "threshold") {
    const p = thresholdPayloadSchema.safeParse(payload);
    if (p.success) {
      const d = p.data;
      const url = subjectId ? `/materias/${subjectId}` : "/";
      if (d.thresholdPct === 100) {
        const over = d.absentUnits - d.maxUnits;
        return {
          title: `${d.subjectName}: limite de faltas atingido`,
          body:
            over > 0
              ? `Você passou do limite em ${units(over)} (${d.absentUnits} de ${d.maxUnits}). Fale com a coordenação sobre abono ou reposição.`
              : `Você chegou a ${d.absentUnits} de ${d.maxUnits} faltas. Qualquer nova falta reprova.`,
          url,
        };
      }
      return {
        title: `${d.subjectName}: ${d.thresholdPct}% do limite de faltas`,
        body: `Você tem ${d.absentUnits} de ${d.maxUnits} faltas. Ainda pode faltar ${units(d.remainingUnits)}${
          d.remainingClasses !== d.remainingUnits ? ` (cerca de ${days(d.remainingClasses)})` : ""
        }.`,
        url,
      };
    }
  }
  if (kind === "checkin_reminder") {
    const p = checkinPayloadSchema.safeParse(payload);
    if (p.success) {
      const { count, scope } = p.data;
      const only = count === 1 ? p.data.classes?.[0] : undefined;
      return scope === "today"
        ? {
            title: "Já marcou as aulas de hoje?",
            body: only
              ? `${only.name}: a aula de hoje está sem registro.`
              : `${classes(count)} de hoje ${count === 1 ? "está" : "estão"} sem registro.`,
            url: "/hoje",
          }
        : {
            title: "Resumo da semana",
            body: `${classes(count)} dos últimos 7 dias ${count === 1 ? "ficou" : "ficaram"} sem registro.`,
            url: "/hoje",
          };
    }
  }
  if (kind === "system") {
    const p = systemPayloadSchema.safeParse(payload);
    if (p.success) return { ...p.data, url: "/avisos" };
  }
  return { title: "Aviso", body: "Abra o app para ver os detalhes.", url: "/avisos" };
}

// ---------------------------------------------------------------- central de avisos

export const notificationItemSchema = z.object({
  id: z.uuid(),
  kind: notificationKindSchema,
  subjectId: z.uuid().nullable(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

export const notificationListSchema = z.object({
  items: z.array(notificationItemSchema),
  unreadCount: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const unreadCountSchema = z.object({ unreadCount: z.number().int() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

export const notificationParamsSchema = z.object({
  id: z.uuid({ error: "Aviso inválido." }),
});

// ---------------------------------------------------------------- preferências

export const checkinModeSchema = z.enum(["off", "daily", "weekly"]);

export const notificationPreferencesBodySchema = z
  .object({
    emailEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    thresholds: z
      .array(thresholdPctSchema)
      .max(4)
      .transform((list) => [...new Set(list)].sort((a, b) => a - b)),
    checkinReminder: checkinModeSchema,
    checkinTime: timeSchema,
    checkinWeekday: z
      .number()
      .int()
      .min(1, { error: "Dia inválido." })
      .max(7, { error: "Dia inválido." }),
    quietStart: timeSchema.nullable(),
    quietEnd: timeSchema.nullable(),
  })
  .superRefine((body, ctx) => {
    if ((body.quietStart === null) !== (body.quietEnd === null)) {
      ctx.addIssue({
        code: "custom",
        path: [body.quietStart === null ? "quietStart" : "quietEnd"],
        message: "Informe o início e o fim do horário silencioso.",
      });
    }
    if (body.quietStart !== null && body.quietStart === body.quietEnd) {
      ctx.addIssue({
        code: "custom",
        path: ["quietEnd"],
        message: "O fim precisa ser diferente do início.",
      });
    }
  });
export type NotificationPreferencesBody = z.infer<typeof notificationPreferencesBodySchema>;

export const notificationPreferencesSchema = z.object({
  emailEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  thresholds: z.array(thresholdPctSchema),
  checkinReminder: checkinModeSchema,
  checkinTime: timeSchema,
  checkinWeekday: z.number().int(),
  quietStart: timeSchema.nullable(),
  quietEnd: timeSchema.nullable(),
  /** Sem e-mail confirmado, alertas por e-mail ficam desligados (mesmo com emailEnabled). */
  emailVerified: z.boolean(),
  /** Chave pública VAPID para assinar o push neste aparelho; null se o servidor não tem push. */
  vapidPublicKey: z.string().nullable(),
  /** Aparelhos com push ativo nesta conta. */
  pushDevices: z.number().int(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

// ---------------------------------------------------------------- push

/**
 * Serviços de push dos navegadores (Chrome/Edge/Brave via FCM, Firefox, Safari, Windows).
 * O worker faz POST no endereço da inscrição: aceitar qualquer URL abriria SSRF.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

/** true se o endereço é HTTPS, na porta padrão, de um serviço de push conhecido. */
export function isPushServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      PUSH_HOSTS.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
}

export const pushSubscriptionBodySchema = z.object({
  endpoint: z
    .url({ error: "Endereço de push inválido." })
    .max(2048)
    .refine(isPushServiceUrl, { error: "Este navegador usa um serviço de push não suportado." }),
  keys: z.object({
    p256dh: z.string().min(16).max(256),
    auth: z.string().min(8).max(128),
  }),
});
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBodySchema>;

export const pushUnsubscribeBodySchema = z.object({ endpoint: z.string().max(2048) });

export const NotificationErrorCode = {
  pushUnavailable: "PUSH_UNAVAILABLE",
  pushEndpointInUse: "PUSH_ENDPOINT_IN_USE",
} as const;
