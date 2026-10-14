-- ════════════════════════════════════════════════════════════════════════════
-- 대시보드 현장 공동 일정표 — 생산 정보(제품명 / 생산 수량 / 단위) 컬럼 추가
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요(여러 번 실행해도 안전).
--
-- · 모두 NULL 허용 → 기존 일정(행)은 전혀 수정되지 않고, 기존 데이터와 기간 일정(end_date)과 그대로 호환된다.
-- · product_name   : 제품명(최대 100자)
-- · production_qty : 생산 수량(0 이상, 소수 3자리까지, 10억 미만)
-- · production_unit: 단위(앱에서 kg/g/개/박스/포/L/mL 중 선택 — DB는 길이만 제한해 단위 목록 변경에 유연)
-- · 수량이 있으면 단위도 있어야 한다.
-- · 메모(memo)·담당자(assignee)는 기존 컬럼을 그대로 쓴다. RLS·트리거·365일 자동 삭제는 변경하지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.dash_schedules add column if not exists product_name text;
alter table public.dash_schedules add column if not exists production_qty numeric(14, 3);
alter table public.dash_schedules add column if not exists production_unit text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dash_schedules_product_name_len' and conrelid = 'public.dash_schedules'::regclass) then
    alter table public.dash_schedules
      add constraint dash_schedules_product_name_len
      check (product_name is null or char_length(btrim(product_name)) between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dash_schedules_production_qty_range' and conrelid = 'public.dash_schedules'::regclass) then
    alter table public.dash_schedules
      add constraint dash_schedules_production_qty_range
      check (production_qty is null or (production_qty >= 0 and production_qty < 1000000000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dash_schedules_production_unit_len' and conrelid = 'public.dash_schedules'::regclass) then
    alter table public.dash_schedules
      add constraint dash_schedules_production_unit_len
      check (production_unit is null or char_length(production_unit) between 1 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dash_schedules_production_pair' and conrelid = 'public.dash_schedules'::regclass) then
    alter table public.dash_schedules
      add constraint dash_schedules_production_pair
      check (production_qty is null or production_unit is not null);
  end if;
end;
$$;
