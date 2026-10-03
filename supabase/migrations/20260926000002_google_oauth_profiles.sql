-- Give each new auth user a least-privilege manager profile pending admin approval.
create or replace function public.h2know_create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role, status, has_password)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Google User'
    ),
    new.email,
    'manager',
    'pending',
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'h2know_create_profile_after_auth_insert'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ) then
    create trigger h2know_create_profile_after_auth_insert
      after insert on auth.users
      for each row execute function public.h2know_create_profile_for_auth_user();
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'users_select_own_profile'
  ) then
    create policy users_select_own_profile
      on public.profiles for select to authenticated
      using (id = (select auth.uid()));
  end if;
end $$;

-- Repair Google accounts created before the auth trigger was installed.
insert into public.profiles (id, full_name, email, role, status, has_password)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Google User'
  ),
  u.email,
  'manager',
  'pending',
  false
from auth.users u
where u.raw_app_meta_data ->> 'provider' = 'google'
  and not exists (
    select 1 from public.profiles p where p.id = u.id
  )
on conflict (id) do nothing;