import { json, readEnv } from '../../server/env.js';
import { createLink } from '../../server/deviceLink.js';
import { adminClient, requireUser } from '../../server/supabase.js';

/** A signed-in device asks for a one-time code to sign in another device. */
export async function POST(req: Request): Promise<Response> {
  const env = readEnv();
  if (!env.supabaseUrl || !env.supabaseServiceKey) return json({ error: 'not-configured' }, 503);
  const user = await requireUser(req, env);
  if (user instanceof Response) return user;
  return json(await createLink(adminClient(env), user.id));
}
