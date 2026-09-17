'use strict';
// compareDeltaPct() — "배합 비교" 탭의 변화량(B-A)/변화율(%) 계산 순수 로직 검증.
// js/compare.js 는 DOM 참조가 있는 클래식 스크립트라 require 할 수 없으므로,
// load-engine.js / mix-normalize.test.js 와 같은 방식으로 함수 본문만 잘라
// vm 샌드박스에서 평가한다(함수를 복사/재구현하지 않고 원문 텍스트 그대로 실행).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const COMPARE_FILE = path.resolve(__dirname, '..', 'js', 'compare.js');

function sliceFn(src, marker) {
  const idx = src.search(marker);
  if (idx < 0) throw new Error(`[compare-delta] 마커를 찾지 못했습니다: ${marker}`);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error('[compare-delta] 중괄호 균형이 맞지 않습니다.');
  return src.slice(idx, i);
}

const SRC = fs.readFileSync(COMPARE_FILE, 'utf8');
const FN_SRC = sliceFn(SRC, /function compareDeltaPct\(/);

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(FN_SRC + '\nthis.__fn = compareDeltaPct;', sandbox);
const compareDeltaPct = sandbox.__fn;

test('일반적인 증가 — delta/pct 정상 계산', () => {
  const { delta, pct } = compareDeltaPct(20, 25);
  assert.equal(delta, 5);
  assert.equal(pct, 25);
});

test('일반적인 감소 — delta 음수, pct 음수', () => {
  const { delta, pct } = compareDeltaPct(20, 15);
  assert.equal(delta, -5);
  assert.equal(pct, -25);
});

test('변화 없음 — delta 0, pct 0', () => {
  const { delta, pct } = compareDeltaPct(10, 10);
  assert.equal(delta, 0);
  assert.equal(pct, 0);
});

test('기준값(A) 0 → 변화율은 null("-" 처리 대상)', () => {
  const { delta, pct } = compareDeltaPct(0, 5);
  assert.equal(delta, 5);
  assert.equal(pct, null);
});

test('A, B 모두 0 → delta 0, pct는 null', () => {
  const { delta, pct } = compareDeltaPct(0, 0);
  assert.equal(delta, 0);
  assert.equal(pct, null);
});

test('A 또는 B가 null(결측) → delta/pct 모두 null', () => {
  for (const [a, b] of [[null, 10], [10, null], [null, null]]) {
    const { delta, pct } = compareDeltaPct(a, b);
    assert.equal(delta, null);
    assert.equal(pct, null);
  }
});
