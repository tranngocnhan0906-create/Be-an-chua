-- =====================================================================
--  Bé ăn chưa? — bản 2.2: tab Lịch học & làm việc của Ny
--  Mỗi dòng = (tuần, thứ, ô). App hiện sẵn 3 ô Sáng/Chiều/Tối mỗi ngày,
--  Ny điền nội dung (và sửa giờ) thì mới lưu thành dòng. Chạy sau v2_1.sql.
-- =====================================================================
create table if not exists public.schedule_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),
  weekday     smallint not null check (weekday between 1 and 7),
  slot        smallint not null check (slot between 0 and 30),
  start_time  time,
  end_time    time,
  content     text not null default '' check (char_length(content) <= 300),
  updated_at  timestamptz not null default now(),
  unique (user_id, week_start, weekday, slot)
);
create index if not exists schedule_week_idx on public.schedule_items (week_start);
alter table public.schedule_items enable row level security;

create policy "members read schedule" on public.schedule_items
  for select to authenticated using (public.is_member());
create policy "own schedule insert" on public.schedule_items
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy "own schedule update" on public.schedule_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own schedule delete" on public.schedule_items
  for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.schedule_items;
