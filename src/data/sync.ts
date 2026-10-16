// Two-way sync with Supabase. Push dirty local rows through LWW RPCs, then pull
// rows changed on the server since our cursor (server clock, `synced_at`).

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSettings } from '../core/settings';
import {
  cardToRow,
  choiceToRow,
  lessonToRow,
  rowToCard,
  rowToChoice,
  rowToLesson,
  type CardRow,
  type LessonRow,
  type MediaChoiceRow,
} from './merge';
import type { Store } from './store';

const CURSOR = { cards: 'cursor:cards', lessons: 'cursor:lessons' } as const;

interface ClientLogEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
}

/** Message with the Postgres/PostgREST code when there is one. */
export function describeError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as { message?: string; code?: string; details?: string; hint?: string; status?: number };
  const parts = [e.code, e.message, e.details, e.hint].filter(Boolean);
  return parts.length ? parts.join(' · ') : String(err);
}

/** Network failures as reported by Safari, Chrome and Firefox. */
export function isNetworkError(message: string): boolean {
  return /load failed|failed to fetch|networkerror|network connection was lost|timed out|aborted|fetch/i.test(message);
}
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

  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  private async run() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.store.setSync({ status: 'offline' });
      return;
    }
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.store.setSync({ status: 'syncing' });
    try {
      await this.push();
      await this.pull();
      this.failures = 0;
      this.store.setSync({ status: 'idle', lastSyncAt: Date.now(), error: undefined });
      await this.reportErrors();
    } catch (err) {
      console.warn('sync failed', err);
      this.failures++;
      const message = describeError(err);
      await this.logError(message);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      // A dropped connection (common right after an iPhone app comes back to
      // the foreground) is retried quietly a few times before it is shown.
      const transient = isNetworkError(message);
      if (offline) this.store.setSync({ status: 'offline' });
      else if (transient && this.failures < 3) this.store.setSync({ status: 'syncing' });
      else this.store.setSync({ status: 'error', error: message });
      const delay = Math.min(60_000, 3000 * 2 ** (this.failures - 1));
      this.retry = setTimeout(() => void this.sync(), delay);
    }
  }

  /** Keeps the last sync errors on the device until they can be sent. */
  private async logError(message: string) {
    try {
      const list = ((await this.store.kvGet('syncErrors')) as ClientLogEntry[] | undefined) ?? [];
      const entry: ClientLogEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), kind: 'sync', message };
      await this.store.kvSet('syncErrors', [...list, entry].slice(-20));
    } catch {
      /* never let logging break sync */
    }
  }

  /** Sends stored errors to the server (client_log) after a good sync, for diagnosis. */
  private async reportErrors() {
    try {
      const list = ((await this.store.kvGet('syncErrors')) as ClientLogEntry[] | undefined) ?? [];
      if (!list.length) return;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null;
      const { error } = await this.sb.from('client_log').upsert(
        list.map((e) => ({ ...e, message: e.message.slice(0, 500), user_id: this.userId, user_agent: ua })),
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (!error) await this.store.kvSet('syncErrors', []);
    } catch {
      /* best effort */
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
      const { error } = await this.sb.rpc('sync_lessons', { rows: lessons.map((l) => lessonToRow(l)) });
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
    const choices = await this.store.dirtyMediaChoices();
    if (choices.length) {
      const { error } = await this.sb.rpc('sync_media_choices', { rows: choices.map(choiceToRow) });
      if (error) throw error;
      await this.store.markMediaChoicesClean(choices);
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

    // Few rows (one per word at most): always read them all.
    const choices = await this.sb.from('media_choices').select('word_id,choice,rejected,updated_at');
    if (choices.error) {
      // Older database without migration 0003: pictures fall back to defaults.
      if (!/media_choices/.test(choices.error.message ?? '')) throw choices.error;
    } else {
      await this.store.applyRemoteChoices((choices.data as MediaChoiceRow[]).map(rowToChoice));
    }
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
