'use strict';
// 캘린더 변경이력 — js/dash-schedule-history.js 의 스냅샷/비교/요약/복원 행 변환/기록 로직 회귀 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
function makeCtx() {
  const ctx = vm.createContext({
    console: { ...console, warn() {} },
    escHtml: s => String(s),
    showToast: () => {},
    document: { getElementById: () => null },
  });
  for (const f of ['dash-schedule.js', 'dash-schedule-history.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const J = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const run = (ctx, code) => J(vm.runInContext(code, ctx));

const EV = { title: '고구마 생산', date: '2026-10-12', endDate: '2026-10-12', start: '', end: '', owner: '', memo: '', product: '', qty: null, unit: '' };

test('스냅샷: 하루짜리/기간/수량·단위 정규화(수량 없으면 단위 비움)', () => {
  const ctx = makeCtx();
  ctx.__a = { title: 't', date: '2026-10-12' };                                       // 기존 일정(필드 없음)
  ctx.__b = { title: 't', date: '2026-10-12', endDate: '2026-10-15', qty: 0, unit: '개', product: 'p' };
  ctx.__c = { title: 't', date: '2026-10-12', endDate: '2026-10-01', qty: null, unit: 'kg' };   // 잘못된 종료일 → 하루
  assert.deepEqual(run(ctx, `dashScheduleSnapshot(__a)`), { title: 't', date: '2026-10-12', endDate: '2026-10-12', start: '', end: '', owner: '', memo: '', product: '', qty: null, unit: '' });
  assert.deepEqual(run(ctx, `(() => { const s = dashScheduleSnapshot(__b); return [s.endDate, s.qty, s.unit, s.product]; })()`), ['2026-10-15', 0, '개', 'p']);
  assert.deepEqual(run(ctx, `(() => { const s = dashScheduleSnapshot(__c); return [s.endDate, s.unit]; })()`), ['2026-10-12', '']);
});

test('비교(diff): 바뀐 필드만, 수량은 단위 변경도 포함, 변경 없으면 빈 배열', () => {
  const ctx = makeCtx();
  ctx.__x = { ...EV };
  ctx.__y = { ...EV, title: '고구마 생산2', date: '2026-10-13', endDate: '2026-10-15', qty: 100, unit: 'kg', product: '트릿', owner: '김' };
  const d = run(ctx, `dashScheduleDiff(__x, __y)`);
  assert.deepEqual(d.map(c => c.field), ['일정명', '시작일', '종료일', '제품명', '생산 수량', '담당자']);
  assert.deepEqual(d.find(c => c.field === '생산 수량'), { field: '생산 수량', from: '(없음)', to: '100 kg' });
  ctx.__z = { ...EV, qty: 100, unit: 'g' };
  ctx.__w = { ...EV, qty: 100, unit: 'kg' };
  assert.deepEqual(run(ctx, `dashScheduleDiff(__w, __z)`).map(c => [c.field, c.from, c.to]), [['생산 수량', '100 kg', '100 g']]);
  assert.deepEqual(run(ctx, `dashScheduleDiff(__x, __x)`), []);
});

test('요약 문구: 등록/삭제/복원/수정', () => {
  const ctx = makeCtx();
  ctx.__s = { ...EV, endDate: '2026-10-15', start: '09:00', product: '트릿', qty: 1200, unit: 'kg', owner: '김' };
  assert.equal(run(ctx, `dashScheduleHistorySummary('create', null, __s, [])`), '2026-10-12 ~ 2026-10-15 · 09:00 ~ · 트릿 · 1,200 kg · 담당 김');
  assert.equal(run(ctx, `dashScheduleHistorySummary('delete', __s, null, [])`), '2026-10-12 ~ 2026-10-15 · 09:00 ~ · 트릿 · 1,200 kg · 담당 김');
  assert.equal(run(ctx, `dashScheduleHistorySummary('restore', null, __s, [])`), '2026-10-12 ~ 2026-10-15 · 09:00 ~ · 트릿 · 1,200 kg · 담당 김 (삭제 이력에서 복원)');
  ctx.__ch = [{ field: '일정명', from: 'A', to: 'B' }, { field: '메모', from: '(없음)', to: 'm' }];
  assert.equal(run(ctx, `dashScheduleHistorySummary('update', null, null, __ch)`), '일정명 A → B / 메모 (없음) → m');
  assert.equal(run(ctx, `dashScheduleHistorySummary('create', null, { ...__s, endDate: __s.date, start: '', product: '', qty: null, unit: '', owner: '' }, [])`), '2026-10-12');
});

test('복원 행 변환: 스냅샷 → insert 행(컬럼 존재 여부에 따라 end_date/생산 컬럼 포함·제외)', () => {
  const ctx = makeCtx();
  ctx.__s = { title: 'T', date: '2026-10-12', endDate: '2026-10-15', start: '09:00', end: '', owner: '김', memo: '', product: '트릿', qty: 3, unit: '박스' };
  assert.deepEqual(run(ctx, `dashScheduleRowFromSnapshot(__s)`), {
    schedule_date: '2026-10-12', title: 'T', start_time: '09:00', end_time: null, assignee: '김', memo: null,
    product_name: '트릿', production_qty: 3, production_unit: '박스', end_date: '2026-10-15',
  });
  vm.runInContext('dashScheduleHasEndDate = false; dashScheduleHasProduction = false;', ctx);
  assert.deepEqual(Object.keys(run(ctx, `dashScheduleRowFromSnapshot(__s)`)), ['schedule_date', 'title', 'start_time', 'end_time', 'assignee', 'memo']);
});

// supabaseClient 대역: 이력 insert 를 가로채 기록
function withClient(ctx, { fail } = {}) {
  const inserted = [];
  ctx.supabaseClient = { from: table => ({ insert: async row => { inserted.push({ table, row }); return fail ? { error: { message: fail } } : { error: null }; } }) };
  ctx.currentUser = { id: 'u1' };
  ctx.currentUserName = '홍길동';
  return inserted;
}

test('logDashScheduleHistory: 등록/수정/삭제 기록, 변경 없는 수정은 건너뜀, 사용자명 스냅샷 전송', async () => {
  const ctx = makeCtx();
  const inserted = withClient(ctx);
  ctx.__e = { ...EV };
  ctx.__e2 = { ...EV, title: '이름변경' };
  assert.equal(await vm.runInContext(`logDashScheduleHistory('create', null, __e, 'id1')`, ctx), true);
  assert.equal(await vm.runInContext(`logDashScheduleHistory('update', __e, __e2, 'id1')`, ctx), true);
  assert.equal(await vm.runInContext(`logDashScheduleHistory('update', __e, __e, 'id1')`, ctx), true);   // 변경 없음 → 기록 안 함
  assert.equal(await vm.runInContext(`logDashScheduleHistory('delete', __e2, null, 'id1')`, ctx), true);
  assert.deepEqual(inserted.map(i => [i.table, i.row.action, i.row.title, i.row.schedule_id]), [
    ['dash_schedule_history', 'create', '고구마 생산', 'id1'],
    ['dash_schedule_history', 'update', '이름변경', 'id1'],
    ['dash_schedule_history', 'delete', '이름변경', 'id1'],
  ]);
  assert.equal(inserted[1].row.summary, '일정명 고구마 생산 → 이름변경');
  assert.equal(inserted[0].row.user_name, '홍길동');
  assert.equal(J(inserted[2].row.details).before.title, '이름변경');   // 삭제 이력에 복원용 스냅샷
});

test('logDashScheduleHistory: 기록 실패(DB 미적용 등)는 예외 없이 false, 토스트는 1번만', async () => {
  const ctx = makeCtx();
  withClient(ctx, { fail: 'relation "dash_schedule_history" does not exist' });
  let toasts = 0; ctx.showToast = () => { toasts++; };
  ctx.__e = { ...EV };
  assert.equal(await vm.runInContext(`logDashScheduleHistory('create', null, __e, 'x')`, ctx), false);
  assert.equal(await vm.runInContext(`logDashScheduleHistory('create', null, __e, 'x')`, ctx), false);
  assert.equal(toasts, 1);
  ctx.supabaseClient = null;   // 비로그인/클라이언트 없음 → 조용히 건너뜀
  assert.equal(await vm.runInContext(`logDashScheduleHistory('create', null, __e, 'x')`, ctx), false);
});
