-- =====================================================================
--  Bé ăn chưa? — cấu hình sau khi đã chạy schema.sql và deploy function "notify"
--  Thay __REF__ (mã project), __SITE__ (link GitHub Pages), __INVITE__ (mã mời).
-- =====================================================================
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

insert into public.app_config (key, value) values
  ('notify_url', 'https://__REF__.supabase.co/functions/v1/notify'),
  ('site_url',   '__SITE__')
on conflict (key) do update set value = excluded.value;

insert into public.app_secrets (key, value) values ('invite_code', '__INVITE__')
on conflict (key) do update set value = excluded.value;

-- Nhắc giờ ăn: cứ 10 phút hỏi function một lần, function tự biết khi nào cần nhắc
select cron.schedule(
  'be-an-chua-nhac-gio-an',
  '*/10 * * * *',
  $$ select net.http_post(
       url                  := (select value from public.app_config where key = 'notify_url'),
       body                 := '{"type":"remind"}'::jsonb,
       headers              := '{"Content-Type":"application/json"}'::jsonb,
       timeout_milliseconds := 10000
     ) $$
);
