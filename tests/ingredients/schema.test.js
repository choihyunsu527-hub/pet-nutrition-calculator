'use strict';
// 원료 스키마(js/ingredient-schema.js) — nutrient index ↔ 표준키 매핑, 단위, 안정 ID.
// 이 계층은 순수 부가 계층이라 require 만으로 로드된다(브라우저 전역 IngredientSchema 와 동일 객체).

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../../js/ingredient-schema.js');
const { getEngine } = require('../helpers/load-engine');
const { ING_IDX, ING_COL_COUNT } = getEngine();

test('영양소 개수 = ING_COL_COUNT(48), 배열 길이 = 49', () => {
  assert.equal(S.NUTRIENT_COUNT, 48);
  assert.equal(S.NUTRIENT_COUNT, ING_COL_COUNT);
  assert.equal(S.ARRAY_LENGTH, 49);
  assert.equal(S.KEY_BY_INDEX.length, 48);
});

test('nutrientIndex ↔ 표준키 매핑이 ING_IDX(js/ingredients.js)와 정확히 일치한다', () => {
  // ING_IDX: { KCAL:0, MOISTURE:1, ... }  /  LEGACY_KEY_MAP: { KCAL:'energyKcal', ... }
  for (const [legacyKey, idx] of Object.entries(ING_IDX)) {
    const stdKey = S.LEGACY_KEY_MAP[legacyKey];
    assert.ok(stdKey, `ING_IDX 키 ${legacyKey} 에 대응하는 표준키가 스키마에 있어야 한다`);
    assert.equal(S.INDEX_BY_KEY[stdKey], idx, `${legacyKey}(=${idx}) ↔ ${stdKey} 인덱스 불일치`);
    assert.equal(S.KEY_BY_INDEX[idx], stdKey);
  }
  // 역방향: 스키마의 모든 표준키도 ING_IDX 에 legacy 대응이 있어야 한다
  const legacySet = new Set(Object.keys(ING_IDX));
  for (const [legacy, stdKey] of Object.entries(S.LEGACY_KEY_MAP)) {
    assert.ok(legacySet.has(legacy), `스키마 legacyKey ${legacy}(→${stdKey}) 가 ING_IDX 에 없음`);
  }
  assert.equal(Object.keys(S.LEGACY_KEY_MAP).length, Object.keys(ING_IDX).length);
});

test('모든 표준키에 단위가 정의돼 있다', () => {
  for (const key of S.KEY_BY_INDEX) {
    assert.equal(typeof S.UNIT_BY_KEY[key], 'string');
    assert.ok(S.UNIT_BY_KEY[key].length > 0);
  }
  assert.equal(S.UNIT_BY_KEY.energyKcal, 'kcal');
  assert.equal(S.UNIT_BY_KEY.protein, 'g');
  assert.equal(S.UNIT_BY_KEY.calcium, 'mg');
  assert.equal(S.UNIT_BY_KEY.selenium, 'ug');
});

test('describe(): arrayPos = nutrientIndex + 1, 48개 필드', () => {
  const d = S.describe();
  assert.equal(d.fields.length, 48);
  assert.equal(d.arrayLength, 49);
  assert.equal(d.basis, 'per_100g_as_fed');
  d.fields.forEach((f, i) => {
    assert.equal(f.nutrientIndex, i);
    assert.equal(f.arrayPos, i + 1);
  });
});

test('deriveId: 결정적 + 정규화(공백/NFC) 무관 + source prefix (canonical)', () => {
  const a = S.deriveId('닭고기(가슴,생것)', 'usda');
  const b = S.deriveId('  닭고기(가슴,생것)  ', 'usda');
  const c = S.deriveId('닭고기(가슴,생것)', 'kfood');
  assert.equal(a, b, '앞뒤/연속 공백은 ID 에 영향 없음');
  assert.notEqual(a, c, 'source 가 다르면 ID 도 다름');
  assert.match(a, /^usda:[0-9a-z]+$/);
  assert.match(c, /^kfood:[0-9a-z]+$/);
  assert.equal(S.deriveId('X'), S.deriveId('X', 'usda'), 'source 기본값 usda');
});

test('deriveId: 하위호환 별칭 base/ext 는 usda/kfood 와 같은 ID', () => {
  assert.equal(S.deriveId('연어', 'base'), S.deriveId('연어', 'usda'));
  assert.equal(S.deriveId('연어', 'ext'), S.deriveId('연어', 'kfood'));
});

test('deriveId: 서로 다른 이름은 서로 다른 ID (실제 base DB 전수)', () => {
  const base = require('../../ingredients.json');
  const ids = new Set();
  for (const row of base) {
    const id = S.deriveId(row[0], 'usda');
    assert.ok(!ids.has(id), `ID 충돌: ${row[0]} → ${id}`);
    ids.add(id);
  }
  assert.equal(ids.size, base.length);
});

test('SOURCE / SOURCE_META / BASIS 상수', () => {
  assert.equal(S.SOURCE.USDA, 'usda');
  assert.equal(S.SOURCE.KFOOD, 'kfood');
  assert.equal(S.SOURCE.CUSTOM, 'custom');
  assert.equal(S.SOURCE.BASE, 'usda', '별칭');
  assert.equal(S.SOURCE.EXT, 'kfood', '별칭');
  for (const k of ['usda', 'kfood', 'custom']) {
    assert.equal(S.SOURCE_META[k].key, k);
    assert.equal(S.SOURCE_META[k].hasSourceId, false, '현재 데이터엔 원본 코드가 없다');
  }
  assert.equal(S.SOURCE_META.usda.file, 'ingredients.json');
  assert.equal(S.SOURCE_META.kfood.file, 'data/ingredients_ext.json');
  assert.equal(S.BASIS_AS_FED_100G, 'per_100g_as_fed');
  assert.equal(S.SCHEMA_VERSION, 1);
});

test('normalizeSource / sourceMeta: base↔usda, ext↔kfood, 알 수 없으면 usda', () => {
  assert.equal(S.normalizeSource('base'), 'usda');
  assert.equal(S.normalizeSource('USDA'), 'usda');
  assert.equal(S.normalizeSource('ext'), 'kfood');
  assert.equal(S.normalizeSource('KFOOD'), 'kfood');
  assert.equal(S.normalizeSource('custom'), 'custom');
  assert.equal(S.normalizeSource('??'), 'usda');
  assert.equal(S.sourceMeta('base').short, 'USDA');
  assert.equal(S.sourceMeta('kfood').short, 'KFOOD');
});

test('sourceIdOf: 코드 미지원 소스는 항상 null (추측 금지)', () => {
  assert.equal(S.sourceIdOf('usda', 'FDC12345'), null, 'hasSourceId=false 면 명시값도 무시');
  assert.equal(S.sourceIdOf('kfood', 'D000123'), null);
  assert.equal(S.sourceIdOf('custom', 'x'), null);
  assert.equal(S.sourceIdOf('usda'), null);
});

test('classifySource: 참조 우선, 이름 폴백, 우선순위 usda→custom→kfood', () => {
  const usda = [['연어'], ['소고기']];
  const custom = [['내 커스텀']];
  const kfood = [['연어'], ['가지']]; // '연어' 는 usda 에도 있음 → usda 우선
  const a = { usda, custom, kfood };
  assert.equal(S.classifySource(usda[0], a), 'usda', '참조 일치');
  assert.equal(S.classifySource(custom[0], a), 'custom');
  assert.equal(S.classifySource(kfood[1], a), 'kfood'); // '가지' 는 kfood 에만
  assert.equal(S.classifySource(['연어'], a), 'usda', '이름 폴백 + 우선순위');
  assert.equal(S.classifySource(['없는원료'], a), null);
});

test('rowToObject: source 는 canonical 로 정규화, sourceId 는 null', () => {
  const row = new Array(49).fill(0); row[0] = '테스트';
  assert.equal(S.rowToObject(row, { source: 'base' }).source, 'usda');
  assert.equal(S.rowToObject(row, { source: 'ext' }).source, 'kfood');
  assert.equal(S.rowToObject(row, { source: 'custom' }).source, 'custom');
  assert.equal(S.rowToObject(row, {}).source, 'usda', '기본값');
  assert.equal(S.rowToObject(row, { source: 'usda', sourceId: 'FDC999' }).sourceId, null, '추측 금지');
});
