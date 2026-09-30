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
// 캐시 일정 형식: { id, title, date:'YYYY-MM-DD', start:'HH:MM'|'', end:'HH:MM'|'', owner, memo, createdAt }
const DASH_SCHEDULE_KEY = 'feedcalc_v4_dash_schedules';                    // (레거시, 읽기 전용)
const DASH_SCHEDULE_MIGRATED_KEY = 'feedcalc_v4_dash_schedules_migrated';  // 레거시 이전 완료 시각
const DASH_SCHEDULE_TABLE = 'dash_schedules';
const DASH_SCHEDULE_COLS = 'id,schedule_date,title,start_time,end_time,assignee,memo,created_at';

let dashSchedules = [];             // DB에서 불러온 공동 일정(메모리 캐시)
let dashScheduleLoading = null;     // 진행 중인 refresh Promise(중복 호출 방지)
let dashScheduleSaving = false;     // 저장 요청 진행 중(Enter 연타/중복 클릭 방지)
let dashScheduleEditingId = null;   // 폼 모달이 수정 중인 일정 id (null = 새 일정)
let dashScheduleDetailId = null;    // 상세 모달에 열려 있는 일정 id

function loadDashSchedules() {
  return dashSchedules;
}

function dashScheduleFromRow(r) {
  const hm = t => (t ? String(t).slice(0, 5) : '');
  return {
    id: r.id, title: r.title, date: r.schedule_date,
    start: hm(r.start_time), end: hm(r.end_time),
    owner: r.assignee || '', memo: r.memo || '',
    createdAt: Date.parse(r.created_at) || 0,
  };
}

// Supabase 오류 → 사용자에게 보여줄 문장 (action: '불러오' | '저장' | '삭제')
function dashScheduleErrMsg(error, action) {
  const msg = (error && error.message) || '';
  if (/fetch|network|Load failed/i.test(msg)) return `서버에 연결하지 못해 일정을 ${action}지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.`;
  if (/JWT|auth|permission|row-level security/i.test(msg)) return `로그인이 만료되었거나 권한이 없어 일정을 ${action}지 못했습니다. 다시 로그인해 주세요.`;
  return `일정을 ${action}지 못했습니다. 잠시 후 다시 시도하세요.${msg ? ` (${msg})` : ''}`;
}

function setDashCalStatus(text, withRetry) {
  const el = document.getElementById('dash-cal-status');
  if (!el) return;
  el.hidden = !text;
  el.innerHTML = text ? `<span>${escHtml(text)}</span>` +
    (withRetry ? '<button type="button" class="dash-cal-nav-btn" onclick="refreshDashSchedules()">다시 시도</button>' : '') : '';
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
    const { data, error } = await supabaseClient.from(DASH_SCHEDULE_TABLE)
      .select(DASH_SCHEDULE_COLS).order('schedule_date', { ascending: true });
    if (error) { setDashCalStatus(dashScheduleErrMsg(error, '불러오'), true); return; }
    dashSchedules = (data || []).map(dashScheduleFromRow);
    setDashCalStatus('');
    renderDashCalendar();
  })().catch(e => {
    setDashCalStatus(dashScheduleErrMsg(e, '불러오'), true);
  }).finally(() => { dashScheduleLoading = null; });
  return dashScheduleLoading;
}

// 날짜별 일정 목록 — 시작 시간 있는 일정을 시간순으로 먼저, 시간 없는 일정은 등록순으로 뒤에.
function getDashSchedulesByDate() {
  const map = {};
  loadDashSchedules().forEach(ev => { (map[ev.date] = map[ev.date] || []).push(ev); });
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
  document.getElementById('dash-sched-date').value = ev ? ev.date : (date || dashScheduleTodayYmd());
  document.getElementById('dash-sched-start').value = ev ? (ev.start || '') : '';
  document.getElementById('dash-sched-end').value = ev ? (ev.end || '') : '';
  document.getElementById('dash-sched-owner').value = ev ? (ev.owner || '') : '';
  document.getElementById('dash-sched-memo').value = ev ? (ev.memo || '') : '';
  document.getElementById('dash-sched-err').textContent = '';
  document.getElementById('dash-sched-form-modal').classList.add('open');
  setTimeout(() => document.getElementById('dash-sched-title').focus(), 0);
}

async function saveDashScheduleForm() {
  if (dashScheduleSaving) return;
  const val = id => document.getElementById(id).value.trim();
  const title = val('dash-sched-title');
  const date = val('dash-sched-date');
  const start = val('dash-sched-start');
  const end = val('dash-sched-end');
  const errEl = document.getElementById('dash-sched-err');
  if (!title) { errEl.textContent = '일정명을 입력하세요.'; return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errEl.textContent = '날짜를 선택하세요.'; return; }
  if (start && end && end < start) { errEl.textContent = '종료 시간이 시작 시간보다 빠릅니다.'; return; }
  if (!supabaseClient || !currentUser) { errEl.textContent = '로그인 후 이용할 수 있습니다.'; return; }

  // created_by/created_at/updated_at은 DB 트리거가 채운다.
  const row = {
    schedule_date: date, title, start_time: start || null, end_time: end || null,
    assignee: val('dash-sched-owner') || null, memo: val('dash-sched-memo') || null,
  };
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
  document.getElementById('dash-sched-detail-date').textContent = formatDashScheduleDate(ev.date);
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
