-- =====================================================================
--  Bé ăn chưa? — bản 2.1
--  Hồ sơ (ngày sinh, sở thích…), hình nền tin nhắn, nút Buzz nhắc ăn,
--  thẻ sự kiện (sinh nhật, kỷ niệm). Chạy sau v2.sql.
-- =====================================================================

-- Hồ sơ: ngày sinh, sở thích (json), hình nền tin nhắn
alter table public.profiles
  add column if not exists birthday date check (birthday is null or birthday between '1940-01-01' and '2030-12-31'),
  add column if not exists info jsonb not null default '{}'::jsonb check (octet_length(info::text) <= 6000),
  add column if not exists chat_bg text check (chat_bg is null or char_length(chat_bg) <= 300);

-- Chỉ được sửa các cột hồ sơ của chính mình (không sửa id, email, created_at)
revoke update on public.profiles from authenticated;
grant update (display_name, avatar, birthday, info, chat_bg) on public.profiles to authenticated;

-- Tin nhắn: thêm loại "buzz" (anh nhắc Ny ăn) và "event" (sinh nhật, kỷ niệm)
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'reminder', 'report', 'heart', 'cycle', 'buzz', 'event'));

alter policy "send own text" on public.messages
  with check (
    kind in ('text', 'buzz') and sender_id = auth.uid() and public.is_member()
    and char_length(coalesce(body, '')) <= 2000
    and (char_length(btrim(coalesce(body, ''))) >= 1 or media_path is not null)
    and (media_path is null or (storage.foldername(media_path))[1] = auth.uid()::text)
    and (thumb_path is null or (storage.foldername(thumb_path))[1] = auth.uid()::text)
  );

create trigger messages_notify_buzz after insert on public.messages
  for each row when (new.kind = 'buzz') execute function public.notify_event();
