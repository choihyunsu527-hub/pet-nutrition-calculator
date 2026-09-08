// nutrition.js — calcNutrition 계산 엔진/아미노산/제품유형/기준검증/급여량. index.html에서 분리.

// ── 순수 계산 엔진(calcNutrition, 아미노산 기준 추출, 제품유형 판정, 평가정책, Ca:P 판정,
//    급여계수 상수 등 DOM 비참조 로직)은 js/nutrition-engine.js 로 분리했다.
//    index.html에서 이 파일보다 먼저 로드되며, 계산식·입출력 형식은 한 글자도 바뀌지 않았다.
//    이 파일에는 DOM/렌더링에 의존하는 UI 함수만 남긴다.
// ════════════════════════════════════════════════════════════════════════════
// 아미노산 탭
// ════════════════════════════════════════════════════════════════════════════
let aminoInputs = {};

function buildAminoGrid() {
  const species = document.getElementById('sb-species')?.value || '개';
  const isCat = species === '고양이';
  const stds = getAminoStds(species);

  // 기존 보정값 보존 (아미노산 이름은 종류와 무관하게 동일)
  const preserved = {};
  stds.forEach(std => {
    const el = document.getElementById(`amino-${std[0]}`);
    if (el && el.value) preserved[std[0]] = el.value;
  });

  const grid = document.getElementById('amino-grid');
  const hdrs = isCat
    ? ['아미노산','단위','자동계산<br>(DMB)','직접입력<br>(보정)','NRC<br>MR','AAFCO<br>성묘','AAFCO<br>성장묘','NRC<br>판정','성묘<br>판정','성장묘<br>판정']
    : ['아미노산','단위','자동계산<br>(DMB)','직접입력<br>(보정)','NRC<br>MR','AAFCO<br>성견','AAFCO<br>성장견','NRC<br>판정','성견<br>판정','성장견<br>판정'];
  grid.innerHTML = hdrs.map(h => `<div class="ag-hdr">${h}</div>`).join('');

  stds.forEach(std => {
    const [nm,unit,mr,ra,aa,aaMax,aaGr,aaRp,fed,fedGr,cat] = std;
    grid.innerHTML += `
      <div class="ag-cell left">${nm}</div>
      <div class="ag-cell" style="font-size:10px;color:var(--sub)">${unit}</div>
      <div class="ag-cell" id="amino-auto-${nm}" style="background:var(--calc);color:var(--pass-t);font-weight:bold">─</div>
      <div class="ag-cell inp" title="자동계산값 보정 시만 입력">
        <input type="number" id="amino-${nm}" value="${preserved[nm]||''}" min="0" step="0.01"
               placeholder="보정값" oninput="debouncedCalculate()">
      </div>
      <div class="ag-cell" style="font-size:10px">${mr||'─'}</div>
      <div class="ag-cell" style="font-size:10px">${aa||'─'}</div>
      <div class="ag-cell" style="font-size:10px">${aaGr||'─'}</div>
      <div class="ag-cell" id="amino-nrc-${nm}">─</div>
      <div class="ag-cell" id="amino-aa-${nm}">─</div>
      <div class="ag-cell" id="amino-gr-${nm}">─</div>
    `;
  });
}

function getAminoManual() {
  const species = document.getElementById('sb-species')?.value || '개';
  const stds = getAminoStds(species);
  const result = {};
  stds.forEach(std => {
    const nm = std[0];
    const el = document.getElementById(`amino-${nm}`);
    // 직접입력값 있으면 우선 사용, 없으면 0 (자동계산은 valMap에서 처리)
    result[nm + '_override'] = (el && el.value !== undefined) ? parseFloat(el.value)||0 : 0;
  });
  return result;
}

function updateAminoJudges(result, pc) {
  const dmb = result.dmb;
  const species = document.getElementById('sb-species')?.value || '개';
  const isCat = species === '고양이';
  const policy = getEvaluationPolicy(pc);
  renderPtypeBanner('amino-ptype-banner', pc);
  // 아미노산 기준은 최소치만 있고(최대치 없음) 판정 축이 "결핍" 하나뿐이므로 evalMinDeficiency만으로 판단.
  // 주식·보조식: 그대로 pass/fail(보조식도 부족 아미노산을 그대로 보여줘야 개선 항목을 알 수 있다).
  // 간식·직접급여불가: 완전·균형식 기준 자체를 적용하지 않는 유형이므로 "제외".
  function renderAminoCell(el, pass, tooltip) {
    if (policy.evalMinDeficiency) {
      el.textContent = pass ? '✅' : '❌';
      el.className = `ag-cell center ${pass ? 'pass' : 'fail'}`;
      el.title = tooltip;
      return;
    }
    el.textContent = '제외';
    el.className = 'ag-cell center none';
    el.title = `${tooltip} — ${pc.short} 유형으로 판단되어 아미노산 적합성 평가에서 제외됨`;
  }
  const stds = getAminoStds(species);
  // 아미노산명 → asis 인덱스 (결측 판정용). result.missingCols에 있으면 원료 데이터 없음.
  const AMINO_ASIS_COL = {
    "아르기닌(Arg)":37, "히스티딘(His)":38, "이소류신(Ile)":39, "류신(Leu)":40, "라이신(Lys)":41,
    "메티오닌+시스틴":42, "페닐알라닌+티로신":43, "트레오닌(Thr)":44, "트립토판(Trp)":45,
    "발린(Val)":46, "타우린(Tau)*":47,
  };
  const missingSet = new Set(result.missingCols || []);
  const aminoMap = {
    "아르기닌(Arg)":       dmb.arg,
    "히스티딘(His)":       dmb.his,
    "이소류신(Ile)":       dmb.ile,
    "류신(Leu)":           dmb.leu,
    "라이신(Lys)":         dmb.lys,
    "메티오닌+시스틴":     dmb.metcys,
    "페닐알라닌+티로신":   dmb.phetyr,
    "트레오닌(Thr)":       dmb.thr,
    "트립토판(Trp)":       dmb.trp,
    "발린(Val)":           dmb.val,
    "타우린(Tau)*":        dmb.tau,
  };

  stds.forEach(std => {
    const [nm,unit,mr,ra,aa,aaMax,aaGr,aaRp,fed,fedGr,cat] = std;

    // 직접입력 보정값
    const overrideEl = document.getElementById(`amino-${nm}`);
    const override = overrideEl ? parseFloat(overrideEl.value)||0 : 0;

    // 배합 원료에 이 아미노산 데이터가 결측이고 보정값도 없으면 → 자동계산값 사용 불가(결측)
    const isMissing = AMINO_ASIS_COL[nm] != null && missingSet.has(AMINO_ASIS_COL[nm]) && override <= 0;

    // 자동계산값 (% DMB)
    const autoVal = isMissing ? null : (aminoMap[nm] || 0);

    const finalVal = override > 0 ? override : autoVal;

    const autoEl = document.getElementById(`amino-auto-${nm}`);
    if (autoEl) {
      autoEl.textContent = (autoVal != null && autoVal > 0) ? autoVal.toFixed(4) : '─';
      autoEl.style.color = (autoVal != null && autoVal > 0) ? 'var(--pass-t)' : 'var(--sub)';
      autoEl.title = isMissing ? '배합 원료에 이 아미노산 데이터가 없어 자동계산 불가 — 판정 제외' : '';
    }

    // 판정 (최종값 기준)
    const nrcEl = document.getElementById(`amino-nrc-${nm}`);
    const aaEl  = document.getElementById(`amino-aa-${nm}`);
    const grEl  = document.getElementById(`amino-gr-${nm}`);

    // 결측: pass/fail 판정하지 않고 '─'(평가 제외)
    if (finalVal == null) {
      [ [nrcEl,mr], [aaEl,aa], [grEl,aaGr] ].forEach(([el,th]) => {
        if (el && th > 0) { el.textContent = '─'; el.className = 'ag-cell center none'; el.title = '원료 데이터 없음 — 판정 제외'; }
      });
      return;
    }

    if (nrcEl && mr > 0) renderAminoCell(nrcEl, finalVal >= mr, `NRC MR: ${mr}`);
    if (aaEl && aa > 0)  renderAminoCell(aaEl,  finalVal >= aa, `AAFCO ${isCat?'성묘':'성견'} Min: ${aa}`);
    if (grEl && aaGr > 0) renderAminoCell(grEl, finalVal >= aaGr, `AAFCO ${isCat?'성장묘':'성장견'} Min: ${aaGr}`);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 제한 아미노산(Limiting Amino Acid) 자동 판정
// 기존 calcNutrition()의 result.standards(및 그리드의 수동 보정값)를 그대로 재사용해
// "값 ÷ 기준" 상대 충족률만 계산하는 부가 분석. 새 아미노산 계산·판정 로직을 만들지 않음.
// ════════════════════════════════════════════════════════════════════════════

// updateAminoJudges()와 동일한 규칙: 수동 보정값이 있으면 그 값을, 없으면 자동계산값을 사용
function getAminoFinalValue(name, autoValue) {
  const overrideEl = document.getElementById(`amino-${name}`);
  const override = overrideEl ? parseFloat(overrideEl.value) || 0 : 0;
  return override > 0 ? override : autoValue;
}

// 각 아미노산마다 NRC/AAFCO/FEDIAF 중 "현재 종·생애주기에 적용 가능한" 기준들의 충족률을 모두 계산한 뒤
// 가장 엄격한(=충족률이 가장 낮게 나오는) 기준을 그 아미노산의 대표 충족률로 채택한다.
// (여러 공식 기준을 동시에 만족해야 한다는 원칙 — Liebig의 최소량 법칙과 동일한 방식)
function computeLimitingAminoAcid(result) {
  const target = document.getElementById('sb-target')?.value || '성견(성체유지)';
  const isGrowth = target === '성장견';
  const isRepro  = target === '임신·수유견';

  const rows = [];
  LIMITING_AA_LIST.forEach(name => {
    const std = result.standards.find(s => s.name === name);
    if (!std) return; // 기준 데이터 자체가 없는 아미노산은 판정 대상에서 제외
    const finalVal = getAminoFinalValue(name, std.value);
    if (finalVal == null) return; // 원료 데이터 결측(std.value === null, 보정값도 없음) → 제한 아미노산·점수 계산에서 제외

    const candidates = [];
    if (std.nrc_mr != null && std.nrc_mr > 0) {
      candidates.push({ src: 'NRC', label: 'NRC 최소요구량', threshold: std.nrc_mr });
    }
    const aafcoTh  = isGrowth ? std.aa_gr : isRepro ? std.aa_rp : std.aa_min;
    const aafcoLbl = isGrowth ? 'AAFCO 성장 최소기준' : isRepro ? 'AAFCO 임신수유 최소기준' : 'AAFCO 성체 최소기준';
    if (aafcoTh != null && aafcoTh > 0) {
      candidates.push({ src: 'AAFCO', label: aafcoLbl, threshold: aafcoTh });
    }
    const fediafTh  = (isGrowth || isRepro) ? std.fed_gr : std.fed_ad;
    const fediafLbl = (isGrowth || isRepro) ? 'FEDIAF 성장 기준' : 'FEDIAF 성체 기준';
    if (fediafTh != null && fediafTh > 0) {
      candidates.push({ src: 'FEDIAF', label: fediafLbl, threshold: fediafTh });
    }

    if (!candidates.length) return; // 적용 가능한 기준이 하나도 없으면 제외

    let binding = null;
    candidates.forEach(c => {
      const pct = finalVal / c.threshold * 100;
      if (!binding || pct < binding.pct) binding = { src: c.src, label: c.label, threshold: c.threshold, pct };
    });

    rows.push({ name, value: finalVal, unit: std.unit, ...binding });
  });

  if (!rows.length) return null; // 판정 불가

  rows.sort((a, b) => a.pct - b.pct);
  const lowest = rows[0];
  // 제한 아미노산(Limiting Amino Acid)은 기준 충족률이 100% 미만인 경우에만 "존재"한다.
  // 전부 100% 이상이면 가장 낮은 충족률이라도 제한 아미노산이 아니라 그냥 "상대적으로 가장 낮은 값"일 뿐.
  const hasLimiting = lowest.pct < 100;
  return { rows, lowest, limiting: hasLimiting ? lowest : null, hasLimiting };
}


const AMINO_100LINE_TIP = '100% 기준선 = 각 아미노산의 실제 최소 요구량(값은 서로 다름)을 각각 100%로 환산한 위치입니다. 그래서 모든 막대에서 같은 자리에 표시됩니다.';

function renderAminoLimitingCard(result) {
  const summaryEl = document.getElementById('amino-limiting-summary');
  const chartEl   = document.getElementById('amino-limiting-chart');
  const cardEl    = document.getElementById('amino-limiting-card');
  if (!summaryEl || !chartEl || !cardEl) return;

  const analysis = computeLimitingAminoAcid(result);
  if (!analysis) {
    summaryEl.innerHTML = '<b>판정 불가</b><br><span style="font-weight:400">적용 가능한 아미노산 기준 데이터가 없습니다.</span>';
    chartEl.innerHTML = '';
    cardEl.innerHTML = '';
    return;
  }

  const { rows, lowest, hasLimiting } = analysis;
  const maxPct   = Math.max(...rows.map(r => r.pct));
  const scaleMax = Math.max(150, Math.ceil((maxPct + 20) / 10) * 10);
  const linePos  = Math.min(100 / scaleMax * 100, 100);

  summaryEl.innerHTML = hasLimiting
    ? `현재 배합의 제한 아미노산은 <b style="color:var(--fail-t)">${lowest.name}</b>이며, 기준 충족률은 <b>${lowest.pct.toFixed(0)}%</b>입니다.`
    : `모든 분석 대상 필수 아미노산이 기준을 충족합니다.<br>상대적으로 가장 낮은 충족률은 <b>${lowest.name} ${lowest.pct.toFixed(0)}%</b>입니다.`;

  // LIMITING 뱃지는 실제로 기준 미달(100% 미만)인 아미노산이 있을 때만 표시 — 전부 충족 시에는 표시하지 않음
  chartEl.innerHTML = `
    <div>
      ${rows.map(r => {
        const cls = r.pct >= 100 ? 'pass' : 'fail';
        const w = Math.min(r.pct / scaleMax * 100, 100);
        const isLimiting = hasLimiting && r === lowest;
        return `
        <div class="amino-lim-bar-row">
          <div class="amino-lim-bar-toprow">
            <span class="amino-lim-bar-name">${r.name}${isLimiting ? '<span class="amino-lim-badge fail">LIMITING</span>' : ''}</span>
            <span class="amino-lim-bar-meta">${r.src} 기준 대비</span>
          </div>
          <div class="amino-lim-bar-detail">현재 ${fmtAminoAmt(r.value, r.unit)} / 최소 ${fmtAminoAmt(r.threshold, r.unit)} · 충족률 ${r.pct.toFixed(0)}%</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="amino-lim-bar-track">
              <div class="amino-lim-bar-fill ${cls}" style="width:${w}%"></div>
              <div class="amino-lim-100line" style="left:${linePos}%" title="${AMINO_100LINE_TIP}"></div>
            </div>
            <span class="amino-lim-bar-pct" style="color:var(--${cls}-t)">${r.pct.toFixed(0)}%</span>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="amino-lim-100caption" title="${AMINO_100LINE_TIP}">┊ 100% 기준선 = 각 아미노산의 최소 요구량(값은 아미노산마다 다름)</div>
  `;

  cardEl.innerHTML = hasLimiting ? `
    <div class="amino-lim-card">
      <div class="lbl">LIMITING AMINO ACID</div>
      <div class="name" style="color:var(--fail-t)">🔴 ${lowest.name}</div>
      <div class="meta">기준 충족률 <b style="color:var(--fail-t)">${lowest.pct.toFixed(0)}%</b> · ${lowest.src}(${lowest.label}) 대비</div>
      <div class="note">현재 배합에서 기준 대비 상대적으로 가장 부족한 필수 아미노산입니다.</div>
    </div>
  ` : `
    <div class="amino-lim-card">
      <div class="lbl">LIMITING AMINO ACID</div>
      <div class="name" style="color:var(--sub)">없음</div>
      <div class="meta">모든 분석 대상 필수 아미노산이 기준을 충족합니다.</div>
      <div class="note">상대적으로 가장 낮은 충족률: <b>${lowest.name} ${lowest.pct.toFixed(0)}%</b></div>
    </div>
  `;
}

// 원료별 아미노산 기여도 히트맵 + 최저 아미노산 충족률 — 위 두 기능(computeContribAnalysis, computeLimitingAminoAcid)을
// 그대로 재사용만 함(새 계산 없음). asis 인덱스는 calcNutrition() 주석과 동일: ing[idx+1] === asis[idx]
const AMINO_CONTRIB_DEFS = [
  { key:'arg',    label:'아르기닌(Arg)',     unit:'g',  asisIdx:ING_IDX.ARG,     get: ing => ing[ING_ARR_COL.ARG]     || 0 },
  { key:'his',    label:'히스티딘(His)',     unit:'g',  asisIdx:ING_IDX.HIS,     get: ing => ing[ING_ARR_COL.HIS]     || 0 },
  { key:'ile',    label:'이소류신(Ile)',     unit:'g',  asisIdx:ING_IDX.ILE,     get: ing => ing[ING_ARR_COL.ILE]     || 0 },
  { key:'leu',    label:'류신(Leu)',         unit:'g',  asisIdx:ING_IDX.LEU,     get: ing => ing[ING_ARR_COL.LEU]     || 0 },
  { key:'lys',    label:'라이신(Lys)',       unit:'g',  asisIdx:ING_IDX.LYS,     get: ing => ing[ING_ARR_COL.LYS]     || 0 },
  { key:'metcys', label:'메티오닌+시스틴',   unit:'g',  asisIdx:ING_IDX.MET_CYS, get: ing => ing[ING_ARR_COL.MET_CYS] || 0 },
  { key:'phetyr', label:'페닐알라닌+티로신', unit:'g',  asisIdx:ING_IDX.PHE_TYR, get: ing => ing[ING_ARR_COL.PHE_TYR] || 0 },
  { key:'thr',    label:'트레오닌(Thr)',     unit:'g',  asisIdx:ING_IDX.THR,     get: ing => ing[ING_ARR_COL.THR]     || 0 },
  { key:'trp',    label:'트립토판(Trp)',     unit:'g',  asisIdx:ING_IDX.TRP,     get: ing => ing[ING_ARR_COL.TRP]     || 0 },
  { key:'val',    label:'발린(Val)',         unit:'g',  asisIdx:ING_IDX.VAL,     get: ing => ing[ING_ARR_COL.VAL]     || 0 },
  { key:'tau',    label:'타우린(Tau)*',      unit:'mg', asisIdx:ING_IDX.TAURINE, get: ing => ing[ING_ARR_COL.TAURINE] || 0 },
];

let lastAminoContribAnalysis = null;

function renderAminoContribHeatmap(result, rows) {
  const wrap = document.getElementById('amino-contrib-heatmap');
  if (!wrap) return;
  const hasRows = rows.some(([nm, ratio]) => nm && ratio > 0 && getIng(nm));
  if (!hasRows) {
    lastAminoContribAnalysis = null;
    wrap.innerHTML = '<div class="ana-contrib-empty">배합 설계 탭에서 원료와 배합비를 입력하면<br>원료별 아미노산 기여도가 표시됩니다.</div>';
    return;
  }
  lastAminoContribAnalysis = computeContribAnalysis(result, rows, AMINO_CONTRIB_DEFS);
  renderContribHeatmapInto('amino-contrib-heatmap', lastAminoContribAnalysis, AMINO_CONTRIB_DEFS, null);
}

// 아미노산 스코어 = 제한 아미노산(가장 낮은 상대 충족률)의 충족률. computeLimitingAminoAcid()가 이미 계산한 값을
// 그대로 재사용하는 것으로, 별도의 새로운 판정식을 만들지 않음(전형적인 Amino Acid Score/Chemical Score 산출 방식과 동일).
// 이 카드는 "제한 아미노산 존재 여부"와 무관하게, 필수 아미노산 중 상대적으로 가장 낮은 충족률을 그대로 보여주는
// 지표다. 값이 100%를 넘을 수도 있으므로(예: 693%) 0~100점짜리 "스코어"가 아니라 "최저 아미노산 충족률"이라는
// 명칭이 실제 계산 내용과 정확히 일치한다.
function renderAminoScoreCard(result) {
  const el = document.getElementById('amino-score-card');
  if (!el) return;

  const analysis = computeLimitingAminoAcid(result);
  if (!analysis) {
    el.innerHTML = `
      <div class="lbl">최저 아미노산 충족률</div>
      <div class="meta">판정 불가 — 적용 가능한 아미노산 기준 데이터가 없습니다.</div>
    `;
    return;
  }

  const { lowest, hasLimiting } = analysis;
  const pct = Math.round(lowest.pct);
  const cls = hasLimiting ? 'fail' : 'pass';
  el.innerHTML = `
    <div class="lbl">최저 아미노산 충족률</div>
    <div style="display:flex;align-items:baseline;gap:8px">
      <span class="name" style="font-size:28px;color:var(--${cls}-t)">${pct}%</span>
      <span class="meta" style="margin-top:0">${lowest.name} · ${lowest.src}(${lowest.label}) 대비</span>
    </div>
    <div class="note">필수 아미노산 중 기준 대비 상대 충족률이 가장 낮은 값입니다. 100% 미만일 때만 "제한 아미노산"이 존재합니다.</div>
  `;
}

// ════════════════════════════════════════════════════════════════════════════
// 제품 유형 자동 판정 (주식 / 보조식·보충식 / 간식)
// AAFCO 완전·균형식 기준은 본래 "주식"에만 적용되는 기준인데, 간식·보조식 제품에도
// 같은 잣대를 그대로 적용하면 정상적인 제품이 "결핍/위험"으로 오판정된다.
// result.standards 안의 "AAFCO 최소기준이 존재하는 모든 필수 영양소"를 대상으로
//   (1) 완전성 — 필수 영양소 데이터가 얼마나 채워져 있는지
//   (2) 충족률 — 채워진 값들이 AAFCO 최소기준을 얼마나 충족하는지
// 두 지표를 함께 봐서 제품 유형을 추정한다(단백질 등 단일 항목만 보지 않음).
// 이 판정은 법적/규제적 제품 분류가 아니라 "영양학적 분석에 기반한 추천"이다.
// ════════════════════════════════════════════════════════════════════════════
let lastProductClass = null;



// ════════════════════════════════════════════════════════════════════════════
// 제품 유형별 "평가 정책" — 영양소 계산식·AAFCO/NRC 기준 데이터는 그대로 두고,
// "그 계산 결과를 결핍/과다 경고로 얼마나 적용할지"만 제품 유형(pc.type)에 따라 바꾼다.
// 4개 제품 유형 → 4개 평가 모드로 1:1 매핑하며, 모든 화면(영양분석/경고패널/아미노산/대시보드)이
// 이 한 곳의 정책만 참조하도록 해서 판정 분기 로직이 여러 함수에 중복되지 않게 한다.
//   - evalMinDeficiency: AAFCO/NRC 최소 기준 미달을 "결핍 경고"로 평가할지
//   - evalMaxExcess:     AAFCO 최대 기준 초과를 "과다·안전성 경고"로 평가할지
//   - showCompleteness:  완전·균형식 여부(핵심 지표)를 표시할지 — 주식만 true
//   - hideStandardsTable: AAFCO/NRC/FEDIAF 기준 비교 자체를 화면에서 숨기고 원료구성·칼로리·기본
//     영양성분만 보여줄지 — 간식만 true (결핍·초과 판정 자체가 성립하지 않는 유형)
// ════════════════════════════════════════════════════════════════════════════





// 대시보드 상단 "제품 유형 분석" 카드
function renderProductTypeCard(pc) {
  const card = document.getElementById('ptype-card');
  if (!card) return;

  if (!pc || !pc.type) {
    card.className = 'ptype-card';
    card.innerHTML = `
      <div class="ptype-card-header">
        <div class="ptype-card-label">제품 유형 분석</div>
      </div>
      <div class="ptype-card-type" style="color:var(--sub)">배합비를 입력하면 자동으로 분석됩니다</div>
      <div class="ptype-card-desc">배합 설계 탭에서 원료와 배합비를 입력하면, 영양성분을 분석해 주식 / 보조식·보충식 / 간식 / 직접 급여 불가 중 가장 적합한 제품 유형을 자동으로 추천합니다.</div>
      <span class="dash-stat-link" onclick="goTab('std-verify')">기준 검증 상세 보기 →</span>`;
    return;
  }

  card.className = 'ptype-card';
  card.innerHTML = `
    <div class="ptype-card-header">
      <div class="ptype-card-label">제품 유형 분석</div>
      <div class="ptype-card-side">
        <span class="ptype-confidence conf-${pc.confidence}">${pc.confidenceLabel}</span>
        <button class="ptype-evidence-btn" onclick="openPtypeEvidence()">판정 근거 보기</button>
      </div>
    </div>
    <div class="ptype-card-type">${pc.label}</div>
    <div class="ptype-card-type-en">${pc.en}</div>
    <div class="ptype-card-desc">${pc.desc}</div>
    <div class="ptype-card-stats">
      <span class="ptype-card-stat">평가 기준<b>${pc.evaluationPolicy ? pc.evaluationPolicy.summary.replace('평가 기준: ','') : '─'}</b></span>
      <span class="ptype-card-stat">AAFCO 최소기준 충족률<b>${Math.round(pc.minPassRate * 100)}%</b></span>
      <span class="ptype-card-stat">필수 영양소 충족<b>${pc.metMinCount} / ${pc.withDataCount}</b></span>
      <span class="ptype-card-stat">입력 데이터 완전성<b>${Math.round(pc.completeness * 100)}%</b></span>
    </div>
    ${pc.type === 'unsuitable' ? `<div style="margin-top:14px;padding:8px 10px;border-radius:6px;border-left:3px solid var(--fail-t);background:var(--gray-l);color:var(--text);font-size:11px;font-weight:600;line-height:1.5"><span style="color:var(--fail-t);display:inline-flex;vertical-align:-2px">${svgIcon('warning', 12)}</span> 직접 급여용 제품이 아닌 배합용 원료로 판단됩니다. 실제 제품에 사용할 경우 적정 배합비와 안전 사용량을 별도로 확인해야 합니다.</div>` : ''}
    <span class="dash-stat-link" onclick="goTab('std-verify')">기준 검증 상세 보기 →</span>`;
}

function openPtypeEvidence() {
  const pc = lastProductClass;
  const body = document.getElementById('ptype-evidence-body');
  if (!pc || !pc.type) {
    body.innerHTML = `<div class="ptype-evidence-section">배합 설계 탭에서 원료와 배합비를 입력하면 판정 근거가 표시됩니다.</div>`;
  } else {
    const fmt = n => (n == null ? '─' : n.toFixed(2));
    body.innerHTML = `
      <div class="ptype-evidence-section">
        <h4>${svgIcon(pc.icon, 15)} ${pc.label} <span class="ptype-confidence conf-${pc.confidence}" style="margin-left:6px">${pc.confidenceLabel}</span></h4>
        <div style="font-size:11px;color:var(--sub)">${pc.desc}</div>
        <div style="font-size:11px;font-weight:700;color:var(--hdr);margin-top:6px">${pc.evaluationPolicy ? pc.evaluationPolicy.summary : ''}</div>
      </div>
      <div class="ptype-evidence-section">
        <h4>주요 영양소 함량</h4>
        ${pc.topNutrients.map(n => `<div class="ptype-evidence-kv"><span>${n.name}</span><b>${fmt(n.value)} ${n.unit}</b></div>`).join('')}
      </div>
      <div class="ptype-evidence-section">
        <h4>필수 영양소 충족 현황 / AAFCO 기준 대비</h4>
        <div class="ptype-evidence-kv"><span>입력된 영양성분 데이터 완전성</span><b>${pc.withDataCount} / ${pc.essentialCount}개 (${Math.round(pc.completeness*100)}%)</b></div>
        <div class="ptype-evidence-kv"><span>AAFCO 최소 기준 충족 (입력값 기준)</span><b>${pc.metMinCount} / ${pc.withDataCount}개 (${Math.round(pc.minPassRate*100)}%)</b></div>
        <div class="ptype-evidence-kv"><span>AAFCO 최대 기준 초과</span><b>${pc.overMaxItems.length}개</b></div>
      </div>
      ${pc.failItems.length ? `<div class="ptype-evidence-section"><h4>AAFCO 최소 기준 미충족 영양소 (${pc.failItems.length}개)</h4>
        <ul class="ptype-evidence-list">${pc.failItems.map(f => `<li>${f.name}: ${f.value.toFixed(3)} ${f.unit||''} (최소 ${f.min})</li>`).join('')}</ul></div>` : ''}
      ${pc.overMaxItems.length ? `<div class="ptype-evidence-section"><h4>AAFCO 최대 기준 초과 영양소 (${pc.overMaxItems.length}개)</h4>
        <ul class="ptype-evidence-list">${pc.overMaxItems.map(f => `<li>${f.name}: ${f.value.toFixed(3)} ${f.unit||''} (최대 ${f.max})</li>`).join('')}</ul></div>` : ''}
      <div class="ptype-evidence-section">
        <h4>판정에 영향을 준 주요 요인</h4>
        <ul class="ptype-evidence-list">${pc.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
      </div>
      <div style="font-size:10px;color:var(--sub)">
        ※ 이 판정은 법적·규제적 제품 분류가 아니라, 입력된 영양성분에 기반한 영양학적 분석 추천입니다.
      </div>`;
  }
  document.getElementById('ptype-evidence-modal').classList.add('open');
}

// 주식이 아닌 제품(간식/보조식)으로 분석됐을 때, 해당 탭 상단에 안내 배너를 표시/숨김
// 배합설계 탭(mix-ptype-banner)에서만 STATUS_TONE과 같은 아이콘 언어(info/alert-circle/warning)를
// 한 줄 맨 앞에 덧붙인다 — std-verify 탭 배너는 문구·표시 조건 그대로 아이콘 없이 유지.
const PTYPE_BANNER_ICON = { supplement: 'info', treat: 'alert-circle', unsuitable: 'warning' };
function renderPtypeBanner(elId, pc, message) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (isStapleClass(pc)) { el.className = 'ptype-banner'; el.innerHTML = ''; return; }
  const policy = getEvaluationPolicy(pc);
  const msg = message || policy.bannerNote || `아래 결핍·초과 판정은 "주식기준 외"로 표시됩니다.`;
  el.className = `ptype-banner show type-${pc.type}`;
  const iconHtml = elId === 'mix-ptype-banner'
    ? `<span style="display:inline-flex;flex-shrink:0">${svgIcon(PTYPE_BANNER_ICON[pc.type] || 'info', 12)}</span>`
    : '';
  el.innerHTML = `${iconHtml}<span style="flex:1;text-align:center"><b>${pc.short}</b> 유형으로 분석되어 주식(완전·균형식) AAFCO 기준을 적용하지 않았습니다. ${msg}</span>
    <span class="linkable" onclick="goTab('dash')">제품 유형 분석 보기 →</span>`;
}

// ════════════════════════════════════════════════════════════════════════════
// 기준 검증 탭 — 배합이 선택한 기준(AAFCO/NRC/사용자 등록 기준)을 충족하는지 검증
// result.standards(calcNutrition의 계산 결과, item당 현재값·NRC·AAFCO 기준이 이미 병합돼 있음)를
// 그대로 재사용하고, 여기서는 "어느 기준을 기준값으로 볼지"만 선택해 재매핑한다 — 계산 로직 중복 없음.
// 주식 판정은 gateJudge(간식·보조식 완화 정책)를 적용하지 않고 항상 실측 판정을 그대로 보여준다 —
// "이 배합이 실제로 기준을 충족하는지"를 검증하는 화면이므로, 제품 유형 완화 정책과는 별개로 동작한다.
// ════════════════════════════════════════════════════════════════════════════
let stdVerifySource = 'aafco'; // 'aafco' | 'nrc' | 'custom'
let stdVerifyCustomId = null;

function loadCustomStandards() {
  try { return JSON.parse(localStorage.getItem('feedcalc_v4_custom_standards') || '[]'); }
  catch { return []; }
}
function saveCustomStandardsToStorage() {
  localStorage.setItem('feedcalc_v4_custom_standards', JSON.stringify(customStandards));
}
let customStandards = loadCustomStandards();

// 아이콘은 ana-table 등 다른 판정 표와 같은 STATUS_TONE 세트(check/x/warning)를 재사용 —
// 이모지 대신 svgIcon으로 통일(문구·색상 판정 로직은 그대로 유지)
const STDV_LABEL = { pass:`${svgIcon('check', 10)} 충족`, fail:`${svgIcon('x', 10)} 부족`, over:`${svgIcon('warning', 10)} 초과`, '─':'─' };
function stdvJClass(j) { return j==='pass'?'pass':j==='fail'?'fail':j==='over'?'over':''; }


// 선택된 기준(source)에 따라 한 영양소 행의 {min,max,j}를 반환 — AAFCO/NRC는 calcNutrition이 이미
// 계산해둔 판정을 그대로 쓰고, 사용자 등록 기준만 judgeGeneric()으로 즉석 계산한다.
function stdVerifyRowStd(s) {
  // NRC의 RA(권장섭취량)는 상한섭취량이 아니므로 max(상한)로 취급하지 않는다 — 참고값(ref)으로만 전달.
  if (stdVerifySource === 'nrc') return { min: s.nrc_mr, max: null, ref: s.nrc_ra, j: s.nrc_j };
  if (stdVerifySource === 'custom') {
    const std = customStandards.find(c => c.id === stdVerifyCustomId);
    const entry = std ? std.values[s.name] : null;
    if (!entry) return { min: null, max: null, ref: null, j: '─' };
    return { min: entry.min, max: entry.max, ref: null, j: judgeGeneric(s.value, entry.min, entry.max) };
  }
  return { min: s.aa_min, max: s.aa_max, ref: null, j: s.aafco_j };
}

function setStdVerifySource(src) {
  stdVerifySource = src;
  if (src === 'custom' && !stdVerifyCustomId && customStandards.length) stdVerifyCustomId = customStandards[0].id;
  renderStdVerify(lastResult, lastProductClass);
}
function setStdVerifyCustomId(id) {
  stdVerifyCustomId = id;
  renderStdVerify(lastResult, lastProductClass);
}

function renderStdVerify(result, pc) {
  const pane = document.getElementById('tab-std-verify');
  if (!pane) return;

  document.querySelectorAll('#stdverify-source .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.value === stdVerifySource));
  const customBar = document.getElementById('stdverify-custom-bar');
  customBar.style.display = stdVerifySource === 'custom' ? 'flex' : 'none';
  const sel = document.getElementById('stdverify-custom-select');
  sel.innerHTML = customStandards.length
    ? customStandards.map(c => `<option value="${escHtml(String(c.id))}" ${c.id===stdVerifyCustomId?'selected':''}>${escHtml(String(c.name))}</option>`).join('')
    : `<option value="">등록된 기준 없음</option>`;
  document.getElementById('stdverify-custom-edit-btn').disabled = !stdVerifyCustomId;
  document.getElementById('stdverify-custom-del-btn').disabled = !stdVerifyCustomId;

  // 기존 "주식기준 외" 배너를 그대로 재사용 — 별도 문구를 새로 만들지 않고, 이미 계산된
  // 제품 유형 판정(lastProductClass) 결과를 그대로 연동해 보여준다.
  renderPtypeBanner('stdverify-ptype-banner', pc);

  const tbody = document.getElementById('stdverify-body');
  const summaryEl = document.getElementById('stdverify-summary');
  const deficitEl = document.getElementById('stdverify-deficit-list');

  if (!result || !(result.totalRatio > 0)) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty-row">배합 설계 탭에서 원료를 먼저 입력하세요.</td></tr>`;
    summaryEl.innerHTML = '';
    deficitEl.innerHTML = '';
    return;
  }
  if (stdVerifySource === 'custom' && !stdVerifyCustomId) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty-row">등록된 사용자 기준이 없습니다. "＋ 새 기준 등록"으로 먼저 기준을 만드세요.</td></tr>`;
    summaryEl.innerHTML = '';
    deficitEl.innerHTML = '';
    return;
  }

  let html = ''; let curCat = '';
  let passCount = 0, failCount = 0, overCount = 0, judgedCount = 0;
  const deficits = []; const excesses = [];

  result.standards.forEach(s => {
    const { min, max, ref, j } = stdVerifyRowStd(s);
    if (s.cat !== curCat) {
      curCat = s.cat;
      html += `<tr class="cat-row"><td colspan="7">── ${s.cat} ──</td></tr>`;
    }
    const v = s.value;
    const stdText = min == null ? '─'
      : max != null ? `${min}~${max} ${s.unit}`
      : ref != null ? `${min} ${s.unit} 이상 (권장 ${ref})`
      : `${min} ${s.unit} 이상`;
    const pct = (v != null && min) ? Math.round(v / min * 100) : null;
    const pctText = pct == null ? '─' : `${pct}%`;

    if (j === 'pass') { passCount++; judgedCount++; }
    else if (j === 'fail') { failCount++; judgedCount++; deficits.push({ name: s.name, unit: s.unit, value: v, min, pct }); }
    else if (j === 'over') { overCount++; judgedCount++; excesses.push({ name: s.name, unit: s.unit, value: v, max }); }

    html += `<tr>
      <td class="left" style="font-size:10px;color:var(--sub)">${s.cat}</td>
      <td class="left">${s.name}</td>
      <td style="font-size:10px;color:var(--sub)">${s.unit}</td>
      <td class="num">${v != null ? v.toFixed(4) : '─'}</td>
      <td class="num" style="font-size:10px">${stdText}</td>
      <td class="num">${pctText}</td>
      <td class="center ${stdvJClass(j)}">${STDV_LABEL[j] || '─'}</td>
    </tr>`;
  });
  const incompleteNote = result.dataIncomplete
    ? `<tr class="cat-row"><td colspan="7">※ 일부 원료의 영양소 데이터가 없어 해당 항목은 판정에서 제외됩니다(─).</td></tr>`
    : '';
  tbody.innerHTML = incompleteNote + html;

  const stapleOk = judgedCount > 0 && failCount === 0 && overCount === 0;
  const overallPct = judgedCount ? Math.round(passCount / judgedCount * 100) : 0;
  const srcLabelRaw = stdVerifySource === 'nrc' ? 'NRC'
    : stdVerifySource === 'custom' ? ((customStandards.find(c => c.id === stdVerifyCustomId) || {}).name || '사용자 기준')
    : 'AAFCO';
  const srcLabel = escHtml(String(srcLabelRaw));

  summaryEl.innerHTML = `
    <div class="dash-kpi" style="grid-column:span 2;background:${stapleOk ? 'var(--pass-bg)' : 'var(--fail-bg)'}">
      <div class="kpi-label">주식 판정 (${srcLabel} 기준)</div>
      <div class="kpi-val" style="color:${stapleOk ? 'var(--pass-t)' : 'var(--fail-t)'}">${stapleOk ? '주식 기준 충족' : '주식 기준 미충족'}</div>
    </div>
    <div class="dash-kpi"><div class="kpi-label">전체 충족률</div><div class="kpi-val">${overallPct}%</div></div>
    <div class="dash-kpi"><div class="kpi-label">충족</div><div class="kpi-val" style="color:var(--pass-t)">${passCount}</div></div>
    <div class="dash-kpi"><div class="kpi-label">부족</div><div class="kpi-val" style="color:var(--fail-t)">${failCount}</div></div>
    <div class="dash-kpi"><div class="kpi-label">초과</div><div class="kpi-val" style="color:var(--fail-t)">${overCount}</div></div>
  `;

  if (!deficits.length && !excesses.length) {
    deficitEl.innerHTML = `<div style="text-align:center;color:var(--pass-t);padding:24px;font-weight:600;font-size:11px">${svgIcon('check', 12)} 선택한 기준의 모든 항목을 충족합니다.</div>`;
  } else {
    let dHtml = '';
    if (deficits.length) {
      dHtml += `<div class="stdverify-deficit-group-label" style="color:var(--fail-t)">부족 영양소 — 배합 수정 필요</div>`;
      dHtml += deficits.map(d => `
        <div class="stdverify-deficit-item fail">
          <span class="stdverify-deficit-name">${d.name}</span>
          <span class="stdverify-deficit-detail">현재 ${d.value != null ? d.value.toFixed(4) : '─'} ${d.unit} · 기준 ${d.min} ${d.unit} · 부족률 ${d.pct != null ? (100 - d.pct) : '─'}%</span>
        </div>`).join('');
    }
    if (excesses.length) {
      dHtml += `<div class="stdverify-deficit-group-label" style="color:var(--warn-t)">초과 영양소 — 안전성 확인 필요</div>`;
      dHtml += excesses.map(d => `
        <div class="stdverify-deficit-item over">
          <span class="stdverify-deficit-name">${d.name}</span>
          <span class="stdverify-deficit-detail">현재 ${d.value != null ? d.value.toFixed(4) : '─'} ${d.unit} · 기준 최대 ${d.max} ${d.unit}</span>
        </div>`).join('');
    }
    deficitEl.innerHTML = dHtml;
  }
}

// 향후 확장을 고려해 사용자 등록 기준도 영양기준 DB(STANDARDS/STANDARDS_CAT)와 같은 영양소 목록·순서를
// 그대로 따른다 — 새 기준 등록 모달은 이 목록을 그대로 순회하며 항목별 최소/최대 입력칸만 만든다.
function openStdVerifyCustomModal(edit) {
  const modal = document.getElementById('stdverify-custom-modal');
  const editId = edit ? stdVerifyCustomId : null;
  modal.dataset.editId = editId || '';
  const std = editId ? customStandards.find(c => c.id === editId) : null;
  document.getElementById('stdverify-custom-modal-title').textContent = std ? `기준 편집: ${std.name}` : '＋ 새 기준 등록';
  document.getElementById('stdverify-custom-name').value = std ? std.name : '';

  const isCat = (document.getElementById('sb-species')?.value || '개') === '고양이';
  const STD = isCat ? STANDARDS_CAT : STANDARDS;
  let curCat = '';
  document.getElementById('stdverify-custom-body-rows').innerHTML = STD.map((row, i) => {
    const [nm, unit, , , , , , , , , cat] = row;
    const entry = std ? std.values[nm] : null;
    let catRow = '';
    if (cat !== curCat) { curCat = cat; catRow = `<div class="stdverify-cust-cat">── ${cat} ──</div>`; }
    // 최소/최대는 항상 숫자여야 한다 — 손상·오염된 localStorage 값이 value 속성을 벗어나
    // 마크업으로 해석되지 않도록 유한한 숫자일 때만 그대로 넣는다(정상 데이터엔 영향 없음).
    const minV = entry && Number.isFinite(Number(entry.min)) && entry.min != null ? Number(entry.min) : '';
    const maxV = entry && Number.isFinite(Number(entry.max)) && entry.max != null ? Number(entry.max) : '';
    return `${catRow}<div class="stdverify-cust-row">
      <span>${nm} <span style="color:var(--sub);font-weight:400">[${unit}]</span></span>
      <input type="number" step="0.0001" placeholder="최소" id="stdverify-cust-min-${i}" value="${minV}">
      <input type="number" step="0.0001" placeholder="최대(선택)" id="stdverify-cust-max-${i}" value="${maxV}">
    </div>`;
  }).join('');
  modal.classList.add('open');
}

function saveStdVerifyCustomStandard() {
  const name = document.getElementById('stdverify-custom-name').value.trim();
  if (!name) { alert('기준 이름을 입력하세요.'); return; }

  const isCat = (document.getElementById('sb-species')?.value || '개') === '고양이';
  const STD = isCat ? STANDARDS_CAT : STANDARDS;
  const values = {};
  STD.forEach((row, i) => {
    const nm = row[0];
    const minEl = document.getElementById(`stdverify-cust-min-${i}`);
    const maxEl = document.getElementById(`stdverify-cust-max-${i}`);
    const min = minEl && minEl.value !== '' ? parseFloat(minEl.value) : null;
    const max = maxEl && maxEl.value !== '' ? parseFloat(maxEl.value) : null;
    if (min != null || max != null) values[nm] = { min, max };
  });
  if (Object.keys(values).length === 0) { alert('최소 1개 이상 영양소에 기준값을 입력하세요.'); return; }

  const editId = document.getElementById('stdverify-custom-modal').dataset.editId || null;
  if (editId) {
    const std = customStandards.find(c => c.id === editId);
    if (std) { std.name = name; std.values = values; }
  } else {
    const id = 'cust_' + Date.now();
    customStandards.push({ id, name, values });
    stdVerifyCustomId = id;
  }
  saveCustomStandardsToStorage();
  stdVerifySource = 'custom';
  closeModal('stdverify-custom-modal');
  renderStdVerify(lastResult, lastProductClass);
}

function deleteStdVerifyCustomStandard() {
  if (!stdVerifyCustomId) return;
  const std = customStandards.find(c => c.id === stdVerifyCustomId);
  if (!std) return;
  if (!confirm(`'${std.name}' 기준을 삭제하시겠습니까?`)) return;
  customStandards = customStandards.filter(c => c.id !== stdVerifyCustomId);
  saveCustomStandardsToStorage();
  stdVerifyCustomId = customStandards.length ? customStandards[0].id : null;
  renderStdVerify(lastResult, lastProductClass);
}

// ════════════════════════════════════════════════════════════════════════════
// 대시보드 탭
// ════════════════════════════════════════════════════════════════════════════
function onSpeciesChange() {
  const species = document.getElementById('sb-species').value;
  const targetSel = document.getElementById('sb-target');
  const cur = targetSel.value;
  const opts = SPECIES_TARGETS[species] || SPECIES_TARGETS['개'];
  targetSel.innerHTML = opts.map(o => `<option>${o}</option>`).join('');
  if (opts.includes(cur)) targetSel.value = cur;
  document.querySelectorAll('#fab .fab-item[data-species]').forEach(b => {
    b.classList.toggle('active', b.dataset.species === species);
  });
  syncSegmentedControls();
  updateAnaTableHeaders();
  buildAminoGrid();
  buildStdTable();
  calculate();
}

function updateAnaTableHeaders() {
  const isCat = (document.getElementById('sb-species')?.value || '개') === '고양이';
  document.getElementById('ana-th-adult').innerHTML  = isCat
    ? '성묘<br><span style="font-size:9px;font-weight:normal">성체유지</span>'
    : '성견<br><span style="font-size:9px;font-weight:normal">성체유지</span>';
  document.getElementById('ana-th-growth').innerHTML = isCat
    ? '성장묘<br><span style="font-size:9px;font-weight:normal">자묘</span>'
    : '성장견<br><span style="font-size:9px;font-weight:normal">퍼피</span>';
  document.getElementById('ana-th-repro').innerHTML  = isCat
    ? '임신·<br><span style="font-size:9px;font-weight:normal">수유묘</span>'
    : '임신·<br><span style="font-size:9px;font-weight:normal">수유견</span>';
  document.getElementById('ana-th-fediaf').innerHTML = isCat
    ? '성묘<br><span style="font-size:9px;font-weight:normal">FEDIAF</span>'
    : '성견<br><span style="font-size:9px;font-weight:normal">FEDIAF</span>';
}

function setSpeciesQuick(species) {
  const sel = document.getElementById('sb-species');
  if (sel.value === species) return;
  sel.value = species;
  onSpeciesChange();
  saveToStorage();
}



function computeFeedingPlan(result) {
  const bwCurrent = parseFloat(document.getElementById('sb-bw')?.value) || 0;
  const bwTarget  = parseFloat(document.getElementById('pet-target-bw')?.value) || bwCurrent;
  const target    = document.getElementById('sb-target')?.value;
  const bcs       = parseInt(document.getElementById('pet-bcs')?.value, 10) || 5;
  const activity  = document.getElementById('pet-activity')?.value || '보통';
  const weightGoal= document.getElementById('pet-weight-goal')?.value || '유지';
  const species   = document.getElementById('sb-species')?.value || '개';
  const neuter    = document.getElementById('pet-neuter')?.value || '완료';

  const useTargetWeight = shouldUseTargetWeight(weightGoal, bcs);
  const bw = (useTargetWeight && bwTarget > 0) ? bwTarget : bwCurrent;

  const baseFactor      = FEEDING_FACTOR[target] || 1.6;
  const activityMult    = ACTIVITY_MULT[activity] ?? 1.0;
  const bcsMult         = BCS_MULT[bcs] ?? 1.0;
  const neuterApplicable = NEUTER_APPLICABLE_TARGETS.has(target);
  const neuterMult      = neuterApplicable ? (NEUTER_ADULT_MULT[species]?.[neuter] ?? 1.0) : 1.0;
  const factor = baseFactor * activityMult * bcsMult * neuterMult;

  const noteEl = document.getElementById('pet-weight-basis-note');
  if (noteEl) {
    noteEl.textContent = useTargetWeight
      ? `현재 목표 체중(${bwTarget || '─'}kg) 기준으로 계산 중입니다.`
      : '';
  }

  const factorDetail = { target, activity, bcs, neuter, species, baseFactor, activityMult, bcsMult, neuterMult, neuterApplicable };

  if (!bw || bw <= 0 || !result.meAsis) {
    return { rer: 0, mer: 0, dailyG: 0, mealG: 0, factor: 0, bwUsed: 0, usedTargetWeight: false, ...factorDetail };
  }
  const rer    = 70 * Math.pow(bw, 0.75);
  const mer    = rer * factor;
  const dailyG = (mer / result.meAsis) * 1000;
  const mealG  = dailyG / 2;
  return { rer, mer, dailyG, mealG, factor, bwUsed: bw, usedTargetWeight: useTargetWeight, ...factorDetail };
}

// "계산 기준" 탭의 4개 계수표(생애주기/활동량/BCS/중성화)를 실제 계산에 쓰이는 상수 객체
// (FEEDING_FACTOR/ACTIVITY_MULT/BCS_MULT/NEUTER_ADULT_MULT)로부터 그대로 생성한다 — 표 값을 다시
// 하드코딩하면 상수가 나중에 조정될 때 문서만 낡아버리므로, 항상 실제 계산값과 일치하도록 한다.
// 현재 배합·반려동물 정보에 의존하지 않는 정적 레퍼런스이므로 calculate()가 아니라 init() 시 1회만 그린다.
function renderCalcBasisPage() {
  const mini = rows => `<table class="cb-mini-table"><tbody>${rows.map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;

  const lifeEl = document.getElementById('cb-tbl-life');
  if (lifeEl) lifeEl.innerHTML = mini(Object.entries(FEEDING_FACTOR).map(([k,v]) => [k, `× ${v.toFixed(1)}`]));

  const actEl = document.getElementById('cb-tbl-activity');
  if (actEl) actEl.innerHTML = mini(Object.entries(ACTIVITY_MULT).map(([k,v]) => [k, `× ${v.toFixed(2)}`]));

  const bcsEl = document.getElementById('cb-tbl-bcs');
  if (bcsEl) bcsEl.innerHTML = mini(Object.entries(BCS_MULT).map(([k,v]) => [`${k}단계${k==='5'?' (이상적)':''}`, `× ${v.toFixed(2)}`]));

  const neuterEl = document.getElementById('cb-tbl-neuter');
  if (neuterEl) {
    const rows = [];
    Object.entries(NEUTER_ADULT_MULT).forEach(([species, opts]) => {
      Object.entries(opts).forEach(([k,v]) => rows.push([`${species} · ${k}`, `× ${v.toFixed(2)}`]));
    });
    neuterEl.innerHTML = mini(rows);
  }
}
