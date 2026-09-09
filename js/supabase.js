// supabase.js — Supabase 클라이언트/세션 스토리지/인증 공통 상수. index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 로그인 (Supabase Auth — 이메일/비밀번호, 관리자 직접 생성 기반)
// 회원가입 기능은 없음 — 계정은 반드시 관리자 페이지의 "사용자 추가"를 통해
// Edge Function(supabase/functions/create-user)이 service_role 키로 auth.admin.createUser()를
// 호출해야만 생성된다(브라우저에 노출되는 anon key로는 관리자 API를 직접 호출할 수 없다).
// ⚠ Supabase 프로젝트의 Authentication → Providers → Email → "Allow new users to sign up"도
//   반드시 꺼야 한다 — 이 파일에서 가입 폼을 지워도, 그 설정이 켜져 있으면 REST API로 직접
//   호출해 계정을 만드는 것까지는 막지 못한다.
// ⚠ 여기에는 Project URL과 Publishable(anon) key만 넣는다 — Database Password나
//   Secret(service_role) key는 브라우저에 노출되는 코드에 절대 넣지 않는다.
// ════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://kvxlpuagwmfbylgzpvuo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JoBouB63T2DPWnsWc_y9ag_fSB0LX87';   // Publishable(anon) key

// Supabase Auth는 이메일이 필수라, 사용자가 입력하는 "아이디"를 결정적으로(항상 같은 결과로)
// 내부용 가짜 이메일로 변환해 auth.users에 저장한다. 사용자·관리자 화면에는 이 이메일이
// 절대 노출되지 않고 항상 아이디만 보인다 — create-user Edge Function도 동일한 규칙을 쓴다.
const AUTH_ID_EMAIL_DOMAIN = 'id.nutricirc.local';
function idToAuthEmail(id) { return id.trim().toLowerCase() + '@' + AUTH_ID_EMAIL_DOMAIN; }

// supabase-js는 Edge Function이 4xx/5xx를 반환하면 항상 error.message를 고정 문구
// ("Edge Function returned a non-2xx status code")로 채우고, 우리가 Edge Function에서
// json({error: '...'})로 보낸 실제 메시지는 error.context(원본 Response)에만 남긴다.
// 여기서 그 본문을 다시 읽어 실제 에러 메시지를 꺼낸다.
async function extractFnError(error, fallbackMsg) {
  if (error && error.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json();
      if (body && body.error) return body.error;
    } catch {}
  }
  return (error && error.message) || fallbackMsg;
}

// "로그인 유지하기" 체크박스 상태 저장용 키(순수 로컬 설정값 — Supabase 세션 자체와는 별개)
const KEEP_LOGIN_KEY = 'feedcalc_v4_keep_login';
const REMEMBER_EMAIL_KEY = 'feedcalc_v4_remember_email';
function isKeepLoginOn() { return localStorage.getItem(KEEP_LOGIN_KEY) !== 'false'; } // 기본값: 유지함

// 새로고침 후 로그인 화면으로 돌아가는 문제의 원인을 콘솔에서 바로 확인하기 위한 디버그 로그.
// 토큰 원문은 절대 출력하지 않고, 존재 여부·만료 시각 등 진단에 필요한 메타데이터만 남긴다.
function authLog(...args) { console.log('%c[AUTH]', 'color:#5a6b7a;font-weight:700', ...args); }

// Supabase 세션을 localStorage에 저장하는 커스텀 스토리지 어댑터.
// localStorage는 탭/창을 닫아도, 브라우저를 재시작해도, 컴퓨터를 재부팅해도 유지되므로,
// 사용자가 명시적으로 로그아웃(auth.signOut())하기 전까지는 다음 실행에서 자동 로그인된다.
// persistSession + autoRefreshToken(아래 createClient 옵션)이 이 저장소를 읽어 세션을 복원하고
// 만료 전 refresh token으로 액세스 토큰을 자동 갱신한다.
// getItem에서 sessionStorage도 한 번 확인하는 이유: 직전 정책(sessionStorage 저장)으로 로그인해 둔
// 사용자를 로그아웃 없이 이어받기 위함(있으면 localStorage로 옮겨 이후 재시작에도 유지되게 한다).
// Supabase 공식 커스텀 스토리지 예제와 동일하게 async 함수로 구현한다 — supabase-js가 내부적으로
// storage 메서드를 Promise로 취급하는 경로가 있어, 동기 함수로 두면 버전에 따라 세션 하이드레이션이
// 조용히 실패할 수 있다.
const authStorage = {
  getItem: async (key) => {
    let value = localStorage.getItem(key);
    if (value === null) {
      const carried = sessionStorage.getItem(key);
      if (carried !== null) {
        localStorage.setItem(key, carried);
        value = carried;
        authLog('storage.getItem', key, '→ sessionStorage 세션을 localStorage로 이관');
      }
    }
    authLog('storage.getItem', key, '→', value ? `found (localStorage, ${value.length}자)` : 'NOT FOUND');
    return value;
  },
  setItem: async (key, value) => {
    localStorage.setItem(key, value);
    authLog('storage.setItem', key, '→ localStorage', `(${value.length}자)`);
  },
  removeItem: async (key) => {
    // 로그아웃 시 양쪽 저장소의 세션 키를 모두 정리한다(직전 정책의 잔여분 포함).
    localStorage.removeItem(key); sessionStorage.removeItem(key);
    authLog('storage.removeItem', key);
  },
};

const supabaseClient = (window.supabase && SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: authStorage,
        // CDN 스크립트가 메이저 버전(@2)만 고정돼 있어 마이너/패치 버전이 바뀌면 기본값이
        // 달라질 수 있다 — 새로고침 시 세션 유지에 필요한 옵션들을 명시적으로 켜 둔다.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
