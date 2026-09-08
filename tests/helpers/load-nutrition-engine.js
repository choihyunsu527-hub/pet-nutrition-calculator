'use strict';
// js/nutrition-engine.js (DOM 비참조 순수 계산 로직) 를 "원문 그대로" 읽어 Node 에서 실행 가능한
// 형태로 로드한다. calcNutrition 뿐 아니라 제품유형 판정·평가정책·Ca:P 판정·급여계수 등
// 순수 함수 전체를 노출해, UI(브라우저/DOM) 없이 단위 테스트할 수 있게 한다.
//
//  - 함수를 복사/재구현하지 않는다. js/nutrition-engine.js 소스 텍스트를 그대로 평가한다.
//  - 엔진이 참조하는 전역(ING_IDX / ING_COL_COUNT / STANDARDS / STANDARDS_CAT)은 js/ingredients.js
//    에서 같은 방식으로 잘라 함께 주입한다. getIng(원료명→배열) 은 테스트가 주입할 수 있게 훅으로 둔다.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS_DIR = path.resolve(__dirname, '..', '..', 'js');
const ENGINE_FILE = path.join(JS_DIR, 'nutrition-engine.js');
const INGREDIENTS_FILE = path.join(JS_DIR, 'ingredients.js');

// marker 이후 첫 `open` 문자부터 괄호 균형이 0 이 되는 지점까지( `close` 포함 ) 잘라 반환.
function sliceBalanced(src, marker, open, close, label) {
  const idx = src.search(marker);
  if (idx < 0) throw new Error(`[load-nutrition-engine] ${label} 선언을 찾지 못했습니다 (마커: ${marker}).`);
  let i = src.indexOf(open, idx);
  if (i < 0) throw new Error(`[load-nutrition-engine] ${label}: '${open}' 를 찾지 못했습니다.`);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error(`[load-nutrition-engine] ${label}: 괄호 균형이 맞지 않습니다.`);
  return src.slice(idx, i);
}

const EXPORT_NAMES = [
  'calcNutrition', 'getAminoStds', 'LIMITING_AA_LIST', 'fmtAminoAmt',
  'PTYPE_META', 'PTYPE_CONF_LABEL', 'isStapleClass',
  'EVAL_MODE_BY_TYPE', 'EVAL_MODE_META', 'getEvaluationPolicy', 'gateJudge',
  'evaluateCapStatus', 'isConcentrateSupplementIngredient', 'classifyProductPurpose', 'applyManualPtypeOverride',
  'judgeGeneric',
  'FEEDING_FACTOR', 'SPECIES_TARGETS', 'ACTIVITY_MULT', 'BCS_MULT', 'NEUTER_ADULT_MULT',
  'NEUTER_APPLICABLE_TARGETS', 'shouldUseTargetWeight',
  'ING_IDX', 'ING_COL_COUNT', 'STANDARDS', 'STANDARDS_CAT',
];

function loadNutritionEngine() {
  if (!fs.existsSync(ENGINE_FILE)) {
    throw new Error('[load-nutrition-engine] js/nutrition-engine.js 가 없습니다 — 계산 엔진 분리 작업이 되어 있어야 합니다.');
  }
  const engineSrc = fs.readFileSync(ENGINE_FILE, 'utf8');
  const ingSrc = fs.readFileSync(INGREDIENTS_FILE, 'utf8');

  const colCountMatch = ingSrc.match(/const\s+ING_COL_COUNT\s*=\s*[^;]+;/);
  if (!colCountMatch) throw new Error('[load-nutrition-engine] const ING_COL_COUNT 를 ingredients.js 에서 찾지 못했습니다.');

  const prelude = [
    colCountMatch[0],
    sliceBalanced(ingSrc, /const\s+ING_IDX\s*=\s*\{/, '{', '}', 'ING_IDX') + ';',
    sliceBalanced(ingSrc, /const\s+STANDARDS\s*=\s*\[/, '[', ']', 'STANDARDS') + ';',
    sliceBalanced(ingSrc, /const\s+STANDARDS_CAT\s*=\s*\[/, '[', ']', 'STANDARDS_CAT') + ';',
    // getIng 훅 — classifyProductPurpose() 가 원료명→배열 조회에 쓴다. 테스트가 __setIng() 로 채운다.
    'let __ingByName = new Map();',
    'function getIng(name) { return __ingByName.get(name); }',
    // entries: [ [name, ingArray], ... ] 이터러블(다른 realm 의 Map 도 그대로 소비된다) 또는 plain object.
    'function __setIng(entries) { __ingByName = new Map(entries && typeof entries[Symbol.iterator] === "function" ? entries : Object.entries(entries || {})); }',
  ].join('\n\n');

  const bundle =
    prelude + '\n\n' + engineSrc + '\n\n' +
    'module.exports = { ' + EXPORT_NAMES.join(', ') + ', __setIng };\n';

  const sandbox = { module: { exports: {} }, console };
  vm.createContext(sandbox);
  try {
    new vm.Script(bundle, { filename: 'js/nutrition-engine.js:bundle' }).runInContext(sandbox);
  } catch (err) {
    throw new Error(
      '[load-nutrition-engine] js/nutrition-engine.js 조각을 실행하지 못했습니다.\n' +
      '  → 엔진이 새 전역/DOM 에 의존하게 됐거나 선언 형태가 바뀌었을 수 있습니다.\n' +
      '  원본 에러: ' + err.message
    );
  }

  const eng = sandbox.module.exports;
  if (typeof eng.calcNutrition !== 'function') throw new Error('[load-nutrition-engine] calcNutrition 추출 실패.');
  if (typeof eng.getEvaluationPolicy !== 'function') throw new Error('[load-nutrition-engine] getEvaluationPolicy 추출 실패.');
  if (typeof eng.classifyProductPurpose !== 'function') throw new Error('[load-nutrition-engine] classifyProductPurpose 추출 실패.');
  if (eng.ING_COL_COUNT !== 48) throw new Error('[load-nutrition-engine] ING_COL_COUNT 이상.');
  return eng;
}

let cached = null;
function getNutritionEngine() {
  if (!cached) cached = loadNutritionEngine();
  return cached;
}

module.exports = { getNutritionEngine, ENGINE_FILE };
