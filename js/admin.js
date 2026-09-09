// admin.js — 권한(Role) 시스템 + 사용자 관리(관리자 페이지). index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 권한(Role) 시스템 — public.profiles.role 컬럼("super_admin" | "user")을 로그인 직후
// 조회해 관리자 전용 메뉴/페이지 노출을 제어한다.
// · 새 관리자 전용 요소는 HTML에 data-requires-role="super_admin"만 붙이면 applyRoleUI()가
//   자동으로 숨기고, showTab()이 자동으로 진입을 막는다 — 이 두 함수는 다시 손댈 필요 없음.
// · 실제 "사용자 생성/역할 변경" 같은 관리 기능은 여기 currentUserRole/isSuperAdmin()을
//   그대로 재사용하되, Supabase admin API(service_role 키 필요) 호출은 반드시 서버
//   사이드(Edge Function 등)에서만 수행한다 — 브라우저의 anon key로는 호출할 수 없다.
// ════════════════════════════════════════════════════════════════════════════
const ROLES = { SUPER_ADMIN: 'super_admin', USER: 'user' };
let currentUserRole = null; // 로그인 후 fetchCurrentUserRole()로 채워짐 — 로그아웃 상태면 null

function isSuperAdmin() { return currentUserRole === ROLES.SUPER_ADMIN; }

// profiles 테이블에서 현재 로그인 사용자의 role을 조회한다.
// 행이 없거나 조회에 실패하면 안전하게 'user' 권한으로 취급한다(fail-closed).
async function fetchCurrentUserRole() {
  if (!supabaseClient || !currentUser) { currentUserRole = null; return currentUserRole; }
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .maybeSingle();
  if (error) console.warn('사용자 role 조회 실패 — user 권한으로 처리합니다:', error.message);
  currentUserRole = (data && data.role) || ROLES.USER;
  return currentUserRole;
}

// role에 따라 [data-requires-role] 요소의 노출 여부를 일괄 반영한다.
function applyRoleUI() {
  const allowed = isSuperAdmin();
  document.querySelectorAll('[data-requires-role="super_admin"]').forEach(el => {
    el.style.display = allowed ? '' : 'none';
  });
  // 관리자 페이지를 보던 중 권한이 바뀐 경우(드묾) 대시보드로 되돌린다.
  if (!allowed && document.getElementById('tab-admin')?.classList.contains('active')) goTab('dash');
}

// 사용자 계정 생성 — auth.admin.createUser()는 service_role 키가 필요해 브라우저에서
// 직접 호출할 수 없으므로, Supabase Edge Function(supabase/functions/create-user)을 통해서만
// 수행한다. 그 함수가 호출자의 super_admin 권한을 서버 사이드에서 다시 검증하므로, 여기
// isSuperAdmin() 체크는 UX상 즉시 피드백을 주기 위한 1차 방어일 뿐이다.
async function createUserAccount() {
  const emailInput = document.getElementById('create-user-email');
  const pwInput = document.getElementById('create-user-password');
  const roleSelect = document.getElementById('create-user-role');
  const btn = document.getElementById('create-user-btn');
  const msg = document.getElementById('create-user-msg');
  const id = emailInput.value.trim();
  const password = pwInput.value;
  const role = roleSelect.value;

  msg.style.color = '#B03A2E';
  if (!isSuperAdmin()) { msg.textContent = 'super_admin 권한이 필요합니다.'; return; }
  if (!id) { msg.textContent = '아이디를 입력하세요.'; return; }
  if (!password || password.length < 4) { msg.textContent = '초기 비밀번호는 4자 이상이어야 합니다.'; return; }
  if (!supabaseClient) { msg.textContent = friendlyAuthError(); return; }

  btn.disabled = true; btn.textContent = '생성 중...'; msg.textContent = '';
  try {
    const { data, error } = await supabaseClient.functions.invoke('create-user', { body: { username: id, password, role } });
    if (error || data?.error) {
      msg.style.color = '#B03A2E';
      msg.textContent = (data && data.error) || await extractFnError(error, '계정 생성 중 오류가 발생했습니다.');
      return;
    }
    msg.style.color = 'var(--pass-t)';
    msg.textContent = `계정이 생성되었습니다.\n아이디: ${id}\n초기 비밀번호: ${password}`;
    emailInput.value = ''; pwInput.value = ''; roleSelect.value = 'user';
    loadAdminUsers();
  } finally {
    btn.disabled = false; btn.textContent = '계정 생성';
  }
}

// ── 사용자 관리(관리자 페이지) — profiles 테이블의 사용자 목록을 조회해 표시한다.
// super_admin만 select 가능하도록 RLS에서도 막혀 있지만(001_profiles_role.sql의
// "profiles: super_admin select all" 정책), UI 쪽에서도 한 번 더 방어적으로 확인한다.
// 향후 역할 변경 등 관리 기능을 추가할 때도 이 테이블 렌더링 방식을 그대로 확장하면 된다.
async function loadAdminUsers() {
  const box = document.getElementById('admin-user-list');
  if (!box || !supabaseClient) return;
  if (!isSuperAdmin()) return;

  box.innerHTML = '';
  const loading = document.createElement('div');
  loading.style.cssText = 'font-size:11px;color:var(--sub)';
  loading.textContent = '사용자 목록을 불러오는 중...';
  box.appendChild(loading);

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, username, email, role, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    box.innerHTML = '';
    const errEl = document.createElement('div');
    errEl.style.cssText = 'font-size:11px;color:#B03A2E';
    errEl.textContent = '사용자 목록을 불러오지 못했습니다: ' + error.message;
    box.appendChild(errEl);
    return;
  }
  renderAdminUserTable(box, data || []);
}

function renderAdminUserTable(box, rows) {
  box.innerHTML = '';
  // 마지막 남은 super_admin만 보호한다(서버 delete-user도 동일한 카운트 규칙을 다시 검증함) —
  // super_admin이 2명 이상이면 본인이 아닌 다른 super_admin은 삭제 버튼을 눌러도 된다.
  const superAdminCount = rows.filter(r => r.role === 'super_admin').length;
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:var(--sub);text-align:center;padding:10px 8px';
    empty.textContent = '등록된 사용자가 없습니다.';
    box.appendChild(empty);
    return;
  }

  const tableWrap = document.createElement('div');
  tableWrap.id = 'admin-user-table-wrap';
  const table = document.createElement('table');
  table.id = 'admin-user-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['아이디', 'Role', '생성일', '상태', '관리'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');

    const tdEmail = document.createElement('td');
    tdEmail.className = 'left';
    tdEmail.textContent = row.username || row.email || '─';
    tdEmail.title = tdEmail.textContent; // 말줄임표로 잘린 아이디를 마우스 오버로 확인 가능하게

    const tdRole = document.createElement('td');
    tdRole.className = 'center';
    tdRole.textContent = row.role || 'user';
    if (row.role === 'super_admin') tdRole.classList.add('info');

    const tdCreated = document.createElement('td');
    tdCreated.className = 'center';
    tdCreated.textContent = row.created_at
      ? new Date(row.created_at).toLocaleString('ko-KR')
      : '─';

    // 계정 정지/비활성화 기능이 없으므로 profiles에 등록된 계정은 모두 활성 상태로 표시한다.
    const tdStatus = document.createElement('td');
    tdStatus.className = 'center';
    tdStatus.textContent = '활성';

    // 관리(편집/삭제) — 본인 계정 삭제와 "마지막 남은" super_admin 삭제는 버튼 자체를 비활성화해
    // Edge Function을 호출하기 전에 UI에서부터 막는다(서버 사이드 검증은 delete-user에서 재수행).
    const tdActions = document.createElement('td');
    tdActions.className = 'center';
    const isSelf = row.id === (currentUser && currentUser.id);
    const editBtn = document.createElement('button');
    editBtn.className = 'settings-opt-btn';
    editBtn.style.cssText = 'padding:4px 10px;font-size:10.5px;margin-right:4px';
    editBtn.textContent = '편집';
    editBtn.onclick = () => openEditUserModal(row);
    const delBtn = document.createElement('button');
    delBtn.className = 'settings-opt-btn';
    delBtn.style.cssText = 'padding:4px 10px;font-size:10.5px;color:#B03A2E;border-color:#B03A2E';
    delBtn.textContent = '삭제';
    const isLastSuperAdmin = row.role === 'super_admin' && superAdminCount <= 1;
    if (isSelf || isLastSuperAdmin) {
      delBtn.disabled = true;
      delBtn.style.opacity = '0.4';
      delBtn.style.cursor = 'not-allowed';
      delBtn.title = isSelf ? '본인 계정은 삭제할 수 없습니다.' : '마지막 남은 관리자(super_admin) 계정은 삭제할 수 없습니다.';
    } else {
      delBtn.onclick = () => deleteUserAccount(row);
    }
    tdActions.appendChild(editBtn);
    tdActions.appendChild(delBtn);

    tr.appendChild(tdEmail);
    tr.appendChild(tdRole);
    tr.appendChild(tdCreated);
    tr.appendChild(tdStatus);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  box.appendChild(tableWrap);
}

let editUserTargetId = null;

function openEditUserModal(row) {
  editUserTargetId = row.id;
  document.getElementById('edit-user-email').value = row.username || row.email || '';
  const roleSelect = document.getElementById('edit-user-role');
  roleSelect.value = row.role || 'user';
  const isSelf = row.id === (currentUser && currentUser.id);
  roleSelect.disabled = isSelf;
  document.getElementById('edit-user-role-note').style.display = isSelf ? '' : 'none';
  document.getElementById('edit-user-password').value = '';
  document.getElementById('edit-user-err').textContent = '';
  document.getElementById('admin-edit-modal').classList.add('open');
}

// 저장 — role은 본인이 아닐 때만, password는 입력된 경우에만 update-user Edge Function에 보낸다.
// 서버(update-user)가 super_admin 권한과 본인 권한 변경 금지를 다시 검증하므로, 여기 UI 체크는
// 1차 방어일 뿐이다.
async function saveEditUser() {
  const btn = document.getElementById('edit-user-save-btn');
  const err = document.getElementById('edit-user-err');
  const roleSelect = document.getElementById('edit-user-role');
  const pwInput = document.getElementById('edit-user-password');
  const isSelf = editUserTargetId === (currentUser && currentUser.id);
  const password = pwInput.value;

  err.textContent = '';
  if (!isSuperAdmin()) { err.textContent = 'super_admin 권한이 필요합니다.'; return; }
  if (!editUserTargetId) { err.textContent = '대상 사용자를 확인할 수 없습니다.'; return; }
  if (password && password.length < 4) { err.textContent = '비밀번호는 4자 이상이어야 합니다.'; return; }
  if (!supabaseClient) { err.textContent = friendlyAuthError(); return; }

  const body = { targetUserId: editUserTargetId };
  if (!isSelf) body.role = roleSelect.value;
  if (password) body.password = password;

  if (body.role === undefined && body.password === undefined) {
    err.textContent = '변경할 내용이 없습니다.';
    return;
  }

  btn.disabled = true; btn.textContent = '저장 중...'; err.textContent = '';
  try {
    const { data, error } = await supabaseClient.functions.invoke('update-user', { body });
    if (error || data?.error) {
      err.textContent = (data && data.error) || await extractFnError(error, '저장 중 오류가 발생했습니다.');
      return;
    }
    closeModal('admin-edit-modal');
    loadAdminUsers();
  } finally {
    btn.disabled = false; btn.textContent = '저장';
  }
}

// 삭제 — 확인창을 거친 뒤 delete-user Edge Function을 호출한다. 본인/super_admin 계정은
// 목록 렌더링 단계에서 이미 삭제 버튼이 비활성화되지만, 서버(delete-user)에서도 다시 검증한다.
async function deleteUserAccount(row) {
  if (!isSuperAdmin()) return;
  if (!confirm(`정말 '${row.username || row.email}' 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  if (!supabaseClient) { alert(friendlyAuthError()); return; }

  const { data, error } = await supabaseClient.functions.invoke('delete-user', { body: { targetUserId: row.id } });
  if (error || data?.error) {
    alert((data && data.error) || await extractFnError(error, '삭제 중 오류가 발생했습니다.'));
    return;
  }
  loadAdminUsers();
}

async function enterApp(session) {
  authLog('enterApp() 실행 — 로그인 오버레이 숨기고 메인 화면 표시', { userEmail: session?.user?.email ?? null, appAlreadyStarted: appStarted });
  currentUser = session ? session.user : null;
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('login-err').textContent = '';
  const emailEl = document.getElementById('account-email');
  if (emailEl) emailEl.textContent = currentUser ? `로그인 계정: ${currentUserLabel()}` : '';
  const initialEl = document.getElementById('profile-initial');
  if (initialEl) initialEl.textContent = currentUser ? currentUserLabel().charAt(0).toUpperCase() : '?';
  const dropdownEmailEl = document.getElementById('profile-dropdown-email');
  if (dropdownEmailEl) dropdownEmailEl.textContent = currentUser ? currentUserLabel() : '';
  await fetchCurrentUserRole();
  applyRoleUI();
  if (!appStarted) { appStarted = true; init(); }
}

// 우측 상단 프로필 원형 아이콘 — 드롭다운(이메일/설정/로그아웃) 토글
// #top-bar가 overflow-y:hidden이라 position:absolute로는 드롭다운 아래쪽이 잘렸다 —
// #top-search-results와 같은 방식으로 position:fixed + getBoundingClientRect() 기반
// 좌표 계산으로 바꿔 헤더 바깥에 그려지게 한다(디자인/항목/열고 닫는 동작은 동일).
function positionProfileDropdown() {
  const btn = document.getElementById('profile-btn');
  const dd = document.getElementById('profile-dropdown');
  if (!btn || !dd) return;
  const zoom = getBodyZoom();
  const r = btn.getBoundingClientRect();
  dd.style.top   = ((r.bottom + 8) / zoom) + 'px';
  dd.style.right = ((window.innerWidth - r.right) / zoom) + 'px';
}
function toggleProfileMenu(e) {
  e.stopPropagation();
  const dd = document.getElementById('profile-dropdown');
  if (!dd.classList.contains('open')) positionProfileDropdown();
  dd.classList.toggle('open');
}
function closeProfileMenu() {
  document.getElementById('profile-dropdown').classList.remove('open');
}
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('profile-menu-wrap');
  if (wrap && !wrap.contains(e.target)) closeProfileMenu();
});
window.addEventListener('resize', () => {
  const dd = document.getElementById('profile-dropdown');
  if (dd && dd.classList.contains('open')) positionProfileDropdown();
});
