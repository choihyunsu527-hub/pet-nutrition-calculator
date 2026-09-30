-- ════════════════════════════════════════════════════════════════════════════
-- 대시보드 현장 공동 일정표 — dash_schedules 테이블 + RLS + 365일 자동 삭제
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요(여러 번 실행해도 안전).
--
-- · 로그인 사용자(authenticated) 전원이 같은 공동 일정을 조회/추가/수정/삭제한다.
-- · created_by 는 항상 현재 로그인 사용자(auth.uid())로 기록된다 — 클라이언트가 보낸 값은
--   트리거가 덮어쓰고, created_at 도 서버 시간으로 고정된다(수정 시에도 변경 불가).
--   → 만료 기준(created_at)을 클라이언트가 조작해 수명을 늘릴 수 없다.
-- · created_by 에는 auth.users FK 를 걸지 않는다(audit_logs 와 같은 이유 — 작성자 계정이
--   삭제돼도 공동 일정 자체는 남아야 한다).
-- · legacy_id: 예전 브라우저 localStorage(feedcalc_v4_dash_schedules) 일정의 id.
--   1회 이전 시 unique 충돌을 무시(on conflict do nothing)해 중복 이전을 막는다.
-- · 365일 자동 삭제: created_at 이 365일을 "초과"한 행만 삭제한다
--   (created_at < now() - interval '365 days'). DB 시간(now()) 기준.
--   1) pg_cron 이 사용 가능하면 매일 03:15(UTC) 자동 실행
--   2) 안전장치: 앱이 일정 조회 직전에 같은 함수(rpc)를 호출
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.dash_schedules (
  id            uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  title         text not null check (char_length(btrim(title)) between 1 and 200),
  start_time    time,
  end_time      time,
  assignee      text,
  memo          text,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  legacy_id     text unique,
  constraint dash_schedules_time_order check (start_time is null or end_time is null or end_time >= start_time)
);

create index if not exists dash_schedules_date_idx on public.dash_schedules (schedule_date);
create index if not exists dash_schedules_created_at_idx on public.dash_schedules (created_at);

-- created_by / created_at 서버 고정 + updated_at 자동 갱신
create or replace function public.dash_schedules_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.legacy_id  := old.legacy_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dash_schedules_stamp on public.dash_schedules;
create trigger dash_schedules_stamp
  before insert or update on public.dash_schedules
  for each row execute procedure public.dash_schedules_stamp();

-- RLS: 로그인 사용자 전원 공동 사용, 비로그인(anon)은 접근 불가
alter table public.dash_schedules enable row level security;

drop policy if exists "dash_schedules: select authenticated" on public.dash_schedules;
create policy "dash_schedules: select authenticated"
  on public.dash_schedules for select
  to authenticated
  using (true);

drop policy if exists "dash_schedules: insert authenticated" on public.dash_schedules;
create policy "dash_schedules: insert authenticated"
  on public.dash_schedules for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "dash_schedules: update authenticated" on public.dash_schedules;
create policy "dash_schedules: update authenticated"
  on public.dash_schedules for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "dash_schedules: delete authenticated" on public.dash_schedules;
create policy "dash_schedules: delete authenticated"
  on public.dash_schedules for delete
  to authenticated
  using (true);

revoke all on public.dash_schedules from anon;

-- 365일 초과 일정 삭제 — 삭제한 행 수를 반환. 365일 미만(= 정확히 365일 이하) 일정은 건드리지 않는다.
create or replace function public.purge_expired_dash_schedules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.dash_schedules
   where created_at < now() - interval '365 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_expired_dash_schedules() from public, anon;
grant execute on function public.purge_expired_dash_schedules() to authenticated;

-- pg_cron 매일 자동 실행(사용 불가 환경이면 경고만 남기고 넘어간다 — 앱 접속 시 rpc 안전장치가 동작)
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule(
    'purge-expired-dash-schedules',
    '15 3 * * *',
    'select public.purge_expired_dash_schedules()'
  );
exception when others then
  raise warning 'pg_cron 설정 실패(앱 접속 시 정리로 대체): %', sqlerrm;
end;
$$;
