// ── 캘린더 변경이력: 일정 등록/수정/삭제/복원 기록 (Supabase public.dash_schedule_history) ──────────────
// 일정 CRUD(js/dash-schedule.js)가 성공한 뒤 이 파일의 logDashScheduleHistory()를 호출해 서버에 이력을 남기고,
// "변경 이력" 탭의 "캘린더 변경이력" 섹션이 같은 테이블을 조회해 보여 준다(supabase/sql/010_dash_schedule_history.sql).
//  · 이력 저장은 일정 저장/삭제와 별개 요청이다 — 이력 기록이 실패해도 일정 작업은 그대로 성공으로 처리하고 안내만 띄운다.
//  · "복원": 삭제 이력의 before 스냅샷으로 일정을 다시 등록한다(새 id로 insert, 복원 이력 기록). 일정 삭제는 영구 삭제라
//    기존에는 복원 수단이 없었다 — 삭제 기록 행의 [복원] 버튼이 그 수단이다.
const DASH_HISTORY_TABLE = 'dash_schedule_history';
const DASH_HISTORY_LIMIT = 200;
const DASH_HISTORY_ACTIONS = { create: '등록', update: '수정', delete: '삭제', restore: '복원' };
const DASH_HISTORY_FIELDS = [   // [표시명, 스냅샷 키]
  ['일정명', 'title'], ['시작일', 'date'], ['종료일', 'endDate'], ['시작 시간', 'start'], ['종료 시간', 'end'],
  ['제품명', 'product'], ['생산 수량', 'qty'], ['담당자', 'owner'], ['메모', 'memo'],
];

let dashHistoryList = [];          // 마지막으로 불러온 이력(최신순)
let dashHistoryLoading = null;     // 진행 중 조회(중복 방지)
let dashHistoryWarned = false;     // 이력 기록 실패 안내는 세션당 1번만
let dashHistoryRestoring = false;  // 복원 요청 진행 중(중복 클릭 방지)

// 일정(캐시 형식 또는 폼 값) → 이력용 스냅샷. 비교/복원에 필요한 필드만, 값은 정규화한다.
function dashScheduleSnapshot(ev) {
  const date = ev.date;
  return {
    title: ev.title || '', date, endDate: ev.endDate && ev.endDate > date ? ev.endDate : date,
    start: ev.start || '', end: ev.end || '', owner: ev.owner || '', memo: ev.memo || '',
    product: ev.product || '',
    qty: ev.qty === null || ev.qty === undefined || Number.isNaN(ev.qty) ? null : Number(ev.qty),
    unit: ev.qty === null || ev.qty === undefined ? '' : (ev.unit || ''),
  };
}

function dashHistoryValue(snap, key) {
  if (key === 'qty') return snap.qty === null ? '' : formatDashScheduleQty({ qty: snap.qty, unit: snap.unit });
  const v = snap[key] || '';
  return key === 'memo' && v.length > 40 ? v.slice(0, 40) + '…' : v;
}

// 수정 전/후 비교 → [{ field, from, to }]  (생산 수량은 단위 변경도 변경으로 본다)
function dashScheduleDiff(before, after) {
  const out = [];
  DASH_HISTORY_FIELDS.forEach(([label, key]) => {
    const a = dashHistoryValue(before, key), b = dashHistoryValue(after, key);
    if (key === 'memo' ? before.memo !== after.memo : a !== b) out.push({ field: label, from: a || '(없음)', to: b || '(없음)' });
  });
  return out;
}

// 등록/삭제/복원 요약: "2026-10-12 ~ 2026-10-15 · 09:00 ~ · 제품명 · 1,200 kg · 담당 김"
function dashScheduleDescribe(snap) {
  const parts = [snap.endDate > snap.date ? `${snap.date} ~ ${snap.endDate}` : snap.date];
  const time = formatDashScheduleTime({ start: snap.start, end: snap.end });
  if (snap.start || snap.end) parts.push(time);
  const prod = formatDashScheduleProduction(snap);
  if (prod) parts.push(prod);
  if (snap.owner) parts.push(`담당 ${snap.owner}`);
  return parts.join(' · ');
}

function dashScheduleHistorySummary(action, before, after, changes) {
  let s;
  if (action === 'update') s = changes.map(c => `${c.field} ${c.from} → ${c.to}`).join(' / ');
  else if (action === 'restore') s = dashScheduleDescribe(after) + ' (삭제 이력에서 복원)';
  else s = dashScheduleDescribe(action === 'delete' ? before : after);
  return s.length > 1000 ? s.slice(0, 1000) + '…' : s;
}

// 삭제 이력의 스냅샷 → dash_schedules insert 행(복원용). 컬럼이 없는 DB(008/009 미적용)에서는 해당 컬럼을 뺀다.
function dashScheduleRowFromSnapshot(snap) {
  const row = {
    schedule_date: snap.date, title: snap.title, start_time: snap.start || null, end_time: snap.end || null,
    assignee: snap.owner || null, memo: snap.memo || null,
  };
  if (dashScheduleHasProduction) {
    row.product_name = snap.product || null;
    row.production_qty = snap.qty;
    row.production_unit = snap.qty === null ? null : (snap.unit || null);
  }
  if (dashScheduleHasEndDate) row.end_date = snap.endDate > snap.date ? snap.endDate : null;
  return row;
}

function dashHistoryUserName() {
  return (typeof currentUserName !== 'undefined' && currentUserName) || (typeof currentUserLabel === 'function' ? currentUserLabel() : '') || null;
}

// 이력 1건 기록. 실패해도 예외를 던지지 않는다(일정 작업 결과에 영향 없음).
async function logDashScheduleHistory(action, beforeEv, afterEv, scheduleId, extraDetails) {
  try {
    if (!supabaseClient || !currentUser) return false;
    const before = beforeEv ? dashScheduleSnapshot(beforeEv) : null;
    const after = afterEv ? dashScheduleSnapshot(afterEv) : null;
    const changes = action === 'update' ? dashScheduleDiff(before, after) : [];
    if (action === 'update' && !changes.length) return true;   // 실제 변경이 없으면 기록하지 않는다
    const { error } = await supabaseClient.from(DASH_HISTORY_TABLE).insert({
      action, schedule_id: scheduleId || null, title: (after || before).title,
      summary: dashScheduleHistorySummary(action, before, after, changes),
      details: { before, after, changes, ...(extraDetails || {}) },
      user_name: dashHistoryUserName(),
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[일정 이력] 기록 실패', e);
    if (!dashHistoryWarned && typeof showToast === 'function') {
      dashHistoryWarned = true;
      const missing = /relation|does not exist|schema cache|dash_schedule_history/i.test((e && e.message) || '');
      showToast(missing ? '일정은 저장됐지만 변경이력 DB(010 SQL)가 없어 기록하지 못했습니다.' : '일정은 저장됐지만 변경이력 기록에 실패했습니다.');
    }
    return false;
  }
}

function dashHistoryFmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function setDashHistoryStatus(text, withRetry) {
  const el = document.getElementById('cal-history-status');
  if (!el) return;
  el.hidden = !text;
  el.innerHTML = text ? `<span>${escHtml(text)}</span>` +
    (withRetry ? '<button type="button" class="dash-cal-nav-btn" onclick="loadDashScheduleHistory()">다시 시도</button>' : '') : '';
}

function renderDashScheduleHistory() {
  const body = document.getElementById('cal-history-body');
  if (!body) return;
  if (!dashHistoryList.length) {
    body.innerHTML = `<tr><td colspan="6" class="table-empty-row"><span class="ter-inner">${typeof svgIcon === 'function' ? svgIcon('file', 13) : ''}<span>기록된 캘린더 변경이력이 없습니다.</span></span></td></tr>`;
    return;
  }
  const restored = new Set(dashHistoryList.filter(h => h.action === 'restore' && h.details && h.details.restored_from).map(h => h.details.restored_from));
  body.innerHTML = dashHistoryList.map(h => {
    const canRestore = h.action === 'delete' && h.details && h.details.before && !restored.has(h.id);
    return `<tr>
      <td>${escHtml(dashHistoryFmtTime(h.created_at))}</td>
      <td>${escHtml(h.user_name || '')}</td>
      <td><span class="cal-hist-act cal-hist-act-${escHtml(h.action)}">${escHtml(DASH_HISTORY_ACTIONS[h.action] || h.action)}</span></td>
      <td class="left">${escHtml(h.title)}</td>
      <td class="left">${escHtml(h.summary || '')}</td>
      <td>${canRestore ? `<button type="button" class="dash-cal-nav-btn" data-restore-id="${escHtml(h.id)}" onclick="restoreDashScheduleFromHistory(this.dataset.restoreId)">복원</button>` : (h.action === 'delete' && restored.has(h.id) ? '<span class="cal-hist-done">복원됨</span>' : '')}</td>
    </tr>`;
  }).join('');
}

// "변경 이력" 탭 진입/기록/복원 때 서버에서 최신 이력을 다시 불러온다.
function loadDashScheduleHistory() {
  if (!document.getElementById('cal-history-body')) return Promise.resolve();
  if (!supabaseClient || !currentUser) { renderDashScheduleHistory(); return Promise.resolve(); }
  if (dashHistoryLoading) return dashHistoryLoading;
  dashHistoryLoading = (async () => {
    const { data, error } = await supabaseClient.from(DASH_HISTORY_TABLE)
      .select('id,created_at,user_name,action,schedule_id,title,summary,details')
      .order('created_at', { ascending: false }).limit(DASH_HISTORY_LIMIT);
    if (error) {
      const msg = error.message || '';
      setDashHistoryStatus(/relation|does not exist|schema cache/i.test(msg)
        ? '캘린더 변경이력을 쓰려면 DB 업데이트(supabase/sql/010_dash_schedule_history.sql 실행)가 필요합니다. 관리자에게 문의하세요.'
        : `캘린더 변경이력을 불러오지 못했습니다. 잠시 후 다시 시도하세요.${msg ? ` (${msg})` : ''}`, true);
      return;
    }
    dashHistoryList = data || [];
    setDashHistoryStatus('');
    renderDashScheduleHistory();
  })().catch(e => setDashHistoryStatus(`캘린더 변경이력을 불러오지 못했습니다. (${(e && e.message) || e})`, true))
    .finally(() => { dashHistoryLoading = null; });
  return dashHistoryLoading;
}

// 삭제 이력의 스냅샷으로 일정을 다시 등록하고 "복원" 이력을 남긴다.
async function restoreDashScheduleFromHistory(historyId) {
  if (dashHistoryRestoring) return;
  const h = dashHistoryList.find(x => x.id === historyId);
  if (!h || h.action !== 'delete' || !h.details || !h.details.before) return;
  const snap = h.details.before;
  if (!confirm(`삭제된 일정 "${snap.title}"을(를) 복원할까요?`)) return;
  if (!supabaseClient || !currentUser) { alert('로그인 후 이용할 수 있습니다.'); return; }
  dashHistoryRestoring = true;
  try {
    const { data, error } = await supabaseClient.from(DASH_SCHEDULE_TABLE).insert(dashScheduleRowFromSnapshot(snap)).select('id');
    if (error) { alert(dashScheduleErrMsg(error, '복원하')); return; }
    await logDashScheduleHistory('restore', null, snap, data && data[0] && data[0].id, { restored_from: historyId });
    if (typeof refreshDashSchedules === 'function') await refreshDashSchedules();   // 대시보드/캘린더 탭 달력 갱신
    await loadDashScheduleHistory();
    if (typeof showToast === 'function') showToast('일정을 복원했습니다.');
  } catch (e) {
    alert(dashScheduleErrMsg(e, '복원하'));
  } finally {
    dashHistoryRestoring = false;
  }
}
