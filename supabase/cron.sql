-- Calls the notification endpoint every 10 minutes (Supabase pg_cron + pg_net).
-- 1) Database → Extensions: enable "pg_cron" and "pg_net".
-- 2) Replace APP_URL and CRON_SECRET below, then run this in the SQL Editor.

select cron.unschedule('okuma-notify') where exists (select 1 from cron.job where jobname = 'okuma-notify');

select cron.schedule(
  'okuma-notify',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://APP_URL/api/cron/notify',
    headers := jsonb_build_object('Authorization', 'Bearer CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
