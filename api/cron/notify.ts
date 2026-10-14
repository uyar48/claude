import { json, readEnv } from '../../server/env.js';
import { runNotify } from '../../server/notify.js';
import { supabaseNotifyStore } from '../../server/notifyStore.js';
import { webPushSender } from '../../server/push.js';
import { adminClient } from '../../server/supabase.js';

/**
 * Called every ~10 minutes by Supabase pg_cron (see supabase/cron.sql) or any
 * external scheduler, with `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(req: Request): Promise<Response> {
  const env = readEnv();
  if (!env.cronSecret || req.headers.get('authorization') !== `Bearer ${env.cronSecret}`) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.supabaseUrl || !env.supabaseServiceKey || !env.vapidPublicKey || !env.vapidPrivateKey) {
    return json({ error: 'not-configured' }, 503);
  }
  const db = adminClient(env);
  const allowed = env.allowedEmail ? await userIdsForEmail(db, env.allowedEmail) : undefined;
  const outcomes = await runNotify({
    now: Date.now(),
    store: supabaseNotifyStore(db, allowed),
    send: webPushSender(env),
    newId: () => crypto.randomUUID(),
  });
  return json({ ok: true, outcomes });
}

async function userIdsForEmail(db: ReturnType<typeof adminClient>, email: string): Promise<string[]> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const users = data.users as Array<{ id: string; email?: string }>;
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return [hit.id];
    if (users.length < 100) break;
  }
  return [];
}

export const GET = handle;
export const POST = handle;
