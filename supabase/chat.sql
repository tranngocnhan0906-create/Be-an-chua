-- =====================================================================
--  Bé ăn chưa? — bản 1.1: tin nhắn hai người + nhắc giờ ăn trong chat
--  Chạy sau schema.sql. "Chủ app" = người tạo tài khoản đầu tiên.
-- =====================================================================

-- Ai được nhắc giờ ăn: 'partner' = chỉ người yêu (mặc định), 'both' = cả hai
alter table public.couple_settings
  add column if not exists remind_targets text not null default 'partner'
  check (remind_targets in ('partner', 'both'));

-- ---------- Tin nhắn ----------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid default auth.uid() references public.profiles(id) on delete cascade, -- null = mèo nhắc
  recipient_id uuid references public.profiles(id) on delete cascade,
  kind         text not null default 'text' check (kind in ('text', 'reminder', 'report')),
  body         text check (body is null or char_length(body) <= 2000),
  meal_type    text check (meal_type is null or meal_type in ('sang','trua','chieu','toi','khuya')),
  meal_date    date,
  meal_id      uuid references public.meals(id) on delete set null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  notified_at  timestamptz
);
create index if not exists messages_created_idx on public.messages (created_at desc);
create index if not exists messages_reminder_idx on public.messages (recipient_id, meal_date, meal_type) where kind = 'reminder';
alter table public.messages enable row level security;
revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

create policy "members read messages" on public.messages
  for select to authenticated using (public.is_member());
create policy "send own text" on public.messages
  for insert to authenticated
  with check (kind = 'text' and sender_id = auth.uid() and public.is_member()
              and char_length(btrim(coalesce(body, ''))) between 1 and 2000);
create policy "recipient marks read" on public.messages
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy "unsend own text" on public.messages
  for delete to authenticated using (sender_id = auth.uid() and kind = 'text');

-- Tin nhắn chữ mới -> gọi hàm gửi thông báo
create trigger messages_notify after insert on public.messages
  for each row when (new.kind = 'text') execute function public.notify_event();

alter publication supabase_realtime add table public.messages;

-- ---------- Đăng bữa đúng lúc đang được nhắc -> "đã báo cáo" + tin báo cáo trong chat ----------
create or replace function public.link_meal_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.messages
     set meal_id = new.id
   where kind = 'reminder'
     and recipient_id = new.user_id
     and meal_date = new.meal_date
     and meal_type = new.meal_type
     and meal_id is null;
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.messages (sender_id, recipient_id, kind, body, meal_type, meal_date, meal_id)
    values (
      new.user_id,
      (select id from public.profiles where id <> new.user_id order by created_at limit 1),
      'report', new.caption, new.meal_type, new.meal_date, new.id
    );
  end if;
  return new;
exception when others then
  return new; -- không bao giờ chặn việc đăng bài
end $$;
revoke execute on function public.link_meal_report() from public, anon, authenticated;

create trigger meals_link_report after insert on public.meals
  for each row execute function public.link_meal_report();
