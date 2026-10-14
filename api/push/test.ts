import { json, readEnv } from '../../server/env.js';
import { webPushSender, type StoredSubscription } from '../../server/push.js';
import { adminClient, requireUser } from '../../server/supabase.js';

const PAYLOAD = {
  title: 'Test bildirimi',
  body: 'Bildirimler çalışıyor. Hatırlatmalar seçtiğin saatte gelecek.',
  url: '/settings',
  tag: 'okuma-test',
};

/** Sends a test push to the signed-in user's devices. */
export async function POST(req: Request): Promise<Response> {
  const env = readEnv();
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return json({ error: 'vapid-missing' }, 503);
  const send = webPushSender(env);

  // Local mode (no Supabase): push straight to the subscription in the body.
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    const body = (await req.json().catch(() => ({}))) as { subscription?: PushSubscriptionJSON };
    const s = body.subscription;
    if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'no-subscription' }, 400);
    const [r] = await send([{ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth }], PAYLOAD);
    return json({ delivered: r.ok ? 1 : 0, total: 1, results: [r] }, r.ok ? 200 : 502);
  }

  const user = await requireUser(req, env);
  if (user instanceof Response) return user;
  const db = adminClient(env);
  const { data, error } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', user.id);
  if (error) return json({ error: error.message }, 500);
  const subs = (data ?? []) as StoredSubscription[];
  if (subs.length === 0) return json({ error: 'no-subscription' }, 404);

  const id = crypto.randomUUID();
  const results = await send(subs, { ...PAYLOAD, id });
  const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone);
  const delivered = results.filter((r) => r.ok).length;
  if (delivered) {
    await db.from('notification_log').insert({ id, user_id: user.id, kind: 'test', delivered });
  }
  return json({ delivered, total: subs.length, results }, delivered ? 200 : 502);
}
