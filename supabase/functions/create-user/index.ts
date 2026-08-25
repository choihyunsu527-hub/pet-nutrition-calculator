// ════════════════════════════════════════════════════════════════════════════
// 관리자 직접 계정 생성 Edge Function
//
// auth.admin.createUser()는 service_role 키가 있어야 호출할 수 있어
// 브라우저(anon key)에서는 직접 실행할 수 없다. 그래서 이 함수가 유일한 진입점이며,
// 아래 순서로 반드시 서버 사이드에서 두 가지를 확인한다:
//   1) 요청에 담긴 로그인 세션(JWT)이 유효한지
//   2) 그 사용자의 profiles.role이 정말 'super_admin'인지 (프런트의 isSuperAdmin()은
//      UX용일 뿐, 여기서 다시 검증하지 않으면 우회 호출로 아무나 계정을 만들 수 있다)
// 계정이 auth.users에 생기면 DB 트리거 on_auth_user_created(001_profiles_role.sql)가
// profiles 행을 role='user'로 자동 생성하므로, 관리자가 'super_admin' 권한으로 생성을
// 요청한 경우에는 트리거 이후 이 함수가 profiles.role을 다시 upsert해 덮어쓴다.
//
// 배포: supabase functions deploy create-user
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Edge Function 런타임에 자동으로 주입되므로
//  별도로 시크릿을 등록할 필요는 없다.)
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// 허용 origin — 실제 배포 프론트엔드 도메인과 로컬 개발용 localhost만 허용한다(그 외는
// 프로덕션 도메인으로 대체 반환되어, 브라우저가 실제 요청 origin과 불일치를 감지해 차단한다).
const ALLOWED_ORIGINS = ['https://pet-nutrition-calculator-virid.vercel.app'];
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && (ALLOWED_ORIGINS.includes(origin) || LOCALHOST_ORIGIN_RE.test(origin))
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const ALLOWED_ROLES = ['user', 'super_admin'];

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req.headers.get('Origin'));
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST만 지원합니다.' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1) 호출자 신원 확인 — 프런트가 supabase.functions.invoke()로 호출하면
  //    현재 로그인 세션의 access_token이 Authorization 헤더로 자동 첨부된다.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: '로그인이 필요합니다.' }, 401);

  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !user) return json({ error: '유효하지 않은 세션입니다.' }, 401);

  // 2) super_admin 권한 재검증 (service_role로 RLS 우회해 직접 조회)
  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (callerProfileErr || !callerProfile || callerProfile.role !== 'super_admin') {
    return json({ error: 'super_admin 권한이 필요합니다.' }, 403);
  }

  // 3) 입력 검증
  let email = '';
  let password = '';
  let role = 'user';
  try {
    const body = await req.json();
    email = typeof body?.email === 'string' ? body.email.trim() : '';
    password = typeof body?.password === 'string' ? body.password : '';
    role = typeof body?.role === 'string' ? body.role : 'user';
  } catch {
    return json({ error: '요청 본문이 올바르지 않습니다.' }, 400);
  }
  if (!email) return json({ error: '이메일을 입력하세요.' }, 400);
  if (!password || password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
  if (!ALLOWED_ROLES.includes(role)) return json({ error: '올바르지 않은 권한입니다.' }, 400);

  // 4) 계정 즉시 생성 — 이메일 인증 없이 바로 로그인 가능하도록 email_confirm: true
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) return json({ error: error.message }, 400);

  const newUserId = data.user?.id;

  // 5) profiles.role 반영 — on_auth_user_created 트리거가 이미 role='user'로 행을 만들었으므로,
  //    관리자로 생성 요청된 경우 여기서 다시 덮어써야 한다.
  if (newUserId) {
    const { error: roleErr } = await admin
      .from('profiles')
      .upsert({ id: newUserId, email, role }, { onConflict: 'id' });
    if (roleErr) return json({ error: `계정은 생성됐지만 권한 저장에 실패했습니다: ${roleErr.message}` }, 500);
  }

  return json({ ok: true, user: { id: newUserId, email: data.user?.email } });
});
