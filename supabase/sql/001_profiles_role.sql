-- ════════════════════════════════════════════════════════════════════════════
-- 관리자 권한(Role) 시스템 — profiles.role 컬럼 + 자동 프로필 생성 + RLS
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요.
--
-- role은 두 가지만 사용합니다: 'super_admin' | 'user' (기본값 'user')
-- 계정은 회원가입이 아닌 초대(Authentication → Users → Invite user)로만 생기므로,
-- 신규 유저가 auth.users에 추가될 때마다 트리거로 profiles 행을 자동 생성합니다.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) profiles 테이블 (없으면 생성)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'user',
  created_at timestamptz not null default now()
);

-- 이미 profiles 테이블이 있고 role 컬럼만 없는 경우 대비
alter table public.profiles
  add column if not exists role text not null default 'user';

-- role 값 제한: super_admin | user
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('super_admin', 'user'));

-- 2) 신규(초대) 유저 가입 시 profiles 행을 자동 생성(기본 role='user')
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3) 기존에 이미 초대되어 있던 계정들도 profiles 행 채워주기(1회성, 이미 있으면 무시)
insert into public.profiles (id, email, role)
select id, email, 'user' from auth.users
on conflict (id) do nothing;

-- 4) RLS: 본인 role만 조회 가능
alter table public.profiles enable row level security;

drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

-- 5) 향후 "사용자 관리(목록/역할 변경)" 기능을 위한 확장 포인트:
--    super_admin은 모든 행을 조회할 수 있도록, RLS 재귀 문제 없이 검사하는
--    security definer 함수 is_super_admin()을 미리 준비해둔다.
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

drop policy if exists "profiles: super_admin select all" on public.profiles;
create policy "profiles: super_admin select all"
  on public.profiles for select
  using (public.is_super_admin());

-- 6) 최초 super_admin 지정 — 아래 이메일을 본인 계정으로 바꿔 한 번만 실행하세요.
-- update public.profiles set role = 'super_admin' where email = 'your-admin@email.com';
