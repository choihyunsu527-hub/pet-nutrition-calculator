// utils.js — 공통 유틸(단일 소스). index.html 인라인 스크립트에서 분리(동작 변경 없음).

function debounce(fn, delay) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}
