-- ════════════════════════════════════════════════════════════════════════════
-- 관리자 작업 변경 이력(Audit Log) — audit_logs 테이블 + RLS
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요.
--
-- 기록 주체는 "그 작업을 수행한 관리자"(user_id/user_name)이며, user_name은
-- 기록 시점의 profiles.name 스냅샷이라 이후 profiles.name이 바뀌어도 과거 로그는
-- 그대로 유지된다(그래서 user_id에는 auth.users FK를 걸지 않는다 — 나중에 그
-- 관리자 계정이 삭제되어도 스냅샷 로그 자체는 남아야 하기 때문).
-- 로그 작성은 서비스 역할(Edge Function: create-user/update-user/delete-user)에서만
-- 수행하므로, RLS는 조회만 super_admin에게 허용하고 쓰기 정책은 두지 않는다(일반
-- 사용자는 물론 super_admin도 클라이언트에서 직접 insert/update/delete 불가).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid,
  user_name   text,
  action      text not null,
  target_type text not null,
  target_id   text,
  details     jsonb
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

-- 001_profiles_role.sql에서 만든 is_super_admin()을 그대로 재사용한다.
drop policy if exists "audit_logs: super_admin select all" on public.audit_logs;
create policy "audit_logs: super_admin select all"
  on public.audit_logs for select
  using (public.is_super_admin());
