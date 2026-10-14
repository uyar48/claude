import { json, readEnv } from '../server/env.js';
import { adminClient, anonClient } from '../server/supabase.js';

/**
 * Sends a sign-in e-mail (magic link + 6-digit code) to the single allowed
 * address. The user is created on first use, so public sign-ups can stay off.
 */
export async function POST(req: Request): Promise<Response> {
  const env = readEnv();
  if (!env.supabaseUrl || !env.supabaseAnonKey || !env.supabaseServiceKey || !env.allowedEmail) {
    return json({ error: 'not-configured' }, 503);
  }
  let body: { email?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  if (email !== env.allowedEmail) return json({ error: 'not-allowed' }, 403);

  const created = await adminClient(env).auth.admin.createUser({ email, email_confirm: true });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    return json({ error: 'create-failed', detail: created.error.message }, 500);
  }

  const origin = new URL(req.url).origin;
  const redirectTo = body.redirectTo && body.redirectTo.startsWith(origin) ? body.redirectTo : `${origin}/`;
  const { error } = await anonClient(env).auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  if (error) return json({ error: 'send-failed', detail: error.message }, error.status ?? 500);
  return json({ ok: true });
}
