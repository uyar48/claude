// Device linking: a signed-in device shows a short code; another device types
// it and receives its own session. Used for the iPhone home-screen app, which
// cannot open e-mail links into its own storage.
//
// Safety: codes are 6 digits, stored hashed, valid 10 minutes, single use.
// Every wrong guess counts against all open codes; after 5 they are revoked.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

export const hashCode = (code: string) => crypto.createHash('sha256').update(`okuma-link:${code}`).digest('hex');

export function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function normalizeCode(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

export async function createLink(db: SupabaseClient, userId: string, now = Date.now()) {
  // Revoke the user's earlier open codes so only one is valid at a time.
  await db.from('device_links').update({ used_at: new Date(now).toISOString() }).eq('user_id', userId).is('used_at', null);
  const code = newCode();
  const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
  const { error } = await db
    .from('device_links')
    .insert({ code_hash: hashCode(code), user_id: userId, expires_at: expiresAt });
  if (error) throw error;
  return { code, expiresAt };
}

/** Returns the user id for a valid code (and consumes it), or null. */
export async function redeemLink(db: SupabaseClient, code: string, now = Date.now()): Promise<string | null> {
  const nowIso = new Date(now).toISOString();
  const { data, error } = await db
    .from('device_links')
    .select('code_hash,user_id,attempts')
    .eq('code_hash', hashCode(code))
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle();
  if (error) throw error;
  if (data && data.attempts < MAX_ATTEMPTS) {
    const used = await db
      .from('device_links')
      .update({ used_at: nowIso })
      .eq('code_hash', data.code_hash)
      .is('used_at', null)
      .select('user_id');
    if (used.error) throw used.error;
    return used.data?.length ? (data.user_id as string) : null;
  }
  // Wrong code: count the attempt on every open code, revoke at the limit.
  const open = await db.from('device_links').select('code_hash,attempts').is('used_at', null).gt('expires_at', nowIso);
  for (const row of open.data ?? []) {
    const attempts = (row.attempts as number) + 1;
    await db
      .from('device_links')
      .update({ attempts, ...(attempts >= MAX_ATTEMPTS ? { used_at: nowIso } : {}) })
      .eq('code_hash', row.code_hash);
  }
  return null;
}
