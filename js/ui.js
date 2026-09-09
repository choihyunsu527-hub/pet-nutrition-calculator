// ui.js — Toast/아이콘/상태배지/테마/사이드바·탭·FAB/세그먼트·BCS/알레르기 UI/알림. index.html에서 분리.


// ════════════════════════════════════════════════════════════════════════════
// 공통 Toast — 저장/수정/추가/불러오기 완료 같은 성공·안내 메시지를 alert() 대신
// 화면 하단에 잠깐 띄웠다 자동으로 사라지게 한다(삭제/초기화 등 확인이 필요한
// confirm()은 대상이 아니며 그대로 둔다).
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// 공통 Outline 아이콘 — 폴더/경고/원료 카테고리 이모지를 대체하는 단색 SVG 모음.
// 새 아이콘 라이브러리를 추가하지 않고, 사이드바 메뉴 아이콘과 같은 Lucide 24×24
// stroke 스타일의 path만 인라인으로 재사용한다(svgIcon()으로 한 곳에서만 조립).
// ════════════════════════════════════════════════════════════════════════════
const ICON_PATHS = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  // 상태 배지(정상/부족/초과/주의/참고/미함유) 전용 아이콘 5종 — 기존 warning(AlertTriangle)과
  // 함께 6개 상태를 모두 커버한다. 다른 아이콘과 같은 Lucide 24×24 stroke path.
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  minus: '<path d="M5 12h14"/>',
  beef: '<path d="M16.4 13.7A6.5 6.5 0 1 0 6.28 6.6c-1.1 3.13-.78 3.9-3.18 6.08A3 3 0 0 0 5 18c4 0 8.4-1.8 11.4-4.3"/><path d="m18.5 6 2.19 4.5a6.48 6.48 0 0 1-2.29 7.2C15.4 20.2 11 22 7 22a3 3 0 0 1-2.68-1.66L2.4 16.5"/><circle cx="12.5" cy="8.5" r="2.5"/>',
  fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/><path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4"/><path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98"/>',
  egg: '<path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/>',
  milk: '<path d="M8 2h8"/><path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2"/><path d="M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/>',
  wheat: '<path d="M2 22 16 8"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/><path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/><path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/><path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/>',
  bean: '<path d="M10.165 6.598C9.954 7.478 9.64 8.36 9 9c-.64.64-1.521.954-2.402 1.165A6 6 0 0 0 8 22c7.732 0 14-6.268 14-14a6 6 0 0 0-11.835-1.402Z"/><path d="M5.341 10.62a4 4 0 1 0 5.279-5.28"/>',
  carrot: '<path d="M15 16a1 1 0 0 0-7-7q-4 4-5.987 12.385a.5.5 0 0 0 .602.602Q11 20 15 16l-3-3"/><path d="M15 9q4 4 7 0-3-4-7 0 4-4 0-7-4 3 0 7"/><path d="m8 15-2.58-2.58"/>',
  salad: '<path d="M7 21h10"/><path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1"/><path d="m13 12 4-4"/><path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2"/>',
  mushroom: '<path d="M4 10a8 5 0 0 1 16 0Z"/><path d="M9 20a1 1 0 0 1-1-1v-5h8v5a1 1 0 0 1-1 1Z"/>',
  apple: '<path d="M12 6.528V3a1 1 0 0 1 1-1h0"/><path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
  soup: '<path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M7 21h10"/><path d="M19.5 12 22 6"/><path d="M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62"/><path d="M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62"/><path d="M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62"/>',
  bone: '<path d="M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="M4.929 4.929 19.07 19.071"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.74a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.86l-3.735-3.64a.53.53 0 0 1 .293-.905l5.166-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  // 배합표 컬럼 정렬 아이콘 3종(기본/오름차순/내림차순) — 다른 아이콘과 같은 Lucide 24×24 stroke path.
  'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
};
function svgIcon(name, size) {
  size = size || 14;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0">${ICON_PATHS[name] || ''}</svg>`;
}
// 즐겨찾기 별 아이콘 전용 — svgIcon()과 같은 path를 쓰되 채움 여부(outline/filled)만 다르게 그린다.
function svgStarIcon(filled, size) {
  size = size || 14;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex-shrink:0">${ICON_PATHS.star}</svg>`;
}

// ════════════════════════════════════════════════════════════════════════════
// 상태 배지(정상/부족/초과/주의/참고/미함유/평가 제외) 표준 — 판정값(pass/fail/over/...)은
// 그대로 두고 "화면에 어떤 아이콘·문구·색으로 그릴지"만 이 한 곳에서 정의한다. gateJudge()·
// judge()·evaluateCapStatus() 등 판정 함수는 건드리지 않으며, 여기서는 이미 나온 판정값을
// 입력으로 받아 표시용 HTML만 만든다.
// ────────────────────────────────────────────────────────────────────────────
const STATUS_TONE = {
  pass:  { icon: 'check',        label: '정상',     cls: 'qi-pass' },
  fail:  { icon: 'x',            label: '부족',     cls: 'qi-fail' },
  over:  { icon: 'warning',      label: '초과',     cls: 'qi-over' },
  warn:  { icon: 'alert-circle', label: '주의',     cls: 'qi-warn' },
  info:  { icon: 'info',         label: '참고',     cls: 'qi-info' },
  none:  { icon: 'minus',        label: '미함유',   cls: 'qi-none' },
  gated: { icon: 'minus',        label: '평가 제외', cls: 'qi-none' },
};
// 셀 배경이 이미 상태색을 칠하는 곳(ana-table 등)에서 쓰는 아이콘+문구만(배지 pill 없이).
function statusIconText(tone, size) {
  const t = STATUS_TONE[tone] || STATUS_TONE.none;
  return `${svgIcon(t.icon, size || 11)}${t.label}`;
}
// 배경이 없는 곳(quick-grid, 기준 충족 현황, Ca:P, 경고 요약 등)에서 쓰는 표준 pill 배지.
function statusBadge(tone, size) {
  const t = STATUS_TONE[tone] || STATUS_TONE.none;
  return `<span class="qi-badge ${t.cls}">${svgIcon(t.icon, size || 11)}${t.label}</span>`;
}

let toastHideTimer = null;
function showToast(msg) {
  const el = document.getElementById('app-toast');
  if (!el) return;
  el.innerHTML = escHtml(msg).replace(/\n/g, '<br>');
  el.classList.add('show');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── 라이트/다크 모드 ──
function setTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem('feedcalc_v4_theme', mode);
  syncThemeButtons();
}
function syncThemeButtons() {
  const mode = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('[data-theme-btn]').forEach(b => {
    b.classList.toggle('active', b.dataset.themeBtn === mode);
  });
}
// ════════════════════════════════════════════════════════════════════════════
// 탭 전환
// ════════════════════════════════════════════════════════════════════════════
const TAB_LABELS = {
  dash:'대시보드', product:'제품 / 정보', mix:'배합 설계', analysis:'분석 현황',
  ana:'영양소 분석', 'ana-energy':'에너지 분석', 'std-verify':'기준 검증', amino:'아미노산 분석', warn:'경고 패널', history:'변경 이력',
  std:'영양 기준 DB', glossary:'전문 용어', calcbasis:'계산 기준', law:'법령·광고기준', label:'표시사항 작성',
  ing:'원료 DB', settings:'설정', admin:'관리자',
};

// ── 페이지 로드 시점의 URL 해시 ───────────────────────────────────────────────
// index.html <head>의 첫 인라인 스크립트가 어떤 외부 스크립트보다 먼저 window.__NC_INITIAL_HASH에
// 원본 해시를 담아 둔다. 이후 인증 SDK 초기화 등이 해시를 지워도, 최초 탭 복원은 항상 이 값을
// 기준으로 삼는다 → "첫 새로고침만 대시보드로 튕기는" 타이밍 의존 버그 제거.
// (혹시 그 캡처가 없으면 현재 location.hash로 폴백한다.)
const INITIAL_URL_HASH = (function () {
  var src = (typeof window !== 'undefined' && typeof window.__NC_INITIAL_HASH === 'string')
    ? window.__NC_INITIAL_HASH : (location.hash || '');
  var raw = src.replace(/^#/, '');
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch (e) { return raw; }
})();

function toggleNavGroup(groupEl) {
  const willOpen = !groupEl.classList.contains('open');
  // 한 번에 하나의 그룹만 펼쳐 사이드바가 길어지지 않도록 아코디언 방식으로 동작한다.
  document.querySelectorAll('.nav-group.open').forEach(g => { if (g !== groupEl) g.classList.remove('open'); });
  groupEl.classList.toggle('open', willOpen);
}

// 사이드바 접기/펼치기 — <html>에 클래스를 둬서(head의 early-script와 동일한 기준점) 새로고침 시에도
// 깜빡임 없이 마지막 상태를 즉시 복원할 수 있게 한다. #sidebar 자체의 너비는 CSS(width transition)만
// 바꾸고, #main은 flex:1이라 자동으로 나머지 공간을 채운다 — JS로 폭을 계산하지 않는다.
function toggleSidebarCollapse() {
  const willCollapse = !document.documentElement.classList.contains('sidebar-collapsed');
  document.documentElement.classList.toggle('sidebar-collapsed', willCollapse);
  localStorage.setItem('feedcalc_v4_sidebar_collapsed', willCollapse ? '1' : '0');
  hideSidebarTooltip();
}

// 접힌 상태에서만 아이콘에 마우스를 올리면 메뉴명을 Tooltip으로 보여준다. 사이드바 자체가
// overflow-y:auto(=overflow-x도 auto로 강제됨)라 CSS ::after로는 잘려서, body 레벨 요소를
// JS로 좌표 계산해 띄운다(getBoundingClientRect 기준이라 이 앱의 zoom:1.1과도 충돌하지 않는다).
function hideSidebarTooltip() {
  document.getElementById('sidebar-tooltip')?.classList.remove('show');
}
function initSidebarTooltips() {
  const tooltip = document.getElementById('sidebar-tooltip');
  if (!tooltip) return;
  document.querySelectorAll('#sidebar-nav .nav-item[data-label], #sidebar-nav .nav-group-hdr[data-label]').forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (!document.documentElement.classList.contains('sidebar-collapsed')) return;
      const r = el.getBoundingClientRect();
      tooltip.textContent = el.dataset.label;
      tooltip.style.left = (r.right + 10) + 'px';
      tooltip.style.top = (r.top + r.height / 2) + 'px';
      tooltip.style.transform = 'translateY(-50%)';
      tooltip.classList.add('show');
    });
    el.addEventListener('mouseleave', hideSidebarTooltip);
  });
}
initSidebarTooltips();

function showTab(id, el) {
  const pane = document.getElementById('tab-'+id);
  if (!pane) return;
  // data-requires-role="super_admin" 같은 속성만 붙이면 이 가드가 자동으로 접근을 막는다 —
  // 새 관리자 전용 탭을 추가할 때 이 함수는 건드릴 필요가 없다.
  if (pane.dataset.requiresRole && pane.dataset.requiresRole !== currentUserRole) return;
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('has-active'));
  pane.classList.add('active');
  if (el) el.classList.add('active');
  // 하위 메뉴가 속한 아코디언 그룹은 자동으로 펼치고 강조 표시한다(직접 클릭 진입 + 새로고침
  // 후 마지막 탭 복원(goTab) 양쪽 모두 여기 한 곳에서 처리됨).
  const parentGroup = el ? el.closest('.nav-group') : null;
  document.querySelectorAll('.nav-group').forEach(g => g.classList.toggle('open', g === parentGroup));
  if (parentGroup) parentGroup.classList.add('has-active');
  const vt = document.getElementById('top-view-title');
  if (vt) vt.textContent = TAB_LABELS[id] || '';
  sessionStorage.setItem('feedcalc_v4_tab', id);
  syncTabHash(id);   // 현재 탭을 URL 해시(#dash, #ing, ...)에 반영 → 새로고침·뒤로가기에서 복원 가능
  if (lastResult) syncPanelWidths();
  // 관리자 탭은 클릭으로 진입하든(사이드바) 새로고침 후 마지막 탭 복원으로 진입하든
  // (goTab(savedTab)) 항상 최신 목록을 불러오도록 여기서 한 번만 트리거한다.
  if (id === 'admin') loadAdminUsers();
  if (id === 'mix') syncMixRecipeNameField();
  if (id === 'history') renderChangeHistory();
  if (id === 'label' && typeof renderLabelDraft === 'function') renderLabelDraft();
}

// 배합 설계 탭의 "레시피명" 입력칸 — 제품/정보 탭의 sb-name과 같은 값을 가리키는
// 별도 입력창이다(입력 즉시 sb-name에 반영, 탭 진입/레시피 불러오기 시 syncMixRecipeNameField로 역방향 동기화).
function onMixRecipeNameInput(value) {
  const nameEl = document.getElementById('sb-name');
  if (nameEl) nameEl.value = value;
}
function syncMixRecipeNameField() {
  const mixNameEl = document.getElementById('mix-recipe-name');
  const nameEl = document.getElementById('sb-name');
  if (mixNameEl && nameEl) mixNameEl.value = nameEl.value;
}

function goTab(id) {
  showTab(id, document.querySelector('.nav-item[data-tab="'+id+'"]'));
}

// ── URL 해시 기반 라우팅 ──────────────────────────────────────────────────────
// 현재 탭을 URL 해시(#dash, #ing, #std, ...)에 반영해서
//  · Ctrl+R / Ctrl+Shift+R 새로고침 후에도 보던 화면이 그대로 복원되고
//  · 브라우저 뒤로/앞으로 가기로 탭 사이를 오갈 수 있게 한다.
// 기존 sessionStorage(feedcalc_v4_tab) 저장은 그대로 두고, 복원 우선순위만
// "해시 > sessionStorage > 대시보드(dash)". 탭 전환 로직 자체(showTab/goTab)는 그대로다.
function isValidTabId(id) {
  return !!id
    && Object.prototype.hasOwnProperty.call(TAB_LABELS, id)
    && !!document.getElementById('tab-' + id);
}

// showTab()에서 호출 — 현재 해시와 다를 때만 바꿔 hashchange 재귀를 피한다.
// replace=true(초기 복원)면 히스토리 항목을 만들지 않고, 사용자의 탭 클릭은 항목을 남겨 뒤로가기가 동작한다.
function syncTabHash(id, replace) {
  if (!id) return;
  const target = '#' + id;
  if (location.hash === target) return;
  if (/type=recovery/.test(location.hash)) return;   // 비밀번호 재설정 링크(#...type=recovery)는 건드리지 않음
  if (replace && history.replaceState) history.replaceState(null, '', target);
  else location.hash = target;
}

// 초기 로드 시 복원할 탭 ID 결정: URL 해시(로드 시점 캡처값) > sessionStorage > 'dash'.
// location.hash를 다시 읽지 않고 INITIAL_URL_HASH를 쓰므로, init()이 늦게 실행되거나
// 그 사이 해시가 지워져도 항상 최초 URL 기준으로 같은 탭을 복원한다(새로고침 횟수 무관).
function initialTabId() {
  if (/type=recovery/.test(location.hash) || /type=recovery/.test(INITIAL_URL_HASH)) return 'dash';
  if (isValidTabId(INITIAL_URL_HASH)) return INITIAL_URL_HASH;
  const saved = sessionStorage.getItem('feedcalc_v4_tab');
  if (saved && document.getElementById('tab-' + saved)) return saved;
  return 'dash';
}

// 뒤로/앞으로 가기 또는 주소창에서 해시를 직접 바꾼 경우 해당 탭으로 전환한다.
// (탭 클릭으로 생긴 해시 변경은 이미 그 탭이 active라 아래 조건에서 걸러져 아무 일도 하지 않는다.)
window.addEventListener('hashchange', () => {
  let id = '';
  try { id = decodeURIComponent(location.hash.replace(/^#/, '')); } catch (e) { id = location.hash.replace(/^#/, ''); }
  if (!isValidTabId(id)) {
    // 외부 코드(예: 라이브러리 초기화)가 해시를 통째로 지웠는데 유효한 탭이 열려 있으면,
    // 그 탭 해시를 되살려 URL을 일관되게 유지한다 — 다음 새로고침이 대시보드로 튀지 않도록.
    if (location.hash === '' && document.getElementById('login-overlay')?.classList.contains('hidden')) {
      const active = document.querySelector('.tab-pane.active');
      const activeId = active ? active.id.replace(/^tab-/, '') : '';
      if (activeId && activeId !== 'dash' && isValidTabId(activeId)) syncTabHash(activeId, true);
    }
    return;
  }
  if (document.getElementById('tab-' + id).classList.contains('active')) return;
  goTab(id);
});

// ── 플로팅 액션 버튼 ──
function toggleFab() {
  document.getElementById('fab').classList.toggle('open');
}
function closeFab() {
  document.getElementById('fab').classList.remove('open');
}
function fabAction(fn) {
  closeFab();
  fn();
}
document.addEventListener('click', (e) => {
  const fab = document.getElementById('fab');
  if (fab && fab.classList.contains('open') && !fab.contains(e.target)) closeFab();
});

// ════════════════════════════════════════════════════════════════════════════
// 세그먼트 컨트롤(동물종류/성별/중성화) & BCS 컬러 게이지 바
// 실제 값은 숨겨진 <select>가 그대로 보유하고, 여기 있는 함수들은 그 select와 커스텀 UI를
// 서로 동기화만 시켜준다 — onSpeciesChange()/calculate() 등 기존 로직은 전혀 건드리지 않는다.
// ════════════════════════════════════════════════════════════════════════════
function syncSegmentedControls() {
  document.querySelectorAll('.seg-control[data-for]').forEach(seg => {
    const target = document.getElementById(seg.dataset.for);
    if (!target) return;
    seg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === target.value);
    });
  });
}
function initSegmentedControls() {
  document.querySelectorAll('.seg-control[data-for]').forEach(seg => {
    const target = document.getElementById(seg.dataset.for);
    if (!target) return;
    seg.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (target.value === btn.dataset.value) return;
        target.value = btn.dataset.value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        syncSegmentedControls();
      });
    });
  });
  syncSegmentedControls();
}

const BCS_LABELS = {
  1: '1단계 (매우 마름)', 2: '2단계', 3: '3단계', 4: '4단계',
  5: '5단계 (이상적 체형)', 6: '6단계', 7: '7단계', 8: '8단계', 9: '9단계 (고도비만)',
};
function syncBcsGauge() {
  const target = document.getElementById('pet-bcs');
  const gauge  = document.querySelector('.bcs-gauge[data-for="pet-bcs"]');
  if (!target || !gauge) return;
  const val = parseInt(target.value, 10) || 5;
  gauge.querySelectorAll('.bcs-seg').forEach(seg => {
    seg.classList.toggle('active', parseInt(seg.dataset.value, 10) === val);
  });
  const chip = gauge.querySelector('.bcs-chip');
  if (chip) {
    chip.textContent = BCS_LABELS[val] || `${val}단계`;
    chip.style.left = `${(val - 0.5) / 9 * 100}%`;
  }
}
function initBcsGauge() {
  const target = document.getElementById('pet-bcs');
  const gauge  = document.querySelector('.bcs-gauge[data-for="pet-bcs"]');
  if (!target || !gauge) return;
  gauge.querySelectorAll('.bcs-seg').forEach(seg => {
    seg.addEventListener('click', () => {
      if (target.value === seg.dataset.value) return;
      target.value = seg.dataset.value;
      target.dispatchEvent(new Event('change', { bubbles: true }));
      syncBcsGauge();
    });
  });
  syncBcsGauge();
}

// ── 알레르기/제외 원료 — 배합 설계 행과 동일한 원료 검색 드롭다운(mix-ing-wrap/initIngCombo)으로
// 고르면 옆 목록 상자에 추가되고, ✕ 클릭 시 제거된다. 실제 값은 숨겨진 input(#pet-allergy)에
// 문자열로 그대로 저장되어 기존 저장/불러오기(PET_PROFILE_FIELDS) 로직을 그대로 재사용한다.
//
// 구분자는 쉼표(,)가 아니라 '|'를 쓴다 — 원료명 자체에 쉼표가 들어간 항목이 많아
// (예: "닭고기(가슴,생것)") 쉼표로 join/split하면 그 이름이 둘로 쪼개지는 문제가 있었다.
// 예전에 쉼표로 저장된 값도 그대로 읽을 수 있도록, '|'가 없으면 쉼표를 기준으로 한 번 더 시도한다.
function getAllergyList() {
  const target = document.getElementById('pet-allergy');
  if (!target || !target.value) return [];
  const raw = target.value;
  // '|'가 있으면 새 방식(파이프 구분)으로 나눈다. 없으면 예전 방식("이름, 이름" — 쉼표+공백 구분)을
  // 시도한다 — 원료명 안에 들어간 쉼표는 뒤에 공백이 없어(예: "닭고기(가슴,생것)") 예전 구분자
  // ", "와 겹치지 않으므로, 항목이 1개뿐이라 '|'가 안 붙은 경우에도 이름이 안 쪼개진다.
  const parts = raw.includes('|') ? raw.split('|') : raw.split(', ');
  return parts.map(s => s.trim()).filter(Boolean);
}
function setAllergyList(list) {
  const target = document.getElementById('pet-allergy');
  if (!target) return;
  target.value = list.join('|');
  target.dispatchEvent(new Event('change', { bubbles: true }));
  syncAllergyControl();
}
function addAllergyItem(name) {
  if (!name) return;
  const list = getAllergyList();
  if (!list.includes(name)) {
    list.push(name);
    setAllergyList(list);
  }
}
function removeAllergyItem(name) {
  setAllergyList(getAllergyList().filter(n => n !== name));
}
function syncAllergyControl() {
  const box = document.getElementById('allergy-list');
  if (!box) return;
  const list = getAllergyList();
  box.innerHTML = '';
  if (list.length === 0) {
    box.innerHTML = '<div class="allergy-list-empty">선택된 원료가 없습니다</div>';
  } else {
    list.forEach(name => {
      const row = document.createElement('div');
      row.className = 'allergy-item';
      const label = document.createElement('span');
      label.textContent = name;
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'rm-btn';
      rmBtn.textContent = '✕';
      rmBtn.onclick = () => removeAllergyItem(name);
      row.appendChild(label);
      row.appendChild(rmBtn);
      box.appendChild(row);
    });
  }
  // 알레르기 목록이 바뀔 때마다 배합 설계 탭의 원료 선택 영역 경고 표시와 대시보드
  // "경고 항목" 집계(알레르기 건수 포함)를 함께 즉시 갱신한다. calculate()가 이미
  // updateMixAllergyWarnings()/updateDashboard()를 모두 호출하므로 여기서 그대로 재사용한다.
  calculate();
}
// 알레르기 등록 UI는 배합 설계 행과 똑같은 원료 검색 드롭다운 컴포넌트를 그대로 재사용한다
// (별도 드롭다운을 새로 만들지 않음) — 다만 고른 원료는 그 자리에 남기지 않고 목록에
// 추가한 뒤 바로 placeholder로 되돌린다(여러 개를 연달아 고를 수 있어야 하므로).
function initAllergyControl() {
  const wrap = document.getElementById('allergy-combo-wrap');
  if (!wrap) return;
  initIngCombo(wrap, (name) => addAllergyItem(name));
  syncAllergyControl();
}

// ════════════════════════════════════════════════════════════════════════════
// 알림(우측 상단 Bell → 우측 슬라이드 Drawer) — 아직 서버 발행 알림 시스템이 없어
// 예시 데이터를 정적으로 표시한다. 백엔드 알림 API가 생기면 NOTIF_ITEMS를 그 응답으로 교체하면 된다.
// ════════════════════════════════════════════════════════════════════════════
const NOTIF_ITEMS = [
  { id: 'energy-tab-added', title: '에너지 분석 탭 추가', desc: 'ME·RER/MER·칼로리 조성·AAFCO 열량 밀도 보정을 한 화면에서 확인할 수 있습니다.', time: '방금 전', unread: true },
  { id: 'glossary-updated', title: '용어 사전 업데이트', desc: 'AAFCO·NRC·FEDIAF 등 전문 용어 27개를 검색 가능한 사전 형태로 정리했습니다.', time: '오늘', unread: true },
  { id: 'calc-basis-doc-added', title: '계산 기준 문서 추가', desc: '이 계산기가 사용하는 공식·기준·판정 로직을 한 곳에서 확인할 수 있습니다.', time: '어제', unread: false },
  { id: 'sidebar-ui-improved', title: '사이드바 UI 개선', desc: '메뉴 아이콘과 여백을 다듬어 가독성을 높였습니다.', time: '3일 전', unread: false },
];

const NOTIF_READ_STORAGE_KEY = 'notif_read_ids';

function getReadNotifIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIF_READ_STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveReadNotifIds(ids) {
  localStorage.setItem(NOTIF_READ_STORAGE_KEY, JSON.stringify([...ids]));
}

(function applyStoredNotifReadState() {
  const readIds = getReadNotifIds();
  NOTIF_ITEMS.forEach(n => { if (readIds.has(n.id)) n.unread = false; });
})();

function renderNotifList() {
  const listEl = document.getElementById('notif-list');
  if (!listEl) return;
  listEl.innerHTML = NOTIF_ITEMS.length
    ? NOTIF_ITEMS.map(n => `
        <div class="notif-item">
          <div class="notif-dot-col">${n.unread ? '<span class="notif-unread-dot"></span>' : ''}</div>
          <div class="notif-body">
            <div class="notif-title">${n.title}</div>
            <div class="notif-desc">${n.desc}</div>
            <div class="notif-time">${n.time}</div>
          </div>
        </div>`).join('')
    : '<div class="notif-empty">새로운 알림이 없습니다.</div>';

  const dotEl = document.getElementById('notif-dot');
  if (dotEl) dotEl.classList.toggle('show', NOTIF_ITEMS.some(n => n.unread));
}

function openNotifDrawer() {
  document.getElementById('notif-overlay').classList.add('open');
  document.getElementById('notif-drawer').classList.add('open');
  // Drawer를 열어 알림을 확인한 시점에 모두 읽음 처리 — 안읽음 Dot(아이템·Bell 모두)이 즉시 사라진다.
  // localStorage에도 저장해 새로고침 후에도 읽음 상태가 유지되게 한다.
  if (NOTIF_ITEMS.some(n => n.unread)) {
    const readIds = getReadNotifIds();
    NOTIF_ITEMS.forEach(n => { n.unread = false; readIds.add(n.id); });
    saveReadNotifIds(readIds);
    renderNotifList();
  }
}
function closeNotifDrawer() {
  document.getElementById('notif-overlay').classList.remove('open');
  document.getElementById('notif-drawer').classList.remove('open');
}
function toggleNotifDrawer() {
  const isOpen = document.getElementById('notif-drawer').classList.contains('open');
  if (isOpen) closeNotifDrawer(); else openNotifDrawer();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('notif-drawer')?.classList.contains('open')) closeNotifDrawer();
});
