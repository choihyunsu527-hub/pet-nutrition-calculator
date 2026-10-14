'use strict';
// 공휴일 자동 갱신(js/kr-holidays.js 의 krValidateHolidayPayload / krApplyHolidayYears / krRefreshHolidays) 회귀 테스트.
// 핵심: 성공 시 검증된 연도만 반영 · 실패(오프라인/HTTP 오류/HTML 응답/형식·검증 실패/타임아웃/예외) 시 기존 데이터 그대로 ·
//       어떤 경우에도 예외를 밖으로 던지지 않음 · 확인되지 않은 날짜를 공휴일로 만들지 않음.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { generateKrHolidays } = require('../scripts/lib/kr-holiday-rules.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'kr-holidays.js'), 'utf8');
const J = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// 매 테스트마다 새 샌드박스(전역 표 변경이 다른 테스트에 새지 않도록). env 로 fetch/navigator/localStorage 등을 주입.
function load(env = {}) {
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const ctx = vm.createContext({ console, escHtml: s => String(s), localStorage, setTimeout, clearTimeout, AbortController, ...env });
  vm.runInContext(SRC, ctx, { filename: 'kr-holidays.js' });
  ctx.__store = store;
  return ctx;
}
const run = (ctx, code) => J(vm.runInContext(code, ctx));
const resp = (body, init = {}) => ({ ok: init.ok !== false, status: init.status || 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

const baseline = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kr-holidays.json'), 'utf8'));

test('data/kr-holidays.json: 형식·검증 통과, 기본 데이터 표와 동일', () => {
  const ctx = load();
  const payload = baseline();
  assert.equal(payload.schema, 1);
  ctx.__p = payload;
  const v = run(ctx, `krValidateHolidayPayload(__p)`);
  assert.equal(v.error, null);
  assert.deepEqual(v.rejected, {});
  assert.deepEqual(Object.keys(v.years).sort(), ['2024', '2025', '2026', '2027', '2028']);
  const table = run(ctx, `KR_HOLIDAYS`);
  const fromFile = Object.assign({}, ...Object.values(payload.years));
  assert.deepEqual(fromFile, table);
  assert.equal(run(ctx, `krApplyHolidayYears(krValidateHolidayPayload(__p).years)`), false);   // 이미 같음 → 변경 없음
});

test('검증: 잘못된 형식/날짜/이름/누락/오염은 연도 단위로 거부하고 나머지 연도는 통과', () => {
  const ctx = load();
  const ok2029 = generateKrHolidays(2029, {});
  const v = (years, schema = 1) => { ctx.__p = { schema, years }; return run(ctx, `krValidateHolidayPayload(__p)`); };
  // 정상(새 연도, 규칙 계산 결과)
  assert.deepEqual(Object.keys(v({ 2029: ok2029 }).years), ['2029']);
  // schema/years 형식
  assert.ok(v({ 2029: ok2029 }, 2).error);
  ctx.__p = null; assert.ok(run(ctx, `krValidateHolidayPayload(__p).error`));
  ctx.__p = { schema: 1, years: [] }; assert.ok(run(ctx, `krValidateHolidayPayload(__p).error`));
  ctx.__p = { schema: 1, years: {} }; assert.ok(run(ctx, `krValidateHolidayPayload(__p).error`));
  // 연도 단위 거부 사유
  const bad = {
    2030: { ...generateKrHolidays(2030, {}), '2030-02-30': '없는 날짜' },
    2031: { ...generateKrHolidays(2031, {}), '2031-03-02': '<script>x</script>' },
    2032: Object.fromEntries(Object.entries(generateKrHolidays(2032, {})).filter(([d]) => !d.endsWith('-10-09'))),       // 한글날 누락
    2033: Object.fromEntries(Object.entries(generateKrHolidays(2033, {})).slice(0, 5)),                                    // 너무 적음
    2034: { ...generateKrHolidays(2034, {}), '2034-04-05': 123 },                                                           // 이름이 문자열 아님
    2035: { ...generateKrHolidays(2035, {}), '2036-01-01': '다른 해 날짜' },
    1999: generateKrHolidays(2029, {}),                                                                                     // 연도 범위 밖
  };
  const r = v({ 2029: ok2029, ...bad });
  assert.deepEqual(Object.keys(r.years), ['2029']);
  assert.deepEqual(Object.keys(r.rejected).sort(), Object.keys(bad).sort());
});

test('검증: 기본 데이터 연도는 기본 날짜를 모두 포함해야 하고 추가는 소수만 허용', () => {
  const ctx = load();
  const y2026 = baseline().years['2026'];
  const vv = years => { ctx.__p = { schema: 1, years }; return run(ctx, `krValidateHolidayPayload(__p)`); };
  const lost = { ...y2026 }; delete lost['2026-07-17'];
  assert.match(vv({ 2026: lost }).rejected['2026'], /기본 데이터의 공휴일 누락/);
  const added1 = { ...y2026, '2026-12-31': '임시공휴일' };                       // 임시공휴일 1건 추가는 허용
  assert.deepEqual(Object.keys(vv({ 2026: added1 }).years), ['2026']);
  const many = { ...y2026, '2026-11-02': 'a', '2026-11-03': 'b', '2026-11-04': 'c', '2026-11-05': 'd' };
  assert.match(vv({ 2026: many }).rejected['2026'], /추가된 날이 너무 많음/);
});

test('반영: 검증 통과 연도만 교체, 새 임시공휴일은 빨강 클래스·이름 툴팁, 데이터 없는 날짜는 그대로 평일', () => {
  const ctx = load();
  const y2026 = { ...baseline().years['2026'], '2026-12-31': '임시공휴일' };
  ctx.__p = { schema: 1, years: { 2026: y2026, 2029: generateKrHolidays(2029, {}) } };
  assert.equal(run(ctx, `krApplyHolidayYears(krValidateHolidayPayload(__p).years)`), true);
  assert.deepEqual(run(ctx, `krDayClasses('2026-12-31')`), ['is-holiday']);
  assert.equal(run(ctx, `krHolidayTitleAttr('2026-12-31')`), ' title="임시공휴일"');
  assert.deepEqual(run(ctx, `krDayClasses('2029-02-13')`), ['is-holiday']);             // 새 연도 설날(데이터에 있음)
  assert.deepEqual(run(ctx, `krDayClasses('2029-02-15')`), []);                         // 데이터에 없는 평일은 공휴일 아님
  assert.deepEqual(run(ctx, `krDayClasses('2026-12-30')`), []);
  assert.deepEqual(run(ctx, `krDayClasses('2025-10-08')`), ['is-holiday']);             // 다른 연도는 그대로
  assert.deepEqual(run(ctx, `[KR_HOLIDAY_YEARS.from, KR_HOLIDAY_YEARS.to]`), [2024, 2029]);
  assert.equal(run(ctx, `krApplyHolidayYears(krValidateHolidayPayload(__p).years)`), false);   // 멱등
  // 기본 표(baseline 스냅샷)는 변경되지 않는다
  assert.equal(run(ctx, `Object.keys(KR_HOLIDAYS_BASELINE).length`), Object.keys(baseline().years).reduce((n, y) => n + Object.keys(baseline().years[y]).length, 0));
});

test('갱신 성공: fetch → 검증 → 반영 → 캐시 저장 → 달력 다시 그리기', async () => {
  let rendered = 0;
  const payload = baseline(); payload.years['2026']['2026-12-31'] = '임시공휴일';
  const ctx = load({ fetch: async () => resp(payload), navigator: { onLine: true }, renderDashCalendar: () => { rendered++; }, renderCalendarTab: () => { rendered++; } });
  const r = J(await vm.runInContext(`krRefreshHolidays({ force: true })`, ctx));
  assert.deepEqual({ status: r.status, changed: r.changed }, { status: 'ok', changed: true });
  assert.deepEqual(run(ctx, `krDayClasses('2026-12-31')`), ['is-holiday']);
  assert.equal(rendered, 2);
  assert.ok(JSON.parse(ctx.__store.get('feedcalc_v4_kr_holidays')).payload.years['2026']['2026-12-31']);
  // 다음 로드: 오프라인이어도 캐시(검증 통과분)를 즉시 적용
  const ctx2 = load({ navigator: { onLine: false } });
  ctx2.localStorage.setItem('feedcalc_v4_kr_holidays', ctx.__store.get('feedcalc_v4_kr_holidays'));
  assert.equal(run(ctx2, `krApplyCachedHolidays()`), true);
  assert.deepEqual(run(ctx2, `krDayClasses('2026-12-31')`), ['is-holiday']);
});

test('갱신 실패 모두 기존 데이터 유지 + 예외 없음: HTTP 오류/404/HTML/네트워크 오류/비JSON/형식·검증 실패/과대 응답', async () => {
  const cases = {
    'http-500': async () => resp('err', { ok: false, status: 500 }),
    'http-404': async () => resp('nf', { ok: false, status: 404 }),
    'invalid-json': async () => resp('<!doctype html><html></html>'),          // vercel rewrite 가 index.html 을 돌려주는 경우
    'error': async () => { throw new TypeError('Failed to fetch'); },
    'invalid': async () => resp({ schema: 9, years: {} }),
    'invalid2': async () => resp({ schema: 1, years: { 2026: { '2026-01-01': '신정' } } }),   // 연도 검증 실패 → 반영할 연도 없음
    'too-large': async () => resp('x'.repeat(250000)),
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    const ctx = load({ fetch: fetchImpl, navigator: { onLine: true } });
    const before = JSON.stringify(run(ctx, `KR_HOLIDAYS`));
    const r = J(await vm.runInContext(`krRefreshHolidays({ force: true })`, ctx));   // reject 되면 테스트 실패
    assert.notEqual(r.status, 'ok', name);
    assert.equal(JSON.stringify(run(ctx, `KR_HOLIDAYS`)), before, `${name}: 기존 데이터 변경됨`);
    assert.equal(ctx.__store.get('feedcalc_v4_kr_holidays'), undefined, `${name}: 실패 응답을 캐시함`);
    assert.deepEqual(run(ctx, `krDayClasses('2026-10-09')`), ['is-holiday']);
  }
});

test('일부 연도만 유효하면 유효한 연도만 반영하고 거부 사유를 알려 준다', async () => {
  const payload = baseline();
  payload.years['2029'] = generateKrHolidays(2029, {});
  payload.years['2027'] = { ...payload.years['2027'] }; delete payload.years['2027']['2027-02-09'];   // 기본 데이터 누락 → 거부
  const ctx = load({ fetch: async () => resp(payload), navigator: { onLine: true } });
  const r = J(await vm.runInContext(`krRefreshHolidays({ force: true })`, ctx));
  assert.equal(r.status, 'ok');
  assert.ok(r.rejected['2027']);
  assert.deepEqual(run(ctx, `krDayClasses('2027-02-09')`), ['is-holiday']);   // 2027 은 기존 데이터 유지
  assert.deepEqual(run(ctx, `krDayClasses('2029-02-13')`), ['is-holiday']);   // 2029 는 반영
});

test('일부 연도가 거부돼도 직전에 검증된 연도의 캐시는 보존(서버 장애 후 재로드에서도 마지막 정상 데이터 유지)', async () => {
  const good = baseline(); good.years['2026']['2026-12-31'] = '임시공휴일';
  let next = good;
  const ctx = load({ fetch: async () => resp(next), navigator: { onLine: true } });
  assert.equal(J(await vm.runInContext(`krRefreshHolidays({ force: true })`, ctx)).status, 'ok');
  // 두 번째 응답: 2026 이 오염(거부) + 2029 는 정상
  const bad = baseline(); bad.years['2026'] = { '2026-01-01': '신정' }; bad.years['2029'] = generateKrHolidays(2029, {});
  next = bad;
  const r = J(await vm.runInContext(`krRefreshHolidays({ force: true })`, ctx));
  assert.equal(r.status, 'ok'); assert.ok(r.rejected['2026']);
  const cached = JSON.parse(ctx.__store.get('feedcalc_v4_kr_holidays')).payload.years;
  assert.equal(cached['2026']['2026-12-31'], '임시공휴일');   // 거부된 연도는 마지막 정상 데이터 유지
  assert.ok(cached['2029']);                                    // 새로 통과한 연도 추가
  // 새 페이지 로드(서버 장애 가정): 캐시만으로 복원
  const ctx2 = load({ navigator: { onLine: false } });
  ctx2.localStorage.setItem('feedcalc_v4_kr_holidays', ctx.__store.get('feedcalc_v4_kr_holidays'));
  assert.equal(run(ctx2, `krApplyCachedHolidays()`), true);
  assert.deepEqual(run(ctx2, `krDayClasses('2026-12-31')`), ['is-holiday']);
  assert.deepEqual(run(ctx2, `krDayClasses('2029-02-13')`), ['is-holiday']);
});

test('오프라인/타임아웃/간격: offline 이면 fetch 호출 안 함, 6시간 내 재확인 생략, 응답 없음(abort)도 예외 없음', async () => {
  let calls = 0;
  const ctx = load({ fetch: async () => { calls++; return resp(baseline()); }, navigator: { onLine: false } });
  assert.equal(J(await vm.runInContext(`krRefreshHolidays({ force: true })`, ctx)).status, 'offline');
  assert.equal(calls, 0);
  // 간격: 방금 성공했으면 'fresh' (force 아니면 fetch 안 함)
  const ctx2 = load({ fetch: async () => { calls++; return resp(baseline()); }, navigator: { onLine: true } });
  assert.equal(J(await vm.runInContext(`krRefreshHolidays()`, ctx2)).status, 'ok');
  const n = calls;
  assert.equal(J(await vm.runInContext(`krRefreshHolidays()`, ctx2)).status, 'fresh');
  assert.equal(calls, n);
  // 응답이 오지 않는 서버: abort 신호로 reject → 예외 없이 error
  const hang = (url, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const ctx3 = load({ fetch: hang, navigator: { onLine: true } });
  ctx3.setTimeout = fn => setTimeout(fn, 5);   // 타임아웃(8초)을 5ms 로 단축해 abort 경로를 검사
  const r = J(await vm.runInContext(`krRefreshHolidays({ force: true })`, ctx3));
  assert.equal(r.status, 'error');
});

test('손상된 캐시/저장소 오류는 무시하고 기본 데이터로 동작', () => {
  const ctx = load();
  ctx.__store.set('feedcalc_v4_kr_holidays', '{not json');
  assert.equal(run(ctx, `krApplyCachedHolidays()`), false);
  ctx.__store.set('feedcalc_v4_kr_holidays', JSON.stringify({ payload: { schema: 1, years: { 2026: { '2026-01-01': '<b>x</b>' } } } }));
  assert.equal(run(ctx, `krApplyCachedHolidays()`), false);            // 검증 실패 캐시는 적용 안 함
  const broken = load({ localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  assert.equal(run(broken, `krApplyCachedHolidays()`), false);
  assert.deepEqual(run(broken, `krDayClasses('2026-10-09')`), ['is-holiday']);
});
