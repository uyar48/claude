import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { ServerEnv } from './env.js';

export function adminClient(env: ServerEnv): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error('Supabase is not configured');
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(env: ServerEnv): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('Supabase is not configured');
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' },
  });
}

/** Validates the bearer token and the single allowed e-mail. */
export async function requireUser(req: Request, env: ServerEnv): Promise<User | Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return new Response('Unauthorized', { status: 401 });
  const { data, error } = await adminClient(env).auth.getUser(token);
  if (error || !data.user) return new Response('Unauthorized', { status: 401 });
  if (!env.allowedEmail || data.user.email?.toLowerCase() !== env.allowedEmail) {
    return new Response('Forbidden', { status: 403 });
  }
  return data.user;
}
