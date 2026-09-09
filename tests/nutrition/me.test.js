'use strict';
// ME(대사에너지) 계산 회귀 — Modified Atwater(3.5 / 8.5 / 3.5), NFE = 탄수화물 − 조섬유(0 클램프),
// meAsis(정규화 전) / meDmb(dmScale·dmPct 반영) / EPA·DHA kcal 환산.
// js/nutrition-engine.js 의 실제 calcNutrition() 을 DOM 없이 로드해 검증한다(계산식 미변경 확인).

const test = require('node:test');
const assert = require('node:assert/strict');

const { getNutritionEngine } = require('../helpers/load-nutrition-engine');
const { INGREDIENTS } = require('../helpers/fixtures');

const { calcNutrition, STANDARDS, STANDARDS_CAT } = getNutritionEngine();

const EPS = 1e-9;
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const mapOf = (names) => new Map(names.map((n) => [n, INGREDIENTS[n]]));

function calc(rows, species = '개') {
  return calcNutrition(rows, '주식', 0, {}, species, mapOf(rows.map((r) => r[0])),
    species === '고양이' ? STANDARDS_CAT : STANDARDS);
}

// CLEAN1 = 수분10 / 단백20 / 지방5 / 탄수30 / 조섬유0
test('meAsis = (prot*3.5 + fat*8.5 + nfe*3.5) * 10 (조섬유 0 → nfe = 탄수)', () => {
  const r = calc([['CLEAN1', 100]]);
  const expected = (20 * 3.5 + 5 * 8.5 + 30 * 3.5) * 10; // 2175
  assert.ok(near(r.meAsis, expected), `meAsis=${r.meAsis} expected=${expected}`);
});

test('meDmb = meAsis * dmScale / dmPct  (100% 배합: dmScale=1, dmPct=0.9)', () => {
  const r = calc([['CLEAN1', 100]]);
  assert.ok(near(r.dmPct, 0.9));
  assert.ok(near(r.meDmb, r.meAsis * 1 / 0.9), `meDmb=${r.meDmb}`);
  assert.ok(near(r.meDmb, 2175 / 0.9));
});

test('NFE = max(탄수화물 − 조섬유, 0) — 조섬유 12 는 그만큼 ME 를 낮춘다', () => {
  const r = calc([['CLEAN1_FIBER12', 100]]); // 탄수30 / 조섬유12 → nfe 18
  const expected = (20 * 3.5 + 5 * 8.5 + 18 * 3.5) * 10; // 1755
  assert.ok(near(r.meAsis, expected), `meAsis=${r.meAsis} expected=${expected}`);
});

test('NFE 음수 클램프 — 조섬유(40) > 탄수(30) 이면 NFE 기여는 0', () => {
  const r = calc([['CLEAN1_FIBER40', 100]]); // 조섬유40 > 탄수30
  const expected = (20 * 3.5 + 5 * 8.5 + 0 * 3.5) * 10; // 1125
  assert.ok(near(r.meAsis, expected), `meAsis=${r.meAsis} expected=${expected}`);
});

test('배합비 합계 50% 여도 meDmb 는 100% 와 동일(dmScale 정규화), meAsis 는 실제 배합량 비례', () => {
  const full = calc([['CLEAN1', 100]]);
  const half = calc([['CLEAN1', 50]]);
  assert.ok(near(half.meDmb, full.meDmb), `half.meDmb=${half.meDmb} full.meDmb=${full.meDmb}`);
  assert.ok(near(half.meAsis, full.meAsis / 2), `half.meAsis=${half.meAsis} full.meAsis=${full.meAsis}`);
});

test('blendError(합계 150%) 여도 meAsis/meDmb 는 계속 계산된다(판정만 ─)', () => {
  const r = calc([['CLEAN1', 90], ['PREMIX', 60]]);
  assert.ok(r.blendError, 'blendError 가 설정돼야 한다');
  assert.ok(Number.isFinite(r.meAsis) && r.meAsis > 0);
  assert.ok(Number.isFinite(r.meDmb) && r.meDmb > 0);
});

// FISH = 수분12 단백22 지방8 탄수0 EPA6 DHA9 (per 100g as-is)
test('EPA/DHA kcal 환산: dmb.epaKcal = mgKg(EPA) / (meDmb/1000)', () => {
  const r = calc([['FISH', 100]], '고양이');
  const epaMgKg = r.dmb.epa; // dmb.epa === mgKg(EPA)
  assert.ok(near(r.dmb.epaKcal, epaMgKg / (r.meDmb / 1000)), `epaKcal=${r.dmb.epaKcal}`);
  assert.ok(near(r.dmb.dhaKcal, r.dmb.dha / (r.meDmb / 1000)), `dhaKcal=${r.dmb.dhaKcal}`);
});

test('빈 배합: meAsis = 0, meDmb = 0', () => {
  const r = calcNutrition([], '주식', 0, {}, '개', new Map(), STANDARDS);
  assert.equal(r.meAsis, 0);
  assert.equal(r.meDmb, 0);
});
