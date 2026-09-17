// compare.js — "배합 비교" 탭: 현재 레시피(A) vs 저장된 레시피(B) 영양성분 비교.
// 계산은 calcNutrition()을 그대로 재사용한다(중복 계산 로직 없음) — 이 파일은 두 결과를
// 정렬해 표로 그리는 역할만 한다. A는 calculate()가 채워둔 전역 lastResult를 읽기만 하고,
// B는 별도의 로컬 ingredientMap으로 계산해 현재 배합(A)이 쓰는 전역 상태(ingIndex/customIngs 등)를
// 건드리지 않는다(applyRecipeData()와 달리 DOM/전역을 덮어쓰지 않음).

const COMPARE_ROWS = [
  { label: '수분',          key: 'moist', unit: '%' },
  { label: '조단백',        key: 'prot',  unit: '% DMB' },
  { label: '조지방',        key: 'fat',   unit: '% DMB' },
  { label: '조섬유',        key: 'fiber', unit: '% DMB' },
  { label: '조회분',        key: 'ash',   unit: '% DMB' },
  { label: '칼슘(Ca)',      key: 'ca',    unit: '% DMB' },
  { label: '인(P)',         key: 'p',     unit: '% DMB' },
  { label: 'Ca:P 비율',     key: 'cap',   unit: '비율' },
  { label: 'ME(대사에너지)', key: 'me',    unit: 'kcal/kg' },
];

let compareRecipeB = null; // { name, result } | null

function setCompareRecipeOptions(html) {
  const sel = document.getElementById('compare-recipe-select');
  if (sel) sel.innerHTML = html;
}

// 전역 ingIndex(ING_DB+customIngs)를 기본으로 하되, 레시피 B의 customIngs 중 전역에 없는
// 이름만 로컬로 얹는다 — rebuildIngIndex()를 다시 불러 전역 customIngs를 바꾸면 "현재"
// 배합(A)의 커스텀 원료 상태까지 바뀌어버리므로, 여기서는 로컬 Map만 만들어 쓴다.
function buildCompareIngMap(recipeCustomIngs) {
  const map = new Map(ingIndex);
  if (Array.isArray(recipeCustomIngs)) {
    for (const ing of recipeCustomIngs) {
      if (ing && !map.has(ing[0])) map.set(ing[0], ing);
    }
  }
  return map;
}

async function onCompareRecipeSelect(name) {
  if (!name || name === '__none__' || !recipeDirHandle) {
    compareRecipeB = null;
    renderCompareTab();
    return;
  }
  try {
    const fh = await recipeDirHandle.getFileHandle(name);
    const file = await fh.getFile();
    const data = JSON.parse(await file.text());
    const species = data.species || '개';
    const stdTable = species === '고양이' ? STANDARDS_CAT : STANDARDS;
    const ingMap = buildCompareIngMap(data.customIngs);
    const result = calcNutrition(data.rows || [], data.ptype, data.vitk || 0, data.amino, species, ingMap, stdTable);
    compareRecipeB = { name: name.replace(/\.json$/i, ''), result };
  } catch (e) {
    alert('비교할 레시피를 불러올 수 없습니다: ' + e.message);
    compareRecipeB = null;
  }
  renderCompareTab();
}

// 표시 자릿수는 공용 fmtByUnit()(js/utils.js)를 그대로 따른다 — % 계열은 소수 1자리,
// 절대량(kcal/kg 등)은 소수 0자리, 비율(Ca:P)은 소수 2자리로 다른 탭(영양 분석·기준 검증)과
// 동일하게 맞춘다. 값 자체(compareDeltaPct)는 건드리지 않고 표시 형식만 unit 기반으로 통일.
function compareFmt(v, unit) {
  return fmtByUnit(v, unit);
}
function compareSignedFmt(v, unit) {
  return v == null ? '─' : (v > 0 ? '+' : '') + fmtByUnit(v, unit);
}

// 변화량(B-A)/변화율(%) 계산 — DOM에 의존하지 않는 순수 함수라 그대로 테스트할 수 있다.
// 기준값(a)이 0/null이거나 b가 없으면 변화율은 정의되지 않아 null("-")을 반환한다.
function compareDeltaPct(a, b) {
  if (a == null || b == null) return { delta: null, pct: null };
  const delta = b - a;
  const pct = a ? (delta / a * 100) : null;
  return { delta, pct };
}

function renderCompareTab() {
  const body = document.getElementById('compare-body');
  const emptyMsg = document.getElementById('compare-empty');
  const wrap = document.getElementById('compare-table-wrap');
  if (!body) return;

  const resultA = lastResult;
  if (!resultA || !compareRecipeB) {
    body.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = '';
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (emptyMsg) emptyMsg.style.display = 'none';
  if (wrap) wrap.style.display = '';

  const nameA = document.getElementById('sb-name')?.value || '현재 레시피';
  const thA = document.getElementById('compare-th-a');
  const thB = document.getElementById('compare-th-b');
  if (thA) thA.textContent = nameA + ' (A)';
  if (thB) thB.textContent = compareRecipeB.name + ' (B)';

  const dmbA = resultA.dmb, dmbB = compareRecipeB.result.dmb;
  body.innerHTML = COMPARE_ROWS.map(row => {
    const a = row.key === 'me' ? resultA.meAsis : dmbA[row.key];
    const b = row.key === 'me' ? compareRecipeB.result.meAsis : dmbB[row.key];
    const { delta, pct } = compareDeltaPct(a, b);
    const sign = n => (n > 0 ? '+' : '');
    return `<tr>
      <td class="left">${row.label}</td>
      <td class="num">${compareFmt(a, row.unit)}</td>
      <td class="num">${compareFmt(b, row.unit)}</td>
      <td class="num">${compareSignedFmt(delta, row.unit)}</td>
      <td class="num">${pct == null ? '─' : sign(pct) + fmtPctVal(pct) + '%'}</td>
      <td style="font-size:10px;color:var(--sub)">${row.unit}</td>
    </tr>`;
  }).join('');
}
