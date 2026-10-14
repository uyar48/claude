// Two devices, one account: progress made on one shows up on the other.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openStore } from './db';
import { Store } from './store';
import { SyncEngine } from './sync';
import { DAY } from '../core/time';

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the PostgREST/RPC calls SyncEngine makes. */
function fakeSupabase() {
  const tables: Record<string, Map<string, Row>> = {
    cards: new Map(),
    lesson_log: new Map(),
    review_log: new Map(),
    profiles: new Map(),
  };
  let clock = Date.UTC(2026, 0, 1);
  const tick = () => new Date((clock += 1)).toISOString().replace('Z', '+00:00');
  const lww = (table: string, key: string, row: Row) => {
    const cur = tables[table].get(key);
    if (!cur || (cur.updated_at as number) < (row.updated_at as number)) {
      tables[table].set(key, { ...row, synced_at: tick() });
    }
  };

  function query(table: string) {
    let rows = () => [...tables[table].values()];
    const filters: Array<(r: Row) => boolean> = [];
    const orders: string[] = [];
    let range: [number, number] | null = null;
    let single = false;
    const run = () => {
      let out = rows().filter((r) => filters.every((f) => f(r)));
      out.sort((a, b) => {
        for (const o of orders) {
          if (a[o]! < b[o]!) return -1;
          if (a[o]! > b[o]!) return 1;
        }
        return 0;
      });
      if (range) out = out.slice(range[0], range[1] + 1);
      return { data: single ? (out[0] ?? null) : out.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select: () => b,
      gte: (col: string, v: string) => (filters.push((r) => (r[col] as string) >= v), b),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), b),
      order: (col: string) => (orders.push(col), b),
      range: (from: number, to: number) => ((range = [from, to]), b),
      maybeSingle: () => ((single = true), b),
      upsert: (input: Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
        for (const r of input) {
          const k = String(r[opts.onConflict]);
          if (!(opts.ignoreDuplicates && tables[table].has(k))) tables[table].set(k, { ...r, synced_at: tick() });
        }
        rows = () => [];
        return b;
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  }

  const client = {
    from: query,
    rpc: async (name: string, args: Row) => {
      if (name === 'sync_cards') for (const r of args.rows as Row[]) lww('cards', String(r.word_id), r);
      if (name === 'sync_lessons') for (const r of args.rows as Row[]) lww('lesson_log', String(r.id), r);
      if (name === 'sync_settings') {
        const cur = tables.profiles.get('me');
        if (!cur || (cur.settings_updated_at as number) < (args.new_updated_at as number)) {
          tables.profiles.set('me', { settings: args.new_settings, settings_updated_at: args.new_updated_at });
        }
      }
      return { data: null, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, tables };
}

let n = 0;
async function device(server: ReturnType<typeof fakeSupabase>, now: () => number) {
  const store = new Store(await openStore(`device-${n++}`), now);
  await store.load();
  const sync = new SyncEngine(store, server.client, 'user-1');
  store.onLocalChange = () => {}; // tests sync explicitly
  return { store, sync };
}

describe('sync between two devices', () => {
  it('cards, lessons and settings made on the phone appear on the desktop', async () => {
    const server = fakeSupabase();
    let t = Date.UTC(2026, 9, 14, 16, 0);
    const phone = await device(server, () => t);
    const desktop = await device(server, () => t);

    await phone.store.introduceWords(['house', 'door']);
    await phone.store.grade('house', 'good', 'quiz');
    await phone.store.putLesson({
      id: 'L1',
      date: '2026-10-14',
      startedAt: t,
      completedAt: t + 1000,
      textIds: ['t5'],
      newWordIds: ['house', 'door'],
      reviewed: 0,
      correct: 0,
      updatedAt: t,
    });
    await phone.store.updateSettings((s) => ({ ...s, lessonMinutes: 20 }));
    await phone.sync.sync();

    await desktop.sync.sync();
    const d = desktop.store.getState();
    expect(d.cards.get('house')).toEqual(phone.store.getState().cards.get('house'));
    expect(d.cards.get('door')?.state).toBe('learning');
    expect(d.lessons.map((l) => l.id)).toEqual(['L1']);
    expect(d.settings.lessonMinutes).toBe(20);
    expect(server.tables.review_log.size).toBe(1);

    // Nothing is left dirty after a successful round-trip.
    expect(await phone.store.dirtyCards()).toEqual([]);
    expect(await desktop.store.dirtyCards()).toEqual([]);
  });

  it('the newer change wins when both devices edit the same card', async () => {
    const server = fakeSupabase();
    let t = Date.UTC(2026, 9, 14, 16, 0);
    const a = await device(server, () => t);
    const b = await device(server, () => t);
    await a.store.introduceWords(['tea']);
    await a.sync.sync();
    await b.sync.sync();

    t += DAY;
    await a.store.grade('tea', 'again', 'review'); // older edit
    t += 60_000;
    await b.store.grade('tea', 'good', 'review'); // newer edit
    await b.sync.sync();
    await a.sync.sync(); // a's older edit must not overwrite b's
    await b.sync.sync();

    const ca = a.store.getState().cards.get('tea')!;
    const cb = b.store.getState().cards.get('tea')!;
    expect(ca).toEqual(cb);
    expect(cb.step).toBe(1);
    expect(server.tables.cards.get('tea')?.updated_at).toBe(t);
  });

  it('offline changes are kept and pushed later', async () => {
    const server = fakeSupabase();
    const t = Date.UTC(2026, 9, 14, 16, 0);
    const a = await device(server, () => t);
    await a.store.introduceWords(['egg']);
    expect((await a.store.dirtyCards()).map((c) => c.wordId)).toEqual(['egg']);
    // reload from IndexedDB (app restart) before syncing
    const reopened = new Store(await openStore(`device-${n - 1}`), () => t);
    await reopened.load();
    expect(reopened.getState().cards.get('egg')?.state).toBe('learning');
    await new SyncEngine(reopened, server.client, 'user-1').sync();
    expect(server.tables.cards.has('egg')).toBe(true);
  });
});
