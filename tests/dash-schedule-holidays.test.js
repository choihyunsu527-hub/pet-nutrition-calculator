'use strict';
// 달력 일요일/공휴일 날짜 색 — js/kr-holidays.js 정적 공휴일 표 검증.
//  1) 표 == 규칙 기반 독립 계산(고정일 + 한국 음력(ICU dangi) + 대체공휴일 규칙) + 선거일/임시공휴일(EXTRAS)
//  2) 표 == 공개된 공식 목록(손으로 옮긴 2024~2028 날짜) — 규칙 계산과 별개의 정답지
//  3) 공통 함수 krDayClasses: 일요일/공휴일만 빨강 클래스, 토요일·평일·데이터 없는 연도의 평일은 없음, 시간대 무관
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { generateKrHolidays, weekday } = require('./helpers/kr-holiday-rules.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'kr-holidays.js'), 'utf8');
function load() {
  const ctx = vm.createContext({ console, escHtml: s => String(s).replace(/"/g, '&quot;') });
  vm.runInContext(SRC, ctx, { filename: 'kr-holidays.js' });
  return ctx;
}
const ctx = load();
const J = v => JSON.parse(JSON.stringify(v));
const run = code => J(vm.runInContext(code, ctx));

// 정부가 따로 지정하는 선거일·임시공휴일 — 규칙으로 계산할 수 없어 표와 같은 값을 여기에도 둔다.
const EXTRAS = {
  2024: { '2024-04-10': '국회의원선거일', '2024-10-01': '임시공휴일(국군의날)' },
  2025: { '2025-01-27': '임시공휴일', '2025-06-03': '대통령선거일' },
  2026: { '2026-06-03': '지방선거일' },
  2027: {},
  2028: { '2028-04-12': '국회의원선거일' },
};

test('표 == 규칙 기반 독립 계산(연도별, 이름까지 일치) — 누락/잘못된 날짜 없음', () => {
  const years = run(`[KR_HOLIDAY_YEARS.from, KR_HOLIDAY_YEARS.to]`);
  const table = run(`KR_HOLIDAYS`);
  const expected = {};
  for (let y = years[0]; y <= years[1]; y++) Object.assign(expected, generateKrHolidays(y, EXTRAS[y] || {}));
  assert.deepEqual(Object.keys(table).sort(), Object.keys(expected).sort());
  assert.deepEqual(table, expected);
});

// 공개 목록(인사혁신처 월력요항 기준 보도/정리본)을 날짜만 옮긴 정답지 — 규칙 계산과 독립
const OFFICIAL = {
  2024: ['01-01', '02-09', '02-10', '02-11', '02-12', '03-01', '04-10', '05-05', '05-06', '05-15', '06-06', '08-15', '09-16', '09-17', '09-18', '10-01', '10-03', '10-09', '12-25'],
  2025: ['01-01', '01-27', '01-28', '01-29', '01-30', '03-01', '03-03', '05-05', '05-06', '06-03', '06-06', '08-15', '10-03', '10-05', '10-06', '10-07', '10-08', '10-09', '12-25'],
  // 2026: 노동절·제헌절 신규 공휴일, 삼일절/부처님오신날/광복절/개천절 대체공휴일, 추석은 토요일과 겹쳐 대체 없음
  2026: ['01-01', '02-16', '02-17', '02-18', '03-01', '03-02', '05-01', '05-05', '05-24', '05-25', '06-03', '06-06', '07-17', '08-15', '08-17', '09-24', '09-25', '09-26', '10-03', '10-05', '10-09', '12-25'],
  // 2027: 대체공휴일 7일 = 2/9, 5/3, 7/19, 8/16, 10/4, 10/11, 12/27
  2027: ['01-01', '02-06', '02-07', '02-08', '02-09', '03-01', '05-01', '05-03', '05-05', '05-13', '06-06', '07-17', '07-19', '08-15', '08-16', '09-14', '09-15', '09-16', '10-03', '10-04', '10-09', '10-11', '12-25', '12-27'],
  // 2028: 개천절이 추석 연휴(10/3)와 겹쳐 10/5 대체공휴일
  2028: ['01-01', '01-26', '01-27', '01-28', '03-01', '04-12', '05-01', '05-02', '05-05', '06-06', '07-17', '08-15', '10-02', '10-03', '10-04', '10-05', '10-09', '12-25'],
};
for (const [year, days] of Object.entries(OFFICIAL)) {
  test(`${year}년 공휴일 표 == 공개 목록 (${days.length}일)`, () => {
    const got = Object.keys(run(`KR_HOLIDAYS`)).filter(d => d.startsWith(year + '-')).map(d => d.slice(5)).sort();
    assert.deepEqual(got, days);
  });
}

test('대체공휴일 대상/비대상 구체 사례', () => {
  const has = d => run(`krHolidayName('${d}')`);
  // 대체 있음
  assert.match(has('2025-10-08'), /^대체공휴일/);   // 추석 연휴가 일요일(10/5)과 겹침
  assert.match(has('2025-05-06'), /^대체공휴일/);   // 어린이날 + 부처님오신날 겹침(대체 1일)
  assert.match(has('2026-03-02'), /^대체공휴일/);   // 삼일절 일요일
  assert.match(has('2026-08-17'), /^대체공휴일/);   // 광복절 토요일 → 일요일 건너뛰고 월요일
  assert.match(has('2026-10-05'), /^대체공휴일/);   // 개천절 토요일
  assert.match(has('2027-02-09'), /^대체공휴일/);   // 설날 일요일
  assert.match(has('2028-10-05'), /^대체공휴일/);   // 추석 연휴와 개천절 겹침
  // 대체 없음
  assert.equal(has('2026-09-27'), null);             // 추석 연휴는 토요일(9/26)과 겹쳐도 대체 없음, 일요일 9/27은 공휴일 아님
  assert.equal(has('2026-06-08'), null);             // 현충일(토) 대체 없음
  assert.equal(has('2027-06-07'), null);             // 현충일(일) 대체 없음
  assert.equal(has('2028-01-03'), null);             // 신정(토) 대체 없음
  assert.equal(has('2025-05-07'), null);             // 대체는 1일뿐
  assert.equal(has('2025-10-10'), null);             // 임시공휴일 미지정
  assert.equal(has('2025-05-01'), null);             // 노동절은 2026년부터
  assert.equal(has('2025-07-17'), null);             // 제헌절은 2026년부터
});

test('krDayClasses: 일요일=is-sun, 공휴일=is-holiday, 토요일/평일=없음', () => {
  const c = d => run(`krDayClasses('${d}')`);
  assert.deepEqual(c('2026-10-11'), ['is-sun']);                    // 일반 일요일
  assert.deepEqual(c('2026-10-12'), []);                            // 평일 월요일
  assert.deepEqual(c('2026-10-10'), []);                            // 토요일은 기존 색
  assert.deepEqual(c('2026-10-09'), ['is-holiday']);                // 평일 공휴일(한글날, 금)
  assert.deepEqual(c('2026-10-05'), ['is-holiday']);                // 대체공휴일(월)
  assert.deepEqual(c('2026-10-03'), ['is-holiday']);                // 토요일 공휴일(개천절) → 공휴일이므로 빨강
  assert.deepEqual(c('2026-03-01'), ['is-sun', 'is-holiday']);      // 일요일이면서 공휴일
  assert.deepEqual(c('2028-04-12'), ['is-holiday']);                // 선거일
  assert.deepEqual(c('2025-01-27'), ['is-holiday']);                // 임시공휴일
});

test('데이터 없는 연도: 평일/토요일은 빨갛게 하지 않고 일요일만 빨강', () => {
  const c = d => run(`krDayClasses('${d}')`);
  assert.deepEqual(c('2023-10-03'), []);        // 개천절이지만 지원 연도 밖 → 표시 안 함
  assert.deepEqual(c('2029-02-13'), []);        // 2029 설날(미공개 월력요항) → 표시 안 함
  assert.deepEqual(c('2029-02-11'), ['is-sun']);
  assert.deepEqual(c('2031-01-05'), ['is-sun']);
  assert.equal(run(`krHolidayName('2029-02-13')`), null);
});

test('표 자체 점검: 날짜 형식/지원 연도 안/요일 계산 — 모든 표 항목', () => {
  const [from, to] = run(`[KR_HOLIDAY_YEARS.from, KR_HOLIDAY_YEARS.to]`);
  for (const [d, name] of Object.entries(run(`KR_HOLIDAYS`))) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number(d.slice(0, 4)) >= from && Number(d.slice(0, 4)) <= to, d);
    assert.ok(name && name.length > 0);
    assert.equal(run(`krWeekday('${d}')`), weekday(d));
  }
});

test('krHolidayTitleAttr: 공휴일만 이름 툴팁, 따옴표 이스케이프', () => {
  assert.equal(run(`krHolidayTitleAttr('2026-10-09')`), ' title="한글날"');
  assert.equal(run(`krHolidayTitleAttr('2026-10-10')`), '');
  assert.equal(run(`krHolidayTitleAttr('2026-10-11')`), '');   // 일요일 자체는 이름 없음
});

for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles', 'Australia/Lord_Howe']) {
  test(`요일/공휴일 판정은 시간대(${tz})와 무관`, () => {
    const code = `
      const fs = require('node:fs'), vm = require('node:vm');
      const ctx = vm.createContext({ escHtml: s => s });
      vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
      const bad = [];
      for (let ms = Date.UTC(2024, 0, 1); ms <= Date.UTC(2028, 11, 31); ms += 86400000) {
        const d = new Date(ms), ymd = d.toISOString().slice(0, 10);
        const sun = d.getUTCDay() === 0;
        const cls = vm.runInContext('krDayClasses(' + JSON.stringify(ymd) + ')', ctx);
        if (cls.includes('is-sun') !== sun) bad.push('sun ' + ymd);
        if (cls.includes('is-holiday') !== (vm.runInContext('krHolidayName(' + JSON.stringify(ymd) + ')', ctx) !== null)) bad.push('hol ' + ymd);
      }
      console.log(JSON.stringify(bad));`;
    const r = spawnSync(process.execPath, ['-e', code, path.join(ROOT, 'js', 'kr-holidays.js')], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim()), []);
  });
}
