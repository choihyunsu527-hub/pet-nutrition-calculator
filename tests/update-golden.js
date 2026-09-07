'use strict';
// golden 스냅샷 재생성기.
//   node tests/update-golden.js
// 실제 calcNutrition() 결과를 tests/fixtures/golden.json 에 고정한다.
// 계산식/기준값을 "의도적으로" 바꿨을 때만 실행할 것 — 그 외에는 스냅샷 테스트가
// 회귀를 잡아내는 안전망이다.

const fs = require('node:fs');
const path = require('node:path');
const { SCENARIOS, runScenario } = require('./helpers/scenarios');
const { normalize } = require('./helpers/serialize');
const { INDEX_HTML } = require('./helpers/load-engine');

const OUT = path.resolve(__dirname, 'fixtures', 'golden.json');

const golden = {
  _meta: {
    generatedAt: new Date().toISOString(),
    indexHtmlBytes: fs.statSync(INDEX_HTML).size,
    scenarioCount: SCENARIOS.length,
    note: '실제 index.html 의 calcNutrition() 출력 스냅샷. 재생성: node tests/update-golden.js',
  },
  results: {},
};

for (const sc of SCENARIOS) {
  golden.results[sc.id] = normalize(runScenario(sc));
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(golden, null, 2) + '\n', 'utf8');
console.log(`golden 스냅샷 ${SCENARIOS.length}건 → ${path.relative(process.cwd(), OUT)}`);
