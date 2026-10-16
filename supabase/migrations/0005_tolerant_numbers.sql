-- Clock values may arrive with a fraction (browsers measure time in
-- fractions of a millisecond). A fraction in a bigint field made the whole
-- sync_lessons call fail ("invalid input syntax for type bigint"), so the
-- lesson log of that device stopped syncing. Numbers are now read as numeric
-- and rounded; integer columns stay integers.

create or replace function public.sync_lessons(rows jsonb) returns void
language sql security invoker set search_path = public as $$
  with incoming as (
    select r.id, round(r.number)::int as number, r.date, round(r.started_at)::bigint as started_at,
           round(r.completed_at)::bigint as completed_at, round(r.active_ms)::bigint as active_ms,
           (select jsonb_object_agg(k, round(v::numeric)) from jsonb_each_text(r.day_ms) as d(k, v)) as day_ms,
           r.text_ids, r.new_word_ids, round(r.reviewed)::int as reviewed, round(r.correct)::int as correct,
           round(r.updated_at)::bigint as updated_at, r.day_ms is not null as has_day_ms
    from jsonb_to_recordset(rows) as r(id text, number numeric, date date, started_at numeric, completed_at numeric,
                                       active_ms numeric, day_ms jsonb, text_ids text[], new_word_ids text[],
                                       reviewed numeric, correct numeric, updated_at numeric)
  ), merged as (
    -- Rows from an app that has not been updated yet (v1) carry no number or
    -- active time: keep what the server already has for those fields.
    select i.id, coalesce(nullif(i.number, 0), l.number, 0) as number, i.date, i.started_at, i.completed_at,
           coalesce(i.active_ms, l.active_ms, 0) as active_ms,
           case when i.has_day_ms then coalesce(i.day_ms, '{}'::jsonb) else coalesce(l.day_ms, '{}'::jsonb) end as day_ms,
           i.text_ids, i.new_word_ids, i.reviewed, i.correct, i.updated_at
    from incoming i left join public.lesson_log l on l.id = i.id
  )
  insert into public.lesson_log (id, user_id, number, date, started_at, completed_at, active_ms, day_ms, text_ids,
                                 new_word_ids, reviewed, correct, updated_at)
  select m.id, (select auth.uid()), m.number, m.date, m.started_at, m.completed_at, m.active_ms, m.day_ms, m.text_ids,
         m.new_word_ids, m.reviewed, m.correct, m.updated_at
  from merged m
  on conflict (id) do update set
    number = excluded.number, date = excluded.date, started_at = excluded.started_at,
    completed_at = excluded.completed_at, active_ms = excluded.active_ms, day_ms = excluded.day_ms,
    text_ids = excluded.text_ids, new_word_ids = excluded.new_word_ids, reviewed = excluded.reviewed,
    correct = excluded.correct, updated_at = excluded.updated_at
  where public.lesson_log.updated_at < excluded.updated_at and public.lesson_log.user_id = (select auth.uid());
$$;

create or replace function public.sync_cards(rows jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.cards (user_id, word_id, state, step, ease, interval_days, reps, lapses, due_at,
                            introduced_at, last_reviewed_at, updated_at)
  select (select auth.uid()), r.word_id, r.state, round(r.step)::int, r.ease, r.interval_days, round(r.reps)::int,
         round(r.lapses)::int, round(r.due_at)::bigint, round(r.introduced_at)::bigint,
         round(r.last_reviewed_at)::bigint, round(r.updated_at)::bigint
  from jsonb_to_recordset(rows) as r(word_id text, state text, step numeric, ease real, interval_days real,
                                      reps numeric, lapses numeric, due_at numeric, introduced_at numeric,
                                      last_reviewed_at numeric, updated_at numeric)
  on conflict (user_id, word_id) do update set
    state = excluded.state, step = excluded.step, ease = excluded.ease, interval_days = excluded.interval_days,
    reps = excluded.reps, lapses = excluded.lapses, due_at = excluded.due_at,
    introduced_at = excluded.introduced_at, last_reviewed_at = excluded.last_reviewed_at,
    updated_at = excluded.updated_at
  where public.cards.updated_at < excluded.updated_at;
$$;

create or replace function public.sync_media_choices(rows jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.media_choices (user_id, word_id, choice, rejected, updated_at)
  select (select auth.uid()), r.word_id, r.choice, coalesce(r.rejected, false), round(r.updated_at)::bigint
  from jsonb_to_recordset(rows) as r(word_id text, choice text, rejected boolean, updated_at numeric)
  on conflict (user_id, word_id) do update set
    choice = excluded.choice, rejected = excluded.rejected, updated_at = excluded.updated_at
  where public.media_choices.updated_at < excluded.updated_at;
$$;

-- Same name, numeric clock: drop the bigint version so calls stay unambiguous.
drop function if exists public.sync_settings(jsonb, bigint);
create or replace function public.sync_settings(new_settings jsonb, new_updated_at numeric) returns void
language sql security invoker set search_path = public as $$
  insert into public.profiles (user_id, settings, settings_updated_at)
  values ((select auth.uid()), new_settings, round(new_updated_at)::bigint)
  on conflict (user_id) do update set settings = excluded.settings, settings_updated_at = excluded.settings_updated_at
  where public.profiles.settings_updated_at < excluded.settings_updated_at;
$$;

grant execute on function public.sync_lessons(jsonb), public.sync_cards(jsonb), public.sync_media_choices(jsonb),
  public.sync_settings(jsonb, numeric) to authenticated;
