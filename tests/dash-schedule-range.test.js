'use strict';
// 대시보드 기간(여러 날짜) 일정 — js/dash-schedule.js 의 순수 로직 회귀 테스트.
// 브라우저 파일을 그대로 vm 샌드박스에 로드한다(최상위는 선언뿐이라 DOM 없이 로드 가능).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'dash-schedule.js'), 'utf8');
const ctx = vm.createContext({ console, escHtml: s => String(s) });
vm.runInContext(SRC, ctx, { filename: 'dash-schedule.js' });
// vm 안에서 만든 배열/객체는 다른 realm 이라 strict deepEqual 이 실패하므로 JSON 으로 옮겨 비교한다.
const run = code => { const v = vm.runInContext(code, ctx); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };

test('dashScheduleDatesInRange: 하루/기간/월 경계/연말연초/윤년', () => {
  assert.deepEqual(run(`dashScheduleDatesInRange('2026-10-12', '2026-10-12')`), ['2026-10-12']);
  assert.deepEqual(run(`dashScheduleDatesInRange('2026-10-12', undefined)`), ['2026-10-12']);
  assert.deepEqual(run(`dashScheduleDatesInRange('2026-10-12', '2026-10-14')`), ['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.deepEqual(run(`dashScheduleDatesInRange('2026-09-29', '2026-10-02')`), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.deepEqual(run(`dashScheduleDatesInRange('2026-12-30', '2027-01-02')`), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(run(`dashScheduleDatesInRange('2028-02-28', '2028-03-01')`), ['2028-02-28', '2028-02-29', '2028-03-01']);
  // 종료일이 시작일보다 빠르면(잘못된 데이터) 시작일 하루만
  assert.deepEqual(run(`dashScheduleDatesInRange('2026-10-12', '2026-10-01')`), ['2026-10-12']);
});

test('dashScheduleSpanDays / 최대 기간 상한', () => {
  assert.equal(run(`dashScheduleSpanDays('2026-10-12', '2026-10-12')`), 0);
  assert.equal(run(`dashScheduleSpanDays('2026-12-31', '2027-01-01')`), 1);
  assert.equal(run(`dashScheduleSpanDays('2026-03-01', '2027-03-02')`), 366);
  assert.equal(run(`dashScheduleDatesInRange('2026-01-01', '2030-01-01').length`), 367);   // 렌더 폭주 방지: 366일 뒤까지만
  assert.equal(run(`DASH_SCHEDULE_MAX_SPAN_DAYS`), 366);
});

test('dashScheduleFromRow: end_date 없음(기존 데이터) = 하루짜리, 있으면 기간', () => {
  const base = { id: 'a', title: 't', schedule_date: '2026-10-12', start_time: '09:00:00', end_time: null, assignee: null, memo: null, created_at: '2026-10-01T00:00:00Z' };
  ctx.__row = base;
  assert.equal(run(`dashScheduleFromRow(__row).endDate`), '2026-10-12');
  ctx.__row = { ...base, end_date: '2026-10-15' };
  assert.equal(run(`dashScheduleFromRow(__row).endDate`), '2026-10-15');
  assert.equal(run(`dashScheduleFromRow(__row).start`), '09:00');
});

test('getDashSchedulesByDate: 기간 일정은 모든 날짜에, 기존 일정(endDate 없음)은 그날만', () => {
  run(`dashSchedules = [
    { id: 'multi', title: '기간', date: '2026-12-30', endDate: '2027-01-02', start: '', end: '', owner: '', memo: '', createdAt: 2 },
    { id: 'old', title: '기존', date: '2026-12-31', start: '', end: '', owner: '', memo: '', createdAt: 1 },
    { id: 'timed', title: '시간', date: '2026-12-31', endDate: '2026-12-31', start: '09:00', end: '', owner: '', memo: '', createdAt: 3 },
  ]`);
  const map = run(`getDashSchedulesByDate()`);
  assert.deepEqual(Object.keys(map).sort(), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(map['2026-12-30'].map(e => e.id), ['multi']);
  assert.deepEqual(map['2027-01-02'].map(e => e.id), ['multi']);
  // 같은 날: 시작 시간 있는 일정 먼저, 나머지는 등록순
  assert.deepEqual(map['2026-12-31'].map(e => e.id), ['timed', 'old', 'multi']);
});

test('formatDashScheduleRange / dashScheduleListDateLabel', () => {
  const one = { date: '2026-10-12', endDate: '2026-10-12' };
  const legacy = { date: '2026-10-12' };
  const same = { date: '2026-10-12', endDate: '2026-10-15' };
  const cross = { date: '2026-09-28', endDate: '2026-10-02' };
  const year = { date: '2026-12-30', endDate: '2027-01-02' };
  ctx.__e = { one, legacy, same, cross, year };
  assert.equal(run(`formatDashScheduleRange(__e.one)`), run(`formatDashScheduleDate('2026-10-12')`));
  assert.equal(run(`formatDashScheduleRange(__e.legacy)`), run(`formatDashScheduleDate('2026-10-12')`));
  assert.match(run(`formatDashScheduleRange(__e.same)`), /2026년 10월 12일 \(월\) ~ 2026년 10월 15일 \(목\)/);
  const m = ['2026-10-01', '2026-10-31'];
  ctx.__m = m;
  assert.equal(run(`dashScheduleListDateLabel(__e.one, __m[0], __m[1])`), '12일');
  assert.equal(run(`dashScheduleListDateLabel(__e.legacy, __m[0], __m[1])`), '12일');
  assert.equal(run(`dashScheduleListDateLabel(__e.same, __m[0], __m[1])`), '12~15일');
  assert.equal(run(`dashScheduleListDateLabel(__e.cross, __m[0], __m[1])`), '9/28~10/2');
  assert.equal(run(`dashScheduleListDateLabel(__e.year, '2026-12-01', '2026-12-31')`), '2026.12/30~2027.1/2');
});
