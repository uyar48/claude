// Runs the real migration on an in-process Postgres (PGlite) with a tiny stub
// of Supabase's `auth` schema, then checks RLS and the last-write-wins RPCs.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const ME = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

const AUTH_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated;
  grant usage on schema public, auth to authenticated;
  insert into auth.users values ('${ME}', 'me@example.com'), ('${OTHER}', 'other@example.com');
`;

let db: PGlite;

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}

const card = (word: string, updated: number, state = 'learning') => ({
  word_id: word,
  state,
  step: 1,
  ease: 2.5,
  interval_days: 0,
  reps: 1,
  lapses: 0,
  due_at: updated + 1000,
  introduced_at: updated,
  last_reviewed_at: updated,
  updated_at: updated,
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);
  const dir = path.join(__dirname, '../supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated;');
});

describe('migration', () => {
  it('sync_cards inserts and keeps the newest version', async () => {
    await as(ME, () => db.query('select public.sync_cards($1)', [JSON.stringify([card('tea', 100)])]));
    await as(ME, () => db.query('select public.sync_cards($1)', [JSON.stringify([card('tea', 50, 'known')])]));
    let r = await db.query<{ state: string; updated_at: string }>('select state, updated_at from cards');
    expect(r.rows).toEqual([{ state: 'learning', updated_at: 100 }]);
    await as(ME, () => db.query('select public.sync_cards($1)', [JSON.stringify([card('tea', 200, 'known')])]));
    r = await db.query('select state, updated_at from cards');
    expect(r.rows).toEqual([{ state: 'known', updated_at: 200 }]);
  });

  it('row level security hides other users’ rows', async () => {
    await as(OTHER, () => db.query('select public.sync_cards($1)', [JSON.stringify([card('egg', 100)])]));
    const mine = await as(ME, () => db.query<{ word_id: string }>('select word_id from cards order by word_id'));
    expect(mine.rows.map((x) => x.word_id)).toEqual(['tea']);
    await expect(
      as(ME, () => db.query(`insert into cards (user_id, word_id, state, updated_at) values ('${OTHER}', 'x', 'new', 1)`)),
    ).rejects.toThrow(/row-level security/);
  });

  it('sync_lessons, sync_settings and touch_active', async () => {
    const lesson = {
      id: 'L1',
      number: 1,
      active_ms: 1_800_000,
      day_ms: { '2026-10-14': 1_800_000 },
      date: '2026-10-14',
      started_at: 1,
      completed_at: 2,
      text_ids: ['t5'],
      new_word_ids: ['house'],
      reviewed: 0,
      correct: 0,
      updated_at: 10,
    };
    await as(ME, () => db.query('select public.sync_lessons($1)', [JSON.stringify([lesson])]));
    await as(ME, () => db.query('select public.sync_lessons($1)', [JSON.stringify([{ ...lesson, reviewed: 9, updated_at: 5 }])]));
    const l = await db.query<{ reviewed: number; text_ids: string[]; number: number; active_ms: number; day_ms: unknown }>(
      'select reviewed, text_ids, number, active_ms, day_ms from lesson_log',
    );
    expect(l.rows).toEqual([
      { reviewed: 0, text_ids: ['t5'], number: 1, active_ms: 1_800_000, day_ms: { '2026-10-14': 1_800_000 } },
    ]);

    // An app that is not updated yet (v1) sends rows without number/active time.
    const v1 = { ...lesson, number: undefined, active_ms: undefined, day_ms: undefined, reviewed: 3, updated_at: 20 };
    await as(ME, () => db.query('select public.sync_lessons($1)', [JSON.stringify([v1])]));
    const kept = await db.query<{ reviewed: number; number: number; active_ms: number }>('select reviewed, number, active_ms from lesson_log');
    expect(kept.rows).toEqual([{ reviewed: 3, number: 1, active_ms: 1_800_000 }]);

    await as(ME, () => db.query('select public.sync_settings($1, $2)', [JSON.stringify({ lessonMinutes: 20 }), 10]));
    await as(ME, () => db.query('select public.sync_settings($1, $2)', [JSON.stringify({ lessonMinutes: 45 }), 5]));
    await as(ME, () => db.query('select public.touch_active()'));
    const p = await db.query<{ settings: { lessonMinutes: number }; last_active_at: Date | null }>(
      'select settings, last_active_at from profiles',
    );
    expect(p.rows[0].settings.lessonMinutes).toBe(20);
    expect(p.rows[0].last_active_at).not.toBeNull();
  });

  it('sync_media_choices keeps the newest pick per word and hides other users’ picks', async () => {
    const pick = (choice: string | null, rejected: boolean, updated: number) =>
      JSON.stringify([{ word_id: 'house', choice, rejected, updated_at: updated }]);
    await as(ME, () => db.query('select public.sync_media_choices($1)', [pick('house-2.jpg', false, 10)]));
    await as(ME, () => db.query('select public.sync_media_choices($1)', [pick('house-4.jpg', false, 5)]));
    await as(OTHER, () => db.query('select public.sync_media_choices($1)', [pick(null, true, 20)]));
    const mine = await as(ME, () => db.query<{ choice: string; rejected: boolean }>('select choice, rejected from media_choices'));
    expect(mine.rows).toEqual([{ choice: 'house-2.jpg', rejected: false }]);
    await as(ME, () => db.query('select public.sync_media_choices($1)', [pick(null, true, 30)]));
    const after = await as(ME, () => db.query<{ choice: string | null; rejected: boolean }>('select choice, rejected from media_choices'));
    expect(after.rows).toEqual([{ choice: null, rejected: true }]);
  });

  it('device link codes are invisible to app users (server only)', async () => {
    await db.query(`insert into device_links (code_hash, user_id, expires_at) values ('h1', '${ME}', now() + interval '10 minutes')`);
    const r = await as(ME, () => db.query('select * from device_links'));
    expect(r.rows).toEqual([]);
  });

  it('the app cannot create notification log rows, only read/mark them', async () => {
    await db.query(`insert into notification_log (id, user_id, kind) values ('n1', '${ME}', 'lesson')`);
    await expect(
      as(ME, () => db.query(`insert into notification_log (id, user_id, kind) values ('n2', '${ME}', 'lesson')`)),
    ).rejects.toThrow(/row-level security/);
    await as(ME, () => db.query(`update notification_log set engaged_at = now() where id = 'n1'`));
    const r = await db.query<{ engaged_at: Date | null }>(`select engaged_at from notification_log where id = 'n1'`);
    expect(r.rows[0].engaged_at).not.toBeNull();
  });
});

describe('migration 0003 on existing data', () => {
  it('numbers old lessons by start time and estimates their active minutes', async () => {
    const pg = new PGlite();
    await pg.exec(AUTH_STUB);
    const dir = path.join(__dirname, '../supabase/migrations');
    const files = fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort();
    for (const f of files.filter((x) => x < '0003')) await pg.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const ins = (id: string, started: number, completed: number | null) =>
      pg.query(
        `insert into lesson_log (id, user_id, date, started_at, completed_at, updated_at) values ($1, '${ME}', '2026-10-14', $2, $3, 100)`,
        [id, started, completed],
      );
    await ins('b', 2_000_000, 2_000_000 + 20 * 60_000);
    await ins('a', 1_000_000, 1_000_000 + 90 * 60_000);
    await ins('c', 3_000_000, null);
    for (const f of files.filter((x) => x >= '0003')) await pg.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    const r = await pg.query<{ id: string; number: number; active_ms: string; day_ms: unknown; updated_at: string }>(
      'select id, number, active_ms, day_ms, updated_at from lesson_log order by id',
    );
    expect(r.rows.map((x) => [x.id, x.number, Number(x.active_ms), x.day_ms, Number(x.updated_at)])).toEqual([
      ['a', 1, 45 * 60_000, { '2026-10-14': 45 * 60_000 }, 101],
      ['b', 2, 20 * 60_000, { '2026-10-14': 20 * 60_000 }, 101],
      ['c', 3, 0, {}, 101],
    ]);
  });
});
