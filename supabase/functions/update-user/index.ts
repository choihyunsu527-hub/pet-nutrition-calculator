// ════════════════════════════════════════════════════════════════════════════
// 관리자 페이지 "사용자 편집" Edge Function
//
// 비밀번호 변경(auth.admin.updateUserById)과 권한 변경은 모두 service_role 키가
// 있어야 하므로 브라우저(anon key)에서는 직접 호출할 수 없다. 아래 순서로 반드시
// 서버 사이드에서 확인한다:
//   1) 요청에 담긴 로그인 세션(JWT)이 유효한지
//   2) 그 사용자의 profiles.role이 정말 'super_admin'인지
//   3) 본인(targetUserId === 호출자)의 권한은 변경하지 못하도록 차단
//
// 배포: supabase functions deploy update-user
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

  // 1) 호출자 신원 확인
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: '로그인이 필요합니다.' }, 401);

  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !user) return json({ error: '유효하지 않은 세션입니다.' }, 401);

  // 2) super_admin 권한 재검증 (service_role로 RLS 우회해 직접 조회) — name은 감사 로그에
  //    "누가" 작업했는지 스냅샷으로 남기기 위해 함께 조회한다.
  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role, name')
    .eq('id', user.id)
    .maybeSingle();

  if (callerProfileErr || !callerProfile || callerProfile.role !== 'super_admin') {
    return json({ error: 'super_admin 권한이 필요합니다.' }, 403);
  }

  // 3) 입력 검증
  let targetUserId = '';
  let role: string | undefined;
  let password: string | undefined;
  let name: string | undefined;
  try {
    const body = await req.json();
    targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId : '';
    role = typeof body?.role === 'string' ? body.role : undefined;
    password = typeof body?.password === 'string' && body.password.length > 0 ? body.password : undefined;
    name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  } catch {
    return json({ error: '요청 본문이 올바르지 않습니다.' }, 400);
  }
  if (!targetUserId) return json({ error: '대상 사용자를 확인할 수 없습니다.' }, 400);
  if (role !== undefined && !ALLOWED_ROLES.includes(role)) return json({ error: '올바르지 않은 권한입니다.' }, 400);
  if (password !== undefined && password.length < 4) return json({ error: '비밀번호는 4자 이상이어야 합니다.' }, 400);
  if (name !== undefined && !name) return json({ error: '이름을 입력하세요.' }, 400);
  if (role === undefined && password === undefined && name === undefined) {
    return json({ error: '변경할 내용이 없습니다.' }, 400);
  }

  // 4) 본인 권한 변경 차단 — 실수로 스스로를 강등/승급시키는 것을 막는다.
  if (role !== undefined && targetUserId === user.id) {
    return json({ error: '본인 계정의 권한은 변경할 수 없습니다.' }, 400);
  }

  // 5) 비밀번호 변경
  if (password !== undefined) {
    const { error: pwErr } = await admin.auth.admin.updateUserById(targetUserId, { password });
    if (pwErr) return json({ error: pwErr.message }, 400);
  }

  // 6) 권한/이름 변경 — profiles에는 update 정책이 없어(001_profiles_role.sql) 일반
  //    사용자는 스스로 이름을 바꿀 수 없고, 오직 이 Edge Function(service_role)을 통해
  //    super_admin만 변경할 수 있다. 감사 로그에 "무엇이 바뀌었는지" 남기려면 변경 전 값이
  //    필요해 patch 전에 대상 프로필을 먼저 조회한다.
  if (role !== undefined || name !== undefined) {
    const { data: targetBefore } = await admin
      .from('profiles')
      .select('username, name, role')
      .eq('id', targetUserId)
      .maybeSingle();

    const patch: Record<string, string> = {};
    if (role !== undefined) patch.role = role;
    if (name !== undefined) patch.name = name;
    const { error: profileErr } = await admin
      .from('profiles')
      .update(patch)
      .eq('id', targetUserId);
    if (profileErr) return json({ error: profileErr.message }, 400);

    // 7) 감사 로그 기록 — 실제로 값이 바뀐 항목만, 이름 변경과 권한 변경을 별도 항목으로 남긴다.
    //    실패해도 이미 반영된 변경 자체에는 영향을 주지 않는다.
    const logEntries: Record<string, unknown>[] = [];
    if (name !== undefined && name !== targetBefore?.name) {
      logEntries.push({
        user_id: user.id,
        user_name: callerProfile.name ?? null,
        action: 'update_user_name',
        target_type: 'profile',
        target_id: targetUserId,
        details: { username: targetBefore?.username ?? null, old_name: targetBefore?.name ?? null, new_name: name },
      });
    }
    if (role !== undefined && role !== targetBefore?.role) {
      logEntries.push({
        user_id: user.id,
        user_name: callerProfile.name ?? null,
        action: 'update_user_role',
        target_type: 'profile',
        target_id: targetUserId,
        details: { username: targetBefore?.username ?? null, old_role: targetBefore?.role ?? null, new_role: role },
      });
    }
    if (logEntries.length > 0) await admin.from('audit_logs').insert(logEntries);
  }

  return json({ ok: true });
});
