import { json, readEnv } from '../../server/env.js';
import { normalizeCode, redeemLink } from '../../server/deviceLink.js';
import { adminClient, anonClient } from '../../server/supabase.js';

/** Exchanges a one-time device code for a fresh session for this device. */
export async function POST(req: Request): Promise<Response> {
  const env = readEnv();
  if (!env.supabaseUrl || !env.supabaseServiceKey || !env.supabaseAnonKey || !env.allowedEmail) {
    return json({ error: 'not-configured' }, 503);
  }
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = normalizeCode(body.code ?? '');
  if (!code) return json({ error: 'bad-code' }, 400);

  const admin = adminClient(env);
  const userId = await redeemLink(admin, code);
  if (!userId) return json({ error: 'invalid-code' }, 401);

  const { data: u, error: ue } = await admin.auth.admin.getUserById(userId);
  const email = u.user?.email?.toLowerCase();
  if (ue || email !== env.allowedEmail) return json({ error: 'forbidden' }, 403);

  // Mint a session without sending e-mail: generate a magic-link token and verify it here.
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || !tokenHash) return json({ error: 'link-failed', detail: link.error?.message }, 500);
  const { data, error } = await anonClient(env).auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (error || !data.session) return json({ error: 'verify-failed', detail: error?.message }, 500);
  return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}
