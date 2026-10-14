'use strict';
// scripts/update-kr-holidays.js — 공식 API(한국천문연구원 특일 정보) 응답 파싱·검증·반영 로직 테스트.
// 실제 API 는 서비스키가 필요해 호출하지 않는다 — 문서화된 응답 형식(response.header/body.items.item)을 흉내 낸 모의 fetch 로 검증한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKrHolidays } = require('../scripts/lib/kr-holiday-rules.js');
const U = require('../scripts/update-kr-holidays.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'krhol-'));
const p2 = n => String(n).padStart(2, '0');
const yearMap = (y, extras = {}) => generateKrHolidays(y, extras);
const FAST = { timeoutMs: 1000, retries: 2, retryDelayMs: 1 };

// 연도별 {date: name} → KASI 월별 응답을 돌려주는 fetch (items 가 0건이면 "", 1건이면 객체, 여러 건이면 배열 — 실제 API 의 변덕을 흉내)
function kasiFetch(yearMaps, { log = [], failures = {} } = {}) {
  return async (url) => {
    log.push(url);
    const u = new URL(url);
    const year = +u.searchParams.get('solYear'), month = +u.searchParams.get('solMonth');
    const key = `${year}-${p2(month)}`;
    if (failures[key]) return failures[key]();
    const map = yearMaps[year] || {};
    const items = Object.entries(map).filter(([d]) => d.startsWith(key)).map(([d, name], i) => ({ dateKind: '01', dateName: name, isHoliday: 'Y', locdate: +d.replace(/-/g, ''), seq: i + 1 }));
    const body = { items: items.length === 0 ? '' : { item: items.length === 1 ? items[0] : items }, numOfRows: 50, pageNo: 1, totalCount: items.length };
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body } }) };
  };
}

test('parseKasiResponse: 배열/단일 객체/빈 items, 기념일(N) 제외, 같은 날짜 이름 합치기', () => {
  const wrap = items => ({ response: { header: { resultCode: '00' }, body: { items } } });
  assert.deepEqual(U.parseKasiResponse(wrap(''), 2026), {});
  assert.deepEqual(U.parseKasiResponse(wrap({ item: { dateName: '신정', isHoliday: 'Y', locdate: 20260101 } }), 2026), { '2026-01-01': '신정' });
  assert.deepEqual(U.parseKasiResponse(wrap({ item: [
    { dateName: '어린이날', isHoliday: 'Y', locdate: 20260505 }, { dateName: '부처님오신날', isHoliday: 'Y', locdate: 20260505 },
    { dateName: '입춘', isHoliday: 'N', locdate: 20260204 },
  ] }), 2026), { '2026-05-05': '어린이날·부처님오신날' });
});

test('parseKasiResponse: 형식 오류는 예외(결과코드/날짜 형식/존재하지 않는 날짜/다른 연도/이름 없음/구조)', () => {
  assert.doesNotThrow(() => U.parseKasiResponse({ response: { header: { resultCode: '00' }, body: { items: '' } } }, 2026));
  assert.throws(() => U.parseKasiResponse({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } }, 2026), /API 오류 30/);
  assert.throws(() => U.parseKasiResponse({}, 2026), /형식 오류/);
  assert.throws(() => U.parseKasiResponse(null, 2026), /형식 오류/);
  const item = it => ({ response: { header: { resultCode: '00' }, body: { items: { item: it } } } });
  assert.throws(() => U.parseKasiResponse(item({ dateName: 'x', isHoliday: 'Y', locdate: 2026101 }), 2026), /locdate/);
  assert.throws(() => U.parseKasiResponse(item({ dateName: 'x', isHoliday: 'Y', locdate: 20260230 }), 2026), /존재하지 않는/);
  assert.throws(() => U.parseKasiResponse(item({ dateName: 'x', isHoliday: 'Y', locdate: 20270101 }), 2026), /요청 연도/);
  assert.throws(() => U.parseKasiResponse(item({ dateName: '  ', isHoliday: 'Y', locdate: 20260101 }), 2026), /이름 없음/);
});

test('validateYear: 규칙과 일치하면 통과, 선거일·임시공휴일은 이름 패턴으로 허용, 규칙 밖 공휴일·누락·이상 개수는 거부', () => {
  const base = yearMap(2026);
  assert.equal(U.validateYear(2026, base).ok, true);
  assert.equal(U.validateYear(2026, {}).empty, true);
  // 선거일(규칙에 없음) 허용: 이름에 "선거"
  const withElection = { ...base, '2026-06-03': '지방선거일' };
  const v = U.validateYear(2026, withElection);
  assert.equal(v.ok, true);
  assert.deepEqual(v.extras, { '2026-06-03': '지방선거일' });
  // 임시공휴일 허용
  assert.equal(U.validateYear(2026, { ...base, '2026-12-31': '임시공휴일' }).ok, true);
  // 이름이 패턴에 안 맞는 규칙 밖 날짜 → 거부(규칙 변경 가능성: 사람이 확인)
  const unknown = U.validateYear(2026, { ...base, '2026-11-11': '새 공휴일' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /API에만 있음.*2026-11-11/);
  // 규칙상 있어야 할 날이 API 에 없음(예: 대체공휴일 누락) → 거부
  const missing = { ...base }; delete missing['2026-03-02'];
  const m = U.validateYear(2026, missing);
  assert.equal(m.ok, false);
  assert.match(m.reason, /API에 없음.*2026-03-02/);
  // 제헌절은 2026년부터 — 2025 데이터에 7/17 이 있으면 규칙 밖이라 거부
  assert.equal(U.validateYear(2025, { ...yearMap(2025, { '2025-01-27': '임시공휴일', '2025-06-03': '대통령선거일' }), '2025-07-17': '제헌절' }).ok, false);
});

test('fetchYear/fetchMonth: 12개월 조회, 서비스키 인코딩(이중 인코딩 방지), 요청에 인증키가 URL에만 쓰임', async () => {
  const log = [];
  const map = yearMap(2026);
  const out = await U.fetchYear(2026, encodeURIComponent('abc+/=def'), kasiFetch({ 2026: map }, { log }), FAST);
  assert.deepEqual(out, map);
  assert.equal(log.length, 12);
  assert.ok(log[0].includes('serviceKey=abc%2B%2F%3Ddef&'));        // 이미 인코딩된 키는 그대로
  assert.ok(log[0].includes('solYear=2026') && log[0].includes('_type=json') && log[0].includes('numOfRows=50'));
});

test('updateData 성공: 검증 통과 연도만 JSON 에 병합 저장(정렬, 원자적 쓰기), 재실행은 변경 없음', async () => {
  const dir = tmp(); const out = path.join(dir, 'kr-holidays.json');
  fs.writeFileSync(out, JSON.stringify({ schema: 1, years: { 2024: yearMap(2024, { '2024-04-10': '국회의원선거일', '2024-10-01': '임시공휴일(국군의날)' }) } }));
  const maps = { 2026: yearMap(2026, { '2026-06-03': '지방선거일' }), 2027: yearMap(2027) };
  const logs = [];
  const r = await U.updateData({ key: 'K', years: [2026, 2027], out, fetchImpl: kasiFetch(maps), now: new Date('2026-10-14T00:00:00Z'), log: m => logs.push(m), fetchOpts: FAST });
  assert.deepEqual(r.updated, [2026, 2027]);
  assert.equal(r.changed, true);
  const file = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(file.years), ['2024', '2026', '2027']);          // 기존 연도 보존 + 정렬
  assert.deepEqual(file.years['2026'], Object.fromEntries(Object.entries(maps[2026]).sort()));
  assert.equal(file.generatedAt, '2026-10-14T00:00:00.000Z');
  assert.match(file.source, /한국천문연구원/);
  assert.deepEqual(fs.readdirSync(dir), ['kr-holidays.json']);                    // .tmp 잔여물 없음
  const before = fs.readFileSync(out, 'utf8');
  const r2 = await U.updateData({ key: 'K', years: [2026, 2027], out, fetchImpl: kasiFetch(maps), fetchOpts: FAST });
  assert.equal(r2.changed, false);
  assert.equal(fs.readFileSync(out, 'utf8'), before);
});

test('updateData: dry-run 은 파일을 쓰지 않고, 미공표(빈 응답) 연도는 건너뛰고, 검증 실패 연도는 건드리지 않는다', async () => {
  const dir = tmp(); const out = path.join(dir, 'k.json');
  const maps = { 2026: yearMap(2026, { '2026-06-03': '지방선거일' }), 2027: { ...yearMap(2027), '2027-11-11': '새 공휴일' } };   // 2027 은 규칙 밖 날짜 포함, 2028 은 빈 응답
  const dry = await U.updateData({ key: 'K', years: [2026], out, dryRun: true, fetchImpl: kasiFetch(maps), fetchOpts: FAST });
  assert.equal(dry.changed, true);
  assert.equal(fs.existsSync(out), false);
  const r = await U.updateData({ key: 'K', years: [2026, 2027, 2028], out, fetchImpl: kasiFetch(maps), fetchOpts: FAST });
  assert.deepEqual(r.updated, [2026]);
  assert.deepEqual(Object.keys(r.rejected), ['2027']);
  assert.deepEqual(r.skipped, [2028]);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8')).years), ['2026']);    // 거부/미공표 연도는 파일에 없음
});

test('updateData 오류: 키 없음/HTTP 401/JSON 아님/API 결과코드 오류/네트워크 오류는 예외(파일 미변경), 키는 메시지에 노출 안 됨', async () => {
  const dir = tmp(); const out = path.join(dir, 'k.json');
  await assert.rejects(U.updateData({ key: '', years: [2026], out }), /KASI_SERVICE_KEY/);
  const mk = fail => ({ key: 'SECRETKEY123', years: [2026], out, fetchOpts: FAST, fetchImpl: async () => fail() });
  const noKeyLeak = re => e => { assert.match(e.message, re); assert.ok(!e.message.includes('SECRETKEY123'), '오류 메시지에 서비스키 노출'); return true; };
  await assert.rejects(U.updateData(mk(() => ({ ok: false, status: 401, text: async () => '' }))), noKeyLeak(/HTTP 401/));
  await assert.rejects(U.updateData(mk(() => ({ ok: true, status: 200, text: async () => '<OpenAPI_ServiceResponse>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</OpenAPI_ServiceResponse>' }))), noKeyLeak(/JSON 이 아닌/));
  await assert.rejects(U.updateData(mk(() => ({ ok: true, status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED ERROR.' } } }) }))), noKeyLeak(/API 오류 30/));
  await assert.rejects(U.updateData(mk(() => { throw new TypeError('fetch failed https://x?serviceKey=SECRETKEY123'); })), noKeyLeak(/네트워크/));
  assert.equal(fs.existsSync(out), false);
});

test('fetchMonth: 5xx/네트워크 오류는 재시도 후 성공, 재시도 소진 시 실패', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n < 3) return { ok: false, status: 503, text: async () => '' }; return { ok: true, status: 200, text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: '' } } }) }; };
  assert.deepEqual(await U.fetchMonth(2026, 1, 'K', flaky, { timeoutMs: 1000, retries: 2, retryDelayMs: 1 }), {});
  assert.equal(n, 3);
  n = -10;
  await assert.rejects(U.fetchMonth(2026, 1, 'K', flaky, { timeoutMs: 1000, retries: 1, retryDelayMs: 1 }), /HTTP 503|네트워크/);
});

test('main: 키 없음/잘못된 --years 는 종료코드 1, 검증 실패 연도가 있으면 2, 정상 0 (실제 네트워크 호출 없음)', async () => {
  const origErr = console.error, origLog = console.log;
  const errs = [];
  console.error = m => errs.push(String(m)); console.log = () => {};
  const origFetch = globalThis.fetch;
  try {
    assert.equal(await U.main(['--years', '2027'], {}), 1);
    assert.match(errs.join('\n'), /KASI_SERVICE_KEY/);
    assert.equal(await U.main(['--years', 'abc'], { KASI_SERVICE_KEY: 'K' }), 1);
    // 검증 실패(규칙 밖 공휴일) → 2
    const dir = tmp(); const out = path.join(dir, 'k.json');
    globalThis.fetch = kasiFetch({ 2027: { ...yearMap(2027), '2027-11-11': '새 공휴일' } });
    assert.equal(await U.main(['--years', '2027', '--out', out], { KASI_SERVICE_KEY: 'K' }), 2);
    // 정상 → 0
    globalThis.fetch = kasiFetch({ 2027: yearMap(2027) });
    assert.equal(await U.main(['--years', '2027', '--out', out, '--dry-run'], { KASI_SERVICE_KEY: 'SECRETKEY123' }), 0);
    assert.ok(!errs.join('\n').includes('SECRETKEY123'));
  } finally { console.error = origErr; console.log = origLog; globalThis.fetch = origFetch; }
});
