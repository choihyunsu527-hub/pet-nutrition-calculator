// ingredients.js — 원료 DB/스키마/로더/기준표/원료 DB·기준 DB 탭. index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 데이터 DB
// ════════════════════════════════════════════════════════════════════════════

// 원료 DB (USDA FDC 기반, per 100g as-is)
// [이름, kcal, 수분g, 단백g, 지방g, 탄수g, 회분g, 콜레스mg,
//  Ca mg, P mg, Na mg, K mg, Fe mg, Zn mg, Mg mg, Se μg,
//  VitA IU, VitD IU, VitE mg, VitK mg,
//  B1 mg, B2 mg, B3 mg, B5 mg, B6 mg, 엽산 μg, B12 μg,
//  EPA mg, DHA mg,
//  Cu mg, Mn mg, I μg, Cl mg, 콜린 mg, 비오틴 μg,
//  LA g, ALA g, 조섬유 g,
//  아르기닌 g, 히스티딘 g, 이소류신 g, 류신 g, 라이신 g,
//  메티오닌+시스틴 g, 페닐알라닌+티로신 g, 트레오닌 g, 트립토판 g, 발린 g, 타우린 mg]
// 총 48개 값 (이름 제외)
// ⚠ 콜린(choline)·염소(Cl)는 아래 출처 데이터에 항목이 없어 전부 0으로 처리됨
let ING_DB = [];

// 원료명 → 원료 배열(48열) 조회 인덱스. getIng()이 매번 [...ING_DB,...customIngs,...extIngs]를
// 새로 만들고 find()하던 O(n) 조회를 O(1) Map 조회로 바꾸기 위한 캐시.
// ING_DB / customIngs / extIngs가 바뀌는 지점에서만 rebuildIngIndex()로 다시 만든다
// (초기 로딩·확장 DB 로드·원료 추가/삭제/편집·레시피 불러오기). calculate()에서는 재생성하지 않는다.
// 우선순위는 기존 allIngs() 순서(ING_DB → customIngs → extIngs)와 동일 — 먼저 들어온 이름이 이긴다.
let ingIndex = new Map();

// ── 원료 48열 스키마 (단일 정의) ────────────────────────────────────────────
// 원료 배열은 [0]=이름, [1..48]=영양소 값 48개다. 여기 값은 calcNutrition()의 asis[] 인덱스와
// 같은 "0-based 영양소 위치"(= 원료배열에서는 ing[위치 + 1])다. 컬럼 의미·순서·개수를 바꾸는
// 유일한 지점이며, ingredients.json / data/ingredients_ext.json 의 실제 배열 순서와 일치해야 한다.
// (컬럼별 표시 라벨·단위는 원료 편집 모달용 ING_COLS 배열이 따로 들고 있고 순서는 동일하다.)
const ING_COL_COUNT = 48;
const ING_IDX = {
  KCAL: 0, MOISTURE: 1, PROTEIN: 2, FAT: 3, CARB: 4, ASH: 5, CHOLESTEROL: 6,
  CA: 7, P: 8, NA: 9, K: 10, FE: 11, ZN: 12, MG: 13, SE: 14,
  VIT_A: 15, VIT_D: 16, VIT_E: 17, VIT_K: 18,
  VIT_B1: 19, VIT_B2: 20, VIT_B3: 21, VIT_B5: 22, VIT_B6: 23, FOLATE: 24, VIT_B12: 25,
  EPA: 26, DHA: 27,
  CU: 28, MN: 29, IODINE: 30, CL: 31, CHOLINE: 32, BIOTIN: 33,
  LA: 34, ALA: 35, CRUDE_FIBER: 36,
  ARG: 37, HIS: 38, ILE: 39, LEU: 40, LYS: 41,
  MET_CYS: 42, PHE_TYR: 43, THR: 44, TRP: 45, VAL: 46, TAURINE: 47,
};
// 원료배열(ing[])에서 직접 읽을 때 쓰는 1-based 컬럼 번호 — 이름 컬럼([0])을 건너뛴 값(= asis 인덱스 + 1).
const ING_ARR_COL = Object.fromEntries(Object.entries(ING_IDX).map(([k, v]) => [k, v + 1]));
// 필수아미노산 10종(타우린 제외)의 원료배열 컬럼 번호 — 결측 백필 패치 등에서 재사용.
const ING_EAA_ARR_COLS = [
  ING_ARR_COL.ARG, ING_ARR_COL.HIS, ING_ARR_COL.ILE, ING_ARR_COL.LEU, ING_ARR_COL.LYS,
  ING_ARR_COL.MET_CYS, ING_ARR_COL.PHE_TYR, ING_ARR_COL.THR, ING_ARR_COL.TRP, ING_ARR_COL.VAL,
];

// 새로 추가된 내장 원료 스냅샷 — localStorage에 저장된 예전 원료DB를 불러올 때
// 이 원료들이 없으면 자동으로 채워 넣기 위해 사용한다(loadIngDBFromStorage 참고).
let BUILTIN_ING_SEED = [];

// 기본 원료 "정본"(ingredients.json + 시드 + null 백필) 스냅샷 — 이름 → 행 JSON 문자열.
// 사용자가 내장 원료를 편집/삭제한 "변경분"만 골라내기 위한 비교 기준이다(feedcalc_v4_ingdb_overrides).
// loadIngDBFromStorage()에서 사용자 변경분을 적용하기 직전에 채운다.
let cleanBaseByName = null;
const INGDB_OVERRIDES_KEY = 'feedcalc_v4_ingdb_overrides';
const INGDB_LEGACY_SNAPSHOT_KEY = 'feedcalc_v4_ingdb';       // 예전: ING_DB 전체 스냅샷(더 이상 쓰지 않음, 삭제하지 않음)
const INGDB_MIGRATED_FLAG = 'feedcalc_v4_ingdb_migrated';

// ── 기본 원료 DB(ingredients.json) 로더 ──────────────────────────────────────
// 예전에는 이 배열 리터럴(157종)이 index.html 안에 그대로 있어 초기 파싱/렌더 부담이 컸다.
// 값과 순서는 그대로 둔 채 ingredients.json으로 분리하고, 앱 시작 시(init) 1회 fetch해
// 기존 전역 ING_DB 배열에 그대로 채워 넣는다 — ING_DB를 참조하던 모든 코드는 수정 없이
// 그대로 동작한다. fetch 실패 시 ING_DB는 빈 배열로 남고 console.error로 원인을 남긴다
// (customIngs/localStorage 경로는 종전과 동일).
let ingDBReady = false;
let ingDBLoadPromise = null;
function loadBaseIngDB() {
  if (ingDBLoadPromise) return ingDBLoadPromise;
  ingDBLoadPromise = fetch('ingredients.json')
    .then(res => { if (!res.ok) throw new Error('ingredients.json HTTP ' + res.status); return res.json(); })
    .then(list => {
      if (!Array.isArray(list)) throw new Error('ingredients.json 형식 오류 — 최상위가 배열이 아님');
      ING_DB.length = 0;
      for (const ing of list) ING_DB.push(ing);
      BUILTIN_ING_SEED = ING_DB
        .filter(ing => ing[0] === '타피오카 전분' || ing[0] === '단호박 분말')
        .map(ing => [...ing]);
      ingDBReady = true;
      rebuildIngIndex();
    })
    .catch(err => {
      ingDBReady = false;
      console.error('기본 원료 DB(ingredients.json)를 불러오지 못했습니다 — 원료 목록이 비어 있을 수 있습니다.', err);
    });
  return ingDBLoadPromise;
}

// 사용자 추가 원료
let customIngs = [];
let editingIngName = null;

// 확장 원료 DB(data/ingredients_ext.json, 국가표준식품성분DB 기반 2천여 종) — 앱 시작 시
// 가져오지 않고, 원료 검색/선택이 실제로 필요해지는 시점(검색창 입력, 원료 선택 드롭다운 열기)에
// 1회만 fetch·parse해 메모리에 캐시한다(extIngsLoadPromise 가드 → 재요청/재파싱 없음).
// 파싱 결과 배열(extIngs)만 그대로 들고 있고, 이름 정렬본은 별도 배열로 복사하지 않는다 —
// 검색용 정렬·소문자 캐시는 IngSearchIndex.setExt()가 한 번만 만들어 재사용한다.
// fetch 실패 시에도 ING_DB+customIngs만으로 기존 기능이 그대로 동작하도록 빈 배열로 남겨둔다.
let extIngs = null;           // null = 아직 로드 안 됨. 로드 후 파싱된 배열(원본 순서, 실패 시 빈 배열)
let extIngsLoadPromise = null;

function loadExtIngsOnce() {
  if (extIngsLoadPromise) return extIngsLoadPromise;
  setExtIngsLoadingIndicator(true);
  extIngsLoadPromise = fetch('data/ingredients_ext.json')
    .then(res => { if (!res.ok) throw new Error('ingredients_ext.json HTTP ' + res.status); return res.json(); })
    .then(list => {
      if (!Array.isArray(list)) throw new Error('ingredients_ext.json 형식 오류');
      extIngs = list;   // 복사 없음 — 파싱 결과를 그대로 보관
    })
    .catch(err => {
      console.warn('확장 원료 DB를 불러오지 못했습니다 — 기본 원료만으로 계속 동작합니다.', err);
      extIngs = [];
    })
    .finally(() => { onExtIngsSettled(); });
  return extIngsLoadPromise;
}

// (하위호환) 예전 코드/폴백 경로가 참조하던 이름 정렬본. 이제는 IngSearchIndex 가 정렬을
// 담당하므로 상시 배열로 들고 있지 않고, 필요할 때만 extIngs 로부터 만든다(폴백 전용).
function extIngsSortedFallback() {
  return Array.isArray(extIngs) ? [...extIngs].sort((a, b) => a[0].localeCompare(b[0], 'ko')) : [];
}

// 확장 DB 로딩 중임을 이미 열려 있는 검색 입력의 placeholder로만 알려준다(레이아웃 변경 없음).
function setExtIngsLoadingIndicator(loading) {
  const ingSearchEl = document.getElementById('ing-search');
  if (ingSearchEl) ingSearchEl.placeholder = loading ? '원료명 검색... (확장 DB 불러오는 중)' : '원료명 검색...';
  const mixSearchEl = mixIngListEl && mixIngListEl.querySelector('.mix-ing-search-input');
  if (mixSearchEl) mixSearchEl.placeholder = loading ? '원료 검색... (확장 DB 불러오는 중)' : '원료 검색...';
}

// 확장 DB 로드가 끝나면(성공/실패 모두) 현재 열려 있는 원료 관련 화면만 그 결과를 반영해
// 다시 그린다 — 로드 시점에 다른 화면을 보고 있었다면 다음에 그 화면을 쓸 때 자연히 반영된다.
function onExtIngsSettled() {
  setExtIngsLoadingIndicator(false);
  rebuildIngIndex();   // 확장 DB(extIngs)가 채워졌으니(성공/실패 모두) 조회 인덱스에 반영
  if (document.getElementById('ing-search')) filterIng();
  if (mixIngOpenWrap && mixIngListEl) {
    const searchInput = mixIngListEl.querySelector('.mix-ing-search-input');
    mixIngListEl.querySelector('.mix-ing-options').innerHTML = ingListItemsHTML(searchInput.value);
    resetMixIngActive();
  }
}

// extIngsSorted처럼 이미 정렬된 두 이름 배열을 매번 재정렬하지 않고 병합해 하나의
// 알파벳순 목록으로 만든다(검색 성능 개선의 핵심 — 정렬은 O(n log n), 병합은 O(n)).
function mergeSortedNames(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    out.push(a[i].localeCompare(b[j], 'ko') <= 0 ? a[i++] : b[j++]);
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

// 확장 DB 검색 결과 중 화면(원료 목록 테이블/선택 드롭다운)에 한 번에 반영할 상한 —
// 수천 개 매칭 결과를 그대로 DOM에 렌더링하지 않기 위함. 전역 검색용 SEARCH_MAX_PER_GROUP
// (카테고리별 소수 요약용)과는 별개의 용도라 값도 따로 둔다.
const EXT_ING_SEARCH_CAP = 300;

// 검색 결과를 실제로 DOM에 그리는 최대 개수. 매칭 계산(데이터·정렬·우선순위)은
// 그대로 두고, 이 개수를 넘으면 잘라서 렌더링하고 "검색어를 좁혀 달라"는 안내만 덧붙인다.
const ING_SEARCH_RENDER_CAP = 100;

function allIngs() { return extIngs && extIngs.length ? [...ING_DB, ...customIngs, ...extIngs] : [...ING_DB, ...customIngs]; }

// ingIndex(원료명 → 원료 배열)를 현재 ING_DB / customIngs / extIngs로 다시 만든다.
// allIngs()와 같은 우선순위(ING_DB → customIngs → extIngs)를 유지하려고 이미 있는 이름은 덮어쓰지 않는다.
// getIng()의 기존 동작(= allIngs().find(i => i[0] === name))과 결과가 완전히 같도록,
// extIngs는 기존과 동일하게 "값이 있고 길이가 0이 아닐 때"만 포함한다.
function rebuildIngIndex() {
  const idx = new Map();
  const addArr = arr => {
    if (!Array.isArray(arr)) return;
    for (const ing of arr) {
      if (ing && !idx.has(ing[0])) idx.set(ing[0], ing);
    }
  };
  addArr(ING_DB);
  addArr(customIngs);
  if (extIngs && extIngs.length) addArr(extIngs);
  ingIndex = idx;
  // 이름 검색 인덱스도 같은 시점(원료 로드/확장DB 로드/CRUD/레시피 로드)에만 갱신한다.
  if (typeof IngSearchIndex !== 'undefined') {
    IngSearchIndex.rebuild(ING_DB, customIngs);
    IngSearchIndex.setExt(extIngs);   // 원본 순서 배열을 넘기면 인덱스가 정렬본을 1회만 만든다
  }
}

function getIng(name) { return ingIndex.get(name); }

// ── custom 원료 안정 ID 헬퍼 ─────────────────────────────────────────────────
// getIng()(이름 기반)은 그대로 두고, ID 로 조회/삭제해야 하는 곳을 위한 부가 API.
function customIngIdOf(nameOrRow) {
  const row = Array.isArray(nameOrRow) ? nameOrRow : customIngs.find(r => r[0] === nameOrRow);
  return row ? CustomIngredients.idOfRow(row) : null;
}
function getCustomIngById(id) { return CustomIngredients.rowById(id, customIngs); }
function getCustomIngNameById(id) { const r = getCustomIngById(id); return r ? r[0] : null; }
// ID 로 custom 원료 1건 삭제(프로그램적 호출용 — UI 의 deleteSelectedIng 은 그대로 둔다).
function deleteCustomIngById(id) {
  const removed = CustomIngredients.removeById(id, customIngs);
  if (!removed) return null;
  rebuildIngIndex();
  if (typeof saveToStorage === 'function') saveToStorage();
  return removed;
}

// ── 원료 출처(source) 메타데이터 조회 ───────────────────────────────────────
// 읽기 전용 부가 API. 기존 코드는 아무 것도 호출하지 않는다(getIng/계산/검색/저장/레시피 무관).
// 반환: { name, source:'usda'|'kfood'|'custom'|null, sourceLabel, sourceShort, sourceId(항상 null),
//         id(custom 이면 안정 ID), hasSourceId(false) }.
function getIngredientSource(name) {
  const row = getIng(name);
  if (typeof IngredientSchema === 'undefined') return { name: name, source: null };
  const src = row
    ? IngredientSchema.classifySource(row, { usda: ING_DB, custom: customIngs, kfood: extIngs })
    : null;
  const meta = src ? IngredientSchema.sourceMeta(src) : null;
  return {
    name: name,
    source: src,
    sourceLabel: meta ? meta.label : null,
    sourceShort: meta ? meta.short : null,
    hasSourceId: meta ? !!meta.hasSourceId : false,
    sourceId: null,   // 현재 어느 소스 데이터에도 원본 식품 코드가 없다 — 추측하지 않는다
    id: src === 'custom' && row ? CustomIngredients.idOfRow(row) : (row ? IngredientSchema.deriveId(name, src) : null),
  };
}

// 영양소 기준 DB
// [이름, 단위, NRC_MR, NRC_RA, AAFCO_성견_min, AAFCO_성견_max,
//  AAFCO_성장_min, AAFCO_임신_min, FEDIAF_성견_min, FEDIAF_성장_min, 카테고리]
const STANDARDS = [
  // ─ 단백질 (출처: AAFCO 2023 Table 1 % DMB)
  ["조단백","% DMB", 20.0,22.0, 18.0,null, 22.5,22.5, 18.0,22.5, "단백질"],

  // ─ 아미노산 (출처: AAFCO 2023 Table 1 % DMB / NRC 2006 Table 15-1 g/1000kcal)
  // AAFCO 단위: % DMB / NRC 단위: g/1000kcal ME (단위 통일: % DMB)
  ["아르기닌(Arg)",        "% DMB", null,null, 0.51,null, 1.00,1.00, 0.44,0.62, "아미노산"],
  ["히스티딘(His)",        "% DMB", null,null, 0.19,null, 0.44,0.44, 0.16,0.22, "아미노산"],
  ["이소류신(Ile)",        "% DMB", null,null, 0.38,null, 0.71,0.71, 0.32,0.45, "아미노산"],
  ["류신(Leu)",            "% DMB", null,null, 0.68,null, 1.29,1.29, 0.52,0.72, "아미노산"],
  ["라이신(Lys)",          "% DMB", null,null, 0.63,null, 0.90,0.90, 0.38,0.77, "아미노산"],
  ["메티오닌+시스틴",      "% DMB", null,null, 0.65,null, 0.70,0.70, 0.29,0.53, "아미노산"],
  ["페닐알라닌+티로신",    "% DMB", null,null, 0.74,null, 1.30,1.30, 0.64,0.89, "아미노산"],
  ["트레오닌(Thr)",        "% DMB", null,null, 0.48,null, 1.04,1.04, 0.42,0.58, "아미노산"],
  ["트립토판(Trp)",        "% DMB", null,null, 0.16,null, 0.20,0.20, 0.14,0.20, "아미노산"],
  ["발린(Val)",            "% DMB", null,null, 0.49,null, 0.68,0.68, 0.43,0.59, "아미노산"],
  ["타우린(Tau)*",         "mg/kg DMB", 0,0, 0,null, 0,0, 0,0, "아미노산"],

  // ─ 지방 (출처: AAFCO 2023)
  ["조지방","% DMB", 5.5,8.5, 5.5,null, 8.5,8.5, 5.5,8.5, "지방"],

  // ─ 지방산 (출처: AAFCO 2023 / NRC 2006)
  // EPA+DHA: AAFCO 2023 성장견 Min 0.05% DMB (성견 ND)
  ["리놀레산(LA,n-6)",  "% DMB",   1.3,2.8,  1.1,null, 1.3,1.3, 1.0,1.3,  "지방산"],
  ["ALA(α-리놀렌,n-3)","% DMB",   0.2,0.44, 0.0,null, 0.08,0.08,0.0,0.08,"지방산"],
  ["EPA+DHA",           "% DMB",   null,null, 0.0,null, 0.05,0.05,0.0,0.05,"지방산"],

  // ─ 미네랄 (출처: AAFCO 2023 Table 1)
  ["칼슘(Ca)",    "% DMB",    1.0,1.25, 0.5,2.5,  1.2,1.2,  0.5,1.2,  "미네랄"],
  ["인(P)",       "% DMB",    0.75,0.94,0.4,1.6,  1.0,1.0,  0.35,1.0, "미네랄"],
  ["Ca:P 비율",   "비율",     1.0,2.0,  1.0,2.0,  1.0,1.0,  1.0,1.0,  "미네랄"],
  ["나트륨(Na)",  "% DMB",    0.08,0.2, 0.08,null, 0.3,0.3, 0.06,0.3, "미네랄"],
  ["칼륨(K)",     "% DMB",    0.4,0.56, 0.6,null,  0.6,0.6,  0.44,0.6, "미네랄"],
  ["염소(Cl)",    "% DMB",    0.09,0.27,0.12,null, 0.45,0.45,0.09,0.45,"미네랄"],
  ["마그네슘(Mg)","% DMB",    0.06,0.15,0.06,null, 0.06,0.06,0.04,0.06,"미네랄"],
  ["철(Fe)",      "mg/kg DMB",7.5,30,   40,3000,   88,88,   40,88,    "미네랄"],
  ["아연(Zn)",    "mg/kg DMB",25,100,   80,null,   100,100,  72,100,   "미네랄"],
  ["구리(Cu)",    "mg/kg DMB",1.83,7.3, 7.3,250,   12.4,12.4,7.3,12.4,"미네랄"],
  ["망간(Mn)",    "mg/kg DMB",1.25,5.0, 5.0,null,  7.2,7.2,  3.7,7.2, "미네랄"],
  ["셀레늄(Se)",  "mg/kg DMB",0.08,0.35,0.35,2.0,  0.35,0.35,0.11,0.35,"미네랄"],
  ["요오드(I)",   "mg/kg DMB",0.22,0.88,1.0,11.0,  1.0,1.0,  1.0,1.0, "미네랄"],

  // ─ 비타민 (출처: AAFCO 2023 / NRC 2006)
  // VitA: NRC MR=379μgRAE=1264IU, NRC RA=1515μgRAE=5045IU (1μgRAE=3.33IU)
  // VitD: NRC MR=3.4μg=136IU, NRC RA=13.8μg=552IU (1μg=40IU)
  // VitE: AAFCO 단위 IU/kg = mg α-TE/kg 동일 적용
  ["비타민A",             "IU/kg DMB",  1264,5045, 5000,250000, 5000,5000, 5000,5000,"비타민"],
  ["비타민D",             "IU/kg DMB",   136,552,   500,3000,    500,500,   500,500, "비타민"],
  ["비타민E(α-TE)",       "IU/kg DMB",   7.5,30,     50,null,    50,50,      38,50,  "비타민"],
  ["비타민K",             "mg/kg DMB",  0.41,1.64,  0.1,null,   0.1,0.1,   0.1,0.1, "비타민"],
  ["비타민B1(티아민)",    "mg/kg DMB",  0.56,2.25,  2.25,null,  2.25,2.25, 0.9,2.25,"비타민"],
  ["비타민B2(리보플라빈)","mg/kg DMB",  1.32,5.2,   5.2,null,   5.2,5.2,   2.0,5.2, "비타민"],
  ["비타민B3(나이아신)",  "mg/kg DMB",  4.25,17,    13.6,null,  13.6,13.6, 11.4,13.6,"비타민"],
  ["비타민B5(판토텐산)",  "mg/kg DMB",  3.0,12,     12,null,    12,12,     8.0,12,  "비타민"],
  ["비타민B6(피리독신)",  "mg/kg DMB",  0.375,1.5,  1.5,null,   1.5,1.5,   1.5,1.5, "비타민"],
  ["비타민B9(엽산)",      "mg/kg DMB",  0.054,0.27, 0.216,null, 0.216,0.216,0.18,0.216,"비타민"],
  ["비타민B12(코발라민)", "μg/kg DMB",  7.0,28,     28,null,    28,28,     26,28,   "비타민"],
  ["비오틴(B7)",          "μg/kg DMB",  25,100,     0,null,     0,0,       0,0,     "비타민"],
  ["콜린",                "mg/kg DMB",  340,1360,   1360,null,  1360,1360, 1000,1360,"비타민"],
];

// 고양이 영양소 기준 (출처: AAFCO 2023 Cat Food Nutrient Profiles / FEDIAF 2024 Nutritional Guidelines)
// nrc_mr/nrc_ra: FEDIAF 성묘 권장치(NRC 2006 기반, MER 100kcal/kg0.67 및 75kcal/kg0.67 기준)
// aafco: AAFCO Adult Maintenance(Min/Max) 및 Growth/Reproduction(Min)
// fediaf: FEDIAF 성묘(MER 100kcal 기준) 및 성장·임신수유묘
const STANDARDS_CAT = [
  ["조단백","% DMB", 25.00,33.30, 26.0,null, 30.0,30.0, 25.00,28.00, "단백질"],

  ["아르기닌(Arg)",        "% DMB", 1.00,1.30, 1.04,null, 1.25,1.25, 1.00,1.07, "아미노산"],
  ["히스티딘(His)",        "% DMB", 0.26,0.35, 0.31,null, 0.31,0.31, 0.26,0.33, "아미노산"],
  ["이소류신(Ile)",        "% DMB", 0.43,0.57, 0.52,null, 0.52,0.52, 0.43,0.54, "아미노산"],
  ["류신(Leu)",            "% DMB", 1.02,1.36, 1.25,null, 1.25,1.25, 1.02,1.28, "아미노산"],
  ["라이신(Lys)",          "% DMB", 0.34,0.45, 0.83,null, 1.20,1.20, 0.34,0.85, "아미노산"],
  ["메티오닌+시스틴",      "% DMB", 0.34,0.45, 1.10,null, 1.10,1.10, 0.34,0.88, "아미노산"],
  ["페닐알라닌+티로신",    "% DMB", 1.53,2.04, 0.88,null, 0.88,0.88, 1.53,1.91, "아미노산"],
  ["트레오닌(Thr)",        "% DMB", 0.52,0.69, 0.73,null, 0.73,0.73, 0.52,0.65, "아미노산"],
  ["트립토판(Trp)",        "% DMB", 0.13,0.44, 0.16,null, 0.25,0.25, 0.13,0.16, "아미노산"],
  ["발린(Val)",            "% DMB", 0.51,0.68, 0.62,null, 0.62,0.62, 0.51,0.64, "아미노산"],
  ["타우린(Tau)*",         "mg/kg DMB", 2000,2700, 2000,null, 2000,2000, 2000,2500, "아미노산"],

  ["조지방","% DMB", 9.00,9.00, 9.0,null, 9.0,9.0, 9.00,9.00, "지방"],

  ["리놀레산(LA,n-6)",  "% DMB",   0.50,0.67,  0.5,null, 0.5,0.5,  0.50,0.55,  "지방산"],
  ["아라키돈산(AA,n-6)","% DMB",   0.006,0.008, 0.02,null, 0.02,0.02,0.006,0.02, "지방산"],
  ["ALA(α-리놀렌,n-3)","% DMB",   null,null,  null,null, null,null,null,0.02, "지방산"],
  ["EPA+DHA",           "% DMB",   null,null,  null,null, null,null,null,0.01, "지방산"],

  ["칼슘(Ca)",    "% DMB",    0.40,0.53, 0.6,null,  1.0,1.0,  0.40,1.00, "미네랄"],
  ["인(P)",       "% DMB",    0.26,0.35, 0.5,null,  0.8,0.8,  0.26,0.84, "미네랄"],
  ["Ca:P 비율",   "비율",     1.0,1.0,   1.0,2.0,   1.0,1.0,  1.0,1.0,   "미네랄"],
  ["나트륨(Na)",  "% DMB",    0.08,0.10, 0.2,null,  0.2,0.2,  0.08,0.16, "미네랄"],
  ["칼륨(K)",     "% DMB",    0.60,0.80, 0.6,null,  0.6,0.6,  0.60,0.60, "미네랄"],
  ["염소(Cl)",    "% DMB",    0.11,0.15, 0.3,null,  0.3,0.3,  0.11,0.24, "미네랄"],
  ["마그네슘(Mg)","% DMB",    0.04,0.05, 0.04,null, 0.08,0.08,0.04,0.05, "미네랄"],
  ["철(Fe)",      "mg/kg DMB",80,107,    80,null,   80,80,    80,80,    "미네랄"],
  ["아연(Zn)",    "mg/kg DMB",75,100,    75,2000,   75,75,    75,75,    "미네랄"],
  ["구리(Cu)",    "mg/kg DMB",5,6.7,     5,null,    5,5,      5,10,     "미네랄"],
  ["망간(Mn)",    "mg/kg DMB",5,6.7,     7.5,null,  7.5,7.5,  5,10,     "미네랄"],
  ["셀레늄(Se)",  "mg/kg DMB",0.21,0.28, 0.1,null,  0.1,0.1,  0.21,0.30,"미네랄"],
  ["요오드(I)",   "mg/kg DMB",1.3,1.7,   0.35,null, 0.35,0.35,1.3,1.8,  "미네랄"],

  ["비타민A",             "IU/kg DMB",  3330,4440, 5000,750000, 9000,9000, 3330,9000,"비타민"],
  ["비타민D",             "IU/kg DMB",   250,333,   500,10000,  750,750,   250,280, "비타민"],
  ["비타민E(α-TE)",       "IU/kg DMB",   38,50.7,    30,null,    30,30,     38,38,  "비타민"],
  ["비타민K",             "mg/kg DMB",  null,null,  0.1,null,  0.1,0.1, null,null,"비타민"],
  ["비타민B1(티아민)",    "mg/kg DMB",  4.4,5.9,    5.0,null,   5.0,5.0,   4.4,5.5, "비타민"],
  ["비타민B2(리보플라빈)","mg/kg DMB",  3.2,4.2,    4.0,null,   4.0,4.0,   3.2,3.2, "비타민"],
  ["비타민B3(나이아신)",  "mg/kg DMB",  32,42.1,    60,null,    60,60,     32,32,   "비타민"],
  ["비타민B5(판토텐산)",  "mg/kg DMB",  5.8,7.7,    5.0,null,   5.0,5.0,   5.8,5.7, "비타민"],
  ["비타민B6(피리독신)",  "mg/kg DMB",  2.5,3.3,    4.0,null,   4.0,4.0,   2.5,2.5, "비타민"],
  ["비타민B9(엽산)",      "mg/kg DMB",  0.75,1.01,  0.8,null,   0.8,0.8,   0.75,0.75,"비타민"],
  ["비타민B12(코발라민)", "μg/kg DMB",  17.6,23.5,  20,null,    20,20,     17.6,18.0,"비타민"],
  ["비오틴(B7)",          "μg/kg DMB",  60,80,      70,null,    70,70,     60,70,   "비타민"],
  ["콜린",                "mg/kg DMB",  2400,3200,  2400,null,  2400,2400, 2400,2400,"비타민"],
];

// ════════════════════════════════════════════════════════════════════════════
// 기준 DB 탭
// ════════════════════════════════════════════════════════════════════════════
function buildStdTable() {
  const species = document.getElementById('sb-species')?.value || '개';
  const isCat = species === '고양이';
  const STD = isCat ? STANDARDS_CAT : STANDARDS;

  document.getElementById('std-th-aafco').textContent    = isCat ? 'AAFCO 성묘'   : 'AAFCO 성견';
  document.getElementById('std-th-aafcogr').textContent  = isCat ? 'AAFCO 성장묘' : 'AAFCO 성장견';
  document.getElementById('std-th-fediaf').textContent   = isCat ? 'FEDIAF 성묘'  : 'FEDIAF 성견';
  document.getElementById('std-th-fediafgr').textContent = isCat ? 'FEDIAF 성장묘': 'FEDIAF 성장견';

  let html = ''; let curCat = '';
  STD.forEach((std,i) => {
    const [nm,unit,mr,ra,aa,aaMax,aaGr,aaRp,fed,fedGr,cat] = std;
    if (cat !== curCat) {
      curCat = cat;
      html += `<tr class="cat-row"><td colspan="11">── ${cat} ──</td></tr>`;
    }
    const bg = i%2===0 ? '' : 'style="background:var(--even)"';
    html += `<tr ${bg} data-std-name="${String(nm).replace(/"/g,'&quot;')}">
      <td class="left" style="font-size:10px;color:var(--sub)">${cat}</td>
      <td class="left">${nm}</td>
      <td style="font-size:10px">${unit}</td>
      <td class="num" style="background:var(--nrc-bg)">${mr??'─'}</td>
      <td class="num" style="background:var(--nrc-bg)">${ra??'─'}</td>
      <td class="num" style="background:var(--aa-bg)">${aa??'─'}</td>
      <td class="num" style="background:var(--aa-bg)">${aaMax??'─'}</td>
      <td class="num" style="background:var(--aa-bg)">${aaGr??'─'}</td>
      <td class="num" style="background:var(--aa-bg)">${aaRp??'─'}</td>
      <td class="num" style="background:var(--fed-bg)">${fed??'─'}</td>
      <td class="num" style="background:var(--fed-bg)">${fedGr??'─'}</td>
    </tr>`;
  });
  document.getElementById('std-body').innerHTML = html;
}

// ════════════════════════════════════════════════════════════════════════════
// 원료 DB 탭
// ════════════════════════════════════════════════════════════════════════════
// 표시할 컬럼 인덱스 (ING_DB 기준)
const ING_SHOW = [
  0,               // 원료명
  1,2,3,4,5,6,     // 에너지,수분,단백,지방,탄수,회분
  7,               // 콜레스테롤
  8,9,10,11,       // Ca,P,Na,K
  12,13,14,15,     // Fe,Zn,Mg,Se
  29,30,31,32,     // Cu,Mn,I,Cl
  16,17,18,19,     // 비타민A,D,E,K
  20,21,22,23,24,25,26, // B1,B2,B3,B5,B6,엽산,B12
  33,34,           // 콜린,비오틴
  35,36,27,28,     // LA,ALA,EPA,DHA
  37,              // 조섬유
  38,39,40,41,42,43,44,45,46,47, // 아르기닌~발린
  48               // 타우린
];

// ING_DB 157종 전수 감사(2026-09) 결과를 반영한 분류 규칙 — 발견된 오분류 46건과 근본 원인
// 8가지(A~H, 아래 코멘트)를 모두 해결한 최종 버전. 우선순위(위→아래 검사 순서)를 바꾸면
// 아래 코멘트에 적힌 문제가 재발하니 순서를 유지할 것.
function getIngCategory(name) {
  if (/오일|씨유/.test(name))                                                return '오일류'; // '지방' 제거 — "저지방우유" 부분문자열 오탐(B) 수정
  if (/어분|fish/i.test(name))                                                return '어류·수산물';
  if (/달걀|계란/.test(name))                                                  return '난류';
  if (/전분|타피오카/.test(name))                                            return '전분류'; // 신설(C) — 곡류·근채류보다 먼저 검사해야 원물 키워드에 선점되지 않음
  if (/연어|고등어|참치|멸치|대구|청어|정어리|가자미|방어|넙치|명태|새우|굴|조개|갈치|병어|아귀|민어|은어|잉어|장어|가물치|숭어|임연수어|해삼/.test(name))  return '어류·수산물'; // 신규 어종 12종+해삼 추가(A) — 신규 어종/수산물 추가 시 이 목록도 함께 갱신할 것
  if (/닭|오리|소|돼지|양고기|칠면조|토끼|사슴|말고기|캥거루/.test(name))  return '육류'; // 내장·부산물은 소/돼지/닭/오리 키워드로 이미 육류에 포함(별도 분리 안 함)
  if (/우유|산양유|염소유|치즈|요거트|요구르트|탈지분유|버터밀크|코티지|커드/.test(name)) return '유제품';
  if (/쌀|보리|귀리|현미|통밀|밀가루|호밀|메밀|오트밀|퀴노아|수수|기장|옥수수/.test(name))    return '곡류'; // 밀가루·호밀·메밀 추가(D) — 통째로 간 가루는 원물과 성분이 유사해 곡류 유지
  if (/렌틸콩|병아리콩|녹두|두부|강낭콩|서리태|대두|팥|완두,\s*말린것/.test(name))                                 return '콩류'; // 강낭콩·서리태·팥 추가(E), 말린 완두만 특례(F) — 생완두콩은 아래 채소류에서 잡힘
  if (/고구마|감자|당근|비트|연근|우엉|^무$|무\(/.test(name))                 return '근채류'; // 뿌리 원물만. 뿌리에서 뽑은 순수 전분은 위 전분류에서 먼저 잡힘
  if (/버섯/.test(name))                                                     return '버섯류';
  if (/완두|브로콜리|시금치|배추|양배추|상추|케일|셀러리|샐러리|호박|양파|토마토|청경채|아욱|파프리카|콜리플라워|오이|아스파라거스|주키니|치커리|겨자잎|무청/.test(name)) return '채소류'; // 잎채소 3종 추가(G)
  if (/블루베리|사과|바나나|딸기|수박|포도|크랜베리|크렌베리|망고|복숭아/.test(name)) return '과일류';
  if (/스피루리나|아마씨|파슬리|한천|홍합분말|난각|곤약|코코넛|캐롭/.test(name))              return '특수원료'; // 곤약·코코넛·캐롭 추가(H)
  return '기타'; // 정제수만 남음(식품군 자체가 없는 유일한 항목)
}

const CAT_ORDER = ['육류','어류·수산물','난류','유제품','곡류','콩류','근채류','채소류','버섯류','과일류','오일류','전분류','특수원료','기타'];
// 카테고리명 → 이모지를 대체하는 outline 아이콘(svgIcon 키). 판정 표시(✅/❌)와는 무관한
// 순수 분류 아이콘이라 대상에 포함됨 — 아이콘만 바뀌고 분류 로직(CAT_ORDER/getIngCategory)은 그대로.
const CAT_ICONS = {
  '육류': 'beef', '어류·수산물': 'fish', '난류': 'egg', '유제품': 'milk', '곡류': 'wheat',
  '콩류': 'bean', '근채류': 'carrot', '채소류': 'salad', '버섯류': 'mushroom',
  '과일류': 'apple', '오일류': 'droplet', '전분류': 'package', '특수원료': 'leaf', '기타': 'info',
};


// rowCap을 넘기면 카테고리 헤더(이름·실제 개수)는 그대로 두되, 실제 원료 <tr>는 전체에서
// rowCap개까지만 DOM에 만든다 — 검색 전 초기 상태에서 수백 개 행을 한꺼번에 렌더링하지 않기 위함.
function buildIngTable(data, rowCap) {
  // 검색 결과를 그릴 때는 표를 다시 보이게 하고 검색 전 Empty State는 감춘다.
  const esWrap = document.querySelector('#tab-ing .tbl-wrap');
  const es = document.getElementById('ing-empty-state');
  if (esWrap) esWrap.hidden = false;
  if (es) es.hidden = true;

  const groups = {};
  CAT_ORDER.forEach(c => { groups[c] = []; });
  data.forEach(ing => {
    const cat = getIngCategory(ing[0]);
    (groups[cat] || (groups[cat] = [])).push(ing);
  });

  const colSpan = ING_SHOW.length + 2;
  const isCapped = rowCap != null;
  let html = '';
  let rowIdx = 0;

  CAT_ORDER.forEach(cat => {
    const ings = groups[cat];
    if (!ings || ings.length === 0) return;
    html += `<tr class="cat-row"><td colspan="${colSpan}" style="font-size:11px"><span class="cat-row-label">${svgIcon(CAT_ICONS[cat], 13)} ${cat} <span style="font-weight:normal;font-size:10px;opacity:0.75">(${ings.length}종)</span></span></td></tr>`;
    for (const ing of ings) {
      if (isCapped && rowIdx >= rowCap) break; // 헤더는 이미 찍었고, 행은 상한까지만 생성
      const vals = ING_SHOW.map(j => ing[j]);
      const escName = escHtml(ing[0]);   // 원료명은 사용자/레시피 입력일 수 있어 HTML 이스케이프
      const bg = rowIdx % 2 === 0 ? '' : 'style="background:var(--even)"';
      html += `<tr ${bg} data-ing-name="${escName}"><td class="center"><input type="checkbox" class="ing-chk" data-name="${escName}"></td>${vals.map((v, vi) =>
        `<td class="${vi === 0 ? 'left' : 'num'}" style="font-size:11px">${vi === 0 ? escName : v}</td>`
      ).join('')}
      <td class="center">
        <button onclick="openEditIng(this.closest('tr').dataset.ingName)"
          style="background:var(--acc2);color:white;border:none;border-radius:3px;
                 padding:2px 7px;cursor:pointer;font-size:10px;font-family:inherit">편집</button>
      </td>
      </tr>`;
      rowIdx++;
    }
  });

  document.getElementById('ing-body').innerHTML = html;
  const cntEl = document.getElementById('ing-count');
  if (isCapped && data.length > rowIdx) {
    cntEl.textContent = `총 ${data.length}개 · 상위 ${rowIdx}개 표시 — 검색해 원료를 찾으세요`;
  } else {
    cntEl.textContent = `총 ${data.length}개 원료`;
  }
}

let isSorted = true;

function toggleSort() {
  isSorted = !isSorted;
  const btn = document.getElementById('sort-btn');
  btn.textContent = isSorted ? '원래 순서' : '가나다순 정렬';
  btn.classList.toggle('active', isSorted);
  filterIng();
}

function getSortedIngs(data) {
  if (!isSorted) return data;
  return [...data].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
}

function filterIng() {
  loadExtIngsOnce(); // 원료 검색창 입력 시점에만 확장 DB를 1회 lazy-load
  const q = document.getElementById('ing-search').value.toLowerCase().trim();

  if (!q) {
    // 검색 전 초기 상태 — 원료 목록을 아예 렌더링하지 않는다(행 0개·카테고리 헤더 0개).
    // 데이터를 DOM에 만들지 않으므로 확장 DB 규모와 무관하게 초기 렌더 비용이 0이다.
    renderIngEmpty();
    return;
  }
  // base(원본 순서) 매칭 + 확장 DB 매칭(상한 EXT_ING_SEARCH_CAP, base 이름 제외)을 인덱스가 조립한다.
  // 정렬(가나다순/원래순서 토글)은 아래 getSortedIngs()가 그대로 담당 — 동작·상한 규칙 불변.
  let data;
  if (typeof IngSearchIndex !== 'undefined') {
    if (!IngSearchIndex.ready()) { IngSearchIndex.rebuild(ING_DB, customIngs); IngSearchIndex.setExt(extIngs); }
    data = IngSearchIndex.filterRows(q, EXT_ING_SEARCH_CAP);
  } else {
    const baseData = [...ING_DB, ...customIngs];
    data = baseData.filter(i => i[0].toLowerCase().includes(q));
    if (extIngs && extIngs.length) {
      const baseSet = new Set(baseData.map(i => i[0]));
      let n = 0;
      for (const ing of extIngsSortedFallback()) {
        if (n >= EXT_ING_SEARCH_CAP) break;
        if (baseSet.has(ing[0])) continue;
        if (ing[0].toLowerCase().includes(q)) { data.push(ing); n++; }
      }
    }
  }
  data = getSortedIngs(data);
  // 2단계: 매칭은 그대로 계산하되 표에 실제로 그리는 행은 상한선까지만.
  const matched = data.length;
  const capped = matched > ING_SEARCH_RENDER_CAP ? data.slice(0, ING_SEARCH_RENDER_CAP) : data;
  buildIngTable(capped);
  if (matched > capped.length) {
    const cntEl = document.getElementById('ing-count');
    if (cntEl) cntEl.textContent = `${matched}개 일치 · 상위 ${capped.length}개 표시 — 검색어를 좁혀주세요`;
  }
}

// 검색 전(초기/검색어 삭제) 상태 — 원료 행을 만들지 않고, 가로 스크롤 표는 숨긴 뒤
// 표 바깥의 안내 Empty State만 노출한다(검색 시 buildIngTable이 표를 다시 보이게 함).
function renderIngEmpty() {
  document.getElementById('ing-body').innerHTML = '';
  const wrap = document.querySelector('#tab-ing .tbl-wrap');
  const es = document.getElementById('ing-empty-state');
  if (wrap) wrap.hidden = true;
  if (es) es.hidden = false;
  const cntEl = document.getElementById('ing-count');
  if (cntEl) cntEl.textContent = '원료명을 검색하세요';
}

// 원료 DB 탭 초기 렌더 — 검색 전 상태(빈 목록). filterIng()의 검색어 없는 경로와 동일 결과.
function renderIngInitial() {
  renderIngEmpty();
}

// 타이핑 중 매 입력마다 표 전체를 다시 만들지 않도록 디바운스한다(정렬 토글은 즉시 filterIng()).
const debouncedFilterIng = debounce(filterIng, 150);

// ════════════════════════════════════════════════════════════════════════════
// 원료 추가 모달
// ════════════════════════════════════════════════════════════════════════════
const ING_COLS = [
  ["원료명",          "텍스트"],
  ["에너지(kcal)",    "kcal"],
  ["수분(g)",         "g"],
  ["단백질(g)",       "g"],
  ["지방(g)",         "g"],
  ["탄수화물(g)",     "g"],
  ["조회분(g)",       "g"],
  ["콜레스테롤(mg)",  "mg"],
  ["Ca(mg)",          "mg"],
  ["P(mg)",           "mg"],
  ["Na(mg)",          "mg"],
  ["K(mg)",           "mg"],
  ["Fe(mg)",          "mg"],
  ["Zn(mg)",          "mg"],
  ["Mg(mg)",          "mg"],
  ["Se(μg)",          "μg"],
  ["비타민A(IU)",     "IU"],
  ["비타민D(IU)",     "IU"],
  ["비타민E(mg)",     "mg"],
  ["비타민K(mg)",     "mg"],
  ["B1-티아민(mg)",   "mg"],
  ["B2-리보(mg)",     "mg"],
  ["B3-나이아신(mg)", "mg"],
  ["B5-판토텐산(mg)", "mg"],
  ["B6(mg)",          "mg"],
  ["B9-엽산(μg)",     "μg"],
  ["B12(μg)",         "μg"],
  ["EPA(mg)",         "mg"],
  ["DHA(mg)",         "mg"],
  ["Cu-구리(mg)",     "mg"],
  ["Mn-망간(mg)",     "mg"],
  ["요오드I(μg)",     "μg"],
  ["Cl-염소(mg)",     "mg"],
  ["콜린(mg)",        "mg"],
  ["비오틴B7(μg)",    "μg"],
  ["리놀레산LA(g)",   "g"],
  ["ALA알파리놀렌(g)","g"],
  ["조섬유(g)",       "g"],
  ["아르기닌(g)",     "g"],
  ["히스티딘(g)",     "g"],
  ["이소류신(g)",     "g"],
  ["류신(g)",         "g"],
  ["라이신(g)",       "g"],
  ["메티오닌+시스틴(g)","g"],
  ["페닐알라닌+티로신(g)","g"],
  ["트레오닌(g)",     "g"],
  ["트립토판(g)",     "g"],
  ["발린(g)",         "g"],
  ["타우린(mg)",      "mg"],
];

function openAddIng() {
  editingIngName = null;
  document.getElementById('modal-ing-title').textContent = '새 원료 추가 (per 100g as-is)';
  const body = document.getElementById('add-ing-body');
  body.innerHTML = ING_COLS.map(([col,unit],i) => `
    <div class="modal-row">
      <label>${col} [${unit}]</label>
      <input type="${i===0?'text':'number'}" id="new-ing-${i}"
             value="${i===0?'':0}" min="0" step="0.001"
             placeholder="${i===0?'원료명 입력':'0'}">
    </div>
  `).join('');
  document.getElementById('add-ing-modal').classList.add('open');
}

function openEditIng(name) {
  const ing = getIng(name);
  if (!ing) return;
  editingIngName = ing[0];
  document.getElementById('modal-ing-title').textContent = '원료 편집: ' + ing[0];
  const body = document.getElementById('add-ing-body');
  body.innerHTML = ING_COLS.map(([col, unit], i) => `
    <div class="modal-row">
      <label>${col} [${unit}]</label>
      <input type="${i === 0 ? 'text' : 'number'}" id="new-ing-${i}"
             value="${i === 0 ? ing[i].replace(/"/g, '&quot;') : (ing[i] ?? '')}"
             min="0" step="0.001"
             placeholder="${i === 0 ? '원료명 입력' : '빈칸=데이터 없음'}">
    </div>
  `).join('');
  document.getElementById('add-ing-modal').classList.add('open');
}

function toggleAllIngChk(el) {
  document.querySelectorAll('#ing-body .ing-chk').forEach(c => c.checked = el.checked);
}

function deleteSelectedIng() {
  const checked = Array.from(document.querySelectorAll('#ing-body .ing-chk')).filter(c => c.checked);
  if (checked.length === 0) { alert('삭제할 원료를 선택하세요.'); return; }
  const names = checked.map(c => c.dataset.name);
  if (!confirm(`선택한 ${names.length}개 원료를 삭제하시겠습니까?\n배합에 사용 중인 경우 계산에서 제외됩니다.`)) return;

  names.forEach(name2 => {
    const dbIdx = ING_DB.findIndex(x => x[0] === name2);
    if (dbIdx >= 0) {
      ING_DB.splice(dbIdx, 1);
    } else {
      const cIdx = customIngs.findIndex(x => x[0] === name2);
      if (cIdx >= 0) { const [removed] = customIngs.splice(cIdx, 1); CustomIngredients.unregister(removed); }
    }
  });
  rebuildIngIndex();   // 삭제된 원료를 조회 인덱스에서도 제거

  document.querySelectorAll('#mix-body .mix-row').forEach(row => {
    const valueEl = row.querySelector('.mix-ing-value');
    if (!valueEl) return;
    // 삭제된 원료가 선택돼 있던 행은 선택을 해제한다(예전에 select가 빈 옵션으로 리셋되던 동작과 동일).
    if (names.includes(valueEl.value)) valueEl.value = '';
    syncIngDisplayFromWrap(row.querySelector('.mix-ing-wrap'));
  });
  const selAll = document.getElementById('ing-select-all');
  if (selAll) selAll.checked = false;
  filterIng();
  calculate();
  saveIngOverrides();   // 내장 원료 삭제분을 변경분 저장소에 반영
  saveToStorage();
}

function saveNewIng() {
  const vals = ING_COLS.map(([col,unit],i) => {
    const el = document.getElementById(`new-ing-${i}`);
    if (i === 0) return el.value.trim();
    // 빈칸 = 데이터 없음(null), 숫자 0 입력 = 실제 0. (기존엔 빈칸도 0으로 저장했다.)
    const t = (el.value || '').trim();
    return t === '' ? null : (parseFloat(t) || 0);
  });
  if (!vals[0]) { alert('원료명을 입력하세요.'); return; }

  const isEdit = editingIngName !== null;
  if (isEdit) {
    if (vals[0] !== editingIngName && getIng(vals[0])) {
      alert('이미 존재하는 원료명입니다.'); return;
    }
    const dbIdx = ING_DB.findIndex(ing => ing[0] === editingIngName);
    if (dbIdx >= 0) { ING_DB[dbIdx] = vals; }
    else {
      const cIdx = customIngs.findIndex(ing => ing[0] === editingIngName);
      if (cIdx >= 0) {
        const oldRow = customIngs[cIdx];
        customIngs[cIdx] = vals;
        CustomIngredients.reassign(oldRow, vals);   // 이름/값이 바뀌어도 같은 안정 ID 유지
      }
    }
    editingIngName = null;
  } else {
    if (getIng(vals[0])) { alert('이미 존재하는 원료명입니다.'); return; }
    customIngs.push(vals);
    CustomIngredients.idFor(vals);                  // 신규 custom 원료에 고유 ID 발급
  }
  rebuildIngIndex();   // 추가·편집(이름 변경/데이터 교체)을 조회 인덱스에 반영

  // 표시 갱신 — 공용 원료 드롭다운은 열 때마다 목록을 새로 그리므로 옵션 재생성이 필요 없고,
  // 각 행의 선택값(.mix-ing-value)도 그대로 유지된다. 표시 버튼 텍스트만 값에 맞춰 다시 그린다.
  document.querySelectorAll('#mix-body .mix-ing-wrap').forEach(wrap => syncIngDisplayFromWrap(wrap));
  filterIng();
  closeModal('add-ing-modal');
  calculate();
  saveIngOverrides();   // 내장 원료 편집분을 변경분 저장소에 반영(신규 추가분은 customIngs로 저장됨)
  saveToStorage();
  showToast(isEdit ? `원료가 수정되었습니다.` : `'${vals[0]}' 원료가 추가되었습니다.`);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

