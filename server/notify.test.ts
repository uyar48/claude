import { describe, expect, it } from 'vitest';
import { runNotify, type NotifyStore, type UserState } from './notify';
import type { PushPayload, PushResult, StoredSubscription } from './push';
import { defaultSettings } from '../src/core/settings';
import { DAY, HOUR } from '../src/core/time';

const AT_1935 = Date.UTC(2026, 9, 14, 16, 35); // 19:35 Istanbul

function fakeStore(state: Partial<UserState>) {
  const calls = {
    engaged: [] as Array<{ id: string; engagedAt: number }>,
    recorded: [] as Array<{ id: string; kind: string; sentAt: number; delivered: number; backoffLevel: number }>,
    removed: [] as string[],
  };
  const full: UserState = {
    userId: 'u1',
    settings: defaultSettings(),
    lastActiveAt: null,
    dueCount: 3,
    minutesToday: 0,
    nextLesson: 4,
    history: [],
    subscriptions: [{ endpoint: 'https://push.example/a', p256dh: 'k', auth: 'a' }],
    ...state,
  };
  const store: NotifyStore = {
    listUserIds: async () => ['u1'],
    loadState: async () => full,
    markEngaged: async (_u, updates) => void calls.engaged.push(...updates),
    recordNotification: async (_u, n) => void calls.recorded.push(n),
    removeSubscriptions: async (eps) => void calls.removed.push(...eps),
    markSubscriptionResults: async () => {},
  };
  return { store, calls };
}

function sender(results: (s: StoredSubscription) => Partial<PushResult> = () => ({ ok: true })) {
  const sent: PushPayload[] = [];
  const send = async (subs: StoredSubscription[], payload: PushPayload) => {
    sent.push(payload);
    return subs.map((s) => ({ endpoint: s.endpoint, ok: false, gone: false, ...results(s) }));
  };
  return { send, sent };
}

describe('notification cron', () => {
  it('sends the daily reminder once and logs it', async () => {
    const { store, calls } = fakeStore({});
    const { send, sent } = sender();
    const [out] = await runNotify({ now: AT_1935, store, send, newId: () => 'id1' });
    expect(out.sent?.kind).toBe('lesson');
    expect(out.delivered).toBe(1);
    expect(sent[0]).toMatchObject({ id: 'id1', url: '/?from=push', title: '4. ders hazır' });
    expect(calls.recorded).toEqual([{ id: 'id1', kind: 'lesson', sentAt: AT_1935, delivered: 1, backoffLevel: 0 }]);
  });

  it('skips the lesson reminder once the daily goal is met', async () => {
    const { store } = fakeStore({ minutesToday: 31, dueCount: 0 });
    const { send, sent } = sender();
    const [out] = await runNotify({ now: AT_1935, store, send, newId: () => 'x' });
    expect(out.sent).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('sends nothing while paused, from old or new settings', async () => {
    const { store } = fakeStore({ settings: { ...defaultSettings(), paused: true, pausedAt: AT_1935 - 9 * DAY } });
    const { send, sent } = sender();
    const [out] = await runNotify({ now: AT_1935, store, send, newId: () => 'x' });
    expect(out.sent).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('does nothing without a push subscription', async () => {
    const { store } = fakeStore({ subscriptions: [] });
    const { send, sent } = sender();
    const [out] = await runNotify({ now: AT_1935, store, send, newId: () => 'x' });
    expect(out.reason).toBe('no-subscription');
    expect(sent).toHaveLength(0);
  });

  it('records engagement from app activity before deciding', async () => {
    const history = [0, 1, 2].map((i) => ({
      id: `h${i}`,
      kind: 'lesson' as const,
      sentAt: AT_1935 - (i + 1) * DAY,
      engagedAt: null,
    }));
    const { store, calls } = fakeStore({ history, lastActiveAt: AT_1935 - DAY + HOUR });
    const { send } = sender();
    const [out] = await runNotify({ now: AT_1935, store, send, newId: () => 'x' });
    expect(calls.engaged.map((e) => e.id)).toEqual(['h0']);
    expect(out.sent?.backoffLevel).toBe(0);
  });

  it('three ignored reminders lower the frequency', async () => {
    const history = [0, 1, 2].map((i) => ({
      id: `h${i}`,
      kind: 'lesson' as const,
      sentAt: AT_1935 - (i + 1) * DAY,
      engagedAt: null,
    }));
    const { store } = fakeStore({ history });
    const { send, sent } = sender();
    const [out] = await runNotify({ now: AT_1935, store, send, newId: () => 'x' });
    expect(out.sent).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('removes expired subscriptions and does not log undelivered notifications', async () => {
    const { store, calls } = fakeStore({});
    const { send } = sender(() => ({ ok: false, gone: true, status: 410 }));
    const [out] = await runNotify({ now: AT_1935, store, send, newId: () => 'x' });
    expect(out.delivered).toBe(0);
    expect(calls.removed).toEqual(['https://push.example/a']);
    expect(calls.recorded).toEqual([]);
  });
});
