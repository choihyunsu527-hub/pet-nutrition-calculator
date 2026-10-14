'use strict';
// 캘린더 날짜 계산 회귀 테스트 — 요일/윤년/연말연초/월말 계산과 시간대(TZ)에 따른 하루 밀림 여부.
// js/dash-schedule.js 의 날짜 함수를 vm 으로 로드해, 독립적인 UTC 정답(Date.UTC)과 모든 날짜를 비교한다.
// 시간대 독립성은 TZ 환경변수를 바꾼 자식 프로세스에서 같은 검증을 다시 돌려 확인한다
// (UTC+14, UTC-11, 서머타임 지역, 30분 단위 DST 지역 포함).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CHECK = String.raw`
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.resolve(process.argv[1], 'js', 'dash-schedule.js'), 'utf8');
const ctx = vm.createContext({ console, escHtml: s => String(s) });
vm.runInContext(src, ctx);
const run = c => vm.runInContext(c, ctx);
const names = ['일', '월', '화', '수', '목', '금', '토'];
const p2 = n => String(n).padStart(2, '0');
const bad = [];
let n = 0;
for (let ms = Date.UTC(2020, 0, 1); ms <= Date.UTC(2032, 11, 31); ms += 86400000) {
  const d = new Date(ms);
  const ymd = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  n++;
  const want = d.getUTCFullYear() + '년 ' + (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 (' + names[d.getUTCDay()] + ')';
  const got = run('formatDashScheduleDate(' + JSON.stringify(ymd) + ')');
  if (got !== want) bad.push('weekday ' + got + ' != ' + want);
  const next = run('dashScheduleAddDays(' + JSON.stringify(ymd) + ', 1)');
  const wantNext = new Date(ms + 86400000).toISOString().slice(0, 10);
  if (next !== wantNext) bad.push('addDays ' + ymd + ' -> ' + next + ' != ' + wantNext);
  if (run('dashScheduleSpanDays(' + JSON.stringify(ymd) + ', ' + JSON.stringify(next) + ')') !== 1) bad.push('span ' + ymd);
  const today = run('dashScheduleTodayYmd()');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) bad.push('today ' + today);
}
// 달력 격자가 쓰는 로컬 생성자 계산(월 1일의 요일/말일/이전 달 말일)도 정답과 같아야 한다
for (let y = 2024; y <= 2030; y++) for (let m = 0; m < 12; m++) {
  const wantFirst = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const wantDim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const wantPrevDim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (new Date(y, m, 1).getDay() !== wantFirst) bad.push('firstWeekday ' + y + '-' + (m + 1));
  if (new Date(y, m + 1, 0).getDate() !== wantDim) bad.push('daysInMonth ' + y + '-' + (m + 1));
  if (new Date(y, m, 0).getDate() !== wantPrevDim) bad.push('prevDaysInMonth ' + y + '-' + (m + 1));
}
console.log(JSON.stringify({ n, bad: bad.slice(0, 5), nBad: bad.length }));
`;

const ROOT = path.resolve(__dirname, '..');
const ZONES = ['UTC', 'Asia/Seoul', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles', 'Europe/London', 'Australia/Lord_Howe'];

for (const tz of ZONES) {
  test(`날짜/요일 계산은 시간대(${tz})와 무관하게 UTC 정답과 일치 (2020~2032 전 날짜)`, () => {
    const r = spawnSync(process.execPath, ['-e', CHECK, ROOT], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim());
    assert.ok(out.n > 4700);
    assert.equal(out.nBad, 0, JSON.stringify(out.bad));
  });
}

// ── 윤년·연말연초·월말 구체 값 (이 테스트는 현재 프로세스 TZ 와 무관해야 한다) ──
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({ console, escHtml: s => String(s) });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'dash-schedule.js'), 'utf8'), ctx);
const run = code => { const v = vm.runInContext(code, ctx); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };

test('윤년: 2028-02-29 존재, 2026/2100 은 2월 28일까지(2400 은 29일)', () => {
  assert.equal(run(`dashScheduleAddDays('2028-02-28', 1)`), '2028-02-29');
  assert.equal(run(`dashScheduleAddDays('2028-02-29', 1)`), '2028-03-01');
  assert.equal(run(`dashScheduleAddDays('2026-02-28', 1)`), '2026-03-01');
  assert.equal(run(`dashScheduleAddDays('2100-02-28', 1)`), '2100-03-01');
  assert.equal(run(`dashScheduleAddDays('2400-02-28', 1)`), '2400-02-29');
  assert.equal(run(`formatDashScheduleDate('2028-02-29')`), '2028년 2월 29일 (화)');
  assert.equal(run(`dashScheduleSpanDays('2028-02-28', '2028-03-01')`), 2);   // 윤년은 하루 더
  assert.equal(run(`dashScheduleSpanDays('2026-02-28', '2026-03-01')`), 1);
});

test('연말·연초·월말 경계', () => {
  assert.equal(run(`dashScheduleAddDays('2026-12-31', 1)`), '2027-01-01');
  assert.equal(run(`dashScheduleAddDays('2027-01-01', -1)`), '2026-12-31');
  assert.equal(run(`dashScheduleAddDays('2026-10-31', 1)`), '2026-11-01');
  assert.equal(run(`dashScheduleAddDays('2026-11-30', 1)`), '2026-12-01');
  assert.equal(run(`formatDashScheduleDate('2026-12-31')`), '2026년 12월 31일 (목)');
  assert.equal(run(`formatDashScheduleDate('2027-01-01')`), '2027년 1월 1일 (금)');
  assert.deepEqual(run(`dashScheduleDatesInRange('2028-02-27', '2028-03-02')`), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02']);
});
