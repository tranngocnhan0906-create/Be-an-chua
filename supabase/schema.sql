-- =====================================================================
--  Bé ăn chưa? — cơ sở dữ liệu Supabase
--  Chạy một lần trên project mới. Chỉ 2 tài khoản (có mã mời) được dùng app.
-- =====================================================================

-- ---------- Cấu hình & bí mật (chỉ máy chủ đọc được) ----------
create table if not exists public.app_config (
  key   text primary key,
  value text
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- ---------- Hồ sơ hai người ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text not null default 'Người thương'
               check (char_length(display_name) between 1 and 40),
  avatar       text not null default '🐱' check (char_length(avatar) <= 16),
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles
  for select to authenticated using (public.is_member());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Cài đặt chung của hai đứa (1 dòng) ----------
create table if not exists public.couple_settings (
  id                int primary key default 1 check (id = 1),
  app_name          text not null default 'Bé ăn chưa?' check (char_length(app_name) between 1 and 40),
  start_date        date,
  reminders_enabled boolean not null default true,
  remind_sang       time not null default '09:30',
  remind_trua       time not null default '13:00',
  remind_toi        time not null default '20:00',
  updated_at        timestamptz not null default now()
);
insert into public.couple_settings (id) values (1) on conflict (id) do nothing;
alter table public.couple_settings enable row level security;

drop policy if exists "members read settings" on public.couple_settings;
create policy "members read settings" on public.couple_settings
  for select to authenticated using (public.is_member());
drop policy if exists "members update settings" on public.couple_settings;
create policy "members update settings" on public.couple_settings
  for update to authenticated using (public.is_member()) with check (public.is_member() and id = 1);

-- ---------- Bữa ăn ----------
create table if not exists public.meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  meal_type   text not null check (meal_type in ('sang','trua','chieu','toi','khuya')),
  -- "ngày bữa ăn" tính từ 5h sáng: ăn khuya lúc 1h vẫn thuộc ngày hôm trước
  meal_date   date not null default ((now() at time zone 'Asia/Ho_Chi_Minh') - interval '5 hours')::date,
  media_type  text not null check (media_type in ('image','video')),
  media_path  text not null,
  thumb_path  text,
  width       int,
  height      int,
  duration    real,
  bytes       bigint not null default 0,
  caption     text check (caption is null or char_length(caption) <= 500),
  mood        text check (mood is null or char_length(mood) <= 16),
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create index if not exists meals_date_idx on public.meals (meal_date desc, created_at desc);
create index if not exists meals_user_idx on public.meals (user_id, meal_date);
alter table public.meals enable row level security;
revoke update on public.meals from authenticated;
grant update (meal_type, meal_date, caption, mood) on public.meals to authenticated;

drop policy if exists "members read meals" on public.meals;
create policy "members read meals" on public.meals
  for select to authenticated using (public.is_member());
drop policy if exists "members add own meals" on public.meals;
create policy "members add own meals" on public.meals
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
drop policy if exists "update own meals" on public.meals;
create policy "update own meals" on public.meals
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own meals" on public.meals;
create policy "delete own meals" on public.meals
  for delete to authenticated using (user_id = auth.uid());

-- ---------- Thả tim ----------
create table if not exists public.reactions (
  id          uuid primary key default gen_random_uuid(),
  meal_id     uuid not null references public.meals(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji       text not null default '❤️' check (char_length(emoji) <= 16),
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (meal_id, user_id)
);
alter table public.reactions enable row level security;
revoke update on public.reactions from authenticated;

drop policy if exists "members read reactions" on public.reactions;
create policy "members read reactions" on public.reactions
  for select to authenticated using (public.is_member());
drop policy if exists "add own reaction" on public.reactions;
create policy "add own reaction" on public.reactions
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
drop policy if exists "delete own reaction" on public.reactions;
create policy "delete own reaction" on public.reactions
  for delete to authenticated using (user_id = auth.uid());

-- ---------- Bình luận ----------
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  meal_id     uuid not null references public.meals(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create index if not exists comments_meal_idx on public.comments (meal_id, created_at);
alter table public.comments enable row level security;
revoke update on public.comments from authenticated;

drop policy if exists "members read comments" on public.comments;
create policy "members read comments" on public.comments
  for select to authenticated using (public.is_member());
drop policy if exists "add own comment" on public.comments;
create policy "add own comment" on public.comments
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
drop policy if exists "delete own comment" on public.comments;
create policy "delete own comment" on public.comments
  for delete to authenticated using (user_id = auth.uid());

-- ---------- Đăng ký nhận thông báo (mỗi máy một dòng) ----------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

-- ---------- Nhật ký nhắc giờ ăn (để không nhắc 2 lần) ----------
create table if not exists public.reminder_log (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  meal_date date not null,
  meal_type text not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, meal_date, meal_type)
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- ---------- Đăng ký tài khoản: cần mã mời, tối đa 2 người ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  expected     text;
  member_count int;
begin
  select value into expected from public.app_secrets where key = 'invite_code';
  if expected is not null
     and upper(btrim(coalesce(new.raw_user_meta_data->>'invite_code', ''))) <> upper(expected) then
    raise exception 'INVITE_INVALID';
  end if;

  select count(*) into member_count from public.profiles;
  if member_count >= 2 then
    raise exception 'APP_FULL';
  end if;

  insert into public.profiles (id, email, display_name, avatar)
  values (
    new.id,
    new.email,
    coalesce(nullif(left(btrim(new.raw_user_meta_data->>'display_name'), 40), ''),
             nullif(left(split_part(coalesce(new.email, ''), '@', 1), 40), ''),
             'Người thương'),
    coalesce(nullif(left(new.raw_user_meta_data->>'avatar', 16), ''), '🐱')
  );
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Gọi hàm gửi thông báo khi có bài/tim/bình luận mới ----------
create or replace function public.notify_event() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  url text;
begin
  select value into url from public.app_config where key = 'notify_url';
  if url is null or url = '' then
    return new;
  end if;
  perform net.http_post(
    url                  := url,
    body                 := jsonb_build_object('type', 'event', 'table', tg_table_name, 'id', new.id),
    headers              := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  return new; -- không bao giờ chặn việc đăng bài vì lỗi thông báo
end $$;

revoke execute on function public.notify_event() from public, anon, authenticated;

drop trigger if exists meals_notify on public.meals;
create trigger meals_notify after insert on public.meals
  for each row execute function public.notify_event();
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_event();
drop trigger if exists reactions_notify on public.reactions;
create trigger reactions_notify after insert on public.reactions
  for each row execute function public.notify_event();

-- ---------- Kho ảnh/video riêng tư ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('meals', 'meals', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "be-an-chua members read media" on storage.objects;
create policy "be-an-chua members read media" on storage.objects
  for select to authenticated
  using (bucket_id = 'meals' and public.is_member());

drop policy if exists "be-an-chua upload own folder" on storage.objects;
create policy "be-an-chua upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'meals' and public.is_member()
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "be-an-chua delete own media" on storage.objects;
create policy "be-an-chua delete own media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'meals' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Cập nhật tức thời (realtime) ----------
do $$
declare t text;
begin
  foreach t in array array['meals', 'reactions', 'comments', 'couple_settings', 'profiles'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
