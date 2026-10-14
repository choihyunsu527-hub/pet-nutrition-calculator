-- ════════════════════════════════════════════════════════════════════════════
-- 대시보드/캘린더 일정 변경 이력 — dash_schedule_history 테이블 + RLS
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요(여러 번 실행해도 안전).
--
-- · 일정(dash_schedules)의 등록(create)·수정(update)·삭제(delete)·복원(restore) 기록을 서버에 쌓는다.
--   (기존 "변경 이력" 탭의 레시피 이력은 브라우저 localStorage 전용이고, audit_logs 는 관리자 작업 전용이라
--    일반 로그인 사용자가 쓰는 공동 일정 이력에는 쓸 수 없어 별도 테이블로 둔다.)
-- · 로그인 사용자(authenticated) 전원이 조회/추가할 수 있고, 수정·삭제는 불가(추가 전용 = 감사 기록).
--   anon(비로그인)은 접근 불가.
-- · user_id / created_at 은 트리거가 서버 값(auth.uid(), now())으로 고정하고, user_name 은 profiles.name 을
--   기록 시점 스냅샷으로 채운다(없으면 클라이언트가 보낸 값). schedule_id 에는 FK 를 걸지 않는다 —
--   일정이 삭제(또는 365일 자동 삭제)돼도 이력은 남아야 한다.
-- · details(jsonb): { before: 일정 스냅샷|null, after: 일정 스냅샷|null, changes: [{field,from,to}], restored_from: 이력 id }
--   삭제 이력의 before 스냅샷으로 "복원"한다(앱의 변경 이력 화면 > 캘린더 변경이력 > 복원 버튼).
-- · 365일 자동 삭제(dash_schedules)·기존 일정 데이터/스키마는 변경하지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.dash_schedule_history (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid default auth.uid(),
  user_name   text,
  action      text not null check (action in ('create', 'update', 'delete', 'restore')),
  schedule_id uuid,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  summary     text check (summary is null or char_length(summary) <= 2000),
  details     jsonb
);

create index if not exists dash_schedule_history_created_at_idx on public.dash_schedule_history (created_at desc);
create index if not exists dash_schedule_history_schedule_id_idx on public.dash_schedule_history (schedule_id);

-- user_id / created_at 서버 고정 + user_name = profiles.name 스냅샷
create or replace function public.dash_schedule_history_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pname text;
begin
  new.created_at := now();
  new.user_id := coalesce(auth.uid(), new.user_id);
  select nullif(btrim(p.name), '') into pname from public.profiles p where p.id = new.user_id;
  new.user_name := coalesce(pname, nullif(btrim(new.user_name), ''));
  return new;
end;
$$;

drop trigger if exists dash_schedule_history_stamp on public.dash_schedule_history;
create trigger dash_schedule_history_stamp
  before insert on public.dash_schedule_history
  for each row execute procedure public.dash_schedule_history_stamp();

alter table public.dash_schedule_history enable row level security;

drop policy if exists "dash_schedule_history: select authenticated" on public.dash_schedule_history;
create policy "dash_schedule_history: select authenticated"
  on public.dash_schedule_history for select
  to authenticated
  using (true);

drop policy if exists "dash_schedule_history: insert authenticated" on public.dash_schedule_history;
create policy "dash_schedule_history: insert authenticated"
  on public.dash_schedule_history for insert
  to authenticated
  with check (user_id = auth.uid());

-- update/delete 정책은 만들지 않는다(추가 전용). 권한도 명시적으로 회수.
revoke all on public.dash_schedule_history from anon;
revoke update, delete on public.dash_schedule_history from authenticated;
