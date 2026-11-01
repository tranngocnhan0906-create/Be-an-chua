-- =====================================================================
--  Bé ăn chưa? — bản 2.0
--  Giờ ăn chuẩn của Ny, tin nhắn có ảnh/video, tim & bình luận hiện trong chat,
--  theo dõi chu kỳ "chị 🍓". Chạy sau schema.sql và chat.sql.
-- =====================================================================

-- ---------- Giờ ăn chuẩn & cài đặt chị 🍓 ----------
alter table public.couple_settings
  add column if not exists sched_sang time not null default '07:30',
  add column if not exists sched_trua time not null default '12:00',
  add column if not exists sched_toi  time not null default '19:00',
  add column if not exists late_alert_owner boolean not null default true,
  add column if not exists cycle_length int not null default 28 check (cycle_length between 18 and 60),
  add column if not exists period_length int not null default 5 check (period_length between 2 and 12),
  add column if not exists cycle_notify boolean not null default true;

-- ---------- Tin nhắn có ảnh/video, bình luận ảnh bữa ăn = tin nhắn có meal_id ----------
alter table public.messages
  add column if not exists media_type text check (media_type is null or media_type in ('image', 'video')),
  add column if not exists media_path text,
  add column if not exists thumb_path text,
  add column if not exists width int,
  add column if not exists height int,
  add column if not exists duration real,
  add column if not exists bytes bigint not null default 0;
create index if not exists messages_meal_idx on public.messages (meal_id) where meal_id is not null;

alter policy "send own text" on public.messages
  with check (
    kind = 'text' and sender_id = auth.uid() and public.is_member()
    and char_length(coalesce(body, '')) <= 2000
    and (char_length(btrim(coalesce(body, ''))) >= 1 or media_path is not null)
    and (media_path is null or (storage.foldername(media_path))[1] = auth.uid()::text)
    and (thumb_path is null or (storage.foldername(thumb_path))[1] = auth.uid()::text)
  );

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'reminder', 'report', 'heart', 'cycle'));

-- Thả tim ảnh bữa ăn -> hiện một dòng trong chat
create or replace function public.reaction_to_chat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.messages (sender_id, recipient_id, kind, body, meal_id, meal_type, meal_date)
  select new.user_id, m.user_id, 'heart', new.emoji, m.id, m.meal_type, m.meal_date
    from public.meals m
   where m.id = new.meal_id
     and m.user_id <> new.user_id
     and not exists (
       select 1 from public.messages x
        where x.kind = 'heart' and x.meal_id = m.id and x.sender_id = new.user_id
     );
  return new;
exception when others then
  return new;
end $$;
revoke execute on function public.reaction_to_chat() from public, anon, authenticated;
create trigger reactions_chat after insert on public.reactions
  for each row execute function public.reaction_to_chat();

-- ---------- Chu kỳ chị 🍓 ----------
create table if not exists public.cycles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  start_date        date not null,
  end_date          date,
  created_by        uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  start_notified_at timestamptz,
  end_notified_at   timestamptz,
  check (end_date is null or end_date >= start_date),
  unique (user_id, start_date)
);
alter table public.cycles enable row level security;
revoke update on public.cycles from authenticated;
grant update (start_date, end_date) on public.cycles to authenticated;

create policy "members read cycles" on public.cycles
  for select to authenticated using (public.is_member());
create policy "members add cycles" on public.cycles
  for insert to authenticated
  with check (public.is_member() and exists (select 1 from public.profiles p where p.id = user_id));
create policy "members edit cycles" on public.cycles
  for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "members remove cycles" on public.cycles
  for delete to authenticated using (public.is_member());

-- Báo cho cả hai khi đánh dấu chị tới / chị đi
create trigger cycles_notify_start after insert on public.cycles
  for each row execute function public.notify_event();
create trigger cycles_notify_end after update of end_date on public.cycles
  for each row when (old.end_date is null and new.end_date is not null) execute function public.notify_event();

alter publication supabase_realtime add table public.cycles;

-- ---------- Mỗi lần Ny đăng hình bữa ăn -> luôn có thẻ "báo cáo" trong Tin nhắn ----------
create or replace function public.link_meal_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.messages
     set meal_id = new.id
   where kind = 'reminder'
     and recipient_id = new.user_id
     and meal_date = new.meal_date
     and meal_type = new.meal_type
     and meal_id is null;
  insert into public.messages (sender_id, recipient_id, kind, body, meal_type, meal_date, meal_id)
  values (
    new.user_id,
    (select id from public.profiles where id <> new.user_id order by created_at limit 1),
    'report', new.caption, new.meal_type, new.meal_date, new.id
  );
  return new;
exception when others then
  return new; -- không bao giờ chặn việc đăng bài
end $$;
revoke execute on function public.link_meal_report() from public, anon, authenticated;
