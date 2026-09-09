'use strict';
// 배합비 계산 회귀 — 원료별 영양소 합산(asis[i] += ing[i+1] * ratio/100),
// 여러 원료 배합, 100g/실제배합량 기준, 배합 유효성 게이팅(F1~F4).

const test = require('node:test');
const assert = require('node:assert/strict');

const { getNutritionEngine } = require('../helpers/load-nutrition-engine');
const { INGREDIENTS, ing } = require('../helpers/fixtures');

const { calcNutrition, ING_IDX, ING_COL_COUNT, STANDARDS } = getNutritionEngine();

const EPS = 1e-9;
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const fullMap = () => new Map(Object.entries(INGREDIENTS));
const calc = (rows, extraMap) =>
  calcNutrition(rows, '주식', 0, {}, '개', extraMap || fullMap(), STANDARDS);

test('원료 1개 100%: asis = 원료 배열 값 그대로', () => {
  const r = calc([['CLEAN1', 100]]);
  assert.ok(near(r.asis[ING_IDX.PROTEIN], 20));
  assert.ok(near(r.asis[ING_IDX.FAT], 5));
  assert.ok(near(r.asis[ING_IDX.CARB], 30));
  assert.ok(near(r.asis[ING_IDX.MOISTURE], 10));
});

test('원료 1개 40%: asis = 값 * 0.4 (실제 배합량 기준 합산)', () => {
  const r = calc([['CLEAN1', 40]]);
  assert.ok(near(r.asis[ING_IDX.PROTEIN], 20 * 0.4));
  assert.ok(near(r.asis[ING_IDX.CARB], 30 * 0.4));
  assert.equal(r.totalRatio, 40);
});

test('여러 원료 배합: asis 는 각 원료 기여의 합', () => {
  const r = calc([['CLEAN1', 60], ['FISH', 40]]);
  // PROTEIN: CLEAN1 20*0.6 + FISH 22*0.4 = 12 + 8.8 = 20.8
  assert.ok(near(r.asis[ING_IDX.PROTEIN], 20 * 0.6 + 22 * 0.4), `prot asis=${r.asis[ING_IDX.PROTEIN]}`);
  // FAT: 5*0.6 + 8*0.4 = 3 + 3.2 = 6.2
  assert.ok(near(r.asis[ING_IDX.FAT], 5 * 0.6 + 8 * 0.4));
});

test('같은 원료가 두 행에 나뉘어도 합산된다', () => {
  const one = calc([['CLEAN1', 50]]);
  const two = calc([['CLEAN1', 20], ['CLEAN1', 30]]);
  assert.ok(near(one.asis[ING_IDX.PROTEIN], two.asis[ING_IDX.PROTEIN]));
  assert.equal(two.totalRatio, 50);
});

test('ratio <= 0 인 행은 합산에서 제외(0 은 미사용 행)', () => {
  const r = calc([['CLEAN1', 100], ['FISH', 0]]);
  assert.ok(near(r.asis[ING_IDX.EPA], 0)); // FISH(EPA 보유)가 0% 라 기여 없음
  assert.equal(r.totalRatio, 100);
});

test('존재하지 않는 원료 행은 조용히 건너뛴다(합계에도 안 들어감)', () => {
  const r = calc([['DOES_NOT_EXIST', 50], ['CLEAN1', 50]]);
  assert.equal(r.totalRatio, 50);
  assert.ok(near(r.asis[ING_IDX.PROTEIN], 20 * 0.5));
});

test('F3 무명 행: 원료명 없이 배합비만 → blendError, 판정 전부 ─', () => {
  const r = calc([['CLEAN1', 80], ['', 20]]);
  assert.match(r.blendError || '', /원료명/);
  assert.ok(r.standards.every((s) => s.value === null));
});

test('F2 음수 배합비: 이름 있는 행에 음수 → blendError', () => {
  const r = calc([['CLEAN1', 80], ['PREMIX', -10]]);
  assert.match(r.blendError || '', /음수/);
  assert.equal(r.totalRatio, 80); // 음수 행은 loop 의 ratio<=0 로도 빠짐
});

test('F1 합계 초과(150%): blendError, 그러나 asis 합산 자체는 정상 수행', () => {
  const r = calc([['CLEAN1', 90], ['PREMIX', 60]]);
  assert.match(r.blendError || '', /100%/);
  assert.equal(r.totalRatio, 150);
  assert.ok(r.asis[ING_IDX.PROTEIN] > 0);
});

test('missingCols: null 셀은 "실제 0" 이 아니라 결측으로 기록된다', () => {
  const r = calc([['NULLY', 100]]);
  assert.ok(r.missingCols.includes(ING_IDX.CA), 'CA 결측 기록');
  assert.ok(r.missingCols.includes(ING_IDX.LYS), 'LYS 결측 기록');
  assert.ok(!r.missingCols.includes(ING_IDX.PROTEIN), 'PROTEIN 은 값이 있으므로 결측 아님');
});

test('asis 배열 길이 = ING_COL_COUNT (48)', () => {
  const r = calc([['CLEAN1', 100]]);
  assert.equal(r.asis.length, ING_COL_COUNT);
  assert.equal(ING_COL_COUNT, 48);
});
