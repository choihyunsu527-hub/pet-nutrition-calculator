'use strict';
// 구조 불변식(property) 테스트 — 참조 구현 없이 실제 calcNutrition() 만으로,
// 시드 고정 난수 배합 다수에 대해 "항상 성립해야 하는 성질"을 확인한다.
// 기존 600케이스 차분(diff) 방식과 충돌하지 않는 독립 스위트다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEngine } = require('./helpers/load-engine');
const { INGREDIENTS } = require('./helpers/fixtures');

const { calcNutrition, ING_IDX, ING_COL_COUNT, STANDARDS, STANDARDS_CAT } = getEngine();

// 시드 고정 mulberry32
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = Object.keys(INGREDIENTS);
const FULL_MAP = new Map(Object.entries(INGREDIENTS));
const J = new Set(['pass', 'fail', 'over', '─']);
const N = 400;

test(`구조 불변식: 시드 고정 랜덤 배합 ${N}건`, () => {
  const R = rng(20240607);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];

  for (let i = 0; i < N; i++) {
    const species = R() < 0.5 ? '개' : '고양이';
    const stdTable = species === '고양이' ? STANDARDS_CAT : STANDARDS;
    const productType = pick(['주식', '보조식', '간식']);

    const k = 1 + Math.floor(R() * 5);
    const rows = [];
    for (let j = 0; j < k; j++) {
      const roll = R();
      let name;
      if (roll < 0.08) name = '';                       // 무명 행
      else if (roll < 0.16) name = 'NOPE_' + Math.floor(R() * 999); // 존재하지 않음
      else name = pick(NAMES);
      let ratio;
      const rr = R();
      if (rr < 0.06) ratio = -(R() * 30);               // 음수
      else if (rr < 0.1) ratio = 0;
      else ratio = R() * (R() < 0.15 ? 140 : 60);       // 가끔 합계 > 100
      rows.push([name, ratio]);
    }

    const ctx = () => `case #${i} rows=${JSON.stringify(rows)} species=${species}`;
    let r;
    assert.doesNotThrow(() => { r = calcNutrition(rows, productType, 0, {}, species, FULL_MAP, stdTable); }, ctx());

    // 반환 구조
    assert.equal(r.asis.length, ING_COL_COUNT, ctx());
    assert.ok(Array.isArray(r.missingCols), ctx());
    assert.ok(r.missingCols.every((c) => Number.isInteger(c) && c >= 0 && c < ING_COL_COUNT), ctx());
    assert.equal(typeof r.dataIncomplete, 'boolean', ctx());
    assert.equal(r.standards.length, stdTable.length, ctx());

    // asis: 입력이 유한수/null 뿐이므로 결과도 NaN 이 아니어야 한다
    for (let c = 0; c < ING_COL_COUNT; c++) {
      assert.ok(Number.isFinite(r.asis[c]), `${ctx()} asis[${c}]=${r.asis[c]}`);
    }

    // dmb 전 항목이 수(number) — undefined/NaN 금지 (일부는 null 허용 항목 없음)
    for (const [key, v] of Object.entries(r.dmb)) {
      assert.equal(typeof v, 'number', `${ctx()} dmb.${key}=${v}`);
      assert.ok(!Number.isNaN(v), `${ctx()} dmb.${key} is NaN`);
    }

    // 판정 라벨 도메인
    for (const s of r.standards) {
      for (const key of ['nrc_j', 'aafco_j', 'aafco_gr_j', 'aafco_rp_j', 'fediaf_j']) {
        assert.ok(J.has(s[key]), `${ctx()} ${s.name}.${key}=${s[key]}`);
      }
    }

    if (r.blendError) {
      // 오류 상태: 모든 기준은 평가 제외
      assert.ok(r.standards.every((s) => s.value === null), `${ctx()} blendError 인데 value != null`);
      assert.ok(r.standards.every((s) => s.nrc_j === '─' && s.aafco_j === '─' && s.fediaf_j === '─'), ctx());
    } else {
      // 정상: ME/DM 은 유한, dmPct 하한 유지
      assert.ok(Number.isFinite(r.meAsis) && Number.isFinite(r.meDmb), ctx());
      assert.ok(r.meAsis >= 0 && r.meDmb >= 0, `${ctx()} meAsis=${r.meAsis} meDmb=${r.meDmb}`);
      assert.ok(r.dmPct >= 0.001 - 1e-12, `${ctx()} dmPct=${r.dmPct}`);

      // totalRatio = 존재하는 원료의 양수 배합비 합
      const expTotal = rows
        .filter(([nm, ra]) => nm && ra > 0 && FULL_MAP.has(nm))
        .reduce((a, [, ra]) => a + ra, 0);
      assert.ok(Math.abs(r.totalRatio - expTotal) < 1e-9, `${ctx()} totalRatio=${r.totalRatio} exp=${expTotal}`);
    }

    // 결측으로 기록된 컬럼에 대응하는 기준은 value=null (해당 기준이 존재할 때)
    for (const s of r.standards) {
      if (s.value !== null && r.blendError) assert.fail(ctx());
    }
  }
});

test('결측 컬럼 ↔ 기준 value=null 대응 (blendError 없는 경우)', () => {
  // NULLY: CA, LYS 결측. 그 두 기준만 null, 나머지 아미노/미네랄 기준은 숫자여야 한다.
  const r = calcNutrition([['NULLY', 100]], '주식', 0, {}, '개', FULL_MAP, STANDARDS);
  assert.equal(r.blendError, null);
  const ca = r.standards.find((s) => s.name === '칼슘(Ca)');
  const lys = r.standards.find((s) => s.name === '라이신(Lys)');
  const prot = r.standards.find((s) => s.name === '조단백');
  assert.equal(ca.value, null);
  assert.equal(lys.value, null);
  assert.equal(typeof prot.value, 'number');
});
