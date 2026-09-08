'use strict';
// 배열 ↔ 객체 어댑터 왕복 안정성.
//  - rowToObject / objectToRow 는 서로 정확한 역함수여야 한다.
//  - JSON.stringify 바이트 동일 (saveIngOverrides() 의 정본 diff 가 문자열 동등성에 의존).
//  - 숫자 0(실제 0) 과 null(결측) 을 구분해 보존해야 한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../../js/ingredient-schema.js');
const base = require('../../ingredients.json');
const ext = require('../../data/ingredients_ext.json');

test('실제 기본 DB(ingredients.json) 157행 전부 왕복 바이트 동일', () => {
  let ok = 0;
  const bad = [];
  for (const row of base) {
    const back = S.objectToRow(S.rowToObject(row, { source: 'base' }));
    if (JSON.stringify(row) === JSON.stringify(back)) ok++;
    else bad.push(row[0]);
  }
  assert.equal(bad.length, 0, `왕복 실패: ${bad.slice(0, 5).join(', ')}`);
  assert.equal(ok, base.length);
});

test('실제 확장 DB(data/ingredients_ext.json) 2,233행 전부 왕복 바이트 동일', () => {
  let ok = 0;
  for (const row of ext) {
    const back = S.objectToRow(S.rowToObject(row, { source: 'ext' }));
    if (JSON.stringify(row) === JSON.stringify(back)) ok++;
  }
  assert.equal(ok, ext.length);
});

test('roundTripEquals 헬퍼가 전체 데이터에서 true', () => {
  assert.ok(base.every((r) => S.roundTripEquals(r)));
  assert.ok(ext.every((r) => S.roundTripEquals(r)));
});

test('숫자 0 = 실제 0 / null = 결측 을 구분 보존', () => {
  // 결측(null) 이 있는 행을 base 에서 하나 고른다
  const nullRow = base.find((r) => r.some((v) => v === null));
  assert.ok(nullRow, '테스트 전제: base 에 null 셀 있는 행 존재');
  const obj = S.rowToObject(nullRow);
  const hasNull = Object.values(obj.nutrients).some((v) => v === null);
  const hasZero = Object.values(obj.nutrients).some((v) => v === 0);
  assert.ok(hasNull, 'null 이 null 로 보존');
  assert.ok(hasZero, '0 이 0 으로 보존(예: taurine)');
  // 되돌린 배열에서도 동일 위치가 각각 null / 0
  const back = S.objectToRow(obj);
  nullRow.forEach((v, i) => {
    if (v === null) assert.equal(back[i], null, `pos ${i} null 유지`);
    if (v === 0) assert.equal(back[i], 0, `pos ${i} 0 유지`);
  });
});

test('rowToObject: 표준키 nutrients + 메타 필드', () => {
  const obj = S.rowToObject(base[0], { source: 'base' });
  assert.equal(obj.name, base[0][0]);
  assert.equal(obj.source, 'usda', "'base' 는 canonical 'usda' 로 정규화됨");
  assert.equal(obj.basis, 'per_100g_as_fed');
  assert.equal(obj.sourceId, null);
  assert.equal(obj.metadata.schemaVersion, 1);
  assert.equal(obj.metadata.arrayLength, 49);
  assert.equal(Object.keys(obj.nutrients).length, 48);
  assert.equal(obj.nutrients.energyKcal, base[0][1]);
  assert.equal(obj.nutrients.protein, base[0][3]);
  assert.equal(obj.nutrients.taurine, base[0][48]);
});

test('objectToRow: metadata._row 있으면 그대로 복제(zero-copy 원본 보존)', () => {
  const row = base[3];
  const obj = S.rowToObject(row, { source: 'base' });
  const back = S.objectToRow(obj);
  assert.deepEqual(back, row);
  assert.notEqual(back, row, '복제본이어야 한다(참조 동일 금지)');
});

test('objectToRow: _row 없이 nutrients 만으로도 재구성', () => {
  const row = base[10];
  const obj = S.rowToObject(row, { source: 'base' });
  delete obj.metadata._row; // 직렬화되어 돌아온 상황 시뮬레이션
  const back = S.objectToRow(obj);
  assert.equal(JSON.stringify(back), JSON.stringify(row));
});

test('짧은 배열(길이 < 49): nutrients 는 없는 칸을 null 로 채운다; _row 있으면 왕복은 원본 그대로', () => {
  const short = ['테스트원료', 100, 10, 20]; // 이름 + 3개만
  const obj = S.rowToObject(short, { source: 'custom' });
  assert.equal(obj.nutrients.energyKcal, 100);
  assert.equal(obj.nutrients.protein, 20);
  assert.equal(obj.nutrients.taurine, null);
  assert.equal(obj.metadata.arrayLength, 4);
  // _row 를 알고 있으면 왕복은 "입력을 그대로" 돌려준다(byte-identical 우선)
  assert.deepEqual(S.objectToRow(obj), short);
  // _row 없이(직렬화 후 상황) 재구성하면 49칸으로 정규화
  delete obj.metadata._row;
  const back = S.objectToRow(obj);
  assert.equal(back.length, 49);
  assert.equal(back[4], null);
  assert.equal(back[1], 100);
});

test('잘못된 입력은 TypeError', () => {
  assert.throws(() => S.rowToObject('not-an-array'), TypeError);
  assert.throws(() => S.objectToRow(null), TypeError);
});

test('deriveId 는 objectToRow 왕복에 영향 없음(파생값이라 배열에 안 들어감)', () => {
  const obj = S.rowToObject(base[0], { source: 'base' });
  assert.ok(obj.id.startsWith('usda:'), "'base' → canonical 'usda:' prefix");
  const back = S.objectToRow(obj);
  assert.equal(back.length, 49);
  assert.equal(back[0], base[0][0]); // 이름 그대로, id 는 배열에 없음
});
