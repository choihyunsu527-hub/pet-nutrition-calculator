# 영양계산 회귀 테스트

`index.html` 안의 **실제 `calcNutrition()`** 과 **실제 상수**(`ING_IDX` / `ING_COL_COUNT` /
`STANDARDS` / `STANDARDS_CAT`)를 원문 그대로 추출해 실행하고, 계산 결과가 리팩터링 과정에서
바뀌지 않는지 고정(golden) 검증한다. calcNutrition 을 복사하거나 재구현하지 않는다.

## 실행

```bash
node --test                       # 전체 (권장)
node --test tests/calc-regression.test.js
node --test tests/property.test.js
```

Node 18+ 내장 테스트 러너만 사용 — 외부 의존성 없음.

## golden 스냅샷 재생성

계산식·기준값을 **의도적으로** 바꿨을 때만:

```bash
node tests/update-golden.js
```

`tests/fixtures/golden.json` 이 갱신된다. 그 외 상황에서 스냅샷 테스트가 실패하면
= 의도치 않은 계산 회귀이므로 golden 을 덮지 말고 원인을 찾을 것.

## 구성

| 파일 | 역할 |
|---|---|
| `helpers/load-engine.js` | index.html 에서 `calcNutrition` + 상수를 마커/괄호균형으로 추출해 vm 로 로드. 줄 번호에 의존하지 않음 |
| `helpers/fixtures.js` | 손검산 가능한 고정 원료 세트 |
| `helpers/scenarios.js` | golden 과 스냅샷 테스트가 공유하는 고정 시나리오 21건 |
| `helpers/serialize.js` | 스냅샷 비교용 정규화(NaN/Infinity/undefined 센티넬, 12 유효자리 반올림, realm 정리) |
| `calc-regression.test.js` | 앵커(손검산) 검증 + golden 스냅샷 비교 |
| `property.test.js` | 시드 고정 랜덤 배합 400건 구조 불변식 |
| `update-golden.js` | golden 재생성기 |
| `fixtures/golden.json` | 실제 calcNutrition 출력 스냅샷 |

## 검증 범위

- 개 / 고양이 (기준표 분기)
- 주식 / 보조식 / 간식 (productType 이 계산에 영향 없음도 명시 검증)
- 배합비 합계 100% / 50%(dmScale 정규화 불변) / 150%(blendError)
- 음수 배합비 / 무명 행 / 존재하지 않는 원료 / 빈 입력
- null 영양소 → `missingCols` · 기준 `value=null` · 판정 `─` · `dataIncomplete`
- DMB(`dmPct`, `dmb.*`), ME(`meAsis`, `meDmb`)
- NFE = 탄수화물 − 조섬유 (음수 클램프 포함)
- Ca:P 비율
- 필수아미노산(라이신) AAFCO 성견 min 임계 판정
- `blendError` 게이팅(F1~F4: 음수 / 무명 / 합계초과 / 건물률)

## 기존 600케이스 차분(diff) 검증과의 관계

이 스위트는 **스냅샷 + 불변식** 방식이라 참조 구현이 필요 없다.
"구/신 calcNutrition 을 동일 입력으로 비교"하는 차분 검증(예: 리팩터링 커밋 리뷰 시
`git show HEAD~1:index.html` 의 함수와 대조)은 이 스위트와 독립적으로 병행 가능하다.
