'use strict';
// mergeRecipeCustomIngs() — 일반 레시피 로드 시 data.customIngs 를 현재 라이브러리에
// "병합"(치환 아님)해 사용자가 만든 커스텀 원료가 사라지지 않게 한다.
// js/recipe.js 는 DOM 참조가 함수 본문 안에만 있어 최상위 실행이 없으므로 그대로 require 가능하다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeRecipeCustomIngs } = require('../js/recipe.js');

// 커스텀 원료 행 = [이름, ...48개 숫자]. 값 차이를 구분하려고 두 번째 칸에 태그를 넣는다.
const row = (name, tag = 0) => [name, tag, ...new Array(47).fill(0)];
const names = (rows) => rows.map(r => r[0]);

test('[A,B] + [] → [A,B] (빈 incoming 은 손실 없음)', () => {
  const cur = [row('A'), row('B')];
  const out = mergeRecipeCustomIngs(cur, [], new Set());
  assert.deepEqual(names(out), ['A', 'B']);
});

test('[A,B] + [C] → [A,B,C] (새 원료만 append)', () => {
  const out = mergeRecipeCustomIngs([row('A'), row('B')], [row('C')], new Set());
  assert.deepEqual(names(out), ['A', 'B', 'C']);
});

test('[A(사용자값)] + [A(타값)] → 기존 A 유지 (덮어쓰지 않음)', () => {
  const mine = row('A', 111);
  const out = mergeRecipeCustomIngs([mine], [row('A', 999)], new Set());
  assert.equal(out.length, 1);
  assert.equal(out[0], mine);      // 동일 참조 — 기존 정의 그대로
  assert.equal(out[0][1], 111);
});

test('[] + [C] → [C] (레시피 자체 원료로 계산 가능)', () => {
  const out = mergeRecipeCustomIngs([], [row('C')], new Set());
  assert.deepEqual(names(out), ['C']);
});

test('비배열 / row[0] 비문자열 incoming 은 제외', () => {
  const junk = [null, 'x', 42, {}, [], [123, 0, 0], row('OK')];
  const out = mergeRecipeCustomIngs([row('A')], junk, new Set());
  assert.deepEqual(names(out), ['A', 'OK']);
});

test('내장 ING_DB 와 같은 이름은 customIngs 에 추가하지 않음', () => {
  const builtin = new Set(['닭가슴살', '현미']);
  const out = mergeRecipeCustomIngs([row('A')], [row('닭가슴살', 5), row('신규')], builtin);
  assert.deepEqual(names(out), ['A', '신규']);
});

test('불변식: 병합 결과 길이는 항상 current 이상 (로드로 줄지 않음)', () => {
  const cur = [row('A'), row('B'), row('C')];
  const cases = [
    [], [row('A')], [row('D'), row('E')], [row('A'), row('D')],
    [null, 'x'], [row('B', 9), row('F')],
  ];
  for (const incoming of cases) {
    const out = mergeRecipeCustomIngs(cur, incoming, new Set(['ZZ']));
    assert.ok(out.length >= cur.length, `길이 감소: ${names(out)}`);
    // current 의 모든 원료가 그대로(동일 참조) 남아 있어야 한다
    cur.forEach((r, i) => assert.equal(out[i], r));
  }
});

test('incoming 내부 중복 이름은 첫 항목만 반영', () => {
  const out = mergeRecipeCustomIngs([], [row('X', 1), row('X', 2)], new Set());
  assert.equal(out.length, 1);
  assert.equal(out[0][1], 1);
});

test('current 가 배열이 아니어도 안전 (빈 배열 기준)', () => {
  const out = mergeRecipeCustomIngs(undefined, [row('C')], new Set());
  assert.deepEqual(names(out), ['C']);
});

test('builtinNames 를 배열로 넘겨도 동작', () => {
  const out = mergeRecipeCustomIngs([], [row('닭가슴살'), row('신규')], ['닭가슴살']);
  assert.deepEqual(names(out), ['신규']);
});
