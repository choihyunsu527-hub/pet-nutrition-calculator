// ingredient-schema.js — 원료 DB 구조 개선을 위한 "순수 부가 계층".
// ⚠ 이 파일은 기존 동작을 절대 바꾸지 않는다.
//   - ING_DB / customIngs / extIngs / ingIndex / getIng / calcNutrition 어느 것도 건드리지 않는다.
//   - 전역은 단 하나(IngredientSchema)만 추가하고, 로드 시 부수효과(DOM 접근·네트워크·저장)가 없다.
//   - 49칸 배열 구조(= [이름, ...영양소 48]) 는 그대로 두고, "배열 ↔ 객체" 어댑터와
//     안정적 ID·출처·기준 필드의 파생 규칙만 한곳에 정의한다.
// 이후 단계(IndexedDB / 분할 JSON / 검색·계산 데이터 분리)가 이 계층 위에서 진행된다.

const IngredientSchema = (function () {
  'use strict';

  // ── 49칸 배열 위치 ↔ 표준 영양소 키(camelCase) 매핑 ─────────────────────────
  // arrayPos 0 = 이름. arrayPos 1..48 = 영양소. 0-based 영양소 인덱스(nutrientIndex)
  //   = arrayPos - 1 = calcNutrition() 의 asis[] 인덱스 = js/ingredients.js 의 ING_IDX 값.
  // 여기 순서·개수는 ING_IDX / ING_COL_COUNT(48) / ingredients.json / data/ingredients_ext.json
  // 의 실제 배열 순서와 반드시 일치해야 한다. (단위는 원료 편집 모달 라벨 ING_COLS 와 동일.)
  const NUTRIENT_FIELDS = [
    // nutrientIndex, key,                        unit,  legacyKey(ING_IDX)
    [0,  'energyKcal',            'kcal', 'KCAL'],
    [1,  'moisture',              'g',    'MOISTURE'],
    [2,  'protein',               'g',    'PROTEIN'],
    [3,  'fat',                   'g',    'FAT'],
    [4,  'carbohydrate',          'g',    'CARB'],       // 차이법(= 가용무질소물 NFE + 조섬유)
    [5,  'ash',                   'g',    'ASH'],
    [6,  'cholesterol',           'mg',   'CHOLESTEROL'],
    [7,  'calcium',               'mg',   'CA'],
    [8,  'phosphorus',            'mg',   'P'],
    [9,  'sodium',                'mg',   'NA'],
    [10, 'potassium',             'mg',   'K'],
    [11, 'iron',                  'mg',   'FE'],
    [12, 'zinc',                  'mg',   'ZN'],
    [13, 'magnesium',             'mg',   'MG'],
    [14, 'selenium',              'ug',   'SE'],
    [15, 'vitaminA',              'IU',   'VIT_A'],
    [16, 'vitaminD',              'IU',   'VIT_D'],
    [17, 'vitaminE',              'mg',   'VIT_E'],
    [18, 'vitaminK',              'mg',   'VIT_K'],
    [19, 'vitaminB1',             'mg',   'VIT_B1'],
    [20, 'vitaminB2',             'mg',   'VIT_B2'],
    [21, 'vitaminB3',             'mg',   'VIT_B3'],
    [22, 'vitaminB5',             'mg',   'VIT_B5'],
    [23, 'vitaminB6',             'mg',   'VIT_B6'],
    [24, 'folate',                'ug',   'FOLATE'],     // 비타민 B9
    [25, 'vitaminB12',            'ug',   'VIT_B12'],
    [26, 'epa',                   'mg',   'EPA'],
    [27, 'dha',                   'mg',   'DHA'],
    [28, 'copper',                'mg',   'CU'],
    [29, 'manganese',             'mg',   'MN'],
    [30, 'iodine',                'ug',   'IODINE'],
    [31, 'chloride',              'mg',   'CL'],
    [32, 'choline',               'mg',   'CHOLINE'],
    [33, 'biotin',                'ug',   'BIOTIN'],
    [34, 'linoleicAcid',          'g',    'LA'],
    [35, 'alphaLinolenicAcid',    'g',    'ALA'],
    [36, 'crudeFiber',            'g',    'CRUDE_FIBER'],
    [37, 'arginine',              'g',    'ARG'],
    [38, 'histidine',             'g',    'HIS'],
    [39, 'isoleucine',            'g',    'ILE'],
    [40, 'leucine',               'g',    'LEU'],
    [41, 'lysine',                'g',    'LYS'],
    [42, 'methionineCystine',     'g',    'MET_CYS'],
    [43, 'phenylalanineTyrosine', 'g',    'PHE_TYR'],
    [44, 'threonine',             'g',    'THR'],
    [45, 'tryptophan',            'g',    'TRP'],
    [46, 'valine',                'g',    'VAL'],
    [47, 'taurine',               'mg',   'TAURINE'],
  ];

  const NUTRIENT_COUNT = NUTRIENT_FIELDS.length;          // 48
  const ARRAY_LENGTH   = NUTRIENT_COUNT + 1;              // 49 (이름 포함)

  const KEY_BY_INDEX    = NUTRIENT_FIELDS.map((f) => f[1]);
  const INDEX_BY_KEY    = {};
  const UNIT_BY_KEY     = {};
  const LEGACY_KEY_MAP  = {};   // ING_IDX 키(대문자) → camelCase 키
  NUTRIENT_FIELDS.forEach(([idx, key, unit, legacy]) => {
    INDEX_BY_KEY[key]   = idx;
    UNIT_BY_KEY[key]    = unit;
    LEGACY_KEY_MAP[legacy] = key;
  });

  // ── 출처(source) / 원본 식품코드(sourceId) / 기준(basis) ──────────────────
  // 원료 데이터는 세 소스에서만 들어온다:
  //   usda   = ingredients.json          (USDA FoodData Central 기반)
  //   kfood  = data/ingredients_ext.json (국가표준식품성분DB, KFOOD)
  //   custom = 사용자 추가 원료           (CustomIngredients 가 custom:<...> id 발급)
  // ⚠ 현재 어느 소스 파일에도 "원본 식품 코드" 컬럼이 없다 → sourceId 는 항상 null 이고,
  //   없는 코드를 추측해서 만들지 않는다. 미래에 코드 컬럼이 생기면 SOURCE_META.hasSourceId 를
  //   켜고 sourceIdOf() 에서 그 컬럼을 읽으면 된다(데이터 대량 변환 없이 얹히는 구조).
  const SOURCE = {
    USDA:   'usda',
    KFOOD:  'kfood',
    CUSTOM: 'custom',
    // 하위호환 별칭 — 예전 'base'/'ext' 를 넘겨도 동일하게 동작한다.
    BASE:   'usda',
    EXT:    'kfood',
  };
  const SOURCE_META = {
    usda:   { key: 'usda',   short: 'USDA',   label: 'USDA FoodData Central',   file: 'ingredients.json',          hasSourceId: false, sourceIdField: 'fdcId'  },
    kfood:  { key: 'kfood',  short: 'KFOOD',  label: '국가표준식품성분DB',       file: 'data/ingredients_ext.json', hasSourceId: false, sourceIdField: 'foodCd' },
    custom: { key: 'custom', short: 'CUSTOM', label: '사용자 추가 원료',         file: null,                        hasSourceId: false, sourceIdField: null    },
  };
  function normalizeSource(s) {
    const v = String(s == null ? '' : s).toLowerCase();
    if (v === 'usda' || v === 'base') return 'usda';
    if (v === 'kfood' || v === 'ext') return 'kfood';
    if (v === 'custom') return 'custom';
    return 'usda'; // 알 수 없으면 기본값(기존 opts.source||BASE 와 같은 취지)
  }
  function sourceMeta(s) { return SOURCE_META[normalizeSource(s)]; }

  // 원료 배열이 어느 소스에서 온 것인지 판정한다 — DOM 을 보지 않고 넘어온 배열들만으로.
  // 우선순위 usda → custom → kfood (= rebuildIngIndex()/allIngs() 의 ING_DB → customIngs → extIngs).
  // 배열 참조가 일치하면 우선 사용하고, 없으면 이름 일치로 판정한다.
  function classifySource(row, arrays) {
    arrays = arrays || {};
    const name = Array.isArray(row) ? row[0] : row;
    const list = [
      ['usda',   arrays.usda   || arrays.ingDb || arrays.base],
      ['custom', arrays.custom || arrays.customIngs],
      ['kfood',  arrays.kfood  || arrays.extIngs || arrays.ext],
    ];
    for (const [key, arr] of list) if (Array.isArray(arr) && arr.indexOf(row) >= 0) return key;
    for (const [key, arr] of list) if (Array.isArray(arr) && arr.some(r => r && r[0] === name)) return key;
    return null;
  }

  // sourceId 추출 — "실제로 존재하는" 코드만 반환한다. 현재 데이터엔 없으므로 항상 null.
  // explicit 로 유효한 코드가 넘어오고 그 소스가 코드를 지원할 때만 그 값을 쓴다(추측 금지).
  function sourceIdOf(source, explicit) {
    const meta = sourceMeta(source);
    if (!meta || !meta.hasSourceId) return null;
    const v = explicit == null ? '' : String(explicit).trim();
    return v ? v : null;
  }

  // 현재 모든 원료 배열 값의 기준: 가식부 100g 기준 "있는 그대로(as-fed)".
  const BASIS_AS_FED_100G = 'per_100g_as_fed';
  const SCHEMA_VERSION = 1;

  // ── 안정적 ID 파생 ────────────────────────────────────────────────────────
  // 데이터를 한 건도 바꾸지 않고 "지금 당장" 쓸 수 있는 결정적 ID.
  //   id = "<source>:<fnv1a32(정규화된 이름) as base36>"
  // - 저장/마이그레이션 불필요(이름과 출처만으로 재현). 같은 이름·같은 출처면 항상 같은 ID.
  // - 한계: 원료명을 편집하면 ID도 바뀐다(이름이 곧 식별자인 현재 구조와 동일한 성질).
  //   진짜 불변 ID(생성 시 1회 발급 + rename alias 테이블)는 다음 단계에서 customIngs 구조와
  //   localStorage 스키마를 확장하며 도입한다 — 이 단계에서는 데이터/스토리지를 건드리지 않는다.
  function normalizeName(name) {
    return String(name == null ? '' : name).normalize('NFC').trim().replace(/\s+/g, ' ');
  }
  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function deriveId(name, source) {
    return normalizeSource(source) + ':' + fnv1a32(normalizeName(name)).toString(36);
  }

  // ── 배열 ↔ 객체 어댑터 ───────────────────────────────────────────────────
  // rowToObject: 49칸 배열 → 목표 객체 스키마. 값 의미(숫자 0 = 실제 0, null = 데이터 없음)를 보존한다.
  //   category 는 getIngCategory()(전역, ingredients.js)가 있으면 파생하고 없으면 null.
  //   metadata._row 에 원본 배열 참조를 그대로 담아, 계산 경로가 배열을 재조립 없이 쓸 수 있게 한다.
  function rowToObject(row, opts) {
    if (!Array.isArray(row)) throw new TypeError('rowToObject: 배열이 아닙니다');
    opts = opts || {};
    const name = row[0];
    const source = normalizeSource(opts.source);   // 'usda' | 'kfood' | 'custom'  ('base'/'ext' 별칭 허용)
    const nutrients = {};
    for (let i = 0; i < NUTRIENT_COUNT; i++) {
      const raw = row[i + 1];
      nutrients[KEY_BY_INDEX[i]] = raw === undefined ? null : raw; // 배열이 짧으면 결측 취급
    }
    let category = opts.category != null ? opts.category : null;
    if (category == null && typeof getIngCategory === 'function') {
      try { category = getIngCategory(name); } catch (e) { category = null; }
    }
    return {
      id:       opts.id || deriveId(name, source),
      name:     name,
      category: category,
      source:   source,
      sourceId: sourceIdOf(source, opts.sourceId), // 실제 존재하는 코드만 — 현재 데이터엔 없어 항상 null
      basis:    opts.basis || BASIS_AS_FED_100G,
      nutrients: nutrients,
      metadata: {
        schemaVersion: SCHEMA_VERSION,
        arrayLength: row.length,     // 왕복 검증용(현재 항상 49)
        _row: row,                   // 원본 배열 참조(계산 경로 zero-copy 용) — 직렬화 시 제거 권장
      },
    };
  }

  // objectToRow: 목표 객체 → 49칸 배열. rowToObject 의 정확한 역함수.
  //   같은 배열을 다시 만들어 JSON.stringify 가 원본과 바이트 동일해야 한다
  //   (saveIngOverrides() 의 정본 diff·cleanBaseByName 비교가 문자열 동등성에 의존하므로 중요).
  function objectToRow(obj) {
    if (!obj || typeof obj !== 'object') throw new TypeError('objectToRow: 객체가 아닙니다');
    const src = obj.metadata && obj.metadata._row;
    if (Array.isArray(src)) return src.slice();   // 원본을 알면 그대로 복제(가장 안전)
    const n = obj.nutrients || {};
    const row = new Array(ARRAY_LENGTH);
    row[0] = obj.name;
    for (let i = 0; i < NUTRIENT_COUNT; i++) {
      const v = n[KEY_BY_INDEX[i]];
      row[i + 1] = v === undefined ? null : v;
    }
    return row;
  }

  // 왕복 안정성 점검 헬퍼(테스트/디버그용). 원본 배열과 objectToRow(rowToObject(row)) 를 비교.
  function roundTripEquals(row) {
    try { return JSON.stringify(row) === JSON.stringify(objectToRow(rowToObject(row))); }
    catch (e) { return false; }
  }

  // ── 스키마 문서(런타임에서도 조회 가능) ─────────────────────────────────
  function describe() {
    return {
      schemaVersion: SCHEMA_VERSION,
      arrayLength: ARRAY_LENGTH,
      nutrientCount: NUTRIENT_COUNT,
      basis: BASIS_AS_FED_100G,
      sources: Object.assign({}, SOURCE),
      sourceMeta: JSON.parse(JSON.stringify(SOURCE_META)),
      fields: NUTRIENT_FIELDS.map(([index, key, unit, legacy]) => ({
        arrayPos: index + 1, nutrientIndex: index, key, unit, legacyKey: legacy,
      })),
    };
  }

  return {
    SCHEMA_VERSION, NUTRIENT_COUNT, ARRAY_LENGTH,
    SOURCE, SOURCE_META, BASIS_AS_FED_100G,
    KEY_BY_INDEX, INDEX_BY_KEY, UNIT_BY_KEY, LEGACY_KEY_MAP,
    normalizeName, normalizeSource, sourceMeta, classifySource, sourceIdOf, deriveId,
    rowToObject, objectToRow, roundTripEquals,
    describe,
  };
})();

// Node 테스트에서 직접 require 할 때만 노출(브라우저 classic script 에서는 무시됨).
if (typeof module !== 'undefined' && module.exports) module.exports = IngredientSchema;
