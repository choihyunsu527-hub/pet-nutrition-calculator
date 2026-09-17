// utils.js — 공통 유틸(단일 소스). index.html 인라인 스크립트에서 분리(동작 변경 없음).

function debounce(fn, delay) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ── 표시용 숫자 포맷(계산 정밀도/로직은 그대로 두고 "화면에 보여줄 자릿수"만 한 곳에서 통일) ──
//   fmtPctVal   — 영양소 %, 충족률/부족률/변화율 등 퍼센트류 → 소수 1자리
//   fmtAmtVal   — 절대량(mg/kg, IU/kg, μg/kg, kcal/kg 등) → 소수 0자리
//   fmtRatioVal — 비율(Ca:P, DER 계수 등) → 소수 2자리
//   fmtByUnit   — 기준표/판정 결과처럼 unit 문자열(예: "% DMB"/"mg/kg DMB"/"비율")로만 값의
//                 종류를 알 수 있는 곳에서 위 3규칙에 자동으로 매핑한다.
function fmtPctVal(v) {
  return (v == null || Number.isNaN(v)) ? '─' : v.toFixed(1);
}
function fmtAmtVal(v) {
  return (v == null || Number.isNaN(v)) ? '─' : v.toFixed(0);
}
function fmtRatioVal(v) {
  return (v == null || Number.isNaN(v)) ? '─' : v.toFixed(2);
}
function fmtByUnit(v, unit) {
  if (v == null || Number.isNaN(v)) return '─';
  const u = unit || '';
  if (u.indexOf('비율') !== -1) return fmtRatioVal(v);
  if (u.indexOf('%') !== -1) return fmtPctVal(v);
  return fmtAmtVal(v);
}
