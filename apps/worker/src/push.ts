import { isPushServiceUrl } from "@presenca/contracts";
import webpush, { WebPushError } from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  classes?: { subjectId: string; scheduleId: string; classDate: string; name: string }[];
}

export type PushOutcome =
  | { ok: true }
  | { ok: false; gone: true; error: string }
  | { ok: false; gone: false; error: string };

export interface PushSender {
  readonly configured: boolean;
  send(target: PushTarget, message: PushMessage, urgent: boolean): Promise<PushOutcome>;
}

export class WebPushSender implements PushSender {
  readonly configured: boolean;

  constructor(
    private readonly vapid: { publicKey?: string; privateKey?: string; subject: string },
  ) {
    this.configured = Boolean(vapid.publicKey && vapid.privateKey);
  }

  async send(target: PushTarget, message: PushMessage, urgent: boolean): Promise<PushOutcome> {
    // Defesa em profundidade (a API já valida): nunca faz POST fora dos serviços de push.
    if (!isPushServiceUrl(target.endpoint)) {
      return { ok: false, gone: true, error: "endereço de push fora dos serviços conhecidos" };
    }
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          vapidDetails: {
            subject: this.vapid.subject,
            publicKey: this.vapid.publicKey!,
            privateKey: this.vapid.privateKey!,
          },
          TTL: 24 * 60 * 60,
          urgency: urgent ? "high" : "normal",
          timeout: 10_000,
        },
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof WebPushError) {
        const gone = error.statusCode === 404 || error.statusCode === 410;
        return {
          ok: false,
          gone,
          error: `push ${error.statusCode}: ${error.body || error.message}`,
        };
      }
      return {
        ok: false,
        gone: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
