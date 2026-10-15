'use strict';
// 일정 생산 정보(제품명/생산 수량/단위) — js/dash-schedule.js 의 변환·표시 함수 회귀 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({
  console,
  escHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js', 'dash-schedule.js'), 'utf8'), ctx);
const run = code => { const v = vm.runInContext(code, ctx); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };

const BASE = { id: 'a', title: '고구마 생산', schedule_date: '2026-10-12', start_time: null, end_time: null, assignee: null, memo: null, created_at: '2026-10-01T00:00:00Z' };

test('dashScheduleFromRow: 기존 일정(생산 컬럼 없음/NULL)은 빈 값으로 호환', () => {
  ctx.__r = BASE;
  assert.deepEqual(run(`(() => { const e = dashScheduleFromRow(__r); return [e.product, e.qty, e.unit]; })()`), ['', null, '']);
  ctx.__r = { ...BASE, product_name: null, production_qty: null, production_unit: null };
  assert.deepEqual(run(`(() => { const e = dashScheduleFromRow(__r); return [e.product, e.qty, e.unit]; })()`), ['', null, '']);
});

test('dashScheduleFromRow: 제품명/수량/단위 매핑(숫자 문자열, 0 수량 포함), 기간 일정과 함께', () => {
  ctx.__r = { ...BASE, product_name: '고구마 트릿', production_qty: '1200.500', production_unit: 'kg', end_date: '2026-10-15' };
  assert.deepEqual(run(`(() => { const e = dashScheduleFromRow(__r); return [e.product, e.qty, e.unit, e.endDate]; })()`), ['고구마 트릿', 1200.5, 'kg', '2026-10-15']);
  ctx.__r = { ...BASE, production_qty: 0, production_unit: '개' };
  assert.deepEqual(run(`(() => { const e = dashScheduleFromRow(__r); return [e.qty, e.unit]; })()`), [0, '개']);   // 0도 유효한 수량
});

test('표시 형식: 천 단위 구분, 소수 3자리, 없는 항목은 생략', () => {
  const f = o => { ctx.__e = o; return run(`[formatDashScheduleQty(__e), formatDashScheduleProduction(__e)]`); };
  assert.deepEqual(f({ product: '고구마', qty: 1200, unit: 'kg' }), ['1,200 kg', '고구마 · 1,200 kg']);
  assert.deepEqual(f({ product: '', qty: 12.5, unit: 'g' }), ['12.5 g', '12.5 g']);
  assert.deepEqual(f({ product: '', qty: 0, unit: '개' }), ['0 개', '0 개']);
  assert.deepEqual(f({ product: '북어 껌', qty: null, unit: '' }), ['', '북어 껌']);
  assert.deepEqual(f({ product: '', qty: null, unit: '' }), ['', '']);
  assert.deepEqual(f({ product: 'x', qty: 1.23456, unit: 'L' }), ['1.235 L', 'x · 1.235 L']);
});

test('툴팁/목록 보조줄: 생산 정보 없으면 일정명만, 있으면 추가하고 HTML 이스케이프', () => {
  ctx.__a = { title: '입고', product: '', qty: null, unit: '' };
  ctx.__b = { title: '생산', product: '<b>트릿</b>', qty: 3, unit: '박스' };
  assert.equal(run(`dashScheduleTip(__a)`), '입고');
  assert.equal(run(`dashScheduleTip(__b)`), '생산 — <b>트릿</b> · 3 박스');
  assert.equal(run(`dashScheduleSubHtml(__a, 'sub')`), '');
  assert.equal(run(`dashScheduleSubHtml(__b, 'sub')`), '<small class="sub">&lt;b&gt;트릿&lt;/b&gt; · 3 박스</small>');
});

test('단위 목록과 수량 상한은 폼/DB 제약과 같은 값', () => {
  assert.deepEqual(run(`DASH_SCHEDULE_UNITS`), ['kg', 'g', '개', '박스', '포', 'L', 'mL']);
  assert.equal(run(`DASH_SCHEDULE_MAX_QTY`), 999999999);
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const opts = [...html.matchAll(/<option value="([^"]+)">[^<]*<\/option>/g)].map(m => m[1]);
  for (const u of run(`DASH_SCHEDULE_UNITS`)) assert.ok(opts.includes(u), `폼 select 에 단위 ${u} 없음`);
});

test('작업 유형(생산/포장/출고): 행 변환·정규화·표시, 미선택/기존 일정 호환', () => {
  ctx.__r = BASE;
  assert.deepEqual(run(`dashScheduleFromRow(__r).workTypes`), []);
  ctx.__r = { ...BASE, work_types: ['shipping', 'production', 'bogus'] };
  assert.deepEqual(run(`dashScheduleFromRow(__r).workTypes`), ['production', 'shipping']);   // 고정 순서, 알 수 없는 값 제거
  const f = o => { ctx.__e = o; return run(`[formatDashScheduleWorkTypes(__e), formatDashScheduleProduction(__e)]`); };
  assert.deepEqual(f({ workTypes: ['production', 'packing', 'shipping'], product: '', qty: null, unit: '' }), ['생산·포장·출고', '[생산·포장·출고]']);
  assert.deepEqual(f({ workTypes: ['packing'], product: '북어 껌', qty: 3, unit: '박스' }), ['포장', '[포장] · 북어 껌 · 3 박스']);
  assert.deepEqual(f({ product: '', qty: null, unit: '' }), ['', '']);
});

test('날짜 칸 라벨: 작업 유형이 제목 앞, 미선택이면 제목만', () => {
  const f = o => { ctx.__e = o; return run(`dashScheduleCellLabel(__e)`); };
  assert.equal(f({ title: '고구마 트릿', workTypes: ['production', 'packing'] }), '생산·포장 | 고구마 트릿');
  assert.equal(f({ title: '고구마 트릿', workTypes: [] }), '고구마 트릿');
  assert.equal(f({ title: '고구마 트릿' }), '고구마 트릿');
});
