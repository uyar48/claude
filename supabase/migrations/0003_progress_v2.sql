-- v2: progress follows completed lessons, not the calendar.
-- • lesson_log gets the lesson's sequence number and its active minutes
--   (the daily goal and the streak are measured in active time).
-- • media_choices keeps the picture picked on /admin/review (1 of 5
--   candidates, or "no picture") so every device shows the same image.

alter table public.lesson_log add column if not exists number int not null default 0;
alter table public.lesson_log add column if not exists active_ms bigint not null default 0;
-- Active ms per local day ({"2026-10-14": 600000, …}): a lesson that crosses
-- midnight counts on both days.
alter table public.lesson_log add column if not exists day_ms jsonb not null default '{}'::jsonb;

-- Number existing lessons in the order they were started and estimate their
-- active time; bump updated_at so devices take the server copy.
update public.lesson_log l
set number = x.n,
    active_ms = case when l.completed_at is null then 0 else least(l.completed_at - l.started_at, 45 * 60000) end,
    day_ms = case when l.completed_at is null then '{}'::jsonb
                  else jsonb_build_object(l.date::text, least(l.completed_at - l.started_at, 45 * 60000)) end,
    updated_at = l.updated_at + 1
from (select id, row_number() over (partition by user_id order by started_at, id) as n from public.lesson_log) x
where l.id = x.id and l.number = 0;

create index if not exists lesson_log_number_idx on public.lesson_log (user_id, number desc);

create or replace function public.sync_lessons(rows jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.lesson_log (id, user_id, number, date, started_at, completed_at, active_ms, day_ms, text_ids,
                                 new_word_ids, reviewed, correct, updated_at)
  select r.id, (select auth.uid()), coalesce(r.number, 0), r.date, r.started_at, r.completed_at,
         coalesce(r.active_ms, 0), coalesce(r.day_ms, '{}'::jsonb), r.text_ids, r.new_word_ids, r.reviewed,
         r.correct, r.updated_at
  from jsonb_to_recordset(rows) as r(id text, number int, date date, started_at bigint, completed_at bigint,
                                      active_ms bigint, day_ms jsonb, text_ids text[], new_word_ids text[],
                                      reviewed int, correct int, updated_at bigint)
  on conflict (id) do update set
    number = excluded.number, date = excluded.date, started_at = excluded.started_at,
    completed_at = excluded.completed_at, active_ms = excluded.active_ms, day_ms = excluded.day_ms,
    text_ids = excluded.text_ids,
    new_word_ids = excluded.new_word_ids, reviewed = excluded.reviewed, correct = excluded.correct,
    updated_at = excluded.updated_at
  where public.lesson_log.updated_at < excluded.updated_at and public.lesson_log.user_id = (select auth.uid());
$$;

create table if not exists public.media_choices (
  user_id uuid not null references auth.users (id) on delete cascade,
  word_id text not null,
  -- File name of the chosen candidate; null together with rejected = true
  -- means "no picture" (the word is taught with emoji / sentence + audio).
  choice text,
  rejected boolean not null default false,
  updated_at bigint not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, word_id)
);
create index if not exists media_choices_synced_idx on public.media_choices (user_id, synced_at);

drop trigger if exists media_choices_touch on public.media_choices;
create trigger media_choices_touch before insert or update on public.media_choices
  for each row execute function public.touch_synced_at();

alter table public.media_choices enable row level security;
drop policy if exists media_choices_own on public.media_choices;
create policy media_choices_own on public.media_choices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.sync_media_choices(rows jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.media_choices (user_id, word_id, choice, rejected, updated_at)
  select (select auth.uid()), r.word_id, r.choice, coalesce(r.rejected, false), r.updated_at
  from jsonb_to_recordset(rows) as r(word_id text, choice text, rejected boolean, updated_at bigint)
  on conflict (user_id, word_id) do update set
    choice = excluded.choice, rejected = excluded.rejected, updated_at = excluded.updated_at
  where public.media_choices.updated_at < excluded.updated_at;
$$;

grant execute on function public.sync_lessons(jsonb), public.sync_media_choices(jsonb) to authenticated;
