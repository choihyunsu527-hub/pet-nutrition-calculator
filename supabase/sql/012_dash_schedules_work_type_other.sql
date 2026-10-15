-- ════════════════════════════════════════════════════════════════════════════
-- 대시보드 현장 공동 일정표 — 작업 유형에 '기타'(other) 추가
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요(여러 번 실행해도 안전).
--
-- · 011(work_types 컬럼)을 아직 실행하지 않았어도 이 파일만 실행하면 컬럼과 제약이 모두 만들어진다.
-- · 허용 값: production(생산) / packing(포장) / shipping(출고) / other(기타) 중 0~4개. NULL = 미선택.
-- · 기존 데이터는 수정되지 않는다(제약을 4종 허용으로 넓힐 뿐이라 기존 행은 모두 유효).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.dash_schedules add column if not exists work_types text[];

alter table public.dash_schedules drop constraint if exists dash_schedules_work_types_valid;
alter table public.dash_schedules
  add constraint dash_schedules_work_types_valid
  check (work_types is null or work_types <@ array['production', 'packing', 'shipping', 'other']::text[]);
