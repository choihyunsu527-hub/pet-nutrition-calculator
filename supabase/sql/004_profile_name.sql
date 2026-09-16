-- ════════════════════════════════════════════════════════════════════════════
-- 사용자 "이름" 필드 추가 — profiles.name 컬럼
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요.
--
-- 관리자가 사용자 계정을 생성할 때 이름을 직접 입력하며, 이후에는 관리자만
-- 수정할 수 있다. 일반 사용자가 스스로 수정할 수단은 두지 않는다 — profiles
-- 테이블에는 update 정책 자체가 없으므로(001_profiles_role.sql), 이름 변경은
-- update-user Edge Function(service_role)을 통해서만 가능하다. 향후 변경이력
-- (Audit Log)에서 수정자를 이름으로 표시할 때는 이 컬럼과 profiles.id(=auth
-- user id)를 연결해 조회하면 된다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists name text;
