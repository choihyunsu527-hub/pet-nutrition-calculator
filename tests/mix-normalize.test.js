'use strict';
// normalizeMixRatios() — "배합비 100% 맞추기" 순수 로직 검증.
// js/mix.js 는 DOM 참조가 많은 클래식 스크립트라 require 할 수 없으므로,
// load-engine.js 와 같은 방식으로 함수 본문만 잘라 vm 샌드박스에서 평가한다.
// (함수를 복사/재구현하지 않는다 — 원문 텍스트를 그대로 실행한다.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MIX_FILE = path.resolve(__dirname, '..', 'js', 'mix.js');

function sliceFn(src, marker) {
  const idx = src.search(marker);
  if (idx < 0) throw new Error(`[mix-normalize] 마커를 찾지 못했습니다: ${marker}`);
  let i = src.indexOf('{', idx);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error('[mix-normalize] 중괄호 균형이 맞지 않습니다.');
  return src.slice(idx, i);
}

const SRC = fs.readFileSync(MIX_FILE, 'utf8');
const FN_SRC = sliceFn(SRC, /function normalizeMixRatios\(\)/);

// 잘라낸 함수를 샌드박스에서 노출. DOM/전역은 테스트가 매번 주입한다.
function makeNormalize(env) {
  const sandbox = {
    document: env.document,
    mixRows: env.mixRows,
    calculate: env.calculate,
    parseFloat, Math, String, Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(FN_SRC + '\nthis.__fn = normalizeMixRatios;', sandbox);
  return sandbox.__fn;
}

// 가짜 배합 행 — 실제 mix.js 가 읽는 셀렉터만 구현한다.
function fakeRow(name, ratioStr) {
  const valueEl = { value: name };
  const numEl = { value: String(ratioStr) };
  return {
    num: numEl,
    querySelector(sel) {
      if (sel === '.mix-ing-value') return valueEl;
      if (sel === 'input[type=number]') return numEl;
      return null;
    },
  };
}

function run(unit, rows) {
  let calcCount = 0;
  const env = {
    document: { getElementById: (id) => (id === 'unit-select' ? { value: unit } : null) },
    mixRows: rows,
    calculate: () => { calcCount++; },
  };
  makeNormalize(env)();
  return { calcCount, values: rows.map(r => r.num.value) };
}

const sumOf = (vals) => vals.reduce((s, v) => s + (parseFloat(v) || 0), 0);
const oneDecimal = (v) => /^\d+(\.\d)?$/.test(v) || v === String(parseFloat(v)); // 소수 1자리 이하

test('97% → 정확히 100.0%', () => {
  const rows = [fakeRow('A', 40), fakeRow('B', 30), fakeRow('C', 27)];
  const { values } = run('pct', rows);
  assert.equal(sumOf(values).toFixed(1), '100.0');
  values.forEach(v => assert.ok(oneDecimal(v), `소수 1자리: ${v}`));
});

test('103% → 정확히 100.0%', () => {
  const rows = [fakeRow('A', 50), fakeRow('B', 30), fakeRow('C', 23)];
  const { values } = run('pct', rows);
  assert.equal(sumOf(values).toFixed(1), '100.0');
});

test('이미 100% → 값 변화 없음 + calculate() 미호출', () => {
  const rows = [fakeRow('A', 50), fakeRow('B', 30), fakeRow('C', 20)];
  const { values, calcCount } = run('pct', rows);
  assert.deepEqual(values, ['50', '30', '20']);
  assert.equal(calcCount, 0);
});

test('100.3% → 정확히 100.0%', () => {
  const rows = [fakeRow('A', 50), fakeRow('B', 30), fakeRow('C', 20.3)];
  const { values, calcCount } = run('pct', rows);
  assert.equal(sumOf(values).toFixed(1), '100.0');
  assert.equal(calcCount, 1);
});

test('0% (유효 배합비 없음) → no-op', () => {
  const rows = [fakeRow('A', 0), fakeRow('B', 0)];
  const { values, calcCount } = run('pct', rows);
  assert.deepEqual(values, ['0', '0']);
  assert.equal(calcCount, 0);
});

test('유효 행 1개 → 100.0%', () => {
  const rows = [fakeRow('A', 45), fakeRow('', 0)];
  const { values } = run('pct', rows);
  assert.equal(values[0], '100');
  assert.equal(values[1], '0'); // 빈 행 유지
});

test('3등분(33.33…) → 합계 정확히 100.0%', () => {
  const rows = [fakeRow('A', 1), fakeRow('B', 1), fakeRow('C', 1)];
  const { values } = run('pct', rows);
  assert.equal(sumOf(values).toFixed(1), '100.0');
  // 잔차(+0.1)는 최대(=동률이면 첫) 행에 반영
  assert.deepEqual(values, ['33.4', '33.3', '33.3']);
});

test('빈 행/원료명 없는 행은 대상에서 제외되고 0 유지', () => {
  const rows = [fakeRow('A', 60), fakeRow('', 15), fakeRow('B', 40), fakeRow('C', 0)];
  const { values } = run('pct', rows);
  assert.equal(values[1], '15');   // 원료명 없음 → 손대지 않음(입력값 그대로)
  assert.equal(values[3], '0');    // 배합비 0 → 그대로
  assert.equal((parseFloat(values[0]) + parseFloat(values[2])).toFixed(1), '100.0');
});

test('정렬 상태(행 순서가 값 내림차순)와 무관하게 각 행 입력값에 적용', () => {
  const a = fakeRow('A', 20), b = fakeRow('B', 50), c = fakeRow('C', 30);
  // mixRows 를 "정렬된" 순서(내림차순)로 전달 — 함수는 배열 순서와 무관하게 각 행 자체를 처리해야 함
  const { values } = run('pct', [b, c, a]);
  assert.equal(sumOf(values).toFixed(1), '100.0');
  assert.ok(parseFloat(b.num.value) > parseFloat(c.num.value));
  assert.ok(parseFloat(c.num.value) > parseFloat(a.num.value));
  assert.equal(b.num.value, '50'); // 100 합계였으므로 값 유지
});

test('g 모드 → no-op', () => {
  const rows = [fakeRow('A', 400), fakeRow('B', 300)];
  const { values, calcCount } = run('g', rows);
  assert.deepEqual(values, ['400', '300']);
  assert.equal(calcCount, 0);
});

test('kg 모드 → no-op', () => {
  const rows = [fakeRow('A', 0.4), fakeRow('B', 0.3)];
  const { calcCount } = run('kg', rows);
  assert.equal(calcCount, 0);
});
