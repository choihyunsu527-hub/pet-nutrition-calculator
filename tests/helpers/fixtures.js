'use strict';
// 회귀 테스트용 "고정" 원료 세트와 조회 헬퍼.
// 값은 전부 손으로 정한 것이며, 앵커 계산(anchor assertion)이 손검산 가능하도록
// 둥근 숫자를 쓴다. 여기 값을 바꾸면 golden 을 재생성해야 한다(node tests/update-golden.js).

const { getEngine } = require('./load-engine');
const { ING_IDX, STANDARDS } = getEngine();

// 원료 배열 = [이름, ...48개 영양소]. overrides 는 ING_IDX 키 → 값(숫자 또는 null).
function ing(name, overrides = {}) {
  const row = new Array(49).fill(0);
  row[0] = name;
  for (const [key, val] of Object.entries(overrides)) {
    if (!(key in ING_IDX)) throw new Error(`fixtures: 알 수 없는 영양소 키 ${key}`);
    row[ING_IDX[key] + 1] = val; // ing[위치+1] === asis[위치]
  }
  return row;
}

// 라이신(Lys) AAFCO 성견 min 을 실제 STANDARDS 에서 읽어와 임계 부근 원료를 만든다.
const LYS_ROW = STANDARDS.find((s) => s[0] === '라이신(Lys)');
const LYS_AA_MIN = LYS_ROW ? LYS_ROW[4] : 0.63; // [name,unit,mr,ra,aa_min,...]

const INGREDIENTS = {
  // 수분 10 / 단백 20 / 지방 5 / 탄수 30 / 조섬유 0  — 손검산용 기준 원료
  CLEAN1: ing('CLEAN1', { MOISTURE: 10, PROTEIN: 20, FAT: 5, CARB: 30, CRUDE_FIBER: 0, CA: 1.0, P: 0.5 }),
  // CLEAN1 + 조섬유 12 (NFE = 탄수 - 조섬유 검증)
  CLEAN1_FIBER12: ing('CLEAN1_FIBER12', { MOISTURE: 10, PROTEIN: 20, FAT: 5, CARB: 30, CRUDE_FIBER: 12, CA: 1.0, P: 0.5 }),
  // 조섬유(40) > 탄수(30) — NFE 음수 클램프 검증
  CLEAN1_FIBER40: ing('CLEAN1_FIBER40', { MOISTURE: 10, PROTEIN: 20, FAT: 5, CARB: 30, CRUDE_FIBER: 40 }),
  // 칼슘/인만 — Ca:P 비율(= 1.0 / 0.4 = 2.5) 검증
  CAP_ONLY: ing('CAP_ONLY', { MOISTURE: 0, CA: 1.0, P: 0.4 }),
  // 결측(null) 원료 — 칼슘·라이신이 "데이터 없음"
  NULLY: ing('NULLY', { MOISTURE: 10, PROTEIN: 20, FAT: 5, CARB: 20, CA: null, LYS: null }),
  // 라이신이 AAFCO 성견 min 을 확실히 넘김(×1.5), 수분 0 → dmb.lys === raw lys
  LYS_PASS: ing('LYS_PASS', { MOISTURE: 0, PROTEIN: 25, LYS: Number((LYS_AA_MIN * 1.5).toFixed(4)) }),
  // 라이신이 min 의 절반 → fail
  LYS_FAIL: ing('LYS_FAIL', { MOISTURE: 0, PROTEIN: 25, LYS: Number((LYS_AA_MIN * 0.5).toFixed(4)) }),
  // 미네랄/비타민을 넉넉히 채운 원료(스냅샷 다양성용)
  PREMIX: ing('PREMIX', {
    MOISTURE: 5, PROTEIN: 8, FAT: 2, CARB: 40, ASH: 30,
    CA: 2.0, P: 1.6, NA: 0.4, K: 0.7, MG: 0.08,
    FE: 12, ZN: 12, SE: 0.4, CU: 1.8, MN: 1.4, IODINE: 0.15,
    VIT_A: 500, VIT_D: 55, VIT_E: 8, VIT_B1: 0.5, VIT_B2: 0.6, VIT_B3: 4,
    CHOLINE: 120, TAURINE: 30,
  }),
  // 어류 — EPA/DHA/타우린/필수지방산
  FISH: ing('FISH', { MOISTURE: 12, PROTEIN: 22, FAT: 8, CARB: 0, EPA: 6, DHA: 9, TAURINE: 250, LA: 0.4, ALA: 0.1 }),
};

function ingMap(names) {
  const m = new Map();
  for (const n of names) {
    if (!INGREDIENTS[n]) throw new Error(`fixtures: 알 수 없는 원료 ${n}`);
    m.set(n, INGREDIENTS[n]);
  }
  return m;
}

// 전체 원료를 담은 Map (존재하지 않는 원료 시나리오에서도 실제 조회 대상이 있어야 함)
function fullIngMap() {
  const m = new Map();
  for (const [k, v] of Object.entries(INGREDIENTS)) m.set(k, v);
  return m;
}

module.exports = { INGREDIENTS, ing, ingMap, fullIngMap, LYS_AA_MIN };
