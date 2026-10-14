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
// 캐시 일정 형식: { id, title, date:'YYYY-MM-DD'(시작일), endDate:'YYYY-MM-DD'(종료일, 하루짜리는 date와 같음),
//                  start:'HH:MM'|'', end:'HH:MM'|'', owner, memo, createdAt }
const DASH_SCHEDULE_KEY = 'feedcalc_v4_dash_schedules';                    // (레거시, 읽기 전용)
const DASH_SCHEDULE_MIGRATED_KEY = 'feedcalc_v4_dash_schedules_migrated';  // 레거시 이전 완료 시각
const DASH_SCHEDULE_TABLE = 'dash_schedules';
const DASH_SCHEDULE_COLS = 'id,schedule_date,title,start_time,end_time,assignee,memo,created_at';
const DASH_SCHEDULE_COLS_RANGE = DASH_SCHEDULE_COLS + ',end_date';
const DASH_SCHEDULE_MAX_SPAN_DAYS = 366;   // 종료일은 시작일로부터 최대 366일 뒤까지(DB 제약과 동일)
let dashScheduleHasEndDate = true;         // 008(end_date 컬럼) 적용 여부 — 조회 오류로 판별

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

function dashScheduleFromRow(r) {
  const hm = t => (t ? String(t).slice(0, 5) : '');
  return {
    id: r.id, title: r.title, date: r.schedule_date, endDate: r.end_date || r.schedule_date,
    start: hm(r.start_time), end: hm(r.end_time),
    owner: r.assignee || '', memo: r.memo || '',
    createdAt: Date.parse(r.created_at) || 0,
  };
}

// Supabase 오류 → 사용자에게 보여줄 문장 (action: '불러오' | '저장' | '삭제')
function dashScheduleErrMsg(error, action) {
  const msg = (error && error.message) || '';
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
    let { data, error } = await query(dashScheduleHasEndDate ? DASH_SCHEDULE_COLS_RANGE : DASH_SCHEDULE_COLS);
    if (error && dashScheduleHasEndDate && /end_date/i.test(error.message || '')) {   // 008 미적용 DB — 기존(하루짜리) 일정만이라도 표시
      dashScheduleHasEndDate = false;
      ({ data, error } = await query(DASH_SCHEDULE_COLS));
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
  if (multiDay && !dashScheduleHasEndDate) { errEl.textContent = dashScheduleErrMsg({ message: 'end_date column' }, '저장하'); return; }
  if (!supabaseClient || !currentUser) { errEl.textContent = '로그인 후 이용할 수 있습니다.'; return; }

  // created_by/created_at/updated_at은 DB 트리거가 채운다.
  const row = {
    schedule_date: date, title, start_time: start || null, end_time: end || null,
    assignee: val('dash-sched-owner') || null, memo: val('dash-sched-memo') || null,
  };
  if (dashScheduleHasEndDate) row.end_date = multiDay ? endDate : null;   // NULL = 하루짜리(기간 → 하루로 줄이는 수정도 반영)
  const editingId = dashScheduleEditingId;
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
  try {
    const { error } = await supabaseClient.from(DASH_SCHEDULE_TABLE).delete().eq('id', id);
    if (error) { alert(dashScheduleErrMsg(error, '삭제하')); return; }
  } catch (e) { alert(dashScheduleErrMsg(e, '삭제하')); return; }
  dashScheduleDetailId = null;
  closeModal('dash-sched-detail-modal');
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
    `<span class="dash-sched-day-item-title">${escHtml(ev.title)}</span>` +
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
  document.getElementById('cal-tab-list-title').textContent = `${month + 1}월 일정`;

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
  gridEl.innerHTML = cells.map(c => {
    const cnt = (byDate[c.date] || []).length;
    const cls = ['cal-tab-cell'];
    if (c.muted) cls.push('is-muted');
    if (c.date === todayYmd) cls.push('is-today');
    if (c.date === calTabSelectedDate) cls.push('is-selected');
    if (cnt) cls.push('has-evt');
    return `<div class="${cls.join(' ')}" data-date="${c.date}"><span class="cal-tab-day">${c.day}</span>` +
      (cnt ? `<span class="cal-tab-badge" title="일정 ${cnt}건">${cnt}</span>` : '') + `</div>`;
  }).join('');

  // 목록: 보고 있는 달의 일정만 날짜순(같은 날은 getDashSchedulesByDate 정렬 그대로)
  const monthStart = ymd(year, month, 1), monthEnd = ymd(year, month, daysInMonth);
  const inMonth = loadDashSchedules().filter(ev => ev.date <= monthEnd && (ev.endDate || ev.date) >= monthStart)   // 이 달과 기간이 겹치는 일정
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (!!a.start !== !!b.start ? (a.start ? -1 : 1) : (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.createdAt || 0) - (b.createdAt || 0))));
  listEl.innerHTML = inMonth.map(ev =>
    `<button type="button" class="cal-tab-item" data-sched-id="${escHtml(ev.id)}">` +
    `<span class="cal-tab-item-date">${escHtml(dashScheduleListDateLabel(ev, monthStart, monthEnd))}</span>` +
    `<span class="cal-tab-item-title">${escHtml(ev.title)}</span>` +
    `<span class="cal-tab-item-time">${escHtml(formatDashScheduleTime(ev))}</span></button>`
  ).join('') || '<div class="dash-sched-day-empty">이 달에 등록된 일정이 없습니다.</div>';

  if (!gridEl.dataset.bound) {
    gridEl.dataset.bound = '1';
    gridEl.addEventListener('click', e => {
      const cell = e.target.closest('.cal-tab-cell');
      if (!cell) return;
      calTabSelectedDate = cell.dataset.date;
      renderCalendarTab();
      openDashScheduleForm(null, calTabSelectedDate);
    });
    listEl.addEventListener('click', e => {
      const item = e.target.closest('.cal-tab-item');
      if (item) openDashScheduleDetail(item.dataset.schedId);
    });
  }
}
