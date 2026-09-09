'use strict';
// 대량 DB(3,000+) 대응 구조 검증 — 실제 DB 는 건드리지 않고 mock 원료만 생성한다.
//  1. 검색 인덱스 위에서 필터 → 상한(render cap)까지만 잘라도 매칭 계산은 정확
//  2. 계산은 "배합에 실제로 쓰인 원료"만 참조한다(맵 크기와 무관)
//  3. 3,000행 반복 검색이 빠르다(선형 스캔이지만 실측 확인)

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../../js/ingredient-schema.js');
const { getNutritionEngine } = require('../helpers/load-nutrition-engine');
const { calcNutrition, ING_IDX, STANDARDS } = getNutritionEngine();

// ── mock 원료 3,000개 (실제 DB 와 무관) ─────────────────────────────────
const MOCK_COUNT = 3000;
function makeMockRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(49).fill(0);
    row[0] = `mock원료_${String(i).padStart(4, '0')}`;
    row[1] = 100 + (i % 300);           // energyKcal
    row[ING_IDX.MOISTURE + 1] = 10;
    row[ING_IDX.PROTEIN + 1] = 5 + (i % 40);
    row[ING_IDX.FAT + 1] = 1 + (i % 10);
    row[ING_IDX.CARB + 1] = 20;
    rows.push(row);
  }
  return rows;
}
const MOCK_ROWS = makeMockRows(MOCK_COUNT);

// 검색용 인덱스: 이름 소문자만 미리 계산(영양소 배열 없음)
const SEARCH_INDEX = MOCK_ROWS.map((r) => ({ id: S.deriveId(r[0], 'ext'), name: r[0], nameLower: r[0].toLowerCase() }));
// 계산용 스토어: id → 배열
const NUTRIENT_STORE = new Map(MOCK_ROWS.map((r) => [S.deriveId(r[0], 'ext'), r]));

const RENDER_CAP = 100;

function search(query) {
  const q = query.toLowerCase().trim();
  const matched = [];
  for (const e of SEARCH_INDEX) if (e.nameLower.includes(q)) matched.push(e);
  return { matched: matched.length, shown: matched.slice(0, RENDER_CAP) };
}

test('3,000 mock: 검색은 매칭 수를 정확히 세고, 렌더는 상한(100)까지만', () => {
  const r = search('mock원료_1'); // 'mock원료_1', 'mock원료_10xx', 'mock원료_1xxx' ...
  // 이름에 '_1' 이 들어가는 것: _1000..1999 (1000개) + _0010..0019,_0100..0199 등 다수
  assert.ok(r.matched >= 1000, `matched=${r.matched}`);
  assert.equal(r.shown.length, RENDER_CAP, '렌더는 상한까지만');
  assert.ok(r.matched > r.shown.length, '상한 초과 시 "더 있음" 신호 가능');
});

test('3,000 mock: 좁은 검색어는 소수만 매칭', () => {
  const r = search('mock원료_2999');
  assert.equal(r.matched, 1);
  assert.equal(r.shown.length, 1);
});

test('3,000 mock: 없는 검색어는 0건', () => {
  assert.equal(search('존재하지않는원료xyz').matched, 0);
});

test('계산은 배합에 쓰인 원료만 참조 — 3,000짜리 맵을 넘겨도 결과는 2개 원료 배합과 동일', () => {
  const usedNames = ['mock원료_0005', 'mock원료_2500'];
  const rows = [[usedNames[0], 60], [usedNames[1], 40]];

  // (a) 3,000개 전부 든 맵
  const bigMap = new Map();
  for (const e of SEARCH_INDEX) bigMap.set(e.name, NUTRIENT_STORE.get(e.id));
  // (b) 쓰인 2개만 든 맵
  const smallMap = new Map(usedNames.map((n) => [n, bigMap.get(n)]));

  const rBig = calcNutrition(rows, '주식', 0, {}, '개', bigMap, STANDARDS);
  const rSmall = calcNutrition(rows, '주식', 0, {}, '개', smallMap, STANDARDS);

  assert.equal(JSON.stringify(rBig.asis), JSON.stringify(rSmall.asis), 'asis 동일');
  assert.equal(rBig.meAsis, rSmall.meAsis, 'meAsis 동일');
  assert.equal(rBig.totalRatio, 100);
});

test('3,000행 반복 검색 성능(실측): 200회 < 1000ms', () => {
  const t0 = Date.now();
  let acc = 0;
  for (let i = 0; i < 200; i++) acc += search('mock원료_' + (i % 100)).matched;
  const ms = Date.now() - t0;
  assert.ok(acc > 0);
  assert.ok(ms < 1000, `200회 검색에 ${ms}ms (선형 스캔이 예상보다 느리면 인덱스 도입 필요 신호)`);
});

test('mock 데이터가 실제 DB 파일에 섞이지 않았다', () => {
  const realBase = require('../../ingredients.json');
  const realExt = require('../../data/ingredients_ext.json');
  assert.ok(!realBase.some((r) => String(r[0]).startsWith('mock원료_')));
  assert.ok(!realExt.some((r) => String(r[0]).startsWith('mock원료_')));
  assert.equal(realBase.length, 157);
  assert.equal(realExt.length, 2233);
});
