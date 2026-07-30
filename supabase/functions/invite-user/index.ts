// ════════════════════════════════════════════════════════════════════════════
// 사용자 초대 Edge Function
//
// auth.admin.inviteUserByEmail()은 service_role 키가 있어야 호출할 수 있어
// 브라우저(anon key)에서는 직접 실행할 수 없다. 그래서 이 함수가 유일한 진입점이며,
// 아래 순서로 반드시 서버 사이드에서 두 가지를 확인한다:
//   1) 요청에 담긴 로그인 세션(JWT)이 유효한지
//   2) 그 사용자의 profiles.role이 정말 'super_admin'인지 (프런트의 isSuperAdmin()은
//      UX용일 뿐, 여기서 다시 검증하지 않으면 우회 호출로 아무나 초대를 보낼 수 있다)
// 초대로 auth.users에 계정이 생기면, DB 트리거 on_auth_user_created(001_profiles_role.sql)가
// profiles 행을 자동 생성한다(role 기본값 'user') — 이 함수는 profiles에 직접 쓰지 않는다.
//
// 배포: supabase functions deploy invite-user
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Edge Function 런타임에 자동으로 주입되므로
//  별도로 시크릿을 등록할 필요는 없다.)
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
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
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr || !profile || profile.role !== 'super_admin') {
    return json({ error: 'super_admin 권한이 필요합니다.' }, 403);
  }

  // 3) 입력 검증
  let email = '';
  try {
    const body = await req.json();
    email = typeof body?.email === 'string' ? body.email.trim() : '';
  } catch {
    return json({ error: '요청 본문이 올바르지 않습니다.' }, 400);
  }
  if (!email) return json({ error: '이메일을 입력하세요.' }, 400);

  // 4) 초대 발송
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
  if (error) return json({ error: error.message }, 400);

  return json({ ok: true, user: { id: data.user?.id, email: data.user?.email } });
});
