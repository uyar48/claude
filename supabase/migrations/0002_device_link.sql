-- One-time codes to sign in another device (e.g. the iPhone home-screen app,
-- whose storage is separate from Safari). Only the server (service role)
-- touches this table; RLS without policies blocks everyone else.

create table if not exists public.device_links (
  code_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz
);
create index if not exists device_links_user_idx on public.device_links (user_id, created_at desc);

alter table public.device_links enable row level security;
