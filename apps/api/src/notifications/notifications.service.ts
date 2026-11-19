import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  notificationContent,
  NotificationErrorCode,
  type NotificationList,
  type NotificationPreferences,
  type NotificationPreferencesBody,
  type PushSubscriptionBody,
  type UnreadCount,
} from "@presenca/contracts";
import { schema, type Tx } from "@presenca/db";
import { and, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { ENV, type Env } from "../config/env";
import { DbService } from "../database/db.service";
import { inOrder } from "../common/in-order";

const { notificationLogs, notificationPreferences, pushSubscriptions, users } = schema;

const DEFAULT_PREFS = {
  emailEnabled: true,
  pushEnabled: false,
  thresholds: [50, 75, 90, 100],
  checkinReminder: "off",
  checkinTime: "21:00",
  checkinWeekday: 5,
  quietStart: null,
  quietEnd: null,
} as const;

const hhmm = (t: string | null) => (t === null ? null : t.slice(0, 5));

/** Avisos que aparecem na central: canal in-app já entregue. */
const inInbox = and(eq(notificationLogs.channel, "in_app"), eq(notificationLogs.status, "sent"));

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------------------------------------------------------------- central

  list(limit: number, cursor?: string): Promise<NotificationList> {
    return this.db.tx(async (tx) => {
      const after = cursor ? decodeCursor(cursor) : null;
      const rows = await tx
        .select()
        .from(notificationLogs)
        .where(
          and(
            inInbox,
            after
              ? or(
                  lt(notificationLogs.createdAt, after.createdAt),
                  and(
                    eq(notificationLogs.createdAt, after.createdAt),
                    lt(notificationLogs.id, after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notificationLogs.createdAt), desc(notificationLogs.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((r) => ({
          id: r.id,
          kind: r.kind,
          subjectId: r.subjectId,
          ...notificationContent(r.kind, r.payload, r.subjectId),
          createdAt: r.createdAt.toISOString(),
          readAt: r.readAt?.toISOString() ?? null,
        })),
        unreadCount: await this.unread(tx),
        nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    });
  }

  read(id: string): Promise<UnreadCount> {
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .select({ id: notificationLogs.id })
        .from(notificationLogs)
        .where(and(eq(notificationLogs.id, id), inInbox));
      if (!row) throw new NotFoundException({ detail: "Aviso não encontrado." });
      await tx
        .update(notificationLogs)
        .set({ readAt: sql`now()` })
        .where(and(eq(notificationLogs.id, id), isNull(notificationLogs.readAt)));
      return { unreadCount: await this.unread(tx) };
    });
  }

  readAll(): Promise<UnreadCount> {
    return this.db.tx(async (tx) => {
      await tx
        .update(notificationLogs)
        .set({ readAt: sql`now()` })
        .where(and(inInbox, isNull(notificationLogs.readAt)));
      return { unreadCount: 0 };
    });
  }

  unreadCount(): Promise<UnreadCount> {
    return this.db.tx(async (tx) => ({ unreadCount: await this.unread(tx) }));
  }

  private async unread(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(notificationLogs)
      .where(and(inInbox, isNull(notificationLogs.readAt)));
    return row?.n ?? 0;
  }

  /** Aviso de teste: confere de ponta a ponta se o push deste aparelho chega. */
  test(userId: string): Promise<UnreadCount> {
    return this.db.tx(async (tx) => {
      const [recent] = await tx
        .select({ id: notificationLogs.id })
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.kind, "system"),
            gt(notificationLogs.createdAt, sql`now() - interval '20 seconds'`),
          ),
        )
        .limit(1);
      if (recent) {
        throw new HttpException(
          { code: "RATE_LIMITED", detail: "Espere alguns segundos para mandar outro teste." },
          429,
        );
      }
      const [prefs] = await tx.select().from(notificationPreferences);
      const dedupeKey = `test:${crypto.randomUUID()}`;
      const payload = {
        title: "Aviso de teste",
        body: "Se você está vendo isto, os avisos estão funcionando neste aparelho.",
      };
      const base = { userId, kind: "system" as const, dedupeKey, payload };
      await tx
        .insert(notificationLogs)
        .values([
          { ...base, channel: "in_app", status: "sent", sentAt: sql`now()` },
          ...(prefs?.pushEnabled
            ? [{ ...base, channel: "push" as const, status: "pending" as const }]
            : []),
        ]);
      return { unreadCount: await this.unread(tx) };
    });
  }

  // ---------------------------------------------------------------- preferências

  getPreferences(): Promise<NotificationPreferences> {
    return this.db.tx((tx) => this.loadPreferences(tx));
  }

  putPreferences(
    userId: string,
    body: NotificationPreferencesBody,
  ): Promise<NotificationPreferences> {
    return this.db.tx(async (tx) => {
      const values = {
        emailEnabled: body.emailEnabled,
        pushEnabled: body.pushEnabled,
        thresholds: body.thresholds,
        checkinReminder: body.checkinReminder,
        checkinTime: body.checkinTime,
        checkinWeekday: body.checkinWeekday,
        quietStart: body.quietStart,
        quietEnd: body.quietEnd,
      };
      await tx
        .insert(notificationPreferences)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: notificationPreferences.userId, set: values });
      return this.loadPreferences(tx);
    });
  }

  private async loadPreferences(tx: Tx): Promise<NotificationPreferences> {
    const [[prefs], [user], [devices]] = await inOrder([
      tx.select().from(notificationPreferences),
      tx.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users),
      tx.select({ n: count() }).from(pushSubscriptions),
    ]);
    const p = prefs ?? DEFAULT_PREFS;
    return {
      emailEnabled: p.emailEnabled,
      pushEnabled: p.pushEnabled,
      thresholds: [...p.thresholds] as NotificationPreferences["thresholds"],
      checkinReminder: p.checkinReminder,
      checkinTime: hhmm(p.checkinTime)!,
      checkinWeekday: p.checkinWeekday,
      quietStart: hhmm(p.quietStart),
      quietEnd: hhmm(p.quietEnd),
      emailVerified: Boolean(user?.emailVerifiedAt),
      vapidPublicKey: this.env.VAPID_PUBLIC_KEY ?? null,
      pushDevices: devices?.n ?? 0,
    };
  }

  // ---------------------------------------------------------------- push

  async subscribePush(
    userId: string,
    body: PushSubscriptionBody,
    userAgent: string | undefined,
  ): Promise<{ pushDevices: number }> {
    if (!this.env.VAPID_PUBLIC_KEY) {
      throw new ServiceUnavailableException({
        code: NotificationErrorCode.pushUnavailable,
        detail: "Este servidor ainda não está configurado para notificações push.",
      });
    }
    try {
      return await this.db.tx(async (tx) => {
        const values = {
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent: userAgent?.slice(0, 300) ?? null,
          failureCount: 0,
        };
        await tx
          .insert(pushSubscriptions)
          .values({ userId, endpoint: body.endpoint, ...values })
          .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values });
        // Registrar um aparelho liga o canal (é o que a pessoa quis ao tocar em "ativar").
        await tx
          .insert(notificationPreferences)
          .values({ userId, pushEnabled: true })
          .onConflictDoUpdate({
            target: notificationPreferences.userId,
            set: { pushEnabled: true },
          });
        const [devices] = await tx.select({ n: count() }).from(pushSubscriptions);
        return { pushDevices: devices?.n ?? 0 };
      });
    } catch (error) {
      // O endereço existe, mas é de outra conta (o RLS esconde a linha e recusa o UPDATE).
      if (isRlsOrUniqueViolation(error)) {
        throw new ConflictException({
          code: NotificationErrorCode.pushEndpointInUse,
          detail: "Este aparelho está registrado em outra conta. Desative e ative o push de novo.",
        });
      }
      throw error;
    }
  }

  unsubscribePush(endpoint: string): Promise<{ pushDevices: number }> {
    return this.db.tx(async (tx) => {
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
      const [devices] = await tx.select({ n: count() }).from(pushSubscriptions);
      return { pushDevices: devices?.n ?? 0 };
    });
  }
}

function isRlsOrUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 3; depth++) {
    const code = (current as { code?: string }).code;
    // 23505 = unique_violation; 42501 = insufficient_privilege (política de RLS).
    if (code === "23505" || code === "42501") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
