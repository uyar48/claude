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
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/0001_init.sql'), 'utf8');
  await db.exec(sql);
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
    const l = await db.query<{ reviewed: number; text_ids: string[] }>('select reviewed, text_ids from lesson_log');
    expect(l.rows).toEqual([{ reviewed: 0, text_ids: ['t5'] }]);

    await as(ME, () => db.query('select public.sync_settings($1, $2)', [JSON.stringify({ lessonMinutes: 20 }), 10]));
    await as(ME, () => db.query('select public.sync_settings($1, $2)', [JSON.stringify({ lessonMinutes: 45 }), 5]));
    await as(ME, () => db.query('select public.touch_active()'));
    const p = await db.query<{ settings: { lessonMinutes: number }; last_active_at: Date | null }>(
      'select settings, last_active_at from profiles',
    );
    expect(p.rows[0].settings.lessonMinutes).toBe(20);
    expect(p.rows[0].last_active_at).not.toBeNull();
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
