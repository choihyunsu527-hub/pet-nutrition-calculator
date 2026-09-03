-- ════════════════════════════════════════════════════════════════════════════
-- 아이디(username) + 비밀번호 로그인 지원 — profiles.username 컬럼 추가
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요.
--
-- 관리자가 사용자를 생성할 때 이메일 대신 아이디를 입력받도록 바뀌면서, 실제로는
-- create-user Edge Function이 "아이디@id.nutricirc.local" 형태의 내부용 가짜 이메일로
-- auth.users를 만든다(Supabase Auth가 이메일을 필수로 요구하기 때문). 사용자·관리자
-- 화면에는 이 이메일이 노출되지 않고 이 컬럼의 아이디만 표시된다.
-- 기존 이메일 기반 계정(email 컬럼)은 그대로 유지되며 영향받지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists username text;

-- 대소문자 구분 없이 아이디 중복을 막는다(같은 아이디로 두 계정이 생기지 않도록).
drop index if exists profiles_username_lower_idx;
create unique index profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;
