-- ════════════════════════════════════════════════════════════════════════════
-- 공유 원료 DB(ING_DB + ingredients_ext.json) 관리자 오버라이드 — soft delete/수정/카테고리 변경
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요.
--
-- ING_DB(index.html 하드코딩)와 ingredients_ext.json(정적 파일)은 코드 재배포 없이는 고칠 수
-- 없으므로, "삭제/수정/카테고리 변경"을 이 테이블에 이름 기준 1행으로 기록해두고 allIngs()/
-- getIngCategory()가 원본 데이터에 이 기록을 얹어서 보여준다. 원본 배열/파일 자체는 그대로
-- 둔다 — 영양 데이터·계산식을 건드리지 않기 위함.
--
-- 컬럼 의미(한 원료에 대해 삭제/영양수정/카테고리변경을 동시에 표현할 수 있어야 해서
-- action enum 대신 독립된 컬럼으로 둔다):
--   source             원본 출처 — 'ing_db' | 'ext' | 'new'('new'는 관리자가 원본에 없던
--                       원료를 새로 만든 경우, allIngs()에서 payload를 그대로 새 행으로 추가)
--   deleted             true면 allIngs()에서 이 이름의 행을 제외한다(soft delete)
--   category_override   널이 아니면 getIngCategory()가 정규식보다 이 값을 우선 반환한다
--   payload              널이 아니면(48개 영양소 배열) 원본 행 대신 이 값을 쓴다.
--                        source='new'인 경우 이 값이 곧 원료의 전체 데이터다.
--
-- 이미 001_profiles_role.sql에서 만든 is_super_admin()을 그대로 재사용해 쓰기 권한을 제한한다.
-- ════════════════════════════════════════════════════════════════════════════

drop table if exists public.ingredient_overrides;

create table public.ingredient_overrides (
  id                uuid primary key default gen_random_uuid(),
  ing_name          text not null unique,
  source            text not null check (source in ('ing_db', 'ext', 'new')),
  deleted           boolean not null default false,
  category_override text,
  payload           jsonb,
  updated_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now()
);

create index ingredient_overrides_deleted_idx on public.ingredient_overrides (deleted);

-- RLS: 로그인한 사용자는 전원 읽을 수 있어야 한다(오버라이드를 적용해야 검색/배합 결과가
-- 모두에게 동일하게 보임). 쓰기(추가/수정/삭제)는 super_admin만.
alter table public.ingredient_overrides enable row level security;

drop policy if exists "ingredient_overrides: select all authenticated" on public.ingredient_overrides;
create policy "ingredient_overrides: select all authenticated"
  on public.ingredient_overrides for select
  to authenticated
  using (true);

drop policy if exists "ingredient_overrides: super_admin insert" on public.ingredient_overrides;
create policy "ingredient_overrides: super_admin insert"
  on public.ingredient_overrides for insert
  to authenticated
  with check (public.is_super_admin());

drop policy if exists "ingredient_overrides: super_admin update" on public.ingredient_overrides;
create policy "ingredient_overrides: super_admin update"
  on public.ingredient_overrides for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "ingredient_overrides: super_admin delete" on public.ingredient_overrides;
create policy "ingredient_overrides: super_admin delete"
  on public.ingredient_overrides for delete
  to authenticated
  using (public.is_super_admin());
