-- ════════════════════════════════════════════════════════════════════════════
-- 대시보드 현장 공동 일정표 — 기간(여러 날짜) 일정 지원: end_date 컬럼 추가
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요(여러 번 실행해도 안전).
--
-- · end_date(종료일): NULL = 하루짜리 일정(기존 데이터 전부 해당 → 기존 행은 수정되지 않음).
--   기간 일정은 schedule_date(시작일) ~ end_date(종료일, 포함).
-- · 제약: 종료일은 시작일보다 빠를 수 없고, 종료일은 시작일로부터 최대 366일 뒤
--   (end_date <= schedule_date + 366)까지로 제한한다 — 앱 검증과 같은 값.
-- · 기존 dash_schedules_time_order(end_time >= start_time)는 "하루짜리"에만 적용하도록 완화한다
--   (기간 일정은 종료일에 끝나는 시각이 시작 시각보다 이를 수 있다). 기존 행은 모두 새 제약도 만족한다.
-- · 365일 자동 삭제(created_at 기준)·RLS·트리거는 변경하지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.dash_schedules add column if not exists end_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'dash_schedules_date_order'
       and conrelid = 'public.dash_schedules'::regclass
  ) then
    alter table public.dash_schedules
      add constraint dash_schedules_date_order
      check (end_date is null or (end_date >= schedule_date and end_date <= schedule_date + 366));
  end if;
end;
$$;

alter table public.dash_schedules drop constraint if exists dash_schedules_time_order;
alter table public.dash_schedules
  add constraint dash_schedules_time_order
  check (
    start_time is null or end_time is null or end_time >= start_time
    or (end_date is not null and end_date > schedule_date)
  );
