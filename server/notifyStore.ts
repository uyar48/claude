// Supabase-backed NotifyStore used by the cron endpoint (service role).

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSettings } from '../src/core/settings.js';
import type { NotificationKind, SentNotification } from '../src/core/scheduler.js';
import { endOfLocalDay, localDate } from '../src/core/time.js';
import type { NotifyStore, UserState } from './notify.js';
import type { PushResult } from './push.js';

const ms = (ts: string | null) => (ts ? Date.parse(ts) : null);
const iso = (n: number) => new Date(n).toISOString();

export function supabaseNotifyStore(db: SupabaseClient, allowedUserIds?: string[]): NotifyStore {
  return {
    async listUserIds() {
      const { data, error } = await db.from('push_subscriptions').select('user_id');
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((r) => r.user_id as string))];
      return allowedUserIds ? ids.filter((id) => allowedUserIds.includes(id)) : ids;
    },

    async loadState(userId, now): Promise<UserState> {
      const profile = await db.from('profiles').select('settings,last_active_at').eq('user_id', userId).maybeSingle();
      if (profile.error) throw profile.error;
      const settings = normalizeSettings(profile.data?.settings);
      const tz = settings.timezone;

      const due = await db
        .from('cards')
        .select('word_id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .neq('state', 'new')
        .lt('due_at', endOfLocalDay(now, tz));
      if (due.error) throw due.error;

      const today = await db.from('lesson_log').select('active_ms').eq('user_id', userId).eq('date', localDate(now, tz));
      if (today.error) throw today.error;
      const last = await db
        .from('lesson_log')
        .select('number,completed_at')
        .eq('user_id', userId)
        .order('number', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last.error) throw last.error;

      const hist = await db
        .from('notification_log')
        .select('id,kind,sent_at,engaged_at')
        .eq('user_id', userId)
        .order('sent_at', { ascending: false })
        .limit(40);
      if (hist.error) throw hist.error;

      const subs = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', userId);
      if (subs.error) throw subs.error;

      return {
        userId,
        settings: profile.data?.settings ?? {},
        lastActiveAt: ms(profile.data?.last_active_at ?? null),
        dueCount: due.count ?? 0,
        minutesToday: (today.data ?? []).reduce((a, r) => a + Number(r.active_ms ?? 0), 0) / 60_000,
        nextLesson: last.data ? Number(last.data.number) + (last.data.completed_at === null ? 0 : 1) : 1,
        history: (hist.data ?? []).map(
          (r): SentNotification => ({
            id: r.id,
            kind: r.kind as NotificationKind,
            sentAt: Date.parse(r.sent_at),
            engagedAt: ms(r.engaged_at),
          }),
        ),
        subscriptions: subs.data ?? [],
      };
    },

    async markEngaged(userId, updates) {
      for (const u of updates) {
        const { error } = await db
          .from('notification_log')
          .update({ engaged_at: iso(u.engagedAt) })
          .eq('user_id', userId)
          .eq('id', u.id);
        if (error) throw error;
      }
    },

    async recordNotification(userId, n) {
      const { error } = await db.from('notification_log').insert({
        id: n.id,
        user_id: userId,
        kind: n.kind,
        sent_at: iso(n.sentAt),
        delivered: n.delivered,
        backoff_level: n.backoffLevel,
      });
      if (error) throw error;
    },

    async removeSubscriptions(endpoints) {
      const { error } = await db.from('push_subscriptions').delete().in('endpoint', endpoints);
      if (error) throw error;
    },

    async markSubscriptionResults(results: PushResult[]) {
      for (const r of results) {
        if (r.gone) continue;
        const patch = r.ok ? { last_success_at: new Date().toISOString(), failures: 0 } : {};
        if (!r.ok) {
          const cur = await db.from('push_subscriptions').select('failures').eq('endpoint', r.endpoint).maybeSingle();
          Object.assign(patch, { failures: ((cur.data?.failures as number) ?? 0) + 1 });
        }
        await db.from('push_subscriptions').update(patch).eq('endpoint', r.endpoint);
      }
    },
  };
}
