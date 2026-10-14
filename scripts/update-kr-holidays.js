#!/usr/bin/env node
'use strict';
// 대한민국 공휴일 데이터 갱신 스크립트 — 공식 API 응답을 검증한 뒤 data/kr-holidays.json 에만 반영한다.
//
// 출처: 한국천문연구원(KASI) 특일 정보 — 공공데이터포털 "한국천문연구원_특일 정보" getRestDeInfo(공휴일 정보)
//       https://www.data.go.kr/data/15012690/openapi.do  (법정공휴일·대체공휴일·선거일·임시공휴일 포함)
// 인증: 공공데이터포털 서비스키 필요(없으면 401 SERVICE_KEY_IS_NULL). 키는 환경변수 KASI_SERVICE_KEY 로만 받는다.
//       키를 브라우저 코드에 넣으면 모든 사용자에게 노출/호출한도 공유가 되므로, 이 스크립트는 관리자 PC/CI 에서만 돌린다.
//       (이 API 는 CORS 를 허용하지만 키가 필요해 브라우저 직접 호출은 하지 않는다 — js/kr-holidays.js 는 같은 사이트의
//        data/kr-holidays.json 만 읽는다.)
//
// 사용:  KASI_SERVICE_KEY=발급키 node scripts/update-kr-holidays.js [--years 2027,2028] [--dry-run] [--out data/kr-holidays.json]
//        (기본: 올해~내후년. 개발계정 일일 1,000회 제한 — 1년 = 12회 호출)
//
// 검증(통과한 연도만 파일에 반영, 하나라도 어긋나면 그 연도는 건드리지 않고 사유를 출력):
//  · 응답 구조/결과코드/날짜 형식/isHoliday=Y/이름 길이
//  · 독립 규칙 계산(scripts/lib/kr-holiday-rules.js: 고정일 + 한국 음력 + 대체공휴일 규칙)과 날짜 집합이 같아야 한다.
//    규칙에 없는 날은 이름에 "선거"/"임시"가 있는 선거일·임시공휴일만 허용(그 외는 규칙 변경 가능성 → 사람이 확인 후 규칙 수정).
//  · 응답이 비어 있는 연도(아직 미공표)는 건너뛴다.
// 종료 코드: 0 정상(반영/변경 없음/미공표), 1 사용법·키·네트워크 오류, 2 검증 실패 연도 있음.

const fs = require('node:fs');
const path = require('node:path');
const { generateKrHolidays } = require('./lib/kr-holiday-rules.js');

const KASI_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const DEFAULT_OUT = path.resolve(__dirname, '..', 'data', 'kr-holidays.json');
const EXTRA_NAME = /선거|임시/;   // 규칙 밖 날짜로 허용하는 지정 공휴일 이름 패턴

const p2 = n => String(n).padStart(2, '0');
const maskKey = m => String(m).replace(/serviceKey=[^&\s]+/gi, 'serviceKey=***');   // 오류 메시지에 URL 이 섞여도 인증키는 노출하지 않는다
function cleanName(s) { return String(s).replace(/\s+/g, ' ').trim().slice(0, 40); }
function isRealDate(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }

// KASI JSON 응답 → { date: name }. 구조가 다르면 예외. items 가 ""(없음)/단일 객체/배열인 경우 모두 처리.
function parseKasiResponse(json, expectYear) {
  const resp = json && json.response;
  if (!resp || !resp.header) throw new Error('응답 형식 오류(response.header 없음)');
  if (String(resp.header.resultCode) !== '00') throw new Error(`API 오류 ${resp.header.resultCode}: ${resp.header.resultMsg || ''}`);
  const items = resp.body && resp.body.items;
  const list = !items ? [] : Array.isArray(items.item) ? items.item : items.item ? [items.item] : [];
  const out = {};
  for (const it of list) {
    const loc = String(it.locdate || '');
    if (!/^\d{8}$/.test(loc)) throw new Error(`locdate 형식 오류: ${loc}`);
    const y = +loc.slice(0, 4), m = +loc.slice(4, 6), d = +loc.slice(6, 8);
    if (!isRealDate(y, m, d)) throw new Error(`존재하지 않는 날짜: ${loc}`);
    if (expectYear && y !== expectYear) throw new Error(`요청 연도(${expectYear})와 다른 날짜: ${loc}`);
    if (it.isHoliday !== 'Y') continue;                       // 기념일(isHoliday=N)은 공휴일이 아님
    const name = cleanName(it.dateName);
    if (!name) throw new Error(`공휴일 이름 없음: ${loc}`);
    const date = `${y}-${p2(m)}-${p2(d)}`;
    out[date] = out[date] ? `${out[date]}·${name}` : name;    // 같은 날짜가 여러 이름이면 합친다
  }
  return out;
}

async function fetchMonth(year, month, key, fetchImpl, { timeoutMs = 15000, retries = 2, retryDelayMs = 500 } = {}) {
  const params = new URLSearchParams({ solYear: String(year), solMonth: p2(month), numOfRows: '50', pageNo: '1', _type: 'json' });
  const url = `${KASI_URL}?serviceKey=${key}&${params}`;   // serviceKey 는 이미 인코딩된 값을 그대로 붙인다(이중 인코딩 방지)
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      clearTimeout(t);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) { const e = new Error(`HTTP ${res.status}(인증키/요청 확인)`); e.fatal = true; throw e; }
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch (e) { const er = new Error('JSON 이 아닌 응답(인증키/서비스 신청 상태 확인)'); er.fatal = true; throw er; }
      return parseKasiResponse(json, year);
    } catch (e) {
      lastErr = e;
      if (e.fatal || /API 오류|형식 오류|존재하지 않는|요청 연도|이름 없음/.test(e.message)) throw e;   // 재시도해도 소용없는 오류
      if (attempt < retries) await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
  throw new Error(`네트워크/서버 오류: ${maskKey(lastErr && lastErr.message)}`);
}

async function fetchYear(year, key, fetchImpl, opts) {
  const merged = {};
  for (let m = 1; m <= 12; m++) Object.assign(merged, await fetchMonth(year, m, key, fetchImpl, opts));
  return merged;
}

// 응답(date→name) vs 독립 규칙 계산 비교. 반환 { ok, reason?, holidays?, extras? }
function validateYear(year, kasi) {
  const dates = Object.keys(kasi);
  if (!dates.length) return { ok: true, empty: true };
  const base = generateKrHolidays(year, {});
  const unknown = dates.filter(d => !(d in base));
  const extras = {};
  const bad = [];
  unknown.forEach(d => { if (EXTRA_NAME.test(kasi[d])) extras[d] = kasi[d]; else bad.push(d); });
  const pred = generateKrHolidays(year, extras);
  const missing = Object.keys(pred).filter(d => !(d in kasi));
  if (bad.length || missing.length) {
    return { ok: false, reason: `규칙과 불일치 — API에만 있음: [${bad.map(d => `${d} ${kasi[d]}`).join(', ')}] / API에 없음: [${missing.map(d => `${d} ${pred[d]}`).join(', ')}]` };
  }
  if (dates.length < 12 || dates.length > 40) return { ok: false, reason: `공휴일 수 이상(${dates.length}일)` };
  return { ok: true, holidays: Object.fromEntries(dates.sort().map(d => [d, kasi[d]])), extras };
}

function readData(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && j.schema === 1 && j.years ? j : null; } catch (e) { return null; }
}

// 핵심 로직(테스트용으로 fetch/파일 시스템/시간을 주입 가능). 반환 { updated:[연도], rejected:{연도:사유}, skipped:[연도], changed }
async function updateData({ key, years, out = DEFAULT_OUT, dryRun = false, fetchImpl = globalThis.fetch, now = new Date(), log = () => {}, fetchOpts } = {}) {
  if (!key) throw new Error('KASI_SERVICE_KEY 환경변수(공공데이터포털 서비스키)가 필요합니다.');
  const k = /%/.test(key) ? key : encodeURIComponent(key);     // 디코딩된 키가 들어와도 안전하게 인코딩
  const existing = readData(out) || { schema: 1, years: {} };
  const result = { updated: [], rejected: {}, skipped: [], changed: false };
  const next = { ...existing, schema: 1, years: { ...existing.years } };
  for (const year of years) {
    let kasi;
    try { kasi = await fetchYear(year, k, fetchImpl, fetchOpts); }
    catch (e) { if (/네트워크|HTTP|JSON 이 아닌|형식 오류|API 오류/.test(e.message)) { const err = new Error(`${year}년 조회 실패: ${e.message}`); err.cause = e; throw err; } throw e; }
    const v = validateYear(year, kasi);
    if (v.empty) { result.skipped.push(year); log(`${year}: 아직 공표된 공휴일 데이터가 없어 건너뜀`); continue; }
    if (!v.ok) { result.rejected[year] = v.reason; log(`${year}: 검증 실패 — ${v.reason}`); continue; }
    const prev = JSON.stringify(existing.years[year] || null);
    if (prev !== JSON.stringify(v.holidays)) { next.years[year] = v.holidays; result.updated.push(year); log(`${year}: 갱신(${Object.keys(v.holidays).length}일)`); }
    else log(`${year}: 변경 없음`);
  }
  if (result.updated.length) {
    next.source = '한국천문연구원 특일 정보(공공데이터포털 getRestDeInfo) — scripts/update-kr-holidays.js 로 검증 후 반영';
    next.generatedAt = now.toISOString();
    next.years = Object.fromEntries(Object.keys(next.years).sort().map(y => [y, next.years[y]]));
    result.changed = true;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = out + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, out);                                  // 원자적 교체 — 중간에 깨진 파일이 남지 않는다
    }
  }
  return result;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const nowYear = new Date().getFullYear();
  const years = arg('--years') ? arg('--years').split(',').map(s => parseInt(s, 10)).filter(y => y >= 2000 && y <= 2100) : [nowYear, nowYear + 1, nowYear + 2];
  if (!years.length) { console.error('--years 값이 올바르지 않습니다(예: --years 2027,2028)'); return 1; }
  try {
    const r = await updateData({ key: env.KASI_SERVICE_KEY, years, out: arg('--out') ? path.resolve(arg('--out')) : DEFAULT_OUT, dryRun: argv.includes('--dry-run'), log: m => console.log(m) });
    console.log(r.changed ? (argv.includes('--dry-run') ? `(dry-run) 갱신 대상: ${r.updated.join(', ')}` : `data/kr-holidays.json 갱신: ${r.updated.join(', ')} — 확인 후 커밋/배포하세요.`) : '변경 사항 없음.');
    if (Object.keys(r.rejected).length) { console.error(`검증 실패 연도(반영 안 함): ${Object.keys(r.rejected).join(', ')}`); return 2; }
    return 0;
  } catch (e) { console.error(maskKey(e.message)); return 1; }
}

module.exports = { parseKasiResponse, fetchMonth, fetchYear, validateYear, updateData, main, KASI_URL };
if (require.main === module) main().then(code => process.exit(code));
