// ── 대시보드: 현장 공동 일정표 (1차: localStorage 전용) ─────────────────────────
// 대시보드 월간 캘린더(js/ui.js renderDashCalendar)에 일정 제목을 표시하고,
// 일정 추가/상세/수정/삭제 모달을 담당한다. 영양계산/배합/레시피 로직과 무관하며
// 레시피·원료용 localStorage 키와 겹치지 않는 별도 키 하나만 사용한다.
// 일정 형식: { id, title, date:'YYYY-MM-DD', start:'HH:MM'|'', end:'HH:MM'|'', owner, memo, createdAt, updatedAt }
const DASH_SCHEDULE_KEY = 'feedcalc_v4_dash_schedules';

let dashScheduleEditingId = null;   // 폼 모달이 수정 중인 일정 id (null = 새 일정)
let dashScheduleDetailId = null;    // 상세 모달에 열려 있는 일정 id

function loadDashSchedules() {
  try {
    const list = JSON.parse(localStorage.getItem(DASH_SCHEDULE_KEY) || '[]');
    return Array.isArray(list) ? list.filter(ev => ev && ev.id && ev.title && ev.date) : [];
  } catch (e) { return []; }
}

function saveDashSchedules(list) {
  try { localStorage.setItem(DASH_SCHEDULE_KEY, JSON.stringify(list)); return true; }
  catch (e) { return false; }
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

function saveDashScheduleForm() {
  const val = id => document.getElementById(id).value.trim();
  const title = val('dash-sched-title');
  const date = val('dash-sched-date');
  const start = val('dash-sched-start');
  const end = val('dash-sched-end');
  const errEl = document.getElementById('dash-sched-err');
  if (!title) { errEl.textContent = '일정명을 입력하세요.'; return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errEl.textContent = '날짜를 선택하세요.'; return; }
  if (start && end && end < start) { errEl.textContent = '종료 시간이 시작 시간보다 빠릅니다.'; return; }

  const list = loadDashSchedules();
  const now = Date.now();
  const fields = { title, date, start, end, owner: val('dash-sched-owner'), memo: val('dash-sched-memo'), updatedAt: now };
  const idx = dashScheduleEditingId ? list.findIndex(x => x.id === dashScheduleEditingId) : -1;
  if (idx >= 0) list[idx] = { ...list[idx], ...fields };
  else list.push({ id: 'sch_' + now.toString(36) + Math.random().toString(36).slice(2, 7), createdAt: now, ...fields });
  if (!saveDashSchedules(list)) { errEl.textContent = '저장에 실패했습니다(브라우저 저장공간 확인).'; return; }

  closeModal('dash-sched-form-modal');
  dashScheduleEditingId = null;
  renderDashCalendar();
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

function deleteDashScheduleFromDetail() {
  const id = dashScheduleDetailId;
  if (!id || !confirm('이 일정을 삭제할까요?')) return;
  saveDashSchedules(loadDashSchedules().filter(x => x.id !== id));
  dashScheduleDetailId = null;
  closeModal('dash-sched-detail-modal');
  renderDashCalendar();
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
