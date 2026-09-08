'use strict';
// 영양 기준(AAFCO / NRC / FEDIAF) 대비 판정 회귀.
//  - calcNutrition 이 붙여주는 standards[].{nrc_j, aafco_j, aafco_gr_j, aafco_rp_j, fediaf_j}
//  - judge(): v/lo/hi → pass/fail/over/─  (lo == null || lo === 0 → ─)
//  - 결측(null) → 판정 제외(─), dataIncomplete
//  - judgeGeneric(): 사용자 등록 기준용 (lo == null → ─, hi 초과 → over)
//  - 제품유형 평가정책: getEvaluationPolicy / gateJudge / evaluateCapStatus / classifyProductPurpose / applyManualPtypeOverride

const test = require('node:test');
const assert = require('node:assert/strict');

const { getNutritionEngine } = require('../helpers/load-nutrition-engine');
const { INGREDIENTS, LYS_AA_MIN } = require('../helpers/fixtures');

const eng = getNutritionEngine();
const { calcNutrition, judgeGeneric, getEvaluationPolicy, gateJudge, evaluateCapStatus,
        classifyProductPurpose, applyManualPtypeOverride, isStapleClass, STANDARDS, STANDARDS_CAT } = eng;

const fullMap = () => new Map(Object.entries(INGREDIENTS));
const calc = (rows, species = '개') =>
  calcNutrition(rows, '주식', 0, {}, species, fullMap(), species === '고양이' ? STANDARDS_CAT : STANDARDS);
const stdRow = (r, name) => r.standards.find((s) => s.name === name);

// ── judge() (calcNutrition 내부) ────────────────────────────────────
test('라이신 AAFCO 성견 min 대비: 1.5× → pass', () => {
  const r = calc([['LYS_PASS', 100]]);
  assert.equal(stdRow(r, '라이신(Lys)').aafco_j, 'pass');
});

test('라이신 AAFCO 성견 min 대비: 0.5× → fail', () => {
  const r = calc([['LYS_FAIL', 100]]);
  assert.equal(stdRow(r, '라이신(Lys)').aafco_j, 'fail');
});

test('결측(null) 영양소 → value=null, 모든 판정 ─', () => {
  const r = calc([['NULLY', 100]]); // CA, LYS 가 null
  const ca = stdRow(r, '칼슘(Ca)');
  assert.equal(ca.value, null);
  assert.equal(ca.aafco_j, '─');
  assert.equal(ca.nrc_j, '─');
  assert.equal(stdRow(r, '라이신(Lys)').aafco_j, '─');
});

test('dataIncomplete: 기준이 있는 영양소가 결측이면 true', () => {
  assert.equal(calc([['NULLY', 100]]).dataIncomplete, true);
  assert.equal(calc([['CLEAN1', 100]]).dataIncomplete, false);
});

test('blendError 상태에서는 모든 standards.value = null (판정 게이팅)', () => {
  const r = calc([['CLEAN1', 90], ['PREMIX', 60]]); // 150%
  assert.ok(r.standards.every((s) => s.value === null));
  assert.ok(r.standards.every((s) => s.aafco_j === '─' && s.nrc_j === '─'));
});

test('standards 항목은 항상 NRC/AAFCO/FEDIAF 기준 필드를 그대로 보존한다', () => {
  const r = calc([['CLEAN1', 100]]);
  const s = stdRow(r, '조단백');
  for (const k of ['nrc_mr', 'nrc_ra', 'aa_min', 'aa_max', 'aa_gr', 'aa_rp', 'fed_ad', 'fed_gr']) {
    assert.ok(k in s, `standards 항목에 ${k} 필드가 있어야 한다`);
  }
});

// ── judgeGeneric() (사용자 등록 기준) ──────────────────────────────
test('judgeGeneric: lo null → ─, hi 초과 → over, lo 이상 → pass, 그 외 → fail', () => {
  assert.equal(judgeGeneric(5, null, null), '─');
  assert.equal(judgeGeneric(null, 1, 2), '─');
  assert.equal(judgeGeneric(3, 1, 2), 'over');
  assert.equal(judgeGeneric(2, 1, 2), 'pass'); // 경계 포함
  assert.equal(judgeGeneric(1, 1, null), 'pass');
  assert.equal(judgeGeneric(0.5, 1, null), 'fail');
});

test('judgeGeneric 은 lo === 0 을 특별취급하지 않는다(judge() 와의 차이)', () => {
  assert.equal(judgeGeneric(0, 0, null), 'pass'); // 0 >= 0
});

// ── 제품유형 평가정책 ──────────────────────────────────────────────
test('getEvaluationPolicy: 유형별 모드 매핑', () => {
  assert.equal(getEvaluationPolicy(null).mode, 'complete');
  assert.equal(getEvaluationPolicy({ type: 'staple' }).mode, 'complete');
  assert.equal(getEvaluationPolicy({ type: 'treat' }).mode, 'snack');
  assert.equal(getEvaluationPolicy({ type: 'supplement' }).mode, 'supplement');
  assert.equal(getEvaluationPolicy({ type: 'unsuitable' }).mode, 'not_for_direct_feeding');
});

test('gateJudge: 간식/직접급여불가는 fail·over 를 gated 로, 주식/보조식은 그대로', () => {
  const complete = getEvaluationPolicy({ type: 'staple' });
  const snack = getEvaluationPolicy({ type: 'treat' });
  const supp = getEvaluationPolicy({ type: 'supplement' });
  assert.equal(gateJudge('fail', complete), 'fail');
  assert.equal(gateJudge('over', complete), 'over');
  assert.equal(gateJudge('pass', snack), 'pass');
  assert.equal(gateJudge('fail', snack), 'gated');
  assert.equal(gateJudge('over', snack), 'gated');
  assert.equal(gateJudge('fail', supp), 'fail'); // 보조식은 결핍 그대로 노출
});

test('isStapleClass: pc 없음/유형없음/staple → true', () => {
  assert.equal(isStapleClass(null), true);
  assert.equal(isStapleClass({}), true);
  assert.equal(isStapleClass({ type: 'staple' }), true);
  assert.equal(isStapleClass({ type: 'treat' }), false);
});

// ── Ca:P 판정 ─────────────────────────────────────────────────────
test('evaluateCapStatus: 주식 정책', () => {
  const p = getEvaluationPolicy({ type: 'staple' });
  assert.equal(evaluateCapStatus(1.5, p, false).level, 'pass');   // 1.1~2.0
  assert.equal(evaluateCapStatus(0, p, false).level, 'unknown');  // Ca 또는 P = 0
  assert.equal(evaluateCapStatus(3.0, p, false).level, 'fail');   // >2.5 심각
  assert.equal(evaluateCapStatus(2.3, p, false).level, 'warn');   // 2.0~2.5 주의
});

test('evaluateCapStatus: 고양이 하한은 1.0', () => {
  const p = getEvaluationPolicy({ type: 'staple' });
  assert.equal(evaluateCapStatus(1.05, p, true).level, 'pass');   // 고양이 1.0~2.0
  assert.equal(evaluateCapStatus(1.05, p, false).level, 'warn');  // 개 1.1 미만
});

test('evaluateCapStatus: 간식은 평가 제외, 보조식은 참고 수준으로 완화', () => {
  assert.equal(evaluateCapStatus(3.0, getEvaluationPolicy({ type: 'treat' }), false).level, 'excluded');
  assert.equal(evaluateCapStatus(3.0, getEvaluationPolicy({ type: 'supplement' }), false).level, 'reference');
});

// ── classifyProductPurpose() ──────────────────────────────────────
test('classifyProductPurpose: 단일 자연식품 100% → treat', () => {
  eng.__setIng(new Map([['CLEAN1', INGREDIENTS.CLEAN1]]));
  const r = calc([['CLEAN1', 100]]);
  const pc = classifyProductPurpose(r, [['CLEAN1', 100]]);
  assert.equal(pc.type, 'treat');
  assert.equal(pc.evaluationMode, 'snack');
});

test('classifyProductPurpose: 프리믹스 원료가 배합비 절반 이상 → unsuitable', () => {
  const PX = require('../helpers/fixtures').ing('비타민 프리믹스', { CA: 20, P: 16 });
  const m = new Map([['비타민 프리믹스', PX], ['CLEAN1', INGREDIENTS.CLEAN1]]);
  eng.__setIng(m);
  const rows = [['비타민 프리믹스', 60], ['CLEAN1', 40]];
  const r = calcNutrition(rows, '주식', 0, {}, '개', m, STANDARDS);
  const pc = classifyProductPurpose(r, rows);
  assert.equal(pc.type, 'unsuitable');
});

test('classifyProductPurpose: 배합 없음 → { type: null, noData: true }', () => {
  const pc = classifyProductPurpose({ totalRatio: 0 }, []);
  assert.equal(pc.type, null);
  assert.equal(pc.noData, true);
});

// ── applyManualPtypeOverride() ────────────────────────────────────
test('applyManualPtypeOverride: "간식" 수동지정은 staple/supplement 만 덮어쓴다', () => {
  const staple = { type: 'staple', minPassRate: 1, withDataCount: 5 };
  assert.equal(applyManualPtypeOverride(staple, '간식').type, 'treat');
  assert.equal(applyManualPtypeOverride(staple, '간식').manualOverride, true);
  assert.equal(applyManualPtypeOverride(staple, '주식').type, 'staple'); // 간식 외에는 무시
  assert.equal(applyManualPtypeOverride({ type: 'unsuitable' }, '간식').type, 'unsuitable'); // 안전신호 우선
  assert.equal(applyManualPtypeOverride({ type: 'treat' }, '간식').type, 'treat');
});
