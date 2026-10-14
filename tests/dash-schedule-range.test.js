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

// ── 기간 일정 가로 막대 레이아웃 (layoutDashCalendarBars) ─────────────────────
// 일요일 시작 7열 격자의 날짜 배열을 만든다(firstSunday 부터 weeks 주).
function gridCells(firstSunday, weeks) {
  ctx.__fs = firstSunday; ctx.__w = weeks;
  return run(`Array.from({ length: __w * 7 }, (_, i) => ({ date: dashScheduleAddDays(__fs, i) }))`);
}
function layout(cells, events, maxLanes = 3) {
  ctx.__cells = cells;
  run(`dashSchedules = ${JSON.stringify(events)}`);
  return run(`layoutDashCalendarBars(__cells, ${maxLanes})`);
}
const ev = (id, date, endDate, createdAt = 1) => ({ id, title: id, date, endDate, start: '', end: '', owner: '', memo: '', createdAt });

test('막대: 한 주 안의 기간 일정은 시작~종료 칸에 걸친 막대 1개', () => {
  const cells = gridCells('2026-09-27', 5);              // 2026-10 격자(9/27 ~ 10/31)
  const { bars, info } = layout(cells, [ev('A', '2026-10-12', '2026-10-15')]);
  assert.equal(bars.length, 1);
  assert.deepEqual({ row: bars[0].row, c1: bars[0].c1, c2: bars[0].c2, lane: bars[0].lane, s: bars[0].isStart, e: bars[0].isEnd }, { row: 3, c1: 1, c2: 4, lane: 0, s: true, e: true });
  assert.equal(info['2026-10-12'].lanes, 1);
  assert.equal(info['2026-10-12'].bars, 1);
  assert.equal(info['2026-10-16'].lanes, 0);
});

test('막대: 주 경계를 넘으면 주마다 구간으로 나뉘고 시작/끝 표시가 맞는다', () => {
  const cells = gridCells('2026-09-27', 5);
  const { bars } = layout(cells, [ev('B', '2026-10-14', '2026-10-21')]);   // 수 ~ 다음 주 수
  assert.deepEqual(bars.map(b => [b.row, b.c1, b.c2, b.isStart, b.isEnd]), [[3, 3, 6, true, false], [4, 0, 3, false, true]]);
});

test('막대: 한 주를 통째로 가로지르는 구간(양쪽 이어짐), 6행 달', () => {
  const cells = gridCells('2026-07-26', 6);              // 2026-08 격자(7/26 ~ 9/5)
  const { bars } = layout(cells, [ev('Aug', '2026-08-04', '2026-08-18')]);
  assert.deepEqual(bars.map(b => [b.row, b.c1, b.c2, b.isStart, b.isEnd]), [[2, 2, 6, true, false], [3, 0, 6, false, false], [4, 0, 2, false, true]]);
});

test('막대: 월 경계/연말연초 — 달 격자에 보이는 칸까지만 그리고 다음 달 격자에서 이어진다', () => {
  const oct = layout(gridCells('2026-09-27', 5), [ev('D', '2026-10-29', '2026-11-02')]).bars;
  assert.deepEqual(oct.map(b => [b.row, b.c1, b.c2, b.isStart, b.isEnd]), [[5, 4, 6, true, false]]);   // 10/29~10/31 (11/1~은 격자 밖)
  const nov = layout(gridCells('2026-11-01', 5), [ev('D', '2026-10-29', '2026-11-02')]).bars;
  assert.deepEqual(nov.map(b => [b.row, b.c1, b.c2, b.isStart, b.isEnd]), [[1, 0, 1, false, true]]);
  const dec = layout(gridCells('2026-11-29', 5), [ev('Y', '2026-12-30', '2027-01-02')]).bars;           // 12월 격자 11/29 ~ 1/2
  assert.deepEqual(dec.map(b => [b.row, b.c1, b.c2, b.isStart, b.isEnd]), [[5, 3, 6, true, true]]);
  const jan = layout(gridCells('2026-12-27', 5), [ev('Y', '2026-12-30', '2027-01-02')]).bars;           // 1월 격자 12/27 ~ 1/30
  assert.deepEqual(jan.map(b => [b.row, b.c1, b.c2, b.isStart, b.isEnd]), [[1, 3, 6, true, true]]);
});

test('막대: 겹치는 일정은 줄을 나눠 쌓고(시작 빠른 순→긴 순→등록순), 안 겹치면 같은 줄 재사용', () => {
  const cells = gridCells('2026-09-27', 5);
  const { bars } = layout(cells, [
    ev('late', '2026-10-14', '2026-10-15', 3), ev('first', '2026-10-12', '2026-10-13', 1), ev('long', '2026-10-12', '2026-10-15', 2),
  ]);
  const lane = id => bars.find(b => b.ev.id === id).lane;
  assert.equal(lane('long'), 0);      // 같은 시작일이면 긴 일정이 먼저
  assert.equal(lane('first'), 1);
  assert.equal(lane('late'), 1);      // first(월~화)와 안 겹쳐 같은 줄 재사용
});

test('막대: 줄이 모자라면(maxLanes 초과) 그리지 않고 칸 정보에는 반영하지 않는다(+N건에 포함되도록)', () => {
  const cells = gridCells('2026-09-27', 5);
  const events = ['a', 'b', 'c', 'd'].map((id, i) => ev(id, '2026-10-14', '2026-10-16', i));
  const { bars, info } = layout(cells, events, 3);
  assert.equal(bars.length, 3);
  assert.equal(info['2026-10-14'].lanes, 3);
  assert.equal(info['2026-10-14'].bars, 3);       // 그려진 막대만 센다 → 하루 일정 수 - bars = 숨겨진 건수
});

test('막대: 하루짜리/기존 일정(endDate 없음)은 막대 대상이 아니다', () => {
  const cells = gridCells('2026-09-27', 5);
  const { bars, info } = layout(cells, [ev('one', '2026-10-12', '2026-10-12'), { id: 'old', title: 'old', date: '2026-10-13', start: '', end: '', owner: '', memo: '', createdAt: 1 }]);
  assert.equal(bars.length, 0);
  assert.equal(info['2026-10-12'].lanes, 0);
});
