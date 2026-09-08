// storage.js — localStorage 저장/원료DB 오버라이드/초기화. index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 초기화
// ════════════════════════════════════════════════════════════════════════════
// 현재 작업(레시피 배합·반려동물 정보 등)은 더 이상 세션 간에 저장·복원하지 않는다 —
// 프로그램을 새로 실행하면 항상 빈 상태로 시작한다. 원료DB(ING_DB + customIngs)는 사용자가
// 직접 추가·수정한 참고용 라이브러리이므로 예외적으로 계속 저장한다.
// saveToStorage()는 호출될 때마다 dirty 플래그를 세워 종료 확인창의 근거로 쓴다.
//
// customIngs(원료 추가 모달로 새로 만든 원료)는 ING_DB(내장 원료)와 별도의 배열이라, 예전에는
// ING_DB만 localStorage에 저장하고 customIngs는 저장하지 않아 새로고침하면 새로 추가한 원료가
// 사라졌다 — 같은 localStorage 방식을 그대로 확장해 customIngs도 함께 저장/복원한다.
//
// customIngs는 계정마다 분리해서 저장한다(로그인 사용자 id를 키에 포함) — 그래야 같은
// 브라우저를 여러 계정이 함께 쓸 때 서로의 커스텀 원료가 보이거나 덮어써지지 않는다.
// ING_DB(내장 원료 스냅샷)는 기존과 동일하게 계정 구분 없이 그대로 둔다.
const LEGACY_CUSTOM_ING_KEY    = 'feedcalc_v4_custom_ings';
const CUSTOM_ING_MIGRATED_FLAG = 'feedcalc_v4_custom_ings_migrated';
function getCustomIngsKey() {
  return currentUser ? `feedcalc_v4_custom_ings_${currentUser.id}` : LEGACY_CUSTOM_ING_KEY;
}
// v2(안정 ID 포함) 저장 키 — v1 키는 그대로 두고 이 키만 "추가"한다.
function getCustomIngsKeyV2() {
  return CustomIngredients.keyV2(currentUser ? currentUser.id : null);
}
// loadIngDBFromStorage()가 최소 1회 실행되기 전에는 customIngs 저장소를 쓰지 않는다.
// (init() 중 syncAllergyControl → calculate → saveToStorage 가 로드보다 먼저 실행돼
//  아직 비어 있는 customIngs 로 저장소를 덮어써 저장된 사용자 원료가 사라지던 문제를 막는다.
//  ING_DB 변경분(saveIngOverrides)은 cleanBaseByName 가드가 이미 같은 역할을 한다.)
let customIngsStorageReady = false;
function saveToStorage() {
  markDirty();
  // 기본 원료 DB(ingredients.json)는 파일이 정본이라 여기서 저장하지 않는다.
  // 내장 원료를 편집/삭제한 변경분은 원료 CRUD 시점(saveNewIng/deleteSelectedIng)에서 saveIngOverrides()가 담당한다.
  if (!customIngsStorageReady) return;
  localStorage.setItem(getCustomIngsKey(), JSON.stringify(customIngs));   // v1(형식 불변) 계속 저장 — 롤백/하위호환
  try {
    localStorage.setItem(getCustomIngsKeyV2(), JSON.stringify(CustomIngredients.serializeV2(customIngs)));
  } catch (e) {
    console.warn('사용자 추가 원료 v2 저장 실패:', e);
  }
}

// 현재 ING_DB를 정본(cleanBaseByName)과 비교해, 사용자가 내장 원료를 편집/삭제한 "변경분"만
// { overrides: {이름: 행}, deleted: [이름] } 형태로 저장한다. 기본 원료 전체 배열은 저장하지 않는다.
function saveIngOverrides() {
  if (!cleanBaseByName) return;   // 아직 정본이 준비되지 않음(초기화 전) — 저장하지 않는다
  const overrides = {};
  const deleted = [];
  const curNames = new Set(ING_DB.map(r => r[0]));
  for (const name of cleanBaseByName.keys()) {
    if (!curNames.has(name)) deleted.push(name);          // 정본에는 있는데 지금은 없음 = 사용자가 삭제
  }
  for (const row of ING_DB) {
    const cleanJson = cleanBaseByName.get(row[0]);
    if (cleanJson === undefined) continue;                // 정본에 없는 이름(사용자 신규 추가분은 customIngs로 감) — 여기선 무시
    if (JSON.stringify(row) !== cleanJson) overrides[row[0]] = row;   // 값이 바뀜 = 사용자가 편집
  }
  try {
    localStorage.setItem(INGDB_OVERRIDES_KEY, JSON.stringify({ overrides, deleted }));
  } catch (e) {
    console.warn('원료 변경분 저장 실패:', e);
  }
}

// ── 결측(null) 백필 패치 ──────────────────────────────────────────────────────
// 예전에 저장된 원료DB 스냅샷(feedcalc_v4_ingdb)에는 이번에 ingredients.json에서 0→null로 바꾼
// "데이터 없음" 정보가 없다. 스냅샷을 복원한 뒤, 아래 목록의 셀이 "여전히 0"이면 null로 되돌린다.
// (사용자가 직접 편집해 0이 아닌 값을 넣었다면 건드리지 않는다 / customIngs는 별도 배열이라 무관.)
// ext DB(data/ingredients_ext.json)는 이 패치 대상이 아니며, 확장 시 여기에 정책만 추가하면 된다.
// 원료배열(ing[]) 컬럼 번호 목록 — 필수아미노산 10종. 상단 스키마(ING_EAA_ARR_COLS)에서 그대로 가져온다.
const INGDB_EAA_COLS = ING_EAA_ARR_COLS;
const INGDB_MISSING_PATCH = {
  "굴분말(건조)": [ING_ARR_COL.CA, ING_ARR_COL.P, ING_ARR_COL.NA, ING_ARR_COL.K, ING_ARR_COL.FE, ING_ARR_COL.ZN, ING_ARR_COL.MG, ...INGDB_EAA_COLS],
  "돼지족발(생것)": INGDB_EAA_COLS, "정어리(생것)": INGDB_EAA_COLS, "임연수어, 생것": INGDB_EAA_COLS,
  "갈치, 생것": INGDB_EAA_COLS, "가물치, 생것": INGDB_EAA_COLS, "민어, 생것": INGDB_EAA_COLS,
  "소 부산물, 심장, 생것": INGDB_EAA_COLS, "닭모래집(생것)": INGDB_EAA_COLS,
  "소 부산물, 신장, 생것": INGDB_EAA_COLS, "돼지 부산물, 신장, 생것": INGDB_EAA_COLS,
  "장어, 붕장어, 생것": INGDB_EAA_COLS, "은어, 생것": INGDB_EAA_COLS, "병어, 생것": INGDB_EAA_COLS,
  "코코넛 분말": INGDB_EAA_COLS,
  "초록잎홍합분말(건조)": [ING_ARR_COL.P, ING_ARR_COL.LEU, ING_ARR_COL.TRP],
};
function applyIngDBMissingPatch() {
  ING_DB.forEach(ing => {
    const cols = INGDB_MISSING_PATCH[ing[0]];
    if (!cols) return;
    cols.forEach(c => { if (ing[c] === 0) ing[c] = null; });
  });
}

// 사용자 원료 라이브러리(=내장 원료 변경분 + customIngs)만 복원한다 — 레시피 작업 상태는 절대 복원하지 않는다.
// 기본 원료 DB는 ingredients.json이 정본이며 loadBaseIngDB()가 이미 ING_DB에 채워 놓은 상태로 들어온다.
function loadIngDBFromStorage() {
  try {
    const key = getCustomIngsKey();
    let savedCustomIngs = localStorage.getItem(key);
    // 계정별 키로 나누기 전에 쓰던 공용 키(feedcalc_v4_custom_ings)에 데이터가 남아 있으면,
    // 이 계정 전용 키가 아직 한 번도 없었을 때에 한해 딱 1회만 그대로 옮겨온다(다른 계정으로
    // 또 옮겨지지 않도록 플래그로 막는다). 공용 키 자체는 지우지 않아 데이터가 사라지지 않는다.
    if (savedCustomIngs === null && currentUser && !localStorage.getItem(CUSTOM_ING_MIGRATED_FLAG)) {
      const legacy = localStorage.getItem(LEGACY_CUSTOM_ING_KEY);
      if (legacy) {
        localStorage.setItem(key, legacy);
        savedCustomIngs = legacy;
      }
      localStorage.setItem(CUSTOM_ING_MIGRATED_FLAG, '1');
    }
    customIngs = [];
    // v2(안정 ID) 우선. 있으면 그대로 복원하고 (row → id) 매핑을 등록한다.
    let v2 = null;
    try {
      const rawV2 = localStorage.getItem(getCustomIngsKeyV2());
      if (rawV2) v2 = CustomIngredients.parseV2(JSON.parse(rawV2));
    } catch (e) { console.warn('사용자 추가 원료 v2 파싱 실패 — v1으로 폴백:', e); v2 = null; }

    if (v2) {
      customIngs = v2.rows;
      CustomIngredients.adoptEntries(v2.entries);
    } else if (savedCustomIngs) {
      const parsed = JSON.parse(savedCustomIngs);
      if (Array.isArray(parsed)) customIngs = parsed;
      // v1 → v2 마이그레이션: 기존 원료마다 ID 발급 후 v2 키에 기록. v1 키는 그대로 둔다.
      CustomIngredients.syncRows(customIngs, { allocMissing: true });
      try {
        localStorage.setItem(getCustomIngsKeyV2(), JSON.stringify(CustomIngredients.serializeV2(customIngs)));
      } catch (e) { console.warn('사용자 추가 원료 v1→v2 마이그레이션 저장 실패:', e); }
    }
  } catch(e) {
    console.warn('사용자 추가 원료 불러오기 실패:', e);
  }
  // 로드가 (성공이든 실패든) 끝났으니 이제부터는 saveToStorage()가 customIngs 저장소를 갱신해도 안전하다.
  customIngsStorageReady = true;
  // 정본이 예전 배포본이라 새 내장 원료(타피오카 전분·단호박 분말)가 없을 가능성에 대비한 방어 로직 —
  // 지금은 ingredients.json에 이미 포함돼 있어 보통 아무 것도 하지 않는다.
  BUILTIN_ING_SEED.forEach(seed => {
    if (!ING_DB.some(ing => ing[0] === seed[0])) ING_DB.push(seed);
  });
  // "데이터 없음"을 나타내는 0→null 백필. 정본(ingredients.json)이 이미 null이면 no-op.
  applyIngDBMissingPatch();

  // 정본(ingredients.json) 로드 자체가 실패해 ING_DB가 비어 있으면 — 예전처럼 전체 스냅샷이
  // 있으면 그것으로만 임시 복원하고(오프라인 대비), 변경분 계산/저장·마이그레이션은 하지 않는다
  // (cleanBaseByName을 null로 둬 saveIngOverrides()가 잘못된 diff를 쓰지 않게 막는다).
  if (!ING_DB.length) {
    try {
      const rawLegacy = localStorage.getItem(INGDB_LEGACY_SNAPSHOT_KEY);
      const snap = rawLegacy ? JSON.parse(rawLegacy) : null;
      if (Array.isArray(snap)) snap.forEach(ing => ING_DB.push(ing));
    } catch (e) { console.warn('원료DB 임시 복원 실패:', e); }
    cleanBaseByName = null;
    rebuildIngIndex();
    return;
  }

  // ── 기본 원료 정본 분리: 정본 위에 "사용자 변경분"만 얹는다 ──────────────────────
  // (1) ingredients.json + 시드 + null 백필까지 끝난 "깨끗한 정본"을 비교 기준으로 보관.
  cleanBaseByName = new Map(ING_DB.map(r => [r[0], JSON.stringify(r)]));

  // (2) 변경분 로드.
  //   - 새 overrides 키가 이미 있으면 그대로 사용한다(신규 구조 사용자 — 동작 불변).
  //   - 새 키가 없고 예전 전체 스냅샷(feedcalc_v4_ingdb)만 있는 기존 사용자는, 스냅샷 내용을
  //     "사용자 편집분"으로 승격하지 않고 "빈 변경분"으로 1회 마이그레이션한다.
  //     예전 스냅샷은 calculate()마다 전체 ING_DB를 무조건 덮어써 저장돼 온 것이라
  //     '사용자가 직접 고친 값'과 '그 뒤 ingredients.json 정본이 갱신된 값'(0→null 결측 표기,
  //     국가표준 DB 수치 보정 등)을 구분할 신호가 전혀 없다. 스냅샷 차이를 override로 간주하면
  //     0↔null 차이까지 사용자 편집으로 잘못 굳어 최신 정본이 기존 사용자에게 영영 적용되지
  //     않으므로, 구분 불가한 legacy 데이터는 보존보다 '최신 정본 우선'을 택한다.
  //     이후의 실제 사용자 편집은 saveIngOverrides()가 새 구조로 정상 기록한다.
  //     예전 키(feedcalc_v4_ingdb)는 이번 단계에서 지우지 않는다 — 되돌릴 여지를 남긴다.
  let overridesData = null;
  try {
    const rawOv = localStorage.getItem(INGDB_OVERRIDES_KEY);
    if (rawOv) {
      overridesData = JSON.parse(rawOv);
    } else if (!localStorage.getItem(INGDB_MIGRATED_FLAG)) {
      if (localStorage.getItem(INGDB_LEGACY_SNAPSHOT_KEY)) {
        // legacy 스냅샷 보유자: 빈 변경분으로만 마이그레이션(정본은 손대지 않음).
        overridesData = { overrides: {}, deleted: [] };
        localStorage.setItem(INGDB_OVERRIDES_KEY, JSON.stringify(overridesData));
      }
      // legacy 스냅샷이 없는 신규 사용자는 아무 것도 쓰지 않는다(기존 동작 유지) — 플래그만 세운다.
      localStorage.setItem(INGDB_MIGRATED_FLAG, '1');
    }
  } catch (e) {
    console.warn('원료 변경분 불러오기 실패:', e);
  }

  // (3) 정본 위에 사용자 변경분 적용 — 삭제 먼저, 그다음 편집/되살림.
  if (overridesData && typeof overridesData === 'object') {
    const del = Array.isArray(overridesData.deleted) ? overridesData.deleted : [];
    del.forEach(name => {
      const i = ING_DB.findIndex(r => r[0] === name);
      if (i >= 0) ING_DB.splice(i, 1);
    });
    const ov = (overridesData.overrides && typeof overridesData.overrides === 'object') ? overridesData.overrides : {};
    Object.keys(ov).forEach(name => {
      const row = ov[name];
      if (!Array.isArray(row)) return;
      const i = ING_DB.findIndex(r => r[0] === name);
      if (i >= 0) ING_DB[i] = row;
      else ING_DB.push(row);   // 정본에서 빠졌지만 사용자가 갖고 있던 내장 원료 → 되살림(예전 스냅샷 동작 보존)
    });
  }

  // customIngs(복원)와 ING_DB(변경분 적용)가 바뀌었으니 조회 인덱스를 다시 만든다.
  rebuildIngIndex();
}
