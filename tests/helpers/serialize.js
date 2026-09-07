'use strict';
// 스냅샷 비교용 안정 직렬화.
// - NaN / Infinity / -Infinity 를 문자열 센티넬로 바꿔 JSON 왕복에서 소실되지 않게 한다.
// - 부동소수 오차로 인한 헛(spurious) 스냅샷 실패를 막기 위해 숫자를 12 유효자리로 반올림한다
//   (계산식이 실제로 바뀌면 12 자리 안에서 반드시 차이가 난다).

function roundSig(n, sig = 12) {
  if (!Number.isFinite(n) || n === 0) return n;
  const d = Math.ceil(Math.log10(Math.abs(n)));
  const power = sig - d;
  const mag = Math.pow(10, power);
  return Math.round(n * mag) / mag;
}

function normalize(value) {
  // undefined 는 JSON 왕복에서 사라지므로 센티넬로 보존한다
  // (calcNutrition 은 valMap 에 없는 기준명에 대해 value: undefined 를 낸다 — 그 변화도 스냅샷에 남긴다).
  if (value === undefined) return '__undefined__';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '__NaN__';
    if (value === Infinity) return '__Infinity__';
    if (value === -Infinity) return '__-Infinity__';
    return roundSig(value);
  }
  // 배열/객체는 항상 이 realm 의 plain 구조로 다시 만든다.
  // (calcNutrition 결과는 vm 컨텍스트에서 생성되므로 프로토타입 realm 이 달라
  //  deepStrictEqual 이 "same structure but not reference-equal" 로 실패하는 것을 막는다.)
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(normalize(value[i]));
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = normalize(value[k]);
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(normalize(value));
}

module.exports = { normalize, stableStringify, roundSig };
