'use strict';
// custom 원료 안정 ID 계층 (js/custom-ingredients.js) — 이름과 무관한 고유 ID,
// 이름 변경 시 ID 유지, 동일 이름 구분, v1→v2 직렬화/마이그레이션, 조회/삭제.

const test = require('node:test');
const assert = require('node:assert/strict');
const CI = require('../../js/custom-ingredients.js');

const mkRow = (name, kcal = 0) => { const r = new Array(49).fill(0); r[0] = name; r[1] = kcal; return r; };

test('신규 ID 형식: custom:<...> 이고 매번 고유하다', () => {
  CI._reset();
  const ids = new Set();
  for (let i = 0; i < 500; i++) {
    const id = CI.allocId();
    assert.match(id, /^custom:[0-9a-z]+$/i);
    assert.ok(!ids.has(id), '충돌 없음');
    ids.add(id);
  }
  assert.equal(ids.size, 500);
});

test('idFor: 같은 row 참조는 항상 같은 ID (idempotent)', () => {
  CI._reset();
  const row = mkRow('내원료');
  const a = CI.idFor(row);
  const b = CI.idFor(row);
  assert.equal(a, b);
  assert.match(a, /^custom:/);
});

test('이름 변경(reassign) 후에도 ID 유지', () => {
  CI._reset();
  const oldRow = mkRow('옛이름', 100);
  const id = CI.idFor(oldRow);
  const newRow = mkRow('새이름', 111);      // saveNewIng 편집: customIngs[i] = vals (새 배열)
  CI.reassign(oldRow, newRow);
  assert.equal(CI.idOfRow(newRow), id, '이름이 바뀌어도 같은 ID');
  assert.equal(CI.idOfRow(oldRow), null, '옛 참조 매핑은 제거');
});

test('동일 이름 원료도 ID로 구분된다', () => {
  CI._reset();
  const r1 = mkRow('닭가슴살', 100);
  const r2 = mkRow('닭가슴살', 120); // 같은 이름, 다른 데이터/참조
  const id1 = CI.idFor(r1);
  const id2 = CI.idFor(r2);
  assert.notEqual(id1, id2);
  const rows = [r1, r2];
  assert.equal(CI.rowById(id1, rows), r1);
  assert.equal(CI.rowById(id2, rows), r2);
});

test('v2 직렬화 → 파싱 왕복: row 형식(49칸)·id 보존', () => {
  CI._reset();
  const rows = [mkRow('A', 1), mkRow('B', 2), mkRow('C', 3)];
  rows.forEach(r => CI.idFor(r));
  const ids = rows.map(r => CI.idOfRow(r));
  const ser = CI.serializeV2(rows);
  assert.equal(ser.v, 2);
  assert.equal(ser.items.length, 3);
  assert.deepEqual(ser.items[0].row, rows[0]);           // 배열 형식 그대로
  assert.equal(ser.items[0].id, ids[0]);
  assert.equal(ser.items[0].name, 'A');

  const json = JSON.parse(JSON.stringify(ser));           // localStorage 왕복 시뮬레이션
  const parsed = CI.parseV2(json);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[1], rows[1]);
  assert.deepEqual(parsed.entries.map(e => e[1]), ids);   // id 보존
});

test('parseV2: 형식이 아니면 null (v1 폴백 신호)', () => {
  assert.equal(CI.parseV2(null), null);
  assert.equal(CI.parseV2([mkRow('X')]), null);           // v1(배열)
  assert.equal(CI.parseV2({ v: 1, items: [] }), null);
  assert.equal(CI.parseV2({ v: 2 }), null);
});

test('v1 → v2 마이그레이션: syncRows 가 ID 없는 기존 원료에 ID 발급', () => {
  CI._reset();
  const v1rows = [mkRow('구원료1'), mkRow('구원료2')]; // localStorage v1 에서 막 파싱됨(매핑 없음)
  CI.syncRows(v1rows, { allocMissing: true });
  const id1 = CI.idOfRow(v1rows[0]);
  const id2 = CI.idOfRow(v1rows[1]);
  assert.match(id1, /^custom:/);
  assert.match(id2, /^custom:/);
  assert.notEqual(id1, id2);
  // 이제 v2로 저장 가능
  const ser = CI.serializeV2(v1rows);
  assert.equal(ser.items[0].id, id1);
});

test('adoptEntries: v2 로드 시 (row,id) 매핑을 그대로 등록', () => {
  CI._reset();
  const rows = [mkRow('P'), mkRow('Q')];
  const entries = [[rows[0], 'custom:abc123'], [rows[1], 'custom:def456']];
  CI.adoptEntries(entries);
  assert.equal(CI.idOfRow(rows[0]), 'custom:abc123');
  assert.equal(CI.idOfRow(rows[1]), 'custom:def456');
});

test('removeById: 배열에서 splice + 매핑 정리, 제거된 row 반환', () => {
  CI._reset();
  const rows = [mkRow('X', 1), mkRow('Y', 2), mkRow('Z', 3)];
  rows.forEach(r => CI.idFor(r));
  const idY = CI.idOfRow(rows[1]);
  const removed = CI.removeById(idY, rows);
  assert.equal(removed[0], 'Y');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r[0]), ['X', 'Z']);
  assert.equal(CI.rowById(idY, rows), null);
  assert.equal(CI.removeById('custom:nope', rows), null); // 없는 id
});

test('syncRows: customIngs 통째 교체(레시피 복원) 시 낡은 매핑 정리 + 새 row에 ID', () => {
  CI._reset();
  const oldRows = [mkRow('레시피A'), mkRow('레시피B')];
  oldRows.forEach(r => CI.idFor(r));
  const sizeBefore = CI._debugSize();
  assert.equal(sizeBefore, 2);

  const newRows = [mkRow('레시피C'), mkRow('레시피D'), mkRow('레시피E')]; // 다른 참조
  CI.syncRows(newRows, { allocMissing: true });
  assert.equal(CI._debugSize(), 3, '낡은 2개 정리 + 새 3개');
  newRows.forEach(r => assert.match(CI.idOfRow(r), /^custom:/));
  oldRows.forEach(r => assert.equal(CI.idOfRow(r), null));
});

test('isValidId', () => {
  assert.ok(CI.isValidId('custom:abc123'));
  assert.ok(!CI.isValidId('base:abc'));
  assert.ok(!CI.isValidId('custom:'));
  assert.ok(!CI.isValidId(null));
  assert.ok(!CI.isValidId('custom:has space'));
});

test('keyV2: 사용자별 키 / 비로그인 키', () => {
  assert.equal(CI.keyV2('u123'), 'feedcalc_v4_custom_ings_v2_u123');
  assert.equal(CI.keyV2(null), 'feedcalc_v4_custom_ings_v2');
});
