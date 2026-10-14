-- Okuma: schema for a single-user reading app.
-- Run in Supabase → SQL Editor (or `supabase db push`).

-- ---------- tables ----------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  settings_updated_at bigint not null default 0,
  last_active_at timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists public.cards (
  user_id uuid not null references auth.users (id) on delete cascade,
  word_id text not null,
  state text not null check (state in ('new', 'learning', 'known')),
  step int not null default 0,
  ease real not null default 2.5,
  interval_days real not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  due_at bigint,
  introduced_at bigint,
  last_reviewed_at bigint,
  updated_at bigint not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, word_id)
);
create index if not exists cards_due_idx on public.cards (user_id, due_at);
create index if not exists cards_synced_idx on public.cards (user_id, synced_at);

create table if not exists public.lesson_log (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  started_at bigint not null,
  completed_at bigint,
  text_ids text[] not null default '{}',
  new_word_ids text[] not null default '{}',
  reviewed int not null default 0,
  correct int not null default 0,
  updated_at bigint not null,
  synced_at timestamptz not null default now()
);
create index if not exists lesson_log_user_idx on public.lesson_log (user_id, synced_at);

create table if not exists public.review_log (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  word_id text not null,
  grade text not null,
  context text not null,
  reviewed_at bigint not null,
  synced_at timestamptz not null default now()
);
create index if not exists review_log_user_idx on public.review_log (user_id, synced_at);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures int not null default 0
);

create table if not exists public.notification_log (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  engaged_at timestamptz,
  delivered int not null default 0,
  backoff_level int not null default 0
);
create index if not exists notification_log_user_idx on public.notification_log (user_id, sent_at desc);

-- synced_at is the server clock: clients pull rows changed since their cursor.
create or replace function public.touch_synced_at() returns trigger
language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'cards', 'lesson_log', 'review_log'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before insert or update on public.%I for each row execute function public.touch_synced_at()', t, t);
  end loop;
end $$;

-- ---------- row level security: every row belongs to its owner ----------

alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.lesson_log enable row level security;
alter table public.review_log enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'cards', 'lesson_log', 'review_log', 'push_subscriptions'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

-- Notifications are written by the server; the app may only read them and
-- mark them as opened.
drop policy if exists own_read on public.notification_log;
create policy own_read on public.notification_log for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists own_engage on public.notification_log;
create policy own_engage on public.notification_log for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- sync functions (last write wins on the client clock) ----------

create or replace function public.sync_cards(rows jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.cards (user_id, word_id, state, step, ease, interval_days, reps, lapses, due_at,
                            introduced_at, last_reviewed_at, updated_at)
  select (select auth.uid()), r.word_id, r.state, r.step, r.ease, r.interval_days, r.reps, r.lapses, r.due_at,
         r.introduced_at, r.last_reviewed_at, r.updated_at
  from jsonb_to_recordset(rows) as r(word_id text, state text, step int, ease real, interval_days real, reps int,
                                      lapses int, due_at bigint, introduced_at bigint, last_reviewed_at bigint,
                                      updated_at bigint)
  on conflict (user_id, word_id) do update set
    state = excluded.state, step = excluded.step, ease = excluded.ease, interval_days = excluded.interval_days,
    reps = excluded.reps, lapses = excluded.lapses, due_at = excluded.due_at,
    introduced_at = excluded.introduced_at, last_reviewed_at = excluded.last_reviewed_at,
    updated_at = excluded.updated_at
  where public.cards.updated_at < excluded.updated_at;
$$;

create or replace function public.sync_lessons(rows jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.lesson_log (id, user_id, date, started_at, completed_at, text_ids, new_word_ids, reviewed,
                                 correct, updated_at)
  select r.id, (select auth.uid()), r.date, r.started_at, r.completed_at, r.text_ids, r.new_word_ids, r.reviewed,
         r.correct, r.updated_at
  from jsonb_to_recordset(rows) as r(id text, date date, started_at bigint, completed_at bigint, text_ids text[],
                                      new_word_ids text[], reviewed int, correct int, updated_at bigint)
  on conflict (id) do update set
    date = excluded.date, started_at = excluded.started_at, completed_at = excluded.completed_at,
    text_ids = excluded.text_ids, new_word_ids = excluded.new_word_ids, reviewed = excluded.reviewed,
    correct = excluded.correct, updated_at = excluded.updated_at
  where public.lesson_log.updated_at < excluded.updated_at and public.lesson_log.user_id = (select auth.uid());
$$;

create or replace function public.sync_settings(new_settings jsonb, new_updated_at bigint) returns void
language sql security invoker set search_path = public as $$
  insert into public.profiles (user_id, settings, settings_updated_at)
  values ((select auth.uid()), new_settings, new_updated_at)
  on conflict (user_id) do update set settings = excluded.settings, settings_updated_at = excluded.settings_updated_at
  where public.profiles.settings_updated_at < excluded.settings_updated_at;
$$;

create or replace function public.touch_active() returns void
language sql security invoker set search_path = public as $$
  insert into public.profiles (user_id, last_active_at) values ((select auth.uid()), now())
  on conflict (user_id) do update set last_active_at = now();
$$;

grant execute on function public.sync_cards(jsonb), public.sync_lessons(jsonb),
  public.sync_settings(jsonb, bigint), public.touch_active() to authenticated;
