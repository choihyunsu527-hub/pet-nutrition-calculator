// ── 대한민국 공휴일 데이터 + 달력 날짜 색상 공통 로직 ────────────────────────────────────
// 대시보드 달력(js/ui.js renderDashCalendar)과 캘린더 탭(js/dash-schedule.js renderCalendarTab)이 같은 함수
// krDayClasses()/krHolidayTitleAttr()를 써서 날짜 숫자 색(일요일·공휴일 = 빨강)을 정한다. 토요일은 기존 색 그대로.
//
// ▶ 유지보수/갱신: 이 파일의 KR_HOLIDAYS 표는 "기본 데이터(baseline)"로 항상 동작한다. 표에 없는 날짜는 빨갛게 표시하지 않는다.
//   · 자동 갱신: 같은 사이트의 data/kr-holidays.json 을 읽어(아래 krRefreshHolidays) 엄격히 검증한 연도만 덮어쓴다.
//     그 JSON 은 scripts/update-kr-holidays.js 가 공식 API(한국천문연구원 특일 정보)를 검증해 만든다 — 브라우저는 API 키를 갖지 않는다.
//     갱신이 실패(오프라인/오류/형식 불일치/검증 실패)해도 아래 표 그대로 동작하고 일정·달력 기능에는 영향이 없다.
//   · 직접 수정: 급히 임시공휴일이 지정되면 이 표에 한 줄 추가해도 된다(이름에 "임시공휴일" 등 표기).
//   · 표는 tests/dash-schedule-holidays.test.js 가 규칙 기반 독립 계산(고정일 + 한국 음력 + 대체공휴일 규칙)과
//     비교 검증한다. 표를 고치면 테스트의 EXTRAS(선거일/임시공휴일)도 같이 맞춰야 한다.
//   · 규칙(2024~): 노동절 5/1·제헌절 7/17 은 2026년부터 공휴일. 설날·추석 연휴는 일요일/다른 공휴일과 겹치면,
//     어린이날·삼일절·노동절·부처님오신날·제헌절·광복절·개천절·한글날·성탄절은 토/일요일/다른 공휴일과 겹치면
//     다음 첫 평일이 대체공휴일. 신정·현충일·선거일에는 대체공휴일 없음.
//   · 출처: 인사혁신처 관공서의 공휴일에 관한 규정·월력요항(2026~2028 공개 목록 대조), 음력 변환은 한국 음력(KST) 기준.
//   · 지원 연도 밖(2023 이전, 2029 이후)은 데이터가 없으므로 일요일만 빨갛게 표시한다.
const KR_HOLIDAY_YEARS = { from: 2024, to: 2028 };   // 데이터가 있는 연도 범위(자동 갱신으로 늘어날 수 있음)
const KR_HOLIDAYS = {
  // 2024
  '2024-01-01': '신정',   // 월
  '2024-02-09': '설날 연휴',   // 금
  '2024-02-10': '설날',   // 토
  '2024-02-11': '설날 연휴',   // 일
  '2024-02-12': '대체공휴일(설날)',   // 월
  '2024-03-01': '삼일절',   // 금
  '2024-04-10': '국회의원선거일',   // 수
  '2024-05-05': '어린이날',   // 일
  '2024-05-06': '대체공휴일(어린이날)',   // 월
  '2024-05-15': '부처님오신날',   // 수
  '2024-06-06': '현충일',   // 목
  '2024-08-15': '광복절',   // 목
  '2024-09-16': '추석 연휴',   // 월
  '2024-09-17': '추석',   // 화
  '2024-09-18': '추석 연휴',   // 수
  '2024-10-01': '임시공휴일(국군의날)',   // 화
  '2024-10-03': '개천절',   // 목
  '2024-10-09': '한글날',   // 수
  '2024-12-25': '성탄절',   // 수
  // 2025
  '2025-01-01': '신정',   // 수
  '2025-01-27': '임시공휴일',   // 월
  '2025-01-28': '설날 연휴',   // 화
  '2025-01-29': '설날',   // 수
  '2025-01-30': '설날 연휴',   // 목
  '2025-03-01': '삼일절',   // 토
  '2025-03-03': '대체공휴일(삼일절)',   // 월
  '2025-05-05': '어린이날·부처님오신날',   // 월
  '2025-05-06': '대체공휴일(어린이날)',   // 화
  '2025-06-03': '대통령선거일',   // 화
  '2025-06-06': '현충일',   // 금
  '2025-08-15': '광복절',   // 금
  '2025-10-03': '개천절',   // 금
  '2025-10-05': '추석 연휴',   // 일
  '2025-10-06': '추석',   // 월
  '2025-10-07': '추석 연휴',   // 화
  '2025-10-08': '대체공휴일(추석)',   // 수
  '2025-10-09': '한글날',   // 목
  '2025-12-25': '성탄절',   // 목
  // 2026
  '2026-01-01': '신정',   // 목
  '2026-02-16': '설날 연휴',   // 월
  '2026-02-17': '설날',   // 화
  '2026-02-18': '설날 연휴',   // 수
  '2026-03-01': '삼일절',   // 일
  '2026-03-02': '대체공휴일(삼일절)',   // 월
  '2026-05-01': '노동절',   // 금
  '2026-05-05': '어린이날',   // 화
  '2026-05-24': '부처님오신날',   // 일
  '2026-05-25': '대체공휴일(부처님오신날)',   // 월
  '2026-06-03': '지방선거일',   // 수
  '2026-06-06': '현충일',   // 토
  '2026-07-17': '제헌절',   // 금
  '2026-08-15': '광복절',   // 토
  '2026-08-17': '대체공휴일(광복절)',   // 월
  '2026-09-24': '추석 연휴',   // 목
  '2026-09-25': '추석',   // 금
  '2026-09-26': '추석 연휴',   // 토
  '2026-10-03': '개천절',   // 토
  '2026-10-05': '대체공휴일(개천절)',   // 월
  '2026-10-09': '한글날',   // 금
  '2026-12-25': '성탄절',   // 금
  // 2027
  '2027-01-01': '신정',   // 금
  '2027-02-06': '설날 연휴',   // 토
  '2027-02-07': '설날',   // 일
  '2027-02-08': '설날 연휴',   // 월
  '2027-02-09': '대체공휴일(설날)',   // 화
  '2027-03-01': '삼일절',   // 월
  '2027-05-01': '노동절',   // 토
  '2027-05-03': '대체공휴일(노동절)',   // 월
  '2027-05-05': '어린이날',   // 수
  '2027-05-13': '부처님오신날',   // 목
  '2027-06-06': '현충일',   // 일
  '2027-07-17': '제헌절',   // 토
  '2027-07-19': '대체공휴일(제헌절)',   // 월
  '2027-08-15': '광복절',   // 일
  '2027-08-16': '대체공휴일(광복절)',   // 월
  '2027-09-14': '추석 연휴',   // 화
  '2027-09-15': '추석',   // 수
  '2027-09-16': '추석 연휴',   // 목
  '2027-10-03': '개천절',   // 일
  '2027-10-04': '대체공휴일(개천절)',   // 월
  '2027-10-09': '한글날',   // 토
  '2027-10-11': '대체공휴일(한글날)',   // 월
  '2027-12-25': '성탄절',   // 토
  '2027-12-27': '대체공휴일(성탄절)',   // 월
  // 2028
  '2028-01-01': '신정',   // 토
  '2028-01-26': '설날 연휴',   // 수
  '2028-01-27': '설날',   // 목
  '2028-01-28': '설날 연휴',   // 금
  '2028-03-01': '삼일절',   // 수
  '2028-04-12': '국회의원선거일',   // 수
  '2028-05-01': '노동절',   // 월
  '2028-05-02': '부처님오신날',   // 화
  '2028-05-05': '어린이날',   // 금
  '2028-06-06': '현충일',   // 화
  '2028-07-17': '제헌절',   // 월
  '2028-08-15': '광복절',   // 화
  '2028-10-02': '추석 연휴',   // 월
  '2028-10-03': '개천절·추석',   // 화
  '2028-10-04': '추석 연휴',   // 수
  '2028-10-05': '대체공휴일(추석)',   // 목
  '2028-10-09': '한글날',   // 월
  '2028-12-25': '성탄절',   // 월
};

const KR_HOLIDAYS_BASELINE = Object.freeze({ ...KR_HOLIDAYS });   // 갱신 데이터 검증의 기준(최소한 이 날짜들은 모두 포함해야 한다)

// 요일(0=일)은 로컬 시간대와 무관하게 UTC 날짜 계산으로 구한다.
function krWeekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function krHolidayName(ymd) {
  return Object.prototype.hasOwnProperty.call(KR_HOLIDAYS, ymd) ? KR_HOLIDAYS[ymd] : null;
}
// 달력 칸 공통: 일요일 'is-sun', 공휴일(대체공휴일·임시공휴일 포함) 'is-holiday' 클래스 목록
function krDayClasses(ymd) {
  const cls = [];
  if (krWeekday(ymd) === 0) cls.push('is-sun');
  if (krHolidayName(ymd)) cls.push('is-holiday');
  return cls;
}
// 공휴일 날짜 숫자의 툴팁(공휴일 이름). 공휴일이 아니면 빈 문자열.
function krHolidayTitleAttr(ymd) {
  const name = krHolidayName(ymd);
  return name ? ` title="${typeof escHtml === 'function' ? escHtml(name) : name}"` : '';
}

// ── 자동 갱신: data/kr-holidays.json (공식 API → scripts/update-kr-holidays.js 로 검증·생성) ─────────────────
// 형식: { schema: 1, source, generatedAt, years: { "2027": { "2027-01-01": "신정", ... }, ... } }
// 원칙: ① 어떤 오류도 예외로 밖에 나가지 않는다 ② 검증을 통과한 연도만 반영한다 ③ 실패하면 기존 데이터 그대로
//       ④ 확인되지 않은 날짜를 임의로 공휴일 처리하지 않는다(데이터에 있는 날짜만).
const KR_HOLIDAY_DATA_URL = 'data/kr-holidays.json';
const KR_HOLIDAY_CACHE_KEY = 'feedcalc_v4_kr_holidays';            // 마지막으로 검증 통과한 payload + 확인 시각
const KR_HOLIDAY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;           // 서버 확인 최소 간격(6시간)
const KR_HOLIDAY_FETCH_TIMEOUT_MS = 8000;
const KR_HOLIDAY_MAX_BYTES = 200000;
const KR_REQUIRED_MD = ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'];   // 매년 반드시 있는 고정 공휴일
const KR_MAX_ADDED_PER_YEAR = 3;                                   // 기본 데이터 연도에 새로 추가될 수 있는 날(임시공휴일/선거일) 상한

function krIsRealDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// 한 연도 검증 → { map } 또는 { reason }
function krCheckHolidayYear(yearKey, obj) {
  if (!/^\d{4}$/.test(yearKey) || +yearKey < 2000 || +yearKey > 2100) return { reason: '연도 형식/범위' };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { reason: '연도 데이터가 객체가 아님' };
  const keys = Object.keys(obj);
  if (keys.length < 8 || keys.length > 40) return { reason: `공휴일 수 이상(${keys.length}일)` };
  const map = {};
  for (const d of keys) {
    if (!krIsRealDate(d) || d.slice(0, 4) !== yearKey) return { reason: `날짜 오류: ${d}` };
    const name = typeof obj[d] === 'string' ? obj[d].replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > 40 || /[\u0000-\u001f<>]/.test(name)) return { reason: `이름 오류: ${d}` };
    map[d] = name;
  }
  for (const md of KR_REQUIRED_MD) if (!(yearKey + '-' + md in map)) return { reason: `필수 공휴일 누락: ${md}` };
  const base = Object.keys(KR_HOLIDAYS_BASELINE).filter(d => d.startsWith(yearKey + '-'));
  if (base.length) {   // 기본 데이터가 있는 연도: 기본 날짜를 모두 포함해야 하고 추가는 소수만 허용(손상/오염 방지)
    const lost = base.filter(d => !(d in map));
    if (lost.length) return { reason: `기본 데이터의 공휴일 누락: ${lost.join(', ')}` };
    if (keys.length - base.length > KR_MAX_ADDED_PER_YEAR) return { reason: '기본 데이터 대비 추가된 날이 너무 많음' };
  }
  return { map };
}

// payload 전체 검증 → { years: {연도: {날짜: 이름}}(통과한 연도만), rejected: {연도: 사유}, error: 문자열|null }
function krValidateHolidayPayload(payload) {
  const out = { years: {}, rejected: {}, error: null };
  if (!payload || typeof payload !== 'object' || payload.schema !== 1 || !payload.years || typeof payload.years !== 'object' || Array.isArray(payload.years)) {
    out.error = '형식 오류(schema/years)';
    return out;
  }
  const keys = Object.keys(payload.years);
  if (!keys.length || keys.length > 20) { out.error = '연도 수 이상'; return out; }
  keys.forEach(yk => {
    const r = krCheckHolidayYear(yk, payload.years[yk]);
    if (r.map) out.years[yk] = r.map; else out.rejected[yk] = r.reason;
  });
  return out;
}

// 검증을 통과한 연도 데이터를 현재 표에 반영한다(해당 연도 항목을 통째로 교체). 변경이 있으면 true.
function krApplyHolidayYears(years) {
  let changed = false;
  Object.keys(years).forEach(y => {
    const next = years[y];
    const cur = Object.keys(KR_HOLIDAYS).filter(d => d.startsWith(y + '-'));
    const nextKeys = Object.keys(next);
    if (cur.length === nextKeys.length && cur.every(d => KR_HOLIDAYS[d] === next[d])) return;
    cur.forEach(d => { delete KR_HOLIDAYS[d]; });
    Object.assign(KR_HOLIDAYS, next);
    changed = true;
  });
  const ys = Object.keys(KR_HOLIDAYS).map(d => +d.slice(0, 4));
  if (ys.length) { KR_HOLIDAY_YEARS.from = Math.min(...ys); KR_HOLIDAY_YEARS.to = Math.max(...ys); }
  return changed;
}

function krReadHolidayCache() {
  try {
    const c = JSON.parse(localStorage.getItem(KR_HOLIDAY_CACHE_KEY) || 'null');
    return c && typeof c === 'object' && c.payload ? c : null;
  } catch (e) { return null; }
}
function krWriteHolidayCache(payload) {
  try { localStorage.setItem(KR_HOLIDAY_CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), payload })); } catch (e) { /* 저장 실패는 무시 */ }
}
// 달력 화면이 이미 그려져 있으면 새 공휴일로 다시 그린다(일정 데이터/기능에는 손대지 않는다).
function krRerenderCalendars() {
  try {
    if (typeof renderDashCalendar === 'function') renderDashCalendar();
    if (typeof renderCalendarTab === 'function') renderCalendarTab();
  } catch (e) { /* 표시 갱신 실패가 다른 기능에 영향 주지 않게 */ }
}

// 마지막으로 검증된 캐시 적용(동기) — 로드 직후 오프라인이어도 최신 데이터 사용. 변경 여부 반환.
function krApplyCachedHolidays() {
  try {
    const c = krReadHolidayCache();
    if (!c) return false;
    return krApplyHolidayYears(krValidateHolidayPayload(c.payload).years);
  } catch (e) { return false; }
}

// 서버(data/kr-holidays.json) 확인 → 검증 → 반영. 절대 예외를 던지지 않고 상태 객체를 돌려준다.
// status: 'ok' | 'fresh'(간격 내라 생략) | 'offline' | 'unsupported' | 'http-xxx' | 'too-large' | 'invalid-json' | 'invalid' | 'error'
async function krRefreshHolidays(opts) {
  const force = !!(opts && opts.force);
  try {
    if (typeof fetch !== 'function') return { status: 'unsupported' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'offline' };
    const cache = krReadHolidayCache();
    if (!force && cache && Date.now() - (cache.checkedAt || 0) < KR_HOLIDAY_CHECK_INTERVAL_MS) return { status: 'fresh' };
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), KR_HOLIDAY_FETCH_TIMEOUT_MS) : null;
    let res;
    try { res = await fetch(KR_HOLIDAY_DATA_URL, { cache: 'no-cache', credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined }); }
    finally { if (timer) clearTimeout(timer); }
    if (!res.ok) return { status: 'http-' + res.status };
    const text = await res.text();
    if (text.length > KR_HOLIDAY_MAX_BYTES) return { status: 'too-large' };
    let payload;
    try { payload = JSON.parse(text); } catch (e) { return { status: 'invalid-json' }; }   // 파일이 없을 때 index.html 이 돌아오는 경우 등
    const v = krValidateHolidayPayload(payload);
    if (v.error || !Object.keys(v.years).length) return { status: 'invalid', error: v.error, rejected: v.rejected };
    const changed = krApplyHolidayYears(v.years);
    // 캐시 = 직전에 검증된 연도 + 이번에 검증 통과한 연도(이번 응답에서 거부된 연도는 마지막 정상 데이터를 그대로 보존)
    const merged = {};
    if (cache) { const pv = krValidateHolidayPayload(cache.payload); Object.keys(pv.years).forEach(y => { merged[y] = pv.years[y]; }); }
    Object.keys(v.years).forEach(y => { merged[y] = v.years[y]; });
    krWriteHolidayCache({ schema: 1, source: payload.source, generatedAt: payload.generatedAt, years: merged });
    if (changed) krRerenderCalendars();
    return { status: 'ok', changed, rejected: v.rejected };
  } catch (e) {
    return { status: 'error' };
  }
}

// 로드 시: 캐시된(검증 통과) 데이터를 먼저 적용하고, 페이지가 뜬 뒤 백그라운드로 서버 확인.
try { krApplyCachedHolidays(); } catch (e) { /* 기본 데이터로 계속 */ }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('load', () => { setTimeout(() => { krRefreshHolidays().catch(() => {}); }, 2000); });
}
