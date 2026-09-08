# CLAUDE.md

## 프로젝트 개요
개/고양이 사료 영양 계산기 (Nutri-Circulator) — NRC 2006 · AAFCO 2023 · FEDIAF 2025 기준 기반 배합 설계 및 영양 분석 도구

## 기술 스택 (중요 — 프레임워크 없음)
- **순수 정적 HTML/CSS/JS 단일 파일** (`index.html`, 약 500KB). React/Vue/Next.js 등 프레임워크 미사용, 빌드 스텝 없음
- 외부 라이브러리는 CDN `<script>` 태그로 로드: `xlsx.js`(엑셀 내보내기), `@supabase/supabase-js`(인증/DB)
- 배포: Vercel (정적 호스팅, `vercel.json` 설정 존재)
- 백엔드: Supabase (인증 + `supabase/functions`에 Edge Function 3개: create-user, delete-user, update-user / `supabase/sql`에 스키마)
- 탭 전환은 SPA 방식이지만 프레임워크 라우터가 아니라 자체 `goTab('tabname')` 함수로 처리 (해시/컴포넌트 마운트 없이 DOM 직접 제어로 추정)

## 주요 파일
- `index.html` — 전체 앱 (마크업 + 스타일 + 로직이 한 파일에 있음)
- `logo.png` — 헤더/사이드바 로고, `index.html`과 **같은 루트 폴더**에 위치
- `레시피/*.json` — 저장된 레시피 데이터 (예: "고구마&산양유 소프트 트릿", "배박 덴탈껌")
- `supabase/functions/` — 사용자 생성/삭제/수정 Edge Function
- `supabase/sql/001_profiles_role.sql` — 프로필/권한 스키마

## 화면 구조 (goTab 값 기준)
- `dash` — 대시보드 (영양 설계 현황 요약, AAFCO 충족률/경고 항목/에너지/일일 급여량)
- `product` — 제품/정보 (제품명, 제조사, 유형, ME/RER/MER 계산)
- `mix` — 배합 설계 (원료 선택 + 배합비 입력 → 실시간 영양소 계산 테이블)
- `ana` — 영양 분석 (하위: 영양소 분석, 에너지 분석)
- `ana-energy` — 에너지 분석
- `amino` — 아미노산 분석
- `warn` — 경고 패널 (AAFCO Max 초과 여부, 임상적 위험 근거 + 출처 표시)
- `settings` — 설정

## 로고 관련 참고사항
- `<img id="top-logo" src="logo.png" alt="Nutri-Circulator">` — **상대경로**로 참조하므로, 같은 파일명(`logo.png`)으로 루트에 덮어쓰기만 하면 코드 수정 없이 바로 반영됨
- 별도 `public/` 폴더나 import 방식이 아님 — 이미지 교체 시 build/이동 작업 불필요, 파일만 교체하고 git commit/push (Vercel 자동 배포) 하면 끝

## 데이터 기준
- 원료 DB: USDA FoodData Central 기반, 104개 원료 (카테고리: 육류/어류 등)
- 영양기준 DB: NRC MR/RA, AAFCO 성견/Max/성장/임신수유, FEDIAF 성견/성장견 병렬 비교
- 배합 설계는 주식(완전균형식) vs 보조식을 구분해서 AAFCO 기준 적용 여부를 다르게 판정함

## 작업 시 주의사항
- 파일이 통째로 하나라 grep으로 특정 id/함수명 먼저 찾고 그 주변만 수정할 것 (전체 재작성 금지)
- 프레임워크 탐색(Next.js/Vite 여부 확인 등) 불필요 — 이미 알려진 사실이므로 스킵
- 커밋 전 Vercel 미리보기로 확인 권장
