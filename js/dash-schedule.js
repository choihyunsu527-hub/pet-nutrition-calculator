// ── 대시보드: 현장 공동 일정표 (Supabase 공동 일정) ───────────────────────────
// 대시보드 월간 캘린더(js/ui.js renderDashCalendar)에 일정 제목을 표시하고,
// 일정 추가/상세/수정/삭제 모달을 담당한다. 영양계산/배합/레시피 로직과 무관하다.
//
// 저장소: Supabase public.dash_schedules (supabase/sql/007_dash_schedules.sql)
//  · 로그인 사용자 전원이 같은 일정을 본다(RLS: authenticated 전체 허용, anon 차단).
//  · created_by/created_at은 DB 트리거가 현재 로그인 사용자/서버 시간으로 고정한다.
//  · 365일(created_at 기준) 초과 일정은 DB가 삭제한다 — pg_cron 매일 실행 +
//    안전장치로 조회 직전 rpc('purge_expired_dash_schedules') 호출.
//  · 화면은 메모리 캐시(dashSchedules)로 그리고, 대시보드 진입/저장/삭제 때마다 DB에서 다시 불러온다.
//
// 예전 localStorage(feedcalc_v4_dash_schedules) 일정은 로그인 후 1회 DB로 이전한다(legacy_id
// unique + on conflict do nothing으로 중복 방지). 원본 키는 삭제하지 않고 그대로 보존하며,
// 이전 성공 시각만 별도 키(…_migrated)에 기록한다.
// 기간 일정: end_date(종료일) 컬럼(supabase/sql/008_dash_schedules_date_range.sql). NULL = 하루짜리(기존 데이터 전부).
//  · 008 미적용 DB에서도 기존 일정이 그대로 보이도록, end_date 포함 조회가 컬럼 오류로 실패하면 end_date 없이 다시 조회한다.
// 생산 정보: product_name(제품명) / production_qty(수량) / production_unit(단위) 컬럼(supabase/sql/009_dash_schedules_production.sql).
//  · 모두 NULL 허용(기존 일정은 그대로). 메모(memo)·담당자(assignee)는 기존 컬럼을 그대로 쓴다.
//  · 009 미적용 DB에서는 조회가 컬럼 오류로 실패하면 해당 컬럼 없이 다시 조회하고(기존 일정 그대로 표시), 생산 정보를 입력해 저장하면 안내 문구를 보여 준다.
// 캐시 일정 형식: { id, title, date:'YYYY-MM-DD'(시작일), endDate:'YYYY-MM-DD'(종료일, 하루짜리는 date와 같음),
//                  start:'HH:MM'|'', end:'HH:MM'|'', owner, memo, product:'제품명'|'', qty:number|null, unit:'kg'|'', createdAt }
const DASH_SCHEDULE_KEY = 'feedcalc_v4_dash_schedules';                    // (레거시, 읽기 전용)
const DASH_SCHEDULE_MIGRATED_KEY = 'feedcalc_v4_dash_schedules_migrated';  // 레거시 이전 완료 시각
const DASH_SCHEDULE_TABLE = 'dash_schedules';
const DASH_SCHEDULE_COLS = 'id,schedule_date,title,start_time,end_time,assignee,memo,created_at';
const DASH_SCHEDULE_COLS_RANGE = DASH_SCHEDULE_COLS + ',end_date';
const DASH_SCHEDULE_COLS_PRODUCTION = ',product_name,production_qty,production_unit';
const DASH_SCHEDULE_COLS_WORK = ',work_types';
const DASH_SCHEDULE_WORK_TYPES = [['production', '생산'], ['packing', '포장'], ['shipping', '출고'], ['other', '기타']];   // [저장값, 표시명] — 폼 체크박스 순서와 동일
const DASH_SCHEDULE_UNITS = ['kg', 'g', '개', '박스', '포', 'L', 'mL'];   // 단위 선택 목록(폼 select와 동일)
const DASH_SCHEDULE_MAX_QTY = 999999999;
const DASH_SCHEDULE_MAX_SPAN_DAYS = 366;   // 종료일은 시작일로부터 최대 366일 뒤까지(DB 제약과 동일)
let dashScheduleHasEndDate = true;         // 008(end_date 컬럼) 적용 여부 — 조회 오류로 판별
let dashScheduleHasWorkTypes = true;       // 011(work_types 컬럼) 적용 여부 — 조회 오류로 판별
let dashScheduleHasProduction = true;      // 009(제품명/수량/단위 컬럼) 적용 여부 — 조회 오류로 판별

let dashSchedules = [];             // DB에서 불러온 공동 일정(메모리 캐시)
let dashScheduleLoading = null;     // 진행 중인 refresh Promise(중복 호출 방지)
let dashScheduleSaving = false;     // 저장 요청 진행 중(Enter 연타/중복 클릭 방지)
let dashScheduleEditingId = null;   // 폼 모달이 수정 중인 일정 id (null = 새 일정)
let dashScheduleDetailId = null;    // 상세 모달에 열려 있는 일정 id

function loadDashSchedules() {
  return dashSchedules;
}

// YYYY-MM-DD 문자열 날짜 계산 — 로컬 시간대/DST 영향 없이 UTC로만 다룬다.
function dashScheduleYmdToUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function dashScheduleAddDays(ymd, n) {
  const dt = new Date(dashScheduleYmdToUtc(ymd) + n * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function dashScheduleSpanDays(start, end) {   // end - start (일). 같은 날 = 0
  return Math.round((dashScheduleYmdToUtc(end) - dashScheduleYmdToUtc(start)) / 86400000);
}
// 시작일~종료일(포함)에 속한 모든 날짜. 종료일이 없거나 시작일보다 빠르면 시작일 하루만.
function dashScheduleDatesInRange(start, end) {
  const n = end && end > start ? Math.min(dashScheduleSpanDays(start, end), DASH_SCHEDULE_MAX_SPAN_DAYS) : 0;
  const out = [];
  for (let i = 0; i <= n; i++) out.push(dashScheduleAddDays(start, i));
  return out;
}

// 작업 유형 정규화: 알 수 없는 값 제거 + 고정 순서(생산→포장→출고→기타). 미선택 = []
function dashScheduleNormWorkTypes(v) {
  const arr = Array.isArray(v) ? v : [];
  return DASH_SCHEDULE_WORK_TYPES.map(([k]) => k).filter(k => arr.includes(k));
}
function formatDashScheduleWorkTypes(ev) {
  const arr = dashScheduleNormWorkTypes(ev.workTypes);
  return DASH_SCHEDULE_WORK_TYPES.filter(([k]) => arr.includes(k)).map(([, label]) => label).join('·');
}

function dashScheduleFromRow(r) {
  const hm = t => (t ? String(t).slice(0, 5) : '');
  return {
    id: r.id, title: r.title, date: r.schedule_date, endDate: r.end_date || r.schedule_date,
    start: hm(r.start_time), end: hm(r.end_time),
    owner: r.assignee || '', memo: r.memo || '',
    product: r.product_name || '',
    qty: r.production_qty === null || r.production_qty === undefined || r.production_qty === '' ? null : Number(r.production_qty),
    unit: r.production_unit || '',
    workTypes: dashScheduleNormWorkTypes(r.work_types),
    createdAt: Date.parse(r.created_at) || 0,
  };
}

// 생산 정보 표시: "제품명 · 1,200 kg" (없는 항목은 생략, 둘 다 없으면 빈 문자열)
function formatDashScheduleQty(ev) {
  return ev.qty === null || ev.qty === undefined || Number.isNaN(ev.qty) ? ''
    : `${ev.qty.toLocaleString('ko-KR', { maximumFractionDigits: 3 })}${ev.unit ? ' ' + ev.unit : ''}`;
}
function formatDashScheduleProduction(ev) {
  const work = formatDashScheduleWorkTypes(ev);
  return [work && `[${work}]`, ev.product, formatDashScheduleQty(ev)].filter(Boolean).join(' · ');
}
// 우측 패널용 작업 유형 색상 칩(미선택이면 빈 문자열)
function dashScheduleChipsHtml(ev) {
  const arr = dashScheduleNormWorkTypes(ev.workTypes);
  return arr.length ? `<span class="cal-day-chips">${DASH_SCHEDULE_WORK_TYPES.filter(([k]) => arr.includes(k))
    .map(([k, label]) => `<span class="cal-chip cal-chip-${k}">${label}</span>`).join('')}</span>` : '';
}
// 달력 날짜 칸 pill/막대에 보이는 텍스트: "생산·포장 | 일정명"(미선택이면 일정명만). 좁은 칸에서는 뒤쪽(제목)부터 말줄임 처리된다.
function dashScheduleCellLabel(ev) {
  const work = formatDashScheduleWorkTypes(ev);
  return work ? `${work} | ${ev.title}` : ev.title;
}
// 목록 항목 제목 아래 한 줄(제품명 · 수량) — 없으면 빈 문자열
function dashScheduleSubHtml(ev, cls) {
  const prod = formatDashScheduleProduction(ev);
  return prod ? `<small class="${cls}">${escHtml(prod)}</small>` : '';
}
// 달력 pill/막대 툴팁(title 속성): 일정명 + 생산 정보
function dashScheduleTip(ev) {
  const prod = formatDashScheduleProduction(ev);
  return prod ? `${ev.title} — ${prod}` : ev.title;
}

// Supabase 오류 → 사용자에게 보여줄 문장 (action: '불러오' | '저장' | '삭제')
function dashScheduleErrMsg(error, action) {
  const msg = (error && error.message) || '';
  if (/product_name|production_qty|production_unit/i.test(msg) && /column|schema cache|constraint/i.test(msg)) return '제품명/생산 수량을 저장하려면 DB 업데이트(supabase/sql/009_dash_schedules_production.sql 실행)가 필요합니다. 관리자에게 문의하세요.';
  if (/work_types/i.test(msg) && /column|schema cache|constraint/i.test(msg)) return '작업 유형(생산/포장/출고)을 저장하려면 DB 업데이트(supabase/sql/011_dash_schedules_work_types.sql 실행)가 필요합니다. 관리자에게 문의하세요.';
  if (/end_date/i.test(msg) && /column|schema cache/i.test(msg)) return '기간 일정을 저장하려면 DB 업데이트(supabase/sql/008_dash_schedules_date_range.sql 실행)가 필요합니다. 관리자에게 문의하세요.';
  if (/fetch|network|Load failed/i.test(msg)) return `서버에 연결하지 못해 일정을 ${action}지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.`;
  if (/JWT|auth|permission|row-level security/i.test(msg)) return `로그인이 만료되었거나 권한이 없어 일정을 ${action}지 못했습니다. 다시 로그인해 주세요.`;
  return `일정을 ${action}지 못했습니다. 잠시 후 다시 시도하세요.${msg ? ` (${msg})` : ''}`;
}

function setDashCalStatus(text, withRetry) {
  ['dash-cal-status', 'cal-tab-status'].forEach(id => {   // 대시보드 + 캘린더 탭 공용
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = !text;
    el.innerHTML = text ? `<span>${escHtml(text)}</span>` +
      (withRetry ? '<button type="button" class="dash-cal-nav-btn" onclick="refreshDashSchedules()">다시 시도</button>' : '') : '';
  });
}

// 예전 브라우저 localStorage 일정 → DB 1회 이전. 실패하면 플래그를 남기지 않아 다음 접속 때 재시도한다.
// 원본 localStorage 키는 지우지 않는다(데이터 보존).
async function migrateLegacyDashSchedules() {
  let legacy;
  try {
    if (localStorage.getItem(DASH_SCHEDULE_MIGRATED_KEY)) return;
    legacy = JSON.parse(localStorage.getItem(DASH_SCHEDULE_KEY) || '[]');
  } catch (e) { return; }
  if (!Array.isArray(legacy)) return;
  const hm = t => (/^\d{2}:\d{2}$/.test(t || '') ? t : null);
  const rows = legacy
    .filter(ev => ev && ev.id && typeof ev.title === 'string' && ev.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(ev.date || ''))
    .map(ev => {
      const start = hm(ev.start), end = hm(ev.end);
      return {
        legacy_id: String(ev.id), schedule_date: ev.date, title: ev.title.trim().slice(0, 200),
        start_time: start, end_time: (start && end && end < start) ? null : end,
        assignee: String(ev.owner || '').trim() || null, memo: String(ev.memo || '').trim() || null,
      };
    });
  if (rows.length) {
    const { error } = await supabaseClient.from(DASH_SCHEDULE_TABLE)
      .upsert(rows, { onConflict: 'legacy_id', ignoreDuplicates: true });
    if (error) { console.warn('[일정] 기존 브라우저 일정 이전 실패 — 다음 접속 때 재시도', error); return; }
  }
  try { localStorage.setItem(DASH_SCHEDULE_MIGRATED_KEY, new Date().toISOString()); } catch (e) {}
}

// DB에서 최신 공동 일정을 다시 불러와 캘린더를 다시 그린다(대시보드 진입/저장/삭제 시).
function refreshDashSchedules() {
  if (!supabaseClient || !currentUser) return Promise.resolve();
  if (dashScheduleLoading) return dashScheduleLoading;
  dashScheduleLoading = (async () => {
    try { await supabaseClient.rpc('purge_expired_dash_schedules'); } catch (e) {}   // 안전장치 — 실패해도 조회는 계속
    try { await migrateLegacyDashSchedules(); } catch (e) { console.warn('[일정] 이전 오류', e); }
    const query = cols => supabaseClient.from(DASH_SCHEDULE_TABLE).select(cols).order('schedule_date', { ascending: true });
    const cols = () => DASH_SCHEDULE_COLS + (dashScheduleHasEndDate ? ',end_date' : '') + (dashScheduleHasProduction ? DASH_SCHEDULE_COLS_PRODUCTION : '') + (dashScheduleHasWorkTypes ? DASH_SCHEDULE_COLS_WORK : '');
    let { data, error } = await query(cols());
    // 008/009/011 미적용 DB — 없는 컬럼을 빼고 다시 조회해 기존 일정만이라도 표시(최대 3번 재시도)
    for (let retry = 0; error && retry < 3; retry++) {
      const m = error.message || '';
      if (dashScheduleHasEndDate && /end_date/i.test(m)) dashScheduleHasEndDate = false;
      else if (dashScheduleHasProduction && /product_name|production_qty|production_unit/i.test(m)) dashScheduleHasProduction = false;
      else if (dashScheduleHasWorkTypes && /work_types/i.test(m)) dashScheduleHasWorkTypes = false;
      else break;
      ({ data, error } = await query(cols()));
    }
    if (error) { setDashCalStatus(dashScheduleErrMsg(error, '불러오'), true); return; }
    dashSchedules = (data || []).map(dashScheduleFromRow);
    setDashCalStatus('');
    renderDashCalendar();
    renderCalendarTab();
  })().catch(e => {
    setDashCalStatus(dashScheduleErrMsg(e, '불러오'), true);
  }).finally(() => { dashScheduleLoading = null; });
  return dashScheduleLoading;
}

// 날짜별 일정 목록 — 기간 일정은 포함된 모든 날짜에 들어간다. 시작 시간 있는 일정을 시간순으로 먼저, 시간 없는 일정은 등록순으로 뒤에.
function getDashSchedulesByDate() {
  const map = {};
  loadDashSchedules().forEach(ev => {
    dashScheduleDatesInRange(ev.date, ev.endDate).forEach(d => { (map[d] = map[d] || []).push(ev); });   // 기간 일정은 포함된 모든 날짜에 표시
  });
  Object.values(map).forEach(arr => arr.sort((a, b) => {
    if (!!a.start !== !!b.start) return a.start ? -1 : 1;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }));
  return map;
}

// ── 기간 일정 가로 막대 레이아웃 (대시보드 달력 + 캘린더 탭 공용) ─────────────────────
// 달력 그리드는 7열 × N주. 기간(여러 날) 일정은 날짜마다 따로 그리지 않고 "주(週) 단위 구간"마다
// 시작 칸~종료 칸에 걸친 하나의 막대로 그린다(그리드 항목을 grid-row/grid-column으로 겹쳐 배치).
//  · 한 주 안에서 겹치는 기간 일정은 줄(lane 0,1,2…)을 나눠 쌓는다(시작일 빠른 순 → 긴 일정 먼저 → 등록순).
//  · 막대는 maxLanes 줄까지만 그린다. 그리지 못한 일정은 그 날짜의 "+ N건"/건수 배지에 포함된다.
//  · info[date] = { lanes: 그 칸 위쪽에 막대가 차지하는 줄 수(하루짜리 일정/칸 높이 예약용), bars: 그 칸을 지나는 "그려진" 막대 수 }
function dashScheduleIsMulti(ev) {
  return !!ev.endDate && ev.endDate > ev.date;
}

function layoutDashCalendarBars(cells, maxLanes) {
  const multi = loadDashSchedules().filter(dashScheduleIsMulti);
  const bars = [];
  const info = {};
  cells.forEach(c => { info[c.date] = { lanes: 0, bars: 0 }; });
  for (let w = 0; w * 7 < cells.length; w++) {
    const first = cells[w * 7].date, last = cells[w * 7 + 6].date;
    const segs = multi.filter(ev => ev.date <= last && ev.endDate >= first)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
        (dashScheduleSpanDays(b.date, b.endDate) - dashScheduleSpanDays(a.date, a.endDate)) ||
        ((a.createdAt || 0) - (b.createdAt || 0)))
      .map(ev => {
        const s0 = ev.date < first ? first : ev.date, e0 = ev.endDate > last ? last : ev.endDate;
        return { ev, row: w + 1, c1: dashScheduleSpanDays(first, s0), c2: dashScheduleSpanDays(first, e0),
                 isStart: ev.date >= first, isEnd: ev.endDate <= last };
      });
    const laneUsed = [];   // laneUsed[lane] = [[c1, c2], …]
    segs.forEach(sg => {
      let lane = 0;
      while (laneUsed[lane] && laneUsed[lane].some(([a, b]) => !(sg.c2 < a || sg.c1 > b))) lane++;
      (laneUsed[lane] = laneUsed[lane] || []).push([sg.c1, sg.c2]);
      sg.lane = lane;
      if (lane >= maxLanes) return;   // 줄이 모자라 못 그림 → "+ N건"/배지에 포함
      bars.push(sg);
      for (let col = sg.c1; col <= sg.c2; col++) {
        const i = info[cells[w * 7 + col].date];
        i.lanes = Math.max(i.lanes, lane + 1);
        i.bars++;
      }
    });
  }
  return { bars, info };
}

// 막대 버튼 HTML — cls: 'dash-cal-evt dash-cal-bar'(대시보드) / 'cal-tab-bar'(캘린더 탭)
function dashCalBarsHtml(bars, cls) {
  return bars.map(b =>
    `<button type="button" class="${cls}${b.isStart ? ' is-start' : ''}${b.isEnd ? ' is-end' : ''}" data-sched-id="${escHtml(b.ev.id)}"` +
    ` title="${escHtml(dashScheduleTip(b.ev))}" style="grid-row:${b.row};grid-column:${b.c1 + 1} / ${b.c2 + 2};--lane:${b.lane}">${escHtml(dashScheduleCellLabel(b.ev))}</button>`
  ).join('');
}

function dashScheduleTodayYmd() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function formatDashScheduleDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

// 상세 모달용: 하루짜리는 기존 표시 그대로, 기간 일정은 "시작일 ~ 종료일"
function formatDashScheduleRange(ev) {
  return ev.endDate && ev.endDate > ev.date
    ? `${formatDashScheduleDate(ev.date)} ~ ${formatDashScheduleDate(ev.endDate)}`
    : formatDashScheduleDate(ev.date);
}

function formatDashScheduleTime(ev) {
  if (ev.start && ev.end) return `${ev.start} ~ ${ev.end}`;
  if (ev.start) return `${ev.start} ~`;
  if (ev.end) return `~ ${ev.end}`;
  return '시간 미정';
}

// 추가(id 없음) / 수정(id 있음) 공용 폼 모달
function openDashScheduleForm(id, date) {
  const ev = id ? loadDashSchedules().find(x => x.id === id) : null;
  dashScheduleEditingId = ev ? ev.id : null;
  document.getElementById('dash-sched-form-title').textContent = ev ? '일정 수정' : '일정 추가';
  document.getElementById('dash-sched-title').value = ev ? ev.title : '';
  const startYmd = ev ? ev.date : (date || dashScheduleTodayYmd());
  document.getElementById('dash-sched-date').value = startYmd;
  document.getElementById('dash-sched-end-date').value = ev ? (ev.endDate || ev.date) : startYmd;   // 하루짜리 = 시작일과 같음
  const wt = ev ? dashScheduleNormWorkTypes(ev.workTypes) : [];
  document.querySelectorAll('input[name="dash-sched-work"]').forEach(cb => { cb.checked = wt.includes(cb.value); });
  document.getElementById('dash-sched-product').value = ev ? (ev.product || '') : '';
  document.getElementById('dash-sched-qty').value = ev && ev.qty !== null && ev.qty !== undefined ? String(ev.qty) : '';
  document.getElementById('dash-sched-unit').value = ev && ev.unit && DASH_SCHEDULE_UNITS.includes(ev.unit) ? ev.unit : DASH_SCHEDULE_UNITS[0];
  document.getElementById('dash-sched-start').value = ev ? (ev.start || '') : '';
  document.getElementById('dash-sched-end').value = ev ? (ev.end || '') : '';
  document.getElementById('dash-sched-owner').value = ev ? (ev.owner || '') : '';
  document.getElementById('dash-sched-memo').value = ev ? (ev.memo || '') : '';
  document.getElementById('dash-sched-err').textContent = '';
  document.getElementById('dash-sched-form-modal').classList.add('open');
  setTimeout(() => document.getElementById('dash-sched-title').focus(), 0);
}

// 시작일을 바꾸면 종료일이 비어 있거나 시작일보다 빠를 때 시작일로 맞춘다(기간 일정 입력 편의).
function syncDashScheduleEndDate() {
  const sd = document.getElementById('dash-sched-date').value;
  const ed = document.getElementById('dash-sched-end-date');
  if (sd && (!ed.value || ed.value < sd)) ed.value = sd;
}

async function saveDashScheduleForm() {
  if (dashScheduleSaving) return;
  const val = id => document.getElementById(id).value.trim();
  const title = val('dash-sched-title');
  const date = val('dash-sched-date');
  const endDate = val('dash-sched-end-date') || date;   // 비어 있으면 하루짜리
  const start = val('dash-sched-start');
  const end = val('dash-sched-end');
  const errEl = document.getElementById('dash-sched-err');
  if (!title) { errEl.textContent = '일정명을 입력하세요.'; return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errEl.textContent = '날짜를 선택하세요.'; return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { errEl.textContent = '종료일을 선택하세요.'; return; }
  if (endDate < date) { errEl.textContent = '종료일이 시작일보다 빠릅니다.'; return; }
  if (dashScheduleSpanDays(date, endDate) > DASH_SCHEDULE_MAX_SPAN_DAYS) { errEl.textContent = `일정 기간은 최대 ${DASH_SCHEDULE_MAX_SPAN_DAYS}일까지 가능합니다.`; return; }
  const multiDay = endDate > date;
  if (!multiDay && start && end && end < start) { errEl.textContent = '종료 시간이 시작 시간보다 빠릅니다.'; return; }   // 기간 일정은 종료일의 종료 시각이 더 이를 수 있다
  const workTypes = dashScheduleNormWorkTypes([...document.querySelectorAll('input[name="dash-sched-work"]:checked')].map(cb => cb.value));
  const productName = val('dash-sched-product');
  const qtyRaw = val('dash-sched-qty');
  const unit = document.getElementById('dash-sched-unit').value;
  let qty = null;
  if (qtyRaw !== '') {
    qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty < 0) { errEl.textContent = '생산 수량은 0 이상의 숫자로 입력하세요.'; return; }
    if (qty > DASH_SCHEDULE_MAX_QTY) { errEl.textContent = '생산 수량이 너무 큽니다.'; return; }
    qty = Math.round(qty * 1000) / 1000;   // DB 소수 3자리
    if (!DASH_SCHEDULE_UNITS.includes(unit)) { errEl.textContent = '단위를 선택하세요.'; return; }
  }
  if ((productName || qty !== null) && !dashScheduleHasProduction) { errEl.textContent = dashScheduleErrMsg({ message: 'production_qty column' }, '저장하'); return; }
  if (workTypes.length && !dashScheduleHasWorkTypes) { errEl.textContent = dashScheduleErrMsg({ message: 'work_types column' }, '저장하'); return; }
  if (multiDay && !dashScheduleHasEndDate) { errEl.textContent = dashScheduleErrMsg({ message: 'end_date column' }, '저장하'); return; }
  if (!supabaseClient || !currentUser) { errEl.textContent = '로그인 후 이용할 수 있습니다.'; return; }

  // created_by/created_at/updated_at은 DB 트리거가 채운다.
  const row = {
    schedule_date: date, title, start_time: start || null, end_time: end || null,
    assignee: val('dash-sched-owner') || null, memo: val('dash-sched-memo') || null,
  };
  if (dashScheduleHasProduction) {   // 비우면 NULL로 저장 → 수정 화면에서 지운 값도 반영
    row.product_name = productName || null;
    row.production_qty = qty;
    row.production_unit = qty === null ? null : unit;
  }
  if (dashScheduleHasWorkTypes) row.work_types = workTypes.length ? workTypes : null;   // 전부 해제하면 NULL로 저장
  if (dashScheduleHasEndDate) row.end_date = multiDay ? endDate : null;   // NULL = 하루짜리(기간 → 하루로 줄이는 수정도 반영)
  const editingId = dashScheduleEditingId;
  const beforeEv = editingId ? loadDashSchedules().find(x => x.id === editingId) : null;   // 변경 이력용 수정 전 스냅샷
  const saveBtn = document.querySelector('#dash-sched-form-modal .btn-save');
  dashScheduleSaving = true;
  if (saveBtn) saveBtn.disabled = true;
  errEl.textContent = '저장 중…';
  try {
    const table = supabaseClient.from(DASH_SCHEDULE_TABLE);
    const { data, error } = editingId
      ? await table.update(row).eq('id', editingId).select('id')
      : await table.insert(row).select('id');
    if (error) { errEl.textContent = dashScheduleErrMsg(error, '저장하'); return; }
    if (editingId && !(data && data.length)) {
      errEl.textContent = '다른 사용자가 이미 삭제한 일정입니다. 최신 목록으로 갱신했습니다.';
      refreshDashSchedules();
      return;
    }
    errEl.textContent = '';
    closeModal('dash-sched-form-modal');
    dashScheduleEditingId = null;
    if (typeof logDashScheduleHistory === 'function') {   // 캘린더 변경이력(등록/수정) — 실패해도 일정 저장 결과에는 영향 없음
      const afterEv = { title, date, endDate: multiDay ? endDate : date, start, end, owner: val('dash-sched-owner'), memo: val('dash-sched-memo'), product: productName, qty, unit: qty === null ? '' : unit, workTypes };
      await logDashScheduleHistory(editingId ? 'update' : 'create', beforeEv, afterEv, editingId || (data && data[0] && data[0].id));
    }
    await refreshDashSchedules();
  } catch (e) {
    errEl.textContent = dashScheduleErrMsg(e, '저장하');
  } finally {
    dashScheduleSaving = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

function openDashScheduleDetail(id) {
  const ev = loadDashSchedules().find(x => x.id === id);
  if (!ev) return;
  dashScheduleDetailId = ev.id;
  document.getElementById('dash-sched-detail-title').textContent = ev.title;
  document.getElementById('dash-sched-detail-date').textContent = formatDashScheduleRange(ev);
  document.getElementById('dash-sched-detail-time').textContent = formatDashScheduleTime(ev);
  // 작업 유형/제품명/수량은 선택 입력 — 비어 있으면 줄 자체를 숨긴다(빈 칸·"-" 표시 방지)
  [['work', formatDashScheduleWorkTypes(ev)], ['product', ev.product || ''], ['qty', formatDashScheduleQty(ev)]].forEach(([k, v]) => {
    const el = document.getElementById('dash-sched-detail-' + k);
    el.textContent = v;
    el.parentElement.style.display = v ? '' : 'none';
  });
  document.getElementById('dash-sched-detail-owner').textContent = ev.owner || '-';
  document.getElementById('dash-sched-detail-memo').textContent = ev.memo || '-';
  document.getElementById('dash-sched-detail-modal').classList.add('open');
}

function editDashScheduleFromDetail() {
  const id = dashScheduleDetailId;
  closeModal('dash-sched-detail-modal');
  if (id) openDashScheduleForm(id);
}

async function deleteDashScheduleFromDetail() {
  const id = dashScheduleDetailId;
  if (!id || !confirm('이 일정을 삭제할까요?')) return;
  if (!supabaseClient || !currentUser) { alert('로그인 후 이용할 수 있습니다.'); return; }
  const beforeEv = loadDashSchedules().find(x => x.id === id);   // 변경 이력용 삭제 전 스냅샷(복원에 사용)
  try {
    const { error } = await supabaseClient.from(DASH_SCHEDULE_TABLE).delete().eq('id', id);
    if (error) { alert(dashScheduleErrMsg(error, '삭제하')); return; }
  } catch (e) { alert(dashScheduleErrMsg(e, '삭제하')); return; }
  dashScheduleDetailId = null;
  closeModal('dash-sched-detail-modal');
  if (beforeEv && typeof logDashScheduleHistory === 'function') await logDashScheduleHistory('delete', beforeEv, null, id);
  await refreshDashSchedules();
}

// "+ N건" 클릭 시 해당 날짜의 전체 일정 목록 — 제목 클릭 = 상세, 하단에서 이 날짜로 일정 추가.
let dashScheduleDayListDate = null;

function openDashScheduleDayList(date) {
  const list = getDashSchedulesByDate()[date] || [];
  dashScheduleDayListDate = date;
  document.getElementById('dash-sched-day-title').textContent = formatDashScheduleDate(date);
  document.getElementById('dash-sched-day-list').innerHTML = list.map(ev =>
    `<button type="button" class="dash-sched-day-item" data-sched-id="${escHtml(ev.id)}">` +
    `<span class="dash-sched-day-item-title">${escHtml(ev.title)}${dashScheduleSubHtml(ev, 'dash-sched-day-item-sub')}</span>` +
    `<span class="dash-sched-day-item-time">${escHtml(formatDashScheduleTime(ev))}</span></button>`
  ).join('') || '<div class="dash-sched-day-empty">일정이 없습니다.</div>';
  document.getElementById('dash-sched-day-modal').classList.add('open');
}

function onDashScheduleDayListClick(e) {
  const item = e.target.closest('.dash-sched-day-item');
  if (!item) return;
  closeModal('dash-sched-day-modal');
  openDashScheduleDetail(item.dataset.schedId);
}

function addDashScheduleFromDayList() {
  closeModal('dash-sched-day-modal');
  openDashScheduleForm(null, dashScheduleDayListDate);
}

// ── 캘린더 탭 (사이드바 작업 > 캘린더) ───────────────────────────────────────
// 대시보드와 같은 dashSchedules 캐시/모달/CRUD를 그대로 쓴다. 이 탭은 월간 달력(일정 있는 날짜 = 건수 배지)
// + 보고 있는 달의 일정 목록만 그린다. 월 offset과 선택 날짜는 대시보드와 별개(세션 메모리).
const CAL_TAB_MAX_LANES = 3;     // 한 주에 쌓아 그리는 기간 일정 막대 최대 줄 수(초과분은 배지 건수에 포함)
let calTabMonthOffset = 0;
let calTabSelectedDate = null;   // 마지막으로 클릭한 날짜(YYYY-MM-DD) — "+ 일정 추가" 기본 날짜

function shiftCalendarTab(delta) {
  calTabMonthOffset += delta;
  renderCalendarTab();
}

function goToCalendarTabToday() {
  calTabMonthOffset = 0;
  calTabSelectedDate = null;
  renderCalendarTab();
}

// 캘린더 탭 목록의 날짜 표기 — 하루짜리 "12일", 같은 달 기간 "12~15일", 달/해를 넘으면 "9/28~10/2"(해가 다르면 연도 포함)
function dashScheduleListDateLabel(ev, monthStart, monthEnd) {
  const end = ev.endDate || ev.date;
  const [sy, sm, sd] = ev.date.split('-').map(Number), [ey, em, ed] = end.split('-').map(Number);
  if (end === ev.date) return `${sd}일`;
  if (ev.date >= monthStart && end <= monthEnd) return `${sd}~${ed}일`;
  return sy === ey ? `${sm}/${sd}~${em}/${ed}` : `${sy}.${sm}/${sd}~${ey}.${em}/${ed}`;
}

function renderCalendarTab() {
  const gridEl = document.getElementById('cal-tab-grid');
  const listEl = document.getElementById('cal-tab-list');
  const titleEl = document.getElementById('cal-tab-title');
  if (!gridEl || !listEl || !titleEl) return;

  const today = new Date();
  const view = new Date(today.getFullYear(), today.getMonth() + calTabMonthOffset, 1);
  const year = view.getFullYear(), month = view.getMonth();
  titleEl.textContent = `${year}년 ${month + 1}월`;
  const panelDate = calTabSelectedDate || dashScheduleTodayYmd();   // 우측 패널 기준 날짜(선택 없으면 오늘)
  document.getElementById('cal-tab-list-title').textContent = formatDashScheduleDate(panelDate);

  const ymd = (y, m, d) => {
    const dt = new Date(y, m, d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  const todayYmd = dashScheduleTodayYmd();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = firstWeekday - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, date: ymd(year, month - 1, daysInPrevMonth - i), muted: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: ymd(year, month, d), muted: false });
  for (let n = 1; cells.length % 7 !== 0; n++) cells.push({ day: n, date: ymd(year, month + 1, n), muted: true });

  const byDate = getDashSchedulesByDate();
  const layout = layoutDashCalendarBars(cells, CAL_TAB_MAX_LANES);   // 기간 일정은 막대, 하루짜리는 대시보드와 같이 제목 pill
  gridEl.innerHTML = cells.map((c, i) => {
    const info = layout.info[c.date];
    const dayEvts = byDate[c.date] || [];
    const singles = dayEvts.filter(ev => !dashScheduleIsMulti(ev));
    const shown = singles.slice(0, Math.max(0, CAL_TAB_MAX_LANES - info.lanes));   // 막대+하루짜리 합쳐 최대 3줄
    const hidden = dayEvts.length - info.bars - shown.length;                        // 못 그린 일정은 "+ N건"
    const cls = ['cal-tab-cell'];
    if (c.muted) cls.push('is-muted');
    if (c.date === todayYmd) cls.push('is-today');
    if (c.date === calTabSelectedDate) cls.push('is-selected');
    if (typeof krDayClasses === 'function') cls.push(...krDayClasses(c.date));   // 일요일/공휴일 날짜 숫자 빨강(대시보드 달력과 같은 공통 로직)
    if (dayEvts.length) cls.push('has-evt');
    const pad = info.lanes ? `<div class="cal-tab-lane-pad" style="--lanes:${info.lanes}"></div>` : '';
    const pills = shown.map(ev =>
      `<button type="button" class="cal-tab-evt" data-sched-id="${escHtml(ev.id)}" title="${escHtml(dashScheduleTip(ev))}">${escHtml(dashScheduleCellLabel(ev))}</button>`).join('');
    const more = hidden > 0 ? `<button type="button" class="cal-tab-more" data-date="${c.date}">+ ${hidden}건</button>` : '';
    return `<div class="${cls.join(' ')}" data-date="${c.date}" style="grid-row:${Math.floor(i / 7) + 1};grid-column:${(i % 7) + 1}">` +
      `<span class="cal-tab-day"${typeof krHolidayTitleAttr === 'function' ? krHolidayTitleAttr(c.date) : ''}><span class="cal-day-num">${c.day}</span></span><div class="cal-tab-evts">${pad}${pills}${more}</div></div>`;
  }).join('') + dashCalBarsHtml(layout.bars, 'cal-tab-bar');

  // 우측 패널: 선택한 날짜의 일정 목록(기간 일정은 포함된 날짜마다 표시). 없으면 빈 상태 + 일정 추가.
  const dayList = byDate[panelDate] || [];
  listEl.innerHTML = dayList.map(ev => {
    const meta = [formatDashScheduleTime(ev), ev.product, formatDashScheduleQty(ev)].filter(Boolean).join(' · ');
    const range = dashScheduleIsMulti(ev) ? ` · ${dashScheduleListDateLabel(ev, '', '')}` : '';
    return `<div class="cal-day-item" data-sched-id="${escHtml(ev.id)}">` +
      `<button type="button" class="cal-day-main">${dashScheduleChipsHtml(ev)}` +
      `<span class="cal-day-title">${escHtml(ev.title)}</span>` +
      `<span class="cal-day-meta">${escHtml(meta + range)}</span></button>` +
      `<span class="cal-day-actions"><button type="button" class="cal-day-edit">수정</button><button type="button" class="cal-day-del">삭제</button></span></div>`;
  }).join('') || `<div class="cal-day-empty"><div>등록된 일정이 없습니다.</div>` +
    `<button type="button" class="dash-cal-nav-btn dash-cal-add-btn cal-day-add">+ 일정 추가</button></div>`;

  if (!gridEl.dataset.bound) {
    gridEl.dataset.bound = '1';
    gridEl.addEventListener('click', e => {
      const bar = e.target.closest('.cal-tab-bar, .cal-tab-evt');
      if (bar) { openDashScheduleDetail(bar.dataset.schedId); return; }   // 기간 일정 막대/하루 일정 제목 = 상세 조회
      const more = e.target.closest('.cal-tab-more');
      if (more) { openDashScheduleDayList(more.dataset.date); return; }   // "+ N건" = 해당 날짜 일정 목록
      const cell = e.target.closest('.cal-tab-cell');
      if (!cell) return;
      calTabSelectedDate = cell.dataset.date;   // 날짜 클릭 = 우측 패널에 그 날짜 일정 표시(추가는 패널의 "+ 일정 추가")
      renderCalendarTab();
      listEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });   // 모바일(패널이 아래로 쌓일 때)에서 패널로 이동
    });
    listEl.addEventListener('click', e => {
      if (e.target.closest('.cal-day-add')) { openDashScheduleForm(null, calTabSelectedDate || dashScheduleTodayYmd()); return; }
      const item = e.target.closest('.cal-day-item');
      if (!item) return;
      const id = item.dataset.schedId;
      if (e.target.closest('.cal-day-edit')) openDashScheduleForm(id);
      else if (e.target.closest('.cal-day-del')) { dashScheduleDetailId = id; deleteDashScheduleFromDetail(); }   // 기존 삭제 흐름(확인창·이력·새로고침) 재사용
      else openDashScheduleDetail(id);
    });
  }
}
