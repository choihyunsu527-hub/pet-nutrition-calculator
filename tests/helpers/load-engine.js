'use strict';
// 실제 index.html 안의 calcNutrition() 과 그 상수(ING_IDX / ING_COL_COUNT /
// STANDARDS / STANDARDS_CAT)를 "원문 그대로" 추출해 Node 에서 실행 가능한 형태로 로드한다.
//
// - calcNutrition 을 복사/재구현하지 않는다. index.html 의 소스 텍스트를 그대로 잘라
//   vm 샌드박스에서 평가한다.
// - 줄 번호에 의존하지 않는다. 식별자 마커(`function calcNutrition(`, `const ING_IDX = {` …)
//   로 찾고 괄호 균형으로 끝을 잡는다 → 함수 위치가 옮겨지거나 서식이 바뀌어도 견딘다.
// - 마커를 못 찾거나 잘라낸 조각이 파싱되지 않으면 즉시 명확한 에러를 던진다
//   (그 경우 이 파일의 마커만 갱신하면 된다).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_HTML = path.resolve(__dirname, '..', '..', 'index.html');

function readLargestInlineScript(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let best = '';
  let m;
  while ((m = re.exec(html))) if (m[1].length > best.length) best = m[1];
  if (!best) throw new Error('[load-engine] index.html 에서 인라인 <script> 블록을 찾지 못했습니다.');
  return best;
}

// marker 이후 첫 `open` 문자부터 괄호 균형이 0 이 되는 지점까지( `close` 포함 ) 잘라 반환.
function sliceBalanced(src, marker, open, close, label) {
  const idx = src.search(marker);
  if (idx < 0) {
    throw new Error(
      `[load-engine] ${label} 선언을 찾지 못했습니다 (마커: ${marker}). ` +
      `index.html 구조가 바뀌었으면 tests/helpers/load-engine.js 의 마커를 갱신하세요.`
    );
  }
  let i = src.indexOf(open, idx);
  if (i < 0) throw new Error(`[load-engine] ${label}: '${open}' 를 찾지 못했습니다.`);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  if (depth !== 0) throw new Error(`[load-engine] ${label}: 괄호 균형이 맞지 않습니다.`);
  return src.slice(idx, i);
}

function loadEngine() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const js = readLargestInlineScript(html);

  const colCountMatch = js.match(/const\s+ING_COL_COUNT\s*=\s*[^;]+;/);
  if (!colCountMatch) throw new Error('[load-engine] const ING_COL_COUNT 선언을 찾지 못했습니다.');

  const parts = [
    colCountMatch[0],
    sliceBalanced(js, /const\s+ING_IDX\s*=\s*\{/, '{', '}', 'ING_IDX') + ';',
    sliceBalanced(js, /const\s+STANDARDS\s*=\s*\[/, '[', ']', 'STANDARDS') + ';',
    sliceBalanced(js, /const\s+STANDARDS_CAT\s*=\s*\[/, '[', ']', 'STANDARDS_CAT') + ';',
    sliceBalanced(js, /function\s+calcNutrition\s*\(/, '{', '}', 'calcNutrition'),
  ];

  const bundle =
    parts.join('\n\n') +
    '\n\nmodule.exports = { calcNutrition, ING_IDX, ING_COL_COUNT, STANDARDS, STANDARDS_CAT };\n';

  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  try {
    new vm.Script(bundle, { filename: 'index.html:calcNutrition-bundle' }).runInContext(sandbox);
  } catch (err) {
    throw new Error(
      '[load-engine] index.html 에서 추출한 계산 엔진 조각을 실행하지 못했습니다.\n' +
      '  → calcNutrition() 이 외부 전역/DOM 에 새로 의존하게 됐거나 상수 선언 형태가 바뀌었을 수 있습니다.\n' +
      '  원본 에러: ' + err.message
    );
  }

  const eng = sandbox.module.exports;
  if (typeof eng.calcNutrition !== 'function') throw new Error('[load-engine] calcNutrition 을 함수로 추출하지 못했습니다.');
  if (!eng.ING_IDX || typeof eng.ING_IDX !== 'object') throw new Error('[load-engine] ING_IDX 추출 실패.');
  if (!Number.isInteger(eng.ING_COL_COUNT)) throw new Error('[load-engine] ING_COL_COUNT 추출 실패.');
  if (!Array.isArray(eng.STANDARDS) || eng.STANDARDS.length === 0) throw new Error('[load-engine] STANDARDS 추출 실패.');
  if (!Array.isArray(eng.STANDARDS_CAT) || eng.STANDARDS_CAT.length === 0) throw new Error('[load-engine] STANDARDS_CAT 추출 실패.');
  if (Object.keys(eng.ING_IDX).length !== eng.ING_COL_COUNT) {
    throw new Error(`[load-engine] ING_IDX 키 수(${Object.keys(eng.ING_IDX).length}) != ING_COL_COUNT(${eng.ING_COL_COUNT}).`);
  }
  return eng;
}

// 프로세스당 1회만 로드
let cached = null;
function getEngine() {
  if (!cached) cached = loadEngine();
  return cached;
}

module.exports = { getEngine, INDEX_HTML };
