-- =====================================================================
--  Bé ăn chưa? — bản 2.3: link mời & quản lí của chủ app
--  Chủ app = tài khoản tạo đầu tiên. Việc đuổi tài khoản nằm ở function "admin".
-- =====================================================================

-- Chủ app xem mã mời để chia sẻ link (?moi=MÃ)
create or replace function public.owner_invite() returns text
language sql stable security definer set search_path = public as $$
  select value from public.app_secrets
   where key = 'invite_code'
     and auth.uid() = (select id from public.profiles order by created_at limit 1)
$$;
revoke execute on function public.owner_invite() from public, anon;
grant execute on function public.owner_invite() to authenticated;

-- Chủ app đổi mã mời (link mời cũ hết dùng được)
create or replace function public.rotate_invite() returns text
language plpgsql security definer set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := 'MEO-';
  i int;
begin
  if auth.uid() is null or auth.uid() is distinct from (select id from public.profiles order by created_at limit 1) then
    raise exception 'NOT_OWNER';
  end if;
  for i in 1..4 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  insert into public.app_secrets (key, value) values ('invite_code', code)
  on conflict (key) do update set value = excluded.value;
  return code;
end $$;
revoke execute on function public.rotate_invite() from public, anon;
grant execute on function public.rotate_invite() to authenticated;
