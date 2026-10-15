// Cron job body: for every user, decide and send at most one notification.
// Storage and push delivery are injected so the logic is unit-testable.

import { applyEngagement, decide, type PlannedNotification, type SentNotification } from '../src/core/scheduler.js';
import { normalizeSettings } from '../src/core/settings.js';
import type { PushPayload, PushResult, StoredSubscription } from './push.js';

export interface UserState {
  userId: string;
  settings: unknown;
  lastActiveAt: number | null;
  dueCount: number;
  /** Active minutes learned today (local day). */
  minutesToday: number;
  nextLesson: number;
  history: SentNotification[];
  subscriptions: StoredSubscription[];
}

export interface NotifyStore {
  listUserIds(): Promise<string[]>;
  /** dueBefore/today are computed by the caller in the user's zone. */
  loadState(userId: string, now: number): Promise<UserState>;
  markEngaged(userId: string, updates: Array<{ id: string; engagedAt: number }>): Promise<void>;
  recordNotification(
    userId: string,
    n: { id: string; kind: string; sentAt: number; delivered: number; backoffLevel: number },
  ): Promise<void>;
  removeSubscriptions(endpoints: string[]): Promise<void>;
  markSubscriptionResults(results: PushResult[]): Promise<void>;
}

export interface NotifyDeps {
  now: number;
  store: NotifyStore;
  send: (subs: StoredSubscription[], payload: PushPayload) => Promise<PushResult[]>;
  newId: () => string;
}

export interface NotifyOutcome {
  userId: string;
  sent: PlannedNotification | null;
  delivered: number;
  reason?: string;
}

export async function runNotify(deps: NotifyDeps): Promise<NotifyOutcome[]> {
  const out: NotifyOutcome[] = [];
  for (const userId of await deps.store.listUserIds()) {
    out.push(await notifyUser(userId, deps));
  }
  return out;
}

async function notifyUser(userId: string, deps: NotifyDeps): Promise<NotifyOutcome> {
  const { now, store } = deps;
  const state = await store.loadState(userId, now);
  const settings = normalizeSettings(state.settings);

  // 1) Record engagement first so the back-off sees fresh data.
  const history = applyEngagement(state.history, state.lastActiveAt);
  const updates = history
    .filter((n, i) => n.engagedAt !== null && state.history[i].engagedAt === null)
    .map((n) => ({ id: n.id, engagedAt: n.engagedAt as number }));
  if (updates.length) await store.markEngaged(userId, updates);

  if (state.subscriptions.length === 0) return { userId, sent: null, delivered: 0, reason: 'no-subscription' };

  // 2) Decide.
  const planned = decide({
    now,
    timezone: settings.timezone,
    settings: settings.notifications,
    goalMinutes: settings.goalMinutes,
    goalMetToday: state.minutesToday >= settings.goalMinutes,
    paused: settings.paused,
    nextLesson: state.nextLesson,
    dueCount: state.dueCount,
    history,
  });
  if (!planned) return { userId, sent: null, delivered: 0, reason: 'not-due' };

  // 3) Send and log.
  const id = deps.newId();
  const results = await deps.send(state.subscriptions, {
    id,
    title: planned.title,
    body: planned.body,
    url: planned.url,
    tag: planned.tag,
  });
  const delivered = results.filter((r) => r.ok).length;
  const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
  if (gone.length) await store.removeSubscriptions(gone);
  await store.markSubscriptionResults(results);
  if (delivered > 0) {
    await store.recordNotification(userId, {
      id,
      kind: planned.kind,
      sentAt: now,
      delivered,
      backoffLevel: planned.backoffLevel,
    });
  }
  return { userId, sent: planned, delivered, reason: delivered ? undefined : 'delivery-failed' };
}
