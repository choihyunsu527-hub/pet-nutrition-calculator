'use strict';
// As-fed ↔ DMB(건물기준) 변환 회귀.
//  - dmScale = 100 / totalRatio  (상대 배합비 정규화, F1)
//  - autoMoisturePct = 배합 원료 수분의 배합비 가중평균
//  - dmFrac = 1 − moist/100,  dmPct = max(dmFrac, 0.001)
//  - dmb.<영양소> = nrm(i) / dmPct  (단위별 환산계수 포함)

const test = require('node:test');
const assert = require('node:assert/strict');

const { getNutritionEngine } = require('../helpers/load-nutrition-engine');
const { INGREDIENTS } = require('../helpers/fixtures');

const { calcNutrition, STANDARDS, STANDARDS_CAT } = getNutritionEngine();

const EPS = 1e-9;
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const mapOf = (names) => new Map(names.map((n) => [n, INGREDIENTS[n]]));
const calc = (rows, species = '개') =>
  calcNutrition(rows, '주식', 0, {}, species, mapOf(rows.map((r) => r[0])),
    species === '고양이' ? STANDARDS_CAT : STANDARDS);

// CLEAN1 = 수분10 단백20 지방5 탄수30
test('dmPct = 1 − 수분/100, dmb.moist = 자동계산 수분', () => {
  const r = calc([['CLEAN1', 100]]);
  assert.ok(near(r.dmb.moist, 10));
  assert.ok(near(r.dmPct, 0.9));
});

test('dmb.prot/fat/nfe = as-fed 값 / dmPct (수분 10 → ÷0.9)', () => {
  const r = calc([['CLEAN1', 100]]);
  assert.ok(near(r.dmb.prot, 20 / 0.9), `prot=${r.dmb.prot}`);
  assert.ok(near(r.dmb.fat, 5 / 0.9), `fat=${r.dmb.fat}`);
  assert.ok(near(r.dmb.nfe, 30 / 0.9), `nfe=${r.dmb.nfe}`);
});

test('dmScale 정규화: 합계 50% 배합의 DMB 결과는 합계 100% 와 완전히 동일', () => {
  const a = calc([['CLEAN1', 100]]);
  const b = calc([['CLEAN1', 50]]);
  for (const k of ['moist', 'prot', 'fat', 'nfe', 'ash', 'ca', 'p', 'cap']) {
    assert.ok(near(a.dmb[k], b.dmb[k]), `dmb.${k}: 100%=${a.dmb[k]} 50%=${b.dmb[k]}`);
  }
  assert.ok(near(a.dmPct, b.dmPct));
});

test('totalRatio 는 실제 입력 배합비 합계(정규화 전)를 그대로 보고한다', () => {
  assert.equal(calc([['CLEAN1', 100]]).totalRatio, 100);
  assert.equal(calc([['CLEAN1', 50]]).totalRatio, 50);
  assert.equal(calc([['CLEAN1', 30], ['PREMIX', 20]]).totalRatio, 50);
});

test('수분 가중평균: 수분10(60%) + 수분5(40%) → 자동 수분 8.0', () => {
  // PREMIX = 수분5. CLEAN1 = 수분10. 60:40 배합 → 0.6*10 + 0.4*5 = 8
  const r = calc([['CLEAN1', 60], ['PREMIX', 40]]);
  assert.ok(near(r.dmb.moist, 8.0), `moist=${r.dmb.moist}`);
  assert.ok(near(r.dmPct, 0.92), `dmPct=${r.dmPct}`);
});

test('mg 단위 환산: dmb.ca = mgPct(CA) = nrm(CA)/1000/dmPct  (CLEAN1 CA=1.0 g/100g)', () => {
  const r = calc([['CLEAN1', 100]]);
  assert.ok(near(r.dmb.ca, 1.0 / 1000 / 0.9), `ca=${r.dmb.ca}`);
  assert.ok(near(r.dmb.p, 0.5 / 1000 / 0.9), `p=${r.dmb.p}`);
  assert.ok(near(r.dmb.cap, (1.0 / 1000 / 0.9) / (0.5 / 1000 / 0.9))); // = 2.0
  assert.ok(near(r.dmb.cap, 2.0));
});

test('건물률 비정상(수분≈100%) → blendError, 판정값은 전부 null', () => {
  const WET = require('../helpers/fixtures').ing('WET', { MOISTURE: 99.9, PROTEIN: 0.05 });
  const r = calcNutrition([['WET', 100]], '주식', 0, {}, '개', new Map([['WET', WET]]), STANDARDS);
  assert.ok(r.blendError, 'blendError 설정');
  assert.ok(r.standards.every((s) => s.value === null));
});
