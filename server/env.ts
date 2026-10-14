// Server-side configuration (Vercel environment variables).

export interface ServerEnv {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  allowedEmail?: string;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject: string;
  cronSecret?: string;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function readEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  return {
    supabaseUrl: clean(env.SUPABASE_URL),
    supabaseAnonKey: clean(env.SUPABASE_ANON_KEY),
    supabaseServiceKey: clean(env.SUPABASE_SERVICE_ROLE_KEY),
    allowedEmail: clean(env.ALLOWED_EMAIL)?.toLowerCase(),
    vapidPublicKey: clean(env.VAPID_PUBLIC_KEY),
    vapidPrivateKey: clean(env.VAPID_PRIVATE_KEY),
    vapidSubject: clean(env.VAPID_SUBJECT) ?? 'mailto:admin@example.com',
    cronSecret: clean(env.CRON_SECRET),
  };
}

/** Names of required variables that are not set (shown in the app's setup checklist). */
export function missingEnv(e: ServerEnv): string[] {
  const missing: string[] = [];
  if (!e.supabaseUrl) missing.push('SUPABASE_URL');
  if (!e.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!e.supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!e.allowedEmail) missing.push('ALLOWED_EMAIL');
  if (!e.vapidPublicKey) missing.push('VAPID_PUBLIC_KEY');
  if (!e.vapidPrivateKey) missing.push('VAPID_PRIVATE_KEY');
  if (!e.cronSecret) missing.push('CRON_SECRET');
  return missing;
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
