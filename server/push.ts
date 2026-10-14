import webpush from 'web-push';
import type { ServerEnv } from './env.js';

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  id?: string;
}

export interface PushResult {
  endpoint: string;
  ok: boolean;
  /** Subscription is gone (404/410) and should be deleted. */
  gone: boolean;
  status?: number;
  error?: string;
}

export type PushSender = (subs: StoredSubscription[], payload: PushPayload) => Promise<PushResult[]>;

export function webPushSender(env: ServerEnv): PushSender {
  if (!env.vapidPublicKey || !env.vapidPrivateKey) throw new Error('VAPID keys are not configured');
  const vapidDetails = { subject: env.vapidSubject, publicKey: env.vapidPublicKey, privateKey: env.vapidPrivateKey };
  return async (subs, payload) =>
    Promise.all(
      subs.map(async (s): Promise<PushResult> => {
        try {
          const res = await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { vapidDetails, TTL: 6 * 3600, urgency: 'normal', topic: payload.tag.slice(0, 32) },
          );
          return { endpoint: s.endpoint, ok: true, gone: false, status: res.statusCode };
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          return {
            endpoint: s.endpoint,
            ok: false,
            gone: status === 404 || status === 410,
            status,
            error: (err as Error).message,
          };
        }
      }),
    );
}
