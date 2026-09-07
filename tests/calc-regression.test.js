'use strict';
// 영양계산 핵심 회귀 테스트 (앵커 + 스냅샷).
// 실제 index.html 의 calcNutrition() 과 실제 상수(ING_IDX/STANDARDS/…)를 로드해 검증한다.
//   실행: node --test tests/     또는     npm test
//   golden 재생성: node tests/update-golden.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getEngine } = require('./helpers/load-engine');
const { INGREDIENTS, ing, LYS_AA_MIN } = require('./helpers/fixtures');
const { SCENARIOS, runScenario } = require('./helpers/scenarios');
const { normalize } = require('./helpers/serialize');

const { calcNutrition, ING_IDX, ING_COL_COUNT, STANDARDS, STANDARDS_CAT } = getEngine();

const EPS = 1e-9;
const mapOf = (obj) => new Map(Object.entries(obj));
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// 단일 원료 100% 호출 헬퍼
function calcOne(name, opts = {}) {
  const species = opts.species || '개';
  return calcNutrition(
    [[name, opts.ratio ?? 100]],
    opts.productType || '주식',
    0, {}, species,
    mapOf({ [name]: INGREDIENTS[name] || opts.ing }),
    species === '고양이' ? STANDARDS_CAT : STANDARDS,
  );
}

// ────────────────────────────────────────────────────────────────────
test('로더: 실제 calcNutrition 과 상수를 index.html 에서 직접 로드했다', () => {
  assert.equal(typeof calcNutrition, 'function');
  assert.equal(ING_COL_COUNT, 48);
  assert.equal(Object.keys(ING_IDX).length, 48);
  assert.ok(STANDARDS.length > 30 && STANDARDS_CAT.length > 30);
  // calcNutrition 은 index.html 원문을 잘라 실행한 것이므로 source 에 실제 본문이 남아 있다
  assert.match(calcNutrition.toString(), /asis\[i \+ 1\]|lookupIng|missingCols/);
});

// ── 앵커 1: DMB (건물기준) 변환 ──────────────────────────────────────
test('DMB: dmPct 와 dmb.prot/fat/nfe/moist (손검산)', () => {
  const r = calcOne('CLEAN1'); // 수분10 단백20 지방5 탄수30
  assert.ok(near(r.dmPct, 0.9), `dmPct=${r.dmPct}`);
  assert.ok(near(r.dmb.moist, 10));
  assert.ok(near(r.dmb.prot, 20 / 0.9), `prot=${r.dmb.prot}`);
  assert.ok(near(r.dmb.fat, 5 / 0.9));
  assert.ok(near(r.dmb.nfe, 30 / 0.9)); // dmb.nfe 는 탄수화물(CARB) 기준
});

// ── 앵커 2: ME (as-is) = (단백*3.5 + 지방*8.5 + NFE*3.5) * 10 ─────────
test('ME: 조섬유 0 이면 meAsis = (P*3.5 + F*8.5 + Carb*3.5)*10', () => {
  const r = calcOne('CLEAN1');
  const expected = (20 * 3.5 + 5 * 8.5 + 30 * 3.5) * 10; // 2175
  assert.ok(near(r.meAsis, expected), `meAsis=${r.meAsis} expected=${expected}`);
  assert.ok(near(r.meDmb, expected / 0.9), `meDmb=${r.meDmb}`); // dmScale=1
});

// ── 앵커 3: NFE = 탄수화물 - 조섬유 ─────────────────────────────────
test('NFE: 조섬유가 있으면 ME 는 (탄수 - 조섬유) 로 계산된다', () => {
  const r = calcOne('CLEAN1_FIBER12'); // 조섬유 12
  const expected = (20 * 3.5 + 5 * 8.5 + (30 - 12) * 3.5) * 10; // 1755
  assert.ok(near(r.meAsis, expected), `meAsis=${r.meAsis} expected=${expected}`);
});

test('NFE: 조섬유 > 탄수화물 이면 NFE 는 0 으로 클램프(음수 안 됨)', () => {
  const r = calcOne('CLEAN1_FIBER40'); // 조섬유 40 > 탄수 30
  const expected = (20 * 3.5 + 5 * 8.5 + 0) * 10; // 1125
  assert.ok(near(r.meAsis, expected), `meAsis=${r.meAsis} expected=${expected}`);
  assert.ok(r.meAsis >= 0);
});

// ── 앵커 4: dmScale (상대 배합비 정규화) ────────────────────────────
test('dmScale: 배합비 합계 50% 결과가 동일 비율 100% 결과와 완전히 같다', () => {
  const map = mapOf({ CLEAN1: INGREDIENTS.CLEAN1, PREMIX: INGREDIENTS.PREMIX });
  const full = calcNutrition([['CLEAN1', 60], ['PREMIX', 40]], '주식', 0, {}, '개', map, STANDARDS);
  const half = calcNutrition([['CLEAN1', 30], ['PREMIX', 20]], '주식', 0, {}, '개', map, STANDARDS);
  assert.equal(normalizeStr(half.dmb), normalizeStr(full.dmb), 'dmb 불일치');
  assert.ok(near(half.meDmb, full.meDmb), `meDmb ${half.meDmb} vs ${full.meDmb}`);
  assert.equal(
    normalizeStr(half.standards.map((s) => [s.name, s.value])),
    normalizeStr(full.standards.map((s) => [s.name, s.value])),
    'standards value 불일치',
  );
  assert.equal(half.blendError, null);
});

test('dmScale: 합계 100% 이면 dmScale === 1 (meDmb === meAsis / dmPct)', () => {
  const r = calcOne('CLEAN1');
  assert.ok(near(r.meDmb, r.meAsis / r.dmPct));
});

// ── 앵커 5: Ca:P 비율 ──────────────────────────────────────────────
test('Ca:P: dmb.cap = raw Ca / raw P (dmPct·dmScale 상쇄)', () => {
  const r = calcOne('CAP_ONLY'); // Ca 1.0 / P 0.4
  assert.ok(near(r.dmb.cap, 1.0 / 0.4), `cap=${r.dmb.cap}`);
});

// ── 앵커 6: blendError 게이팅 (F1~F4) ──────────────────────────────
test('blendError: 음수 배합비 → 오류 메시지 + 모든 기준 value=null, 판정 "─"', () => {
  const map = mapOf({ CLEAN1: INGREDIENTS.CLEAN1, PREMIX: INGREDIENTS.PREMIX });
  const r = calcNutrition([['CLEAN1', 80], ['PREMIX', -10]], '주식', 0, {}, '개', map, STANDARDS);
  assert.ok(r.blendError && /음수/.test(r.blendError), r.blendError);
  assert.ok(r.standards.every((s) => s.value === null));
  assert.ok(r.standards.every((s) => s.nrc_j === '─' && s.aafco_j === '─' && s.fediaf_j === '─'));
});

test('blendError: 원료명 없는 행에 배합비 → 오류', () => {
  const map = mapOf({ CLEAN1: INGREDIENTS.CLEAN1 });
  const r = calcNutrition([['CLEAN1', 80], ['', 20]], '주식', 0, {}, '개', map, STANDARDS);
  assert.ok(r.blendError && /원료명/.test(r.blendError), r.blendError);
});

test('blendError: 배합비 합계 > 100% → 오류', () => {
  const map = mapOf({ CLEAN1: INGREDIENTS.CLEAN1, PREMIX: INGREDIENTS.PREMIX });
  const r = calcNutrition([['CLEAN1', 90], ['PREMIX', 60]], '주식', 0, {}, '개', map, STANDARDS);
  assert.ok(r.blendError && /100%/.test(r.blendError), r.blendError);
});

test('blendError: 건물률 비정상(수분≈100%) → 오류', () => {
  const wet = ing('WET', { MOISTURE: 99.9, PROTEIN: 0.05 });
  const r = calcNutrition([['WET', 100]], '주식', 0, {}, '개', mapOf({ WET: wet }), STANDARDS);
  assert.ok(r.blendError && /건물률/.test(r.blendError), r.blendError);
});

test('정상 배합(합계 100%, 양수, 원료명 있음) → blendError 없음', () => {
  const r = calcOne('CLEAN1');
  assert.equal(r.blendError, null);
});

// ── 앵커 7: null "데이터 없음" 처리 ────────────────────────────────
test('null 영양소: missingCols 기록 + 해당 기준 value=null·판정 "─" + dataIncomplete', () => {
  const r = calcOne('NULLY'); // CA=null, LYS=null
  assert.ok(r.missingCols.includes(ING_IDX.CA), `missingCols=${r.missingCols}`);
  assert.ok(r.missingCols.includes(ING_IDX.LYS));
  const ca = r.standards.find((s) => s.name === '칼슘(Ca)');
  assert.equal(ca.value, null);
  assert.equal(ca.aafco_j, '─');
  assert.equal(ca.nrc_j, '─');
  assert.equal(r.dataIncomplete, true);
  // 결측 셀은 합산에 기여하지 않는다 (asis 는 0)
  assert.equal(r.asis[ING_IDX.CA], 0);
  // 결측이 아닌 영양소는 정상 판정
  const prot = r.standards.find((s) => s.name === '조단백');
  assert.equal(typeof prot.value, 'number');
});

// ── 앵커 8: 필수아미노산 기준 (라이신) ────────────────────────────
test('EAA: 라이신 ≥ AAFCO 성견 min → aafco_j "pass"', () => {
  const r = calcOne('LYS_PASS'); // lys = min * 1.5, 수분 0
  const lys = r.standards.find((s) => s.name === '라이신(Lys)');
  assert.ok(near(lys.value, LYS_AA_MIN * 1.5, 1e-3), `lys.value=${lys.value}`);
  assert.equal(lys.aafco_j, 'pass');
});

test('EAA: 라이신 < AAFCO 성견 min → aafco_j "fail"', () => {
  const r = calcOne('LYS_FAIL'); // lys = min * 0.5
  const lys = r.standards.find((s) => s.name === '라이신(Lys)');
  assert.equal(lys.aafco_j, 'fail');
});

// ── 앵커 9: 존재하지 않는 원료 ────────────────────────────────────
test('존재하지 않는 원료 행은 조용히 무시된다(합산·오류 없음)', () => {
  const map = mapOf({ CLEAN1: INGREDIENTS.CLEAN1 });
  const r = calcNutrition([['DOES_NOT_EXIST', 50], ['CLEAN1', 50]], '주식', 0, {}, '개', map, STANDARDS);
  assert.equal(r.totalRatio, 50);
  assert.equal(r.blendError, null);
  assert.ok(near(r.asis[ING_IDX.PROTEIN], 20 * 0.5)); // CLEAN1 50%
});

// ── 앵커 10: productType 은 계산에 영향 없음 ──────────────────────
test('productType(주식/보조식/간식) 값이 calcNutrition 결과를 바꾸지 않는다', () => {
  const map = mapOf({ CLEAN1: INGREDIENTS.CLEAN1, PREMIX: INGREDIENTS.PREMIX });
  const rows = [['CLEAN1', 60], ['PREMIX', 40]];
  const a = normalizeStr(calcNutrition(rows, '주식', 0, {}, '개', map, STANDARDS));
  const b = normalizeStr(calcNutrition(rows, '보조식', 0, {}, '개', map, STANDARDS));
  const c = normalizeStr(calcNutrition(rows, '간식', 0, {}, '개', map, STANDARDS));
  assert.equal(a, b);
  assert.equal(a, c);
});

// ── 앵커 11: 개 vs 고양이 기준표 분기 ─────────────────────────────
test('species 에 따라 standardsTable(개/고양이)이 반영된다', () => {
  const map = mapOf({ FISH: INGREDIENTS.FISH });
  const dog = calcNutrition([['FISH', 100]], '주식', 0, {}, '개', map, STANDARDS);
  const cat = calcNutrition([['FISH', 100]], '주식', 0, {}, '고양이', map, STANDARDS_CAT);
  assert.equal(dog.standards.length, STANDARDS.length);
  assert.equal(cat.standards.length, STANDARDS_CAT.length);
  // 타우린: 고양이 기준은 min > 0, 개(성견)는 0 → 판정 결과가 구조적으로 다르다
  const dogTau = dog.standards.find((s) => s.name === '타우린(Tau)*');
  const catTau = cat.standards.find((s) => s.name === '타우린(Tau)*');
  assert.ok(dogTau && catTau);
  assert.notEqual(catTau.aa_min, dogTau.aa_min);
});

// ── 스냅샷(golden) 비교 ───────────────────────────────────────────
test('스냅샷: 모든 고정 시나리오 결과가 golden 과 일치한다', async (t) => {
  const goldenPath = path.resolve(__dirname, 'fixtures', 'golden.json');
  if (!fs.existsSync(goldenPath)) {
    assert.fail('tests/fixtures/golden.json 이 없습니다. 먼저 `node tests/update-golden.js` 를 실행하세요.');
  }
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  assert.equal(
    Object.keys(golden.results).length,
    SCENARIOS.length,
    'golden 시나리오 수와 현재 시나리오 수가 다릅니다 — node tests/update-golden.js 재실행 필요',
  );
  for (const sc of SCENARIOS) {
    await t.test(sc.id, () => {
      const expected = golden.results[sc.id];
      assert.ok(expected, `golden 에 ${sc.id} 없음 — node tests/update-golden.js 재실행 필요`);
      const actual = normalize(runScenario(sc));
      assert.deepEqual(
        actual,
        expected,
        `시나리오 "${sc.id}" 결과가 golden 과 다릅니다. 의도한 변경이면 node tests/update-golden.js 실행.`,
      );
    });
  }
});

function normalizeStr(v) {
  return JSON.stringify(normalize(v));
}
