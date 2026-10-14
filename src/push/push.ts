// Web push on the client: permission, subscription, test notification.
// iPhone: push works only for the home-screen app (iOS 16.4+), and permission
// must be requested from a tap inside that app.

import type { Runtime } from '../data/runtime';

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export type PushAvailability =
  | { ok: true }
  | { ok: false; reason: 'ios-not-installed' | 'unsupported' | 'no-server-key' };

export function pushAvailability(rt: Runtime): PushAvailability {
  if (isIOS() && !isStandalone()) return { ok: false, reason: 'ios-not-installed' };
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  if (!rt.config.vapidPublicKey) return { ok: false, reason: 'no-server-key' };
  return { ok: true };
}

export function permission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Must be called directly from a click handler: the permission prompt is the
 * first thing that happens, before any other await.
 */
export async function enablePush(rt: Runtime): Promise<PushSubscription> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'denied' : 'dismissed');
  return ensureSubscription(rt);
}

export async function ensureSubscription(rt: Runtime): Promise<PushSubscription> {
  if (!rt.config.vapidPublicKey) throw new Error('no-server-key');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = keyBytes(rt.config.vapidPublicKey);
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  if (rt.sync) await rt.sync.savePushSubscription(sub.toJSON());
  return sub;
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return true;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export async function disablePush(rt: Runtime) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  if (rt.sync) await rt.sync.deletePushSubscription(sub.endpoint);
  await sub.unsubscribe();
}

export interface TestResult {
  via: 'server' | 'local';
  delivered: number;
  total: number;
  error?: string;
}

/** Real push through the server when possible; otherwise a local notification. */
export async function sendTestNotification(rt: Runtime): Promise<TestResult> {
  const sub = await ensureSubscription(rt).catch(() => null);
  if (sub && !rt.config.missing.includes('VAPID_PRIVATE_KEY')) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (rt.session) headers.Authorization = `Bearer ${(await rt.supabase!.auth.getSession()).data.session?.access_token}`;
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers,
      body: JSON.stringify(rt.session ? {} : { subscription: sub.toJSON() }),
    });
    const body = (await res.json().catch(() => ({}))) as { delivered?: number; total?: number; error?: string };
    return { via: 'server', delivered: body.delivered ?? 0, total: body.total ?? 0, error: res.ok ? undefined : body.error ?? String(res.status) };
  }
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Test bildirimi (yerel)', {
    body: 'Bu cihaz bildirim gösterebiliyor. Sunucu bildirimi için kurulum gerekli.',
    icon: '/icons/icon-192.png',
    tag: 'okuma-test',
  });
  return { via: 'local', delivered: 1, total: 1 };
}
