'use strict';
// golden 스냅샷과 스냅샷 테스트가 공유하는 고정 시나리오 목록.
// 각 시나리오는 실제 calcNutrition() 을 그대로 호출한다.

const { getEngine } = require('./load-engine');
const { fullIngMap } = require('./fixtures');

const { calcNutrition, STANDARDS, STANDARDS_CAT } = getEngine();

const MAP = fullIngMap();
const stdFor = (species) => (species === '고양이' ? STANDARDS_CAT : STANDARDS);

// rows: [[원료명, 배합비], ...] / productType: '주식'|'보조식'|'간식' / species: '개'|'고양이'
const SCENARIOS = [
  // ── 정상 배합 (합계 100%) ─────────────────────────────────
  { id: 'dog-staple-100',   species: '개',    productType: '주식',   rows: [['CLEAN1', 60], ['PREMIX', 40]] },
  { id: 'dog-supp-100',     species: '개',    productType: '보조식', rows: [['CLEAN1', 70], ['FISH', 30]] },
  { id: 'dog-treat-100',    species: '개',    productType: '간식',   rows: [['CLEAN1', 100]] },
  { id: 'cat-staple-100',   species: '고양이', productType: '주식',   rows: [['FISH', 55], ['PREMIX', 45]] },
  { id: 'cat-supp-100',     species: '고양이', productType: '보조식', rows: [['FISH', 80], ['CLEAN1', 20]] },
  { id: 'cat-treat-100',    species: '고양이', productType: '간식',   rows: [['FISH', 100]] },

  // ── 배합비 합계 50% (dmScale 정규화가 100% 결과와 동일해야 함) ──
  { id: 'dog-staple-50',    species: '개',    productType: '주식',   rows: [['CLEAN1', 30], ['PREMIX', 20]] },
  { id: 'cat-staple-50',    species: '고양이', productType: '주식',   rows: [['FISH', 27.5], ['PREMIX', 22.5]] },

  // ── 배합비 합계 150% (blendError: 합계 100% 초과) ──────────
  { id: 'dog-staple-150',   species: '개',    productType: '주식',   rows: [['CLEAN1', 90], ['PREMIX', 60]] },

  // ── 조섬유 (NFE = 탄수화물 - 조섬유) ──────────────────────
  { id: 'dog-fiber12-100',  species: '개',    productType: '주식',   rows: [['CLEAN1_FIBER12', 100]] },
  { id: 'dog-fiber40-100',  species: '개',    productType: '주식',   rows: [['CLEAN1_FIBER40', 100]] },

  // ── 결측(null) 영양소 ────────────────────────────────────
  { id: 'dog-null-100',     species: '개',    productType: '주식',   rows: [['NULLY', 100]] },
  { id: 'cat-null-mix',     species: '고양이', productType: '보조식', rows: [['NULLY', 50], ['FISH', 50]] },

  // ── 필수아미노산 임계 ────────────────────────────────────
  { id: 'dog-lys-pass',     species: '개',    productType: '주식',   rows: [['LYS_PASS', 100]] },
  { id: 'dog-lys-fail',     species: '개',    productType: '주식',   rows: [['LYS_FAIL', 100]] },

  // ── 잘못된 배합 (blendError) ─────────────────────────────
  { id: 'dog-negative-row', species: '개',    productType: '주식',   rows: [['CLEAN1', 80], ['PREMIX', -10]] },
  { id: 'dog-nameless-row', species: '개',    productType: '주식',   rows: [['CLEAN1', 80], ['', 20]] },
  { id: 'dog-moisture-100', species: '개',    productType: '주식',   rows: [['WET', 100]] }, // 아래에서 WET 주입

  // ── 존재하지 않는 원료 ──────────────────────────────────
  { id: 'dog-missing-ing',  species: '개',    productType: '주식',   rows: [['DOES_NOT_EXIST', 50], ['CLEAN1', 50]] },
  { id: 'dog-all-missing',  species: '개',    productType: '주식',   rows: [['NOPE_A', 40], ['NOPE_B', 60]] },

  // ── 빈 입력 ─────────────────────────────────────────────
  { id: 'dog-empty',        species: '개',    productType: '주식',   rows: [] },
];

// 수분 ~100% 원료(건물률 비정상 → blendError) 를 MAP 에 주입
MAP.set('WET', (() => {
  const { ing } = require('./fixtures');
  return ing('WET', { MOISTURE: 99.9, PROTEIN: 0.05 });
})());

function runScenario(sc) {
  return calcNutrition(
    sc.rows,
    sc.productType,
    0,            // vitkManual
    {},           // aminoManual
    sc.species,
    MAP,
    stdFor(sc.species),
  );
}

module.exports = { SCENARIOS, runScenario, MAP, stdFor };
