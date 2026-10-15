-- ════════════════════════════════════════════════════════════════════════════
-- 대시보드 현장 공동 일정표 — 작업 유형(생산 / 포장 / 출고) 컬럼 추가
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요(여러 번 실행해도 안전).
--
-- · work_types: text[] — 'production'(생산) / 'packing'(포장) / 'shipping'(출고) 중 0~3개. NULL = 미선택(기존 일정 전부).
-- · NULL 허용이라 기존 일정(행)은 수정되지 않는다. RLS·트리거·365일 자동 삭제는 변경하지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.dash_schedules add column if not exists work_types text[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dash_schedules_work_types_valid' and conrelid = 'public.dash_schedules'::regclass) then
    alter table public.dash_schedules
      add constraint dash_schedules_work_types_valid
      check (work_types is null or work_types <@ array['production', 'packing', 'shipping']::text[]);
  end if;
end;
$$;
