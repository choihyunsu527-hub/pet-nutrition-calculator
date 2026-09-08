'use strict';
// 반올림 / 소수점 처리 회귀.
//  - calcNutrition() 은 내부적으로 값을 반올림하지 않는다(원시 float 그대로 반환) — 표시 단계에서만 toFixed.
//  - fmtAminoAmt(): % 단위는 toFixed(2) 로 숫자에 붙이고, 그 외 단위는 띄어쓴다.
//  - 전 시나리오 golden 스냅샷을 "분리된 nutrition-engine.js" 로 다시 계산해도 동일해야 한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getNutritionEngine } = require('../helpers/load-nutrition-engine');
const { INGREDIENTS } = require('../helpers/fixtures');
const { SCENARIOS, MAP, stdFor } = require('../helpers/scenarios');
const { normalize } = require('../helpers/serialize');

const { calcNutrition, fmtAminoAmt, STANDARDS } = getNutritionEngine();

const calc = (rows) =>
  calcNutrition(rows, '주식', 0, {}, '개', new Map(Object.entries(INGREDIENTS)), STANDARDS);

test('calcNutrition 은 결과를 반올림하지 않는다 — dmb.prot === 20 / 0.9 (무한소수 그대로)', () => {
  const r = calc([['CLEAN1', 100]]);
  assert.equal(r.dmb.prot, 20 / 0.9);
  assert.equal(r.meDmb, 2175 / 0.9);
  // 12자리 안에서 정확히 일치(표시용 반올림이 엔진에 새어들지 않았는지)
  assert.ok(String(r.dmb.prot).length > 10, `prot=${r.dmb.prot} (무한소수여야 함)`);
});

test('dmPct 하한 클램프: max(dmFrac, 0.001) — 반올림이 아니라 하한', () => {
  const DRY = require('../helpers/fixtures').ing('DRY', { MOISTURE: 0, PROTEIN: 50 });
  const r = calcNutrition([['DRY', 100]], '주식', 0, {}, '개', new Map([['DRY', DRY]]), STANDARDS);
  assert.equal(r.dmPct, 1); // 수분 0 → dmFrac 1
});

test('fmtAminoAmt: % 단위는 toFixed(2) 를 숫자에 붙인다', () => {
  assert.equal(fmtAminoAmt(1.5, '% DMB'), '1.50% DMB');
  assert.equal(fmtAminoAmt(2, '%'), '2.00%');
});

test('fmtAminoAmt: % 아닌 단위는 값과 단위를 띄어 쓴다', () => {
  assert.equal(fmtAminoAmt(2.5, 'g'), '2.50 g');
  assert.equal(fmtAminoAmt(3, 'mg/kg'), '3.00 mg/kg');
  assert.equal(fmtAminoAmt(4, undefined), '4.00 ');
});

test('fmtAminoAmt: null → ─', () => {
  assert.equal(fmtAminoAmt(null, 'g'), '─');
  assert.equal(fmtAminoAmt(undefined, '%'), '─');
});

test('fmtAminoAmt 는 JS toFixed 의 은행가 아닌 반올림 규칙을 그대로 따른다', () => {
  // (2.5).toFixed(0) === '3', (0.125).toFixed(2) === '0.12' — 엔진이 이 동작을 바꾸지 않는다
  assert.equal(fmtAminoAmt(0.125, '%'), (0.125).toFixed(2) + '%');
  assert.equal(fmtAminoAmt(0.005, '%'), (0.005).toFixed(2) + '%');
});

// ── golden 스냅샷 교차검증: 분리된 엔진 파일로 재계산해도 동일 ──────────
test('전 시나리오: 분리된 js/nutrition-engine.js 결과가 golden 스냅샷과 100% 일치', () => {
  const goldenPath = path.resolve(__dirname, '..', 'fixtures', 'golden.json');
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8')).results;
  let checked = 0;
  for (const sc of SCENARIOS) {
    const got = normalize(
      calcNutrition(sc.rows, sc.productType, 0, {}, sc.species, MAP, stdFor(sc.species)),
    );
    assert.deepEqual(got, golden[sc.id], `시나리오 ${sc.id} 결과가 golden 과 다릅니다`);
    checked++;
  }
  assert.equal(checked, SCENARIOS.length);
  assert.ok(checked >= 21, `시나리오 ${checked}건 (기대 21+)`);
});
