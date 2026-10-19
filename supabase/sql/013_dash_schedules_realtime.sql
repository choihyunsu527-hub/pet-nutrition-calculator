-- ════════════════════════════════════════════════════════════════════════════
-- 공동 일정표 실시간 동기화 — dash_schedules 를 Realtime publication 에 추가
-- Supabase 대시보드 → SQL Editor 에서 1회 실행하세요(여러 번 실행해도 안전).
-- (또는 Database → Replication → supabase_realtime 에서 dash_schedules 토글)
-- RLS(authenticated 전체 허용)가 그대로 적용되므로 로그인 사용자에게만 변경 이벤트가 전달된다.
-- 이미 추가돼 있는지 확인: select * from pg_publication_tables where pubname='supabase_realtime' and tablename='dash_schedules';
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dash_schedules') then
    alter publication supabase_realtime add table public.dash_schedules;
  end if;
end $$;
