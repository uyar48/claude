// Two-way sync with Supabase. Push dirty local rows through LWW RPCs, then pull
// rows changed on the server since our cursor (server clock, `synced_at`).

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSettings } from '../core/settings';
import { cardToRow, lessonToRow, rowToCard, rowToLesson, type CardRow, type LessonRow } from './merge';
import type { Store } from './store';

const CURSOR = { cards: 'cursor:cards', lessons: 'cursor:lessons' } as const;
const PAGE = 500;

export class SyncEngine {
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private store: Store,
    private sb: SupabaseClient,
    private userId: string,
  ) {
    store.onLocalChange = () => this.schedule(1500);
  }

  schedule(delay = 0) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delay);
  }

  /** Runs a sync; concurrent calls coalesce into one follow-up run. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.running;
  }

  private async run() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.store.setSync({ status: 'offline' });
      return;
    }
    this.store.setSync({ status: 'syncing', error: undefined });
    try {
      await this.push();
      await this.pull();
      this.store.setSync({ status: 'idle', lastSyncAt: Date.now() });
    } catch (err) {
      console.warn('sync failed', err);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.store.setSync({ status: offline ? 'offline' : 'error', error: (err as Error).message });
    }
  }

  private async push() {
    const cards = await this.store.dirtyCards();
    if (cards.length) {
      const { error } = await this.sb.rpc('sync_cards', { rows: cards.map(cardToRow) });
      if (error) throw error;
      await this.store.markClean('cards', cards.map((c) => ({ key: c.wordId, updatedAt: c.updatedAt })));
    }
    const lessons = await this.store.dirtyLessons();
    if (lessons.length) {
      const { error } = await this.sb.rpc('sync_lessons', { rows: lessons.map(lessonToRow) });
      if (error) throw error;
      await this.store.markClean('lessons', lessons.map((l) => ({ key: l.id, updatedAt: l.updatedAt })));
    }
    const reviews = await this.store.dirtyReviews();
    if (reviews.length) {
      const rows = reviews.map((r) => ({
        id: r.id,
        user_id: this.userId,
        word_id: r.wordId,
        grade: r.grade,
        context: r.context,
        reviewed_at: r.reviewedAt,
      }));
      const { error } = await this.sb.from('review_log').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      await this.store.markReviewsClean(reviews.map((r) => r.id));
    }
    if (await this.store.settingsDirty()) {
      const s = this.store.getState().settings;
      const { error } = await this.sb.rpc('sync_settings', { new_settings: s, new_updated_at: s.updatedAt });
      if (error) throw error;
      await this.store.clearSettingsDirty(s.updatedAt);
    }
  }

  /** Rows changed since the stored cursor (inclusive, so equal timestamps are never skipped). */
  private async changedRows<T>(table: 'cards' | 'lesson_log', key: string, cursorKey: string) {
    const since = ((await this.store.kvGet(cursorKey)) as string | undefined) ?? '1970-01-01T00:00:00Z';
    const rows: Array<T & { synced_at: string }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb
        .from(table)
        .select('*')
        .gte('synced_at', since)
        .order('synced_at')
        .order(key)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data as Array<T & { synced_at: string }>));
      if (data.length < PAGE) break;
    }
    const cursor = rows.reduce((max, r) => (r.synced_at > max ? r.synced_at : max), since);
    return { rows, commit: () => this.store.kvSet(cursorKey, cursor) };
  }

  private async pull() {
    const cards = await this.changedRows<CardRow>('cards', 'word_id', CURSOR.cards);
    const lessons = await this.changedRows<LessonRow>('lesson_log', 'id', CURSOR.lessons);

    const prof = await this.sb.from('profiles').select('settings,settings_updated_at').maybeSingle();
    if (prof.error) throw prof.error;
    const remoteSettings =
      prof.data && Number(prof.data.settings_updated_at) > 0
        ? { ...normalizeSettings(prof.data.settings), updatedAt: Number(prof.data.settings_updated_at) }
        : null;

    await this.store.applyRemote(cards.rows.map(rowToCard), lessons.rows.map(rowToLesson), remoteSettings);
    await cards.commit();
    await lessons.commit();
  }

  async touchActive() {
    const { error } = await this.sb.rpc('touch_active');
    if (error) console.warn('touch_active failed', error.message);
  }

  async markNotificationOpened(id: string) {
    await this.sb.from('notification_log').update({ engaged_at: new Date().toISOString() }).eq('id', id).is('engaged_at', null);
  }

  async savePushSubscription(sub: PushSubscriptionJSON) {
    if (!sub.endpoint || !sub.keys) return;
    const { error } = await this.sb.from('push_subscriptions').upsert(
      {
        endpoint: sub.endpoint,
        user_id: this.userId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      },
      { onConflict: 'endpoint' },
    );
    if (error) throw error;
  }

  async deletePushSubscription(endpoint: string) {
    await this.sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }
}
