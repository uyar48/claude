import { json, missingEnv, readEnv } from '../server/env.js';

/** Public runtime configuration for the client (no secrets). */
export function GET(): Response {
  const env = readEnv();
  return json({
    supabaseUrl: env.supabaseUrl ?? null,
    supabaseAnonKey: env.supabaseAnonKey ?? null,
    vapidPublicKey: env.vapidPublicKey ?? null,
    missing: missingEnv(env),
  });
}
