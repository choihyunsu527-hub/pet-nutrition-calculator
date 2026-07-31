// ════════════════════════════════════════════════════════════════════════════
// 관리자 페이지 "사용자 삭제" Edge Function
//
// auth.admin.deleteUser()는 service_role 키가 있어야 호출할 수 있어 브라우저에서는
// 직접 실행할 수 없다. 아래 순서로 반드시 서버 사이드에서 확인한다:
//   1) 요청에 담긴 로그인 세션(JWT)이 유효한지
//   2) 그 사용자의 profiles.role이 정말 'super_admin'인지
//   3) 본인 계정은 삭제하지 못하도록 차단
//   4) 삭제 대상이 super_admin이면 차단 (관리자 계정은 삭제 불가)
//
// profiles.id는 auth.users(id)를 on delete cascade로 참조하므로 auth 사용자를
// 삭제하면 profiles 행도 자동으로 함께 삭제되지만, 순서를 보장하기 위해 profiles
// 행을 먼저 명시적으로 지운 뒤 auth 사용자를 삭제한다.
//
// 배포: supabase functions deploy delete-user
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

  // 1) 호출자 신원 확인
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
  let targetUserId = '';
  try {
    const body = await req.json();
    targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId : '';
  } catch {
    return json({ error: '요청 본문이 올바르지 않습니다.' }, 400);
  }
  if (!targetUserId) return json({ error: '대상 사용자를 확인할 수 없습니다.' }, 400);

  // 4) 본인 계정 삭제 차단
  if (targetUserId === user.id) {
    return json({ error: '본인 계정은 삭제할 수 없습니다.' }, 400);
  }

  // 5) 삭제 대상이 super_admin이면 차단
  const { data: targetProfile, error: targetProfileErr } = await admin
    .from('profiles')
    .select('role')
    .eq('id', targetUserId)
    .maybeSingle();

  if (targetProfileErr) return json({ error: targetProfileErr.message }, 400);
  if (targetProfile?.role === 'super_admin') {
    return json({ error: '관리자(super_admin) 계정은 삭제할 수 없습니다.' }, 400);
  }

  // 6) profiles 행 명시적 삭제 후 auth 사용자 삭제
  const { error: profileDelErr } = await admin.from('profiles').delete().eq('id', targetUserId);
  if (profileDelErr) return json({ error: profileDelErr.message }, 400);

  const { error: authDelErr } = await admin.auth.admin.deleteUser(targetUserId);
  if (authDelErr) return json({ error: authDelErr.message }, 400);

  return json({ ok: true });
});
