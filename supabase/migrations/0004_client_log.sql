-- Errors the app ran into (e.g. a failed sync), sent once the next sync works.
-- Only for diagnosis: the app may add and read its own rows, nothing else.

create table if not exists public.client_log (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null,
  kind text not null,
  message text not null check (length(message) <= 500),
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists client_log_user_idx on public.client_log (user_id, at desc);

alter table public.client_log enable row level security;
drop policy if exists client_log_insert on public.client_log;
create policy client_log_insert on public.client_log for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists client_log_read on public.client_log;
create policy client_log_read on public.client_log for select to authenticated
  using (user_id = (select auth.uid()));
