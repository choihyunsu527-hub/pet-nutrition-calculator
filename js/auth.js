// auth.js — 로그인/로그아웃/비밀번호 재설정·변경/개인정보/enterApp/initAuthGate. index.html에서 분리.

let currentUser = null;   // 로그인된 Supabase 사용자 — 로그아웃 상태면 null

// 화면에 표시할 사용자 식별자 — create-user가 auth 계정의 user_metadata.username에 저장해둔
// 아이디가 있으면 그걸 쓰고(가짜 이메일은 절대 화면에 보이지 않게), 없으면(레거시 이메일 계정)
// 이메일을 그대로 보여준다.
function currentUserLabel() {
  if (!currentUser) return '';
  return currentUser.user_metadata?.username || currentUser.email || '';
}
let appStarted  = false;  // init()이 이미 실행됐는지(세션 확인·로그인 이벤트가 겹쳐도 init()은 1회만 실행)

// 현재 작업(레시피 배합) 변경 여부 — true면 창을 닫거나 새로고침할 때 확인창을 띄운다.
// init()이 끝나기 전까지의 초기 렌더링(calculate() 등)으로 인한 오탐을 막기 위해 appReady로 감싼다.
let isDirty  = false;
let appReady = false;
function markDirty() { if (appReady) isDirty = true; }

// Supabase가 반환하는 원본(영문) 에러 메시지를 이해하기 쉬운 한국어 메시지로 변환
function friendlyAuthError(err) {
  if (!supabaseClient) return 'Supabase 연결 정보(Project URL/Publishable key)가 설정되지 않았습니다.';
  const msg = (err && err.message) || '';
  if (/Invalid login credentials/i.test(msg)) return '아이디 또는 비밀번호가 올바르지 않습니다.';
  if (/Email not confirmed/i.test(msg))       return '이메일 인증이 완료되지 않은 계정입니다. 메일함을 확인해주세요.';
  if (/Unable to validate email address|invalid format|Invalid email/i.test(msg)) return '올바르지 않은 아이디 형식입니다.';
  if (/Password should be at least|Password.*characters/i.test(msg)) return '비밀번호가 너무 짧습니다(4자 이상 입력해주세요).';
  if (/Signups? (is|not) disabled|Signups not allowed|signups_disabled/i.test(msg)) return '이 계정으로는 로그인할 수 없습니다. 관리자에게 계정 발급을 문의하세요.';
  if (/rate limit/i.test(msg))                return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return '네트워크 연결을 확인해주세요.';
  return msg || '처리 중 오류가 발생했습니다.';
}

async function tryLogin() {
  const idInput     = document.getElementById('login-email');
  const pwInput     = document.getElementById('login-pw');
  const rememberEl  = document.getElementById('login-remember-id');
  const keepLoginEl = document.getElementById('login-keep');
  const btn         = document.getElementById('login-btn');
  const err         = document.getElementById('login-err');
  const id = idInput.value.trim();
  const password = pwInput.value;

  if (!supabaseClient) { err.textContent = friendlyAuthError(); return; }
  if (!id || !password) { err.textContent = '아이디와 비밀번호를 모두 입력하세요.'; return; }

  // "로그인 유지하기" 체크 상태를 세션 발급 전에 먼저 저장해야, authStorage가 이번 로그인 결과를
  // 올바른 저장소(localStorage/sessionStorage)에 기록한다.
  localStorage.setItem(KEEP_LOGIN_KEY, keepLoginEl.checked ? 'true' : 'false');

  btn.disabled = true; btn.textContent = '로그인 중...'; err.textContent = '';
  // '@'가 있으면 기존 이메일 기반 계정으로 보고 입력값을 그대로 이메일로 쓴다 — 무조건
  // idToAuthEmail()을 적용하면 레거시 이메일 계정이 "이메일@도메인" 형태의 존재하지 않는
  // 주소로 뒤바뀌어 로그인이 막힌다. '@'가 없는 순수 아이디만 가짜 이메일로 변환한다.
  const loginEmail = id.includes('@') ? id.toLowerCase() : idToAuthEmail(id);
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email: loginEmail, password });
  btn.disabled = false; btn.textContent = '로그인';

  if (error) {
    err.textContent = friendlyAuthError(error);
    pwInput.value = '';
    pwInput.focus();
    return;
  }

  if (rememberEl.checked) localStorage.setItem(REMEMBER_EMAIL_KEY, id);
  else localStorage.removeItem(REMEMBER_EMAIL_KEY);

  authLog('6. 메인 화면 표시 이유: signInWithPassword() 로그인 성공 → enterApp() 호출');
  enterApp(data.session);
}

// 로그인 화면 내 뷰 전환(로그인 / 비밀번호 찾기 / 새 비밀번호 설정)
// 'signup' 뷰는 없음 — 회원가입 기능 자체가 없고 계정은 관리자가 직접 생성하기 때문.
function showAuthView(view) {
  ['login','forgot','reset'].forEach(v => {
    document.getElementById('auth-view-' + v).classList.toggle('show', v === view);
  });
}

async function trySendResetEmail() {
  const emailInput = document.getElementById('forgot-email');
  const btn = document.getElementById('forgot-btn');
  const err = document.getElementById('forgot-err');
  const email = emailInput.value.trim();

  err.className = 'auth-err';
  if (!supabaseClient) { err.textContent = friendlyAuthError(); return; }
  if (!email) { err.textContent = '이메일을 입력하세요.'; return; }

  btn.disabled = true; btn.textContent = '전송 중...'; err.textContent = '';
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  btn.disabled = false; btn.textContent = '재설정 링크 보내기';

  if (error) { err.textContent = friendlyAuthError(error); return; }
  err.className = 'auth-err auth-msg-ok';
  err.textContent = '재설정 링크를 이메일로 보냈습니다. 메일함을 확인해주세요.';
}

// 이메일의 재설정 링크를 타고 들어오면 Supabase가 PASSWORD_RECOVERY 이벤트를 발생시키고
// 임시 세션을 발급한다(initAuthGate 참고) — 그 임시 세션 상태에서 새 비밀번호를 설정한다.
async function trySetNewPassword() {
  const pwInput  = document.getElementById('reset-pw');
  const pw2Input = document.getElementById('reset-pw2');
  const btn      = document.getElementById('reset-btn');
  const err      = document.getElementById('reset-err');
  const password  = pwInput.value;
  const password2 = pw2Input.value;

  err.className = 'auth-err';
  if (!supabaseClient) { err.textContent = friendlyAuthError(); return; }
  if (!password) { err.textContent = '새 비밀번호를 입력하세요.'; return; }
  if (password.length < 4) { err.textContent = '비밀번호는 4자 이상이어야 합니다.'; return; }
  if (password !== password2) { err.textContent = '비밀번호가 일치하지 않습니다.'; return; }

  btn.disabled = true; btn.textContent = '설정 중...'; err.textContent = '';
  const { error } = await supabaseClient.auth.updateUser({ password });
  btn.disabled = false; btn.textContent = '비밀번호 설정';

  if (error) { err.textContent = friendlyAuthError(error); return; }
  err.className = 'auth-err auth-msg-ok';

  err.textContent = '비밀번호가 변경되었습니다. 계산기로 이동합니다...';
  const { data: { session } } = await supabaseClient.auth.getSession();
  setTimeout(() => enterApp(session), 1000);
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  location.reload(); // 계산기 상태(배합행·리스너 등)를 안전하게 초기화하기 위해 새로고침
}

function openPwChangeModal() {
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-new2').value = '';
  document.getElementById('pw-change-err').textContent = '';
  document.getElementById('pw-change-modal').classList.add('open');
}

// 현재 비밀번호는 재로그인 시도로 검증한 뒤, Supabase 계정 비밀번호를 실제로 변경한다.
async function savePasswordChange() {
  const cur = document.getElementById('pw-current').value;
  const nw  = document.getElementById('pw-new').value;
  const nw2 = document.getElementById('pw-new2').value;
  const err = document.getElementById('pw-change-err');

  if (!supabaseClient || !currentUser) { err.textContent = '로그인 상태가 아닙니다.'; return; }
  if (!cur) { err.textContent = '현재 비밀번호를 입력하세요.'; return; }
  if (!nw)  { err.textContent = '새 비밀번호를 입력하세요.'; return; }
  if (nw.length < 4) { err.textContent = '새 비밀번호는 4자 이상이어야 합니다.'; return; }
  if (nw !== nw2) { err.textContent = '새 비밀번호가 일치하지 않습니다.'; return; }

  const { error: verifyErr } = await supabaseClient.auth.signInWithPassword({ email: currentUser.email, password: cur });
  if (verifyErr) { err.textContent = '현재 비밀번호가 올바르지 않습니다.'; return; }

  const { error: updateErr } = await supabaseClient.auth.updateUser({ password: nw });
  if (updateErr) { err.textContent = friendlyAuthError(updateErr); return; }

  closeModal('pw-change-modal');
  showToast('비밀번호가 변경되었습니다.');
}

// ── 프로필 드롭다운 "개인정보" — 이메일 확인 + 비밀번호 변경 전용 화면.
// 설정 탭의 savePasswordChange()(현재 비밀번호 재인증 방식)와는 별개의 화면이며,
// 여기서는 이미 로그인된 세션 기준으로 auth.updateUser()만 호출한다(본인 계정에만 영향).
function openMyInfoModal() {
  document.getElementById('my-info-email').value = currentUserLabel();
  document.getElementById('my-info-pw').value = '';
  document.getElementById('my-info-pw2').value = '';
  document.getElementById('my-info-err').textContent = '';
  document.getElementById('my-info-modal').classList.add('open');
}

// Supabase 원본 에러 메시지를 그대로 노출하지 않고, 비밀번호 정책 미충족/기타 오류로만 구분해 안내한다.
function friendlyPasswordChangeError(err) {
  const msg = (err && err.message) || '';
  if (/password/i.test(msg)) return '비밀번호는 최소 조건을 만족해야 합니다.';
  return '비밀번호 변경 중 오류가 발생했습니다.';
}

async function saveMyInfoPassword() {
  const pwInput  = document.getElementById('my-info-pw');
  const pw2Input = document.getElementById('my-info-pw2');
  const btn      = document.getElementById('my-info-save-btn');
  const err      = document.getElementById('my-info-err');
  const password  = pwInput.value;
  const password2 = pw2Input.value;

  err.textContent = '';
  if (!supabaseClient || !currentUser) { err.textContent = '로그인 상태가 아닙니다.'; return; }
  if (!password) { err.textContent = '새 비밀번호를 입력하세요.'; return; }
  if (password.length < 4) { err.textContent = '비밀번호는 4자 이상이어야 합니다.'; return; }
  if (password !== password2) { err.textContent = '비밀번호가 일치하지 않습니다.'; return; }

  btn.disabled = true; btn.textContent = '변경 중...';
  const { error } = await supabaseClient.auth.updateUser({ password });
  btn.disabled = false; btn.textContent = '비밀번호 변경';

  if (error) { err.textContent = friendlyPasswordChangeError(error); return; }

  pwInput.value = ''; pw2Input.value = '';
  closeModal('my-info-modal');
  showToast('비밀번호가 변경되었습니다.');
}

// 로그인 성공(또는 페이지 로드시 기존 세션 복원) 시 로그인 화면을 닫고 계산기 본체를 연다.
// init()은 여기서만(그리고 딱 1회만) 실행돼, 비로그인 상태에서는 계산기 로직 자체가 시작되지 않는다.
