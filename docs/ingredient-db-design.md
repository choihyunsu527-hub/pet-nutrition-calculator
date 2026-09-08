# 원료 DB 구조 개선 설계 (작업 3/10)

> 이 문서는 **설계·문서화**만 담는다. 이번 단계에서 실제 데이터/스토리지/계산은 바꾸지 않았다.
> 만든 것: `js/ingredient-schema.js`(순수 부가 어댑터), 본 문서, 관련 테스트.

---

## 1. 현재 원료 DB 구조

### 1.1 데이터 소스 3갈래

| 소스 | 파일 | 건수 | 로딩 시점 | 전역 변수 | 성격 |
|---|---|---|---|---|---|
| 기본(base) | `ingredients.json` | 157 | 앱 시작 `init()` → `loadBaseIngDB()` 1회 `fetch` | `ING_DB` (`let`, `js/ingredients.js`) | USDA FoodData Central 기반. 파일이 정본 |
| 확장(ext) | `data/ingredients_ext.json` | 2,233 | **지연 로딩** — 검색창 입력/드롭다운 열림 시 `loadExtIngsOnce()` 1회 | `extIngs` / `extIngsSorted` | 국가표준식품성분DB 기반. 읽기 전용 |
| 사용자(custom) | localStorage | 가변 | `loadIngDBFromStorage()` | `customIngs` (`let`) | 원료 추가 모달로 생성. 계정별 키 |

- 세 소스 모두 **행 = 길이 49 배열** `[이름, ...영양소 48]`. 컬럼 순서/개수 동일.
- 조회: `ingIndex`(`Map<이름, 배열>`)를 `rebuildIngIndex()`가 `ING_DB → customIngs → extIngs` 우선순위로 재생성. `getIng(name)` = `ingIndex.get(name)` (O(1)).
- `allIngs()` = `[...ING_DB, ...customIngs, ...extIngs]` (매 호출 새 배열; 전역 검색 `search.js`에서만 사용).

### 1.2 배열 구조 (49칸)

`arrayPos 0` = 이름. `arrayPos 1..48` = 영양소.
**`nutrientIndex`(0-based) = `arrayPos - 1` = `calcNutrition()`의 `asis[]` 인덱스 = `ING_IDX`의 값.**
원료 배열에서 직접 읽을 때는 `ing[nutrientIndex + 1]` = `ing[ING_ARR_COL.<KEY>]`.

| pos | idx | ING_IDX 키 | 표준 키(신규) | 단위 |
|--:|--:|---|---|---|
| 0 | – | – | `name` | – |
| 1 | 0 | `KCAL` | `energyKcal` | kcal |
| 2 | 1 | `MOISTURE` | `moisture` | g |
| 3 | 2 | `PROTEIN` | `protein` | g |
| 4 | 3 | `FAT` | `fat` | g |
| 5 | 4 | `CARB` | `carbohydrate` | g (차이법 = NFE + 조섬유) |
| 6 | 5 | `ASH` | `ash` | g |
| 7 | 6 | `CHOLESTEROL` | `cholesterol` | mg |
| 8 | 7 | `CA` | `calcium` | mg |
| 9 | 8 | `P` | `phosphorus` | mg |
| 10 | 9 | `NA` | `sodium` | mg |
| 11 | 10 | `K` | `potassium` | mg |
| 12 | 11 | `FE` | `iron` | mg |
| 13 | 12 | `ZN` | `zinc` | mg |
| 14 | 13 | `MG` | `magnesium` | mg |
| 15 | 14 | `SE` | `selenium` | µg |
| 16 | 15 | `VIT_A` | `vitaminA` | IU |
| 17 | 16 | `VIT_D` | `vitaminD` | IU |
| 18 | 17 | `VIT_E` | `vitaminE` | mg |
| 19 | 18 | `VIT_K` | `vitaminK` | mg |
| 20 | 19 | `VIT_B1` | `vitaminB1` | mg |
| 21 | 20 | `VIT_B2` | `vitaminB2` | mg |
| 22 | 21 | `VIT_B3` | `vitaminB3` | mg |
| 23 | 22 | `VIT_B5` | `vitaminB5` | mg |
| 24 | 23 | `VIT_B6` | `vitaminB6` | mg |
| 25 | 24 | `FOLATE` | `folate` | µg (B9) |
| 26 | 25 | `VIT_B12` | `vitaminB12` | µg |
| 27 | 26 | `EPA` | `epa` | mg |
| 28 | 27 | `DHA` | `dha` | mg |
| 29 | 28 | `CU` | `copper` | mg |
| 30 | 29 | `MN` | `manganese` | mg |
| 31 | 30 | `IODINE` | `iodine` | µg |
| 32 | 31 | `CL` | `chloride` | mg |
| 33 | 32 | `CHOLINE` | `choline` | mg |
| 34 | 33 | `BIOTIN` | `biotin` | µg |
| 35 | 34 | `LA` | `linoleicAcid` | g |
| 36 | 35 | `ALA` | `alphaLinolenicAcid` | g |
| 37 | 36 | `CRUDE_FIBER` | `crudeFiber` | g |
| 38 | 37 | `ARG` | `arginine` | g |
| 39 | 38 | `HIS` | `histidine` | g |
| 40 | 39 | `ILE` | `isoleucine` | g |
| 41 | 40 | `LEU` | `leucine` | g |
| 42 | 41 | `LYS` | `lysine` | g |
| 43 | 42 | `MET_CYS` | `methionineCystine` | g |
| 44 | 43 | `PHE_TYR` | `phenylalanineTyrosine` | g |
| 45 | 44 | `THR` | `threonine` | g |
| 46 | 45 | `TRP` | `tryptophan` | g |
| 47 | 46 | `VAL` | `valine` | g |
| 48 | 47 | `TAURINE` | `taurine` | mg |

값 의미: **숫자 `0` = 실제 0**, **`null` = 데이터 없음(결측)**. `calcNutrition()`은 `null`이면 그 영양소를 합산에서 빼고 `missingCols`에 기록해 기준 판정을 `─`로 낸다.
데이터 현황: base 157행 중 16행에 `null` 셀 160개. ext 2,233행은 `null` 없음. 음수·비숫자 셀 없음. 이름 중복(소스 내부/소스 간) 없음.

### 1.3 사용처 요약

| 목적 | 코드 | 접근 방식 |
|---|---|---|
| 계산 | `calcNutrition(rows,…, ingIndex, …)` (`js/nutrition-engine.js`) | `ingIndex.get(name)` → `ing[i+1]` 순회 |
| 기여도 분석 | `js/app.js` `CONTRIB_NUTRIENTS`, `js/nutrition.js` `AMINO_CONTRIB_DEFS` | `getIng(nm)` → `ing[ING_ARR_COL.<KEY>]` |
| 원료 DB 탭 | `buildIngTable` / `filterIng` / `getIngCategory` (`js/ingredients.js`) | `[...ING_DB, ...customIngs]` + `extIngsSorted` 필터, 렌더 상한 `ING_SEARCH_RENDER_CAP=100` |
| 배합 드롭다운 | `getSortedIngNames` / `ingListItemsHTML` (`js/mix.js`), `buildIngOptions` | 이름 목록만. 커스텀 패널 렌더 상한 100 |
| 원료 CRUD | `saveNewIng` / `deleteSelectedIng` / `openEditIng` (`js/ingredients.js`) | `ING_DB`/`customIngs` 배열 직접 `splice`/대입 + `rebuildIngIndex()` |
| 저장 | `saveToStorage` / `saveIngOverrides` / `loadIngDBFromStorage` (`js/storage.js`) | `customIngs` 통짜 JSON + 내장 원료 "정본 대비 변경분"만 |
| 전역 검색 | `collectGlobalSearchResults` (`js/search.js`) | `for (ing of allIngs())` 전체 순회 |
| 테스트 | `tests/helpers/load-engine.js` 등 | `ING_IDX`/`ING_COL_COUNT`/`STANDARDS`를 소스 텍스트에서 잘라 실행. 원료 배열은 `tests/helpers/fixtures.js`가 `ING_IDX`로 조립 |

### 1.4 localStorage 키

| 키 | 내용 | 쓰는 곳 |
|---|---|---|
| `feedcalc_v4_custom_ings` / `feedcalc_v4_custom_ings_<userId>` | `customIngs` 통짜 JSON | `saveToStorage` |
| `feedcalc_v4_ingdb_overrides` | `{ overrides: {이름: 행}, deleted: [이름] }` — 내장 원료 정본 대비 변경분만 | `saveIngOverrides` |
| `feedcalc_v4_ingdb` (legacy) | 예전 `ING_DB` 전체 스냅샷. **더 이상 쓰지 않음, 삭제도 안 함**(롤백 여지) | 읽기만(마이그레이션 판단) |
| `feedcalc_v4_ingdb_migrated` / `…_custom_ings_migrated` | 마이그레이션 1회 실행 플래그 | `loadIngDBFromStorage` |

정본 diff는 **`JSON.stringify(행)` 문자열 동등성**에 의존한다(`cleanBaseByName`). → 어댑터의 배열 왕복은 **바이트 동일**이어야 한다.

---

## 2. 현재 구조의 문제점 (병목)

| # | 문제 | 현재 상태 | 3,000+건에서 영향 |
|---|---|---|---|
| B1 | **배열 position dependency** | 49칸 위치가 곧 의미. `ING_IDX`/`ING_ARR_COL`/`ING_SHOW`/`ING_COLS`/JSON 배열 순서 5곳이 암묵적으로 동기화돼야 함 | 컬럼 추가/재배치 시 5곳+JSON 2개를 동시 수정. 실수 시 조용한 오계산 |
| B2 | **원료 ID 부재** | 식별자 = 원료명 문자열 | 이름 편집 시 레시피·즐겨찾기·overrides 연결 끊김. 소스 간 동명이인 불가 |
| B3 | **이름 기반 중복 처리** | `rebuildIngIndex`가 "먼저 온 이름이 이김"으로 무시. ext에서 base와 같은 이름은 검색에서 제외 | 소스가 늘수록 "가려진 원료"가 늘고 사용자가 이유를 알 수 없음 |
| B4 | **전체 DB 메모리 로딩** | ext 2,233행을 통짜 `fetch`+`JSON.parse`+정렬 후 상주. 현재 ~468KB | 3,000행 ≈ 630KB, 30,000행 ≈ 6MB — 파싱 지연 + 상시 메모리 |
| B5 | **원료 DOM 렌더링** | 원료 DB 탭 초기 0행(good). **그러나 배합 행마다 숨은 `<select>` 에 `buildIngOptions()` 로 base+custom 전체(~158개) `<option>` 생성** (`addMixRow`, 최대 25행 ⇒ ~3,950 노드) | base가 3,000이면 25행 × 3,000 = **75,000 `<option>` 노드**. `saveNewIng`/`deleteSelectedIng`가 모든 select를 다시 채움 |
| B6 | **localStorage 용량 의존** | `customIngs` 통짜 JSON, `overrides`도 행 통짜. 5–10MB 한도 | custom이 수천 건이면 quota 초과 → 조용한 저장 실패(`catch`) |
| B7 | **검색 시 전체 배열 순회** | `filterIng`/`getSortedIngNames`가 `includes(q)` 선형 스캔 + 매 입력 `[...ING_DB,...customIngs]` 새로 만들고 정렬 | 3,000행 순회·정렬 × 디바운스(120–150ms)마다. 30,000행이면 체감 지연 |
| B8 | **데이터 수정/추가 안정성** | CRUD가 `ING_DB.splice()` 등 배열 직접 변형 + 여러 곳에서 `rebuildIngIndex()` 수동 호출 | 인덱스 갱신 누락 시 유령 원료. 트랜잭션·검증 계층 없음 |
| B9 | **출처/원본 추적성** | 배열에 `source`/`sourceId` 자리 없음. "이 값이 어디서 왔나"를 파일명으로만 유추 | 데이터 검수·갱신·출처표기 불가 |
| B10 | **nutrient index 의존성** | 소비 코드가 `ing[37]` 같은 매직 넘버 또는 `ING_ARR_COL.LA` 사용 | 이름 기반 접근으로 못 바꾸면 컬럼 변경이 계속 위험 |

---

## 3. 권장 목표 구조

### 3.1 ingredient 객체 스키마 (v1)

```
{
  id:        "base:15tl3cf",          // <source>:<fnv1a32(정규화 이름) base36>  (§3.2)
  name:      "닭고기(가슴,생것)",
  category:  "육류",                   // getIngCategory(name) 파생 — 저장 안 함
  source:    "base" | "ext" | "custom",
  sourceId:  null,                     // 원본 식품 코드(USDA FDC id / 국표 식품코드). 현재 데이터에 없음 → null
  basis:     "per_100g_as_fed",        // 현재 모든 데이터 동일
  nutrients: {                         // 48키. number = 값(실제 0 포함), null = 결측
    energyKcal: 106, moisture: 76.2, protein: 22.97, fat: 0.97,
    carbohydrate: 0, ash: 1.13, ... , taurine: 0
  },
  metadata: {
    schemaVersion: 1,
    arrayLength: 49,                   // 왕복 검증
    _row: [원본 49칸 배열]              // 계산 경로 zero-copy. 직렬화 시 제거
  }
}
```

- `nutrients` 키는 `IngredientSchema.KEY_BY_INDEX` / `INDEX_BY_KEY` / `LEGACY_KEY_MAP`(ING_IDX→camelCase)로 상호 변환.
- `basis`는 향후 "as-fed / DMB / per-1000kcal" 확장 지점. 변환은 이 필드를 보고 `calcNutrition` 진입 전에 정규화.

### 3.2 안정적 ID 설계

**이번 단계(무마이그레이션):** `id = "<source>:<fnv1a32(normalizeName(name)) → base36>"`
- 결정적: 같은 이름+소스 → 항상 같은 ID. 저장 불필요.
- `normalizeName` = `NFC` 정규화 + trim + 연속 공백 1칸.
- 한계: 이름을 편집하면 ID도 바뀐다(현재 "이름=식별자"와 동일한 성질이라 회귀 아님).

**다음 단계(진짜 불변 ID):**
1. custom 원료: 생성 시 `custom:<base36(now)><rand>` 1회 발급, `customIngs` 원소를 `{id, name, nutrients…}` 객체로 승격(또는 병렬 `customIngMeta` 맵). localStorage 스키마 v5로 범프.
2. rename: `localStorage['feedcalc_v4_ing_aliases'] = { "옛이름": "id", … }` 별칭 테이블. `getIng`/레시피 로딩이 별칭을 먼저 조회.
3. base/ext: 데이터에 `sourceId` 컬럼이 생기면 `id = "<source>:<sourceId>"`로 승격(현재는 이름 해시 유지).

### 3.3 source / sourceId / basis

- `source`: 배열이 어느 소스에서 왔는지로 **파생**(base/ext/custom). 저장 안 함.
- `sourceId`: 원본 DB의 식품 코드. **현재 두 JSON에 없음** → 임의 생성 금지, `null` 고정. 데이터 갱신 시 50번째 컬럼으로 추가하거나 별도 `data/ingredients_meta.json`(`{name|id: {sourceId, sourceUrl, revisedAt}}`)로 분리 권장(계산 경로 무영향).
- `basis`: 전량 `per_100g_as_fed`. DMB 기준 데이터를 섞어 받을 때 대비한 명시 필드.

### 3.4 배열 ↔ 객체 어댑터 — `js/ingredient-schema.js`

| API | 설명 |
|---|---|
| `IngredientSchema.rowToObject(row, {source,id,sourceId,basis,category})` | 49칸 배열 → §3.1 객체. `null`/`0` 의미 보존. `category`는 전역 `getIngCategory` 있으면 파생 |
| `IngredientSchema.objectToRow(obj)` | 객체 → 49칸 배열. `metadata._row` 있으면 그대로 복제. **`rowToObject`의 정확한 역함수** |
| `IngredientSchema.roundTripEquals(row)` | `JSON.stringify(row) === JSON.stringify(objectToRow(rowToObject(row)))` |
| `IngredientSchema.deriveId(name, source)` | §3.2 결정적 ID |
| `IngredientSchema.KEY_BY_INDEX` / `INDEX_BY_KEY` / `UNIT_BY_KEY` / `LEGACY_KEY_MAP` | 인덱스 ↔ 표준키 ↔ 단위 ↔ ING_IDX키 |
| `IngredientSchema.describe()` | 전체 스키마 표(런타임 조회) |

검증: base 157 + ext 2,233 = **2,390행 전부 왕복 바이트 동일**. → `saveIngOverrides` 정본 diff 안전.

**어댑터는 기존 코드에서 아직 호출하지 않는다.** `ING_DB`/`getIng`/`calcNutrition` 경로는 그대로 배열을 쓴다. 어댑터는 다음 단계가 얹힐 토대.

---

## 4. 검색용 데이터 vs 계산용 데이터 분리 (검토)

| 축 | 계산용 | 검색/표시용 |
|---|---|---|
| 필요 정보 | 배합에 실제 쓰인 원료의 48영양소 배열 | 이름·카테고리·(선택) 대표 몇 개 값 |
| 규모 | 배합 행 수(≤25) | 전체 DB |
| 접근 | `ingIndex.get(name)` | prefix/부분일치 정렬 목록 |

**권장:** 두 인덱스를 분리.
- `searchIndex`: `[{id, name, nameLower, category, source}]` 정렬 배열 (+ 선택적으로 초성/prefix trie). 영양소 배열 없음 → 가볍다.
- `nutrientStore`: `Map<id, 49칸 배열>` 또는 `Map<id, Float64Array(48)>`. **배합에 등장한 id만 lazy 로드**(§5).
- `calcNutrition`은 이미 `ingredientMap` 인자를 받으므로, `{get(name|id)}` 어댑터만 넘기면 계산식 무변경으로 id 기반 조회로 전환 가능.

---

## 5. 대량 DB(3,000+)에서 전체 DOM을 만들지 않는 검색 구조

현재도 원료 DB 탭 초기 렌더는 0행이고 검색 결과는 100개 상한이라 **DOM 측면 병목은 사실상 B5(배합 행 `<select>`) 하나**다.

**설계(다음 단계 적용 대상, 이번엔 미적용):**
1. **배합 행의 숨은 `<select>` 제거** → 커스텀 드롭다운(`.mix-ing-list`, body에 1개, 렌더 상한 100)만 사용. 값 보관은 `<input type="hidden">` 또는 `dataset`. `buildIngOptions()` 호출 0회 ⇒ B5 소멸. (기존 접근성/폼 제출 의존 없음 확인 필요.)
2. **검색은 `searchIndex` 대상 + 결과 상한 유지**(`ING_SEARCH_RENDER_CAP` / `EXT_ING_SEARCH_CAP`). 매 입력마다 `[...ING_DB,...customIngs]`를 새로 만들지 않고 `searchIndex`를 재사용.
3. **가상 스크롤(선택):** 결과가 상한을 자주 넘으면 `.mix-ing-options`에 windowing. 우선순위 낮음(상한 100으로 충분).
4. **계산은 이미 "배합에 쓰인 원료만" 참조**(`calcNutrition`이 `rows` 순회) — 유지.

성능 목표 대비 현황: 초기 전체 DOM 미생성 ✅(원료탭), 검색 결과만 렌더 ✅, 입력 시 전체 재렌더 최소화 △(디바운스 있음, 배열 재생성은 남음), 계산 시 사용 원료만 참조 ✅.

---

## 6. localStorage 충돌 없는 마이그레이션 전략

원칙: **기존 키를 지우지 않는다. 새 키만 추가한다. 실패 시 조용히 기존 경로로 폴백.**

| 단계 | 동작 | 롤백 |
|---|---|---|
| 0 (현재) | 어댑터만 존재. localStorage 무변경 | 파일 삭제 |
| 1 | custom 원료에 `id` 부여 → `feedcalc_v4_custom_ings_v2_<userId>` = `[{id,name,nutrients,source:'custom',basis}]`. 로드시 **v2 없으면 v1(`customIngs` 배열) 읽어 1회 변환해 v2 기록**. v1 키 유지 | v2 무시하고 v1 계속 사용 |
| 2 | rename 별칭 `feedcalc_v4_ing_aliases`. 없으면 `{}` | 키 삭제 |
| 3 | overrides를 id 기준으로: `feedcalc_v4_ingdb_overrides_v2` = `{ overrides:{id:행}, deleted:[id] }`. 없으면 이름 기준 v1에서 파생 | v1 사용 |
| 4 (선택) | ext DB를 IndexedDB(`objectStore: ingredients`, keyPath `id`)로. `fetch`는 최초 1회만, 이후 IDB. IDB 미지원/실패 → 현재 `fetch` 경로 | IDB 무시 |

`feedcalc_v4_ingdb`(legacy 스냅샷)는 계속 보존.

---

## 7. IndexedDB / 분할 JSON 확장 경로

- **분할 JSON:** `data/ingredients_ext/` 아래 카테고리별(`meat.json`, `fish.json`, …) 또는 초성별 파일 + `data/ingredients_ext/index.json`(`[{id,name,category,file}]`). 검색은 index만 로드, 상세는 필요한 파일만.
- **IndexedDB:** 스토어 `ingredients`(keyPath `id`), 인덱스 `by_name`(lower), `by_category`, `by_source`. 최초 1회 seed 후 오프라인·즉시. 스키마 버전 `IngredientSchema.SCHEMA_VERSION`과 연동.
- 어느 쪽이든 `calcNutrition(ingredientMap)` 인자 덕분에 **계산식 변경 없이** 백엔드 스토어 교체 가능. `ingredientMap`을 `{ get(key){ return nutrientStore.get(key); } }`로만 바꾸면 됨.

---

## 8. 다음 단계 권장 순서

1. `js/ingredient-schema.js`를 **읽기 경로에서만** 사용 시작: `getIngObject(name)` = `rowToObject(getIng(name), {source})` 헬퍼 추가(계산·저장 경로 무변경).
2. B5 제거: 배합 행 숨은 `<select>` → hidden input + 커스텀 드롭다운 단일화. (UI 픽셀 변화 없음 확인하며)
3. custom 원료 `id` 도입 + localStorage v2 + rename 별칭 (§6 단계 1–2).
4. `searchIndex` / `nutrientStore` 분리 (§4). `calcNutrition`에 id 기반 `ingredientMap` 주입.
5. ext DB IndexedDB 또는 분할 JSON (§7).
6. `sourceId`/`sourceUrl` 메타를 `data/ingredients_meta.json`으로 별도 수집(데이터 검수 트랙).
