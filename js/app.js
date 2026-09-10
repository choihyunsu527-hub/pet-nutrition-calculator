// app.js — 메인 계산/분석·대시보드·용어사전·에너지 분석 렌더링 + init()/부트스트랩. 마지막에 로드.

function onMixChange() { calculate(); }
const debouncedMixChange = debounce(onMixChange, 300);
const debouncedCalculate = debounce(calculate, 300);
// ════════════════════════════════════════════════════════════════════════════
// 메인 계산
// ════════════════════════════════════════════════════════════════════════════
let lastResult = null;
let lastWarnItems = []; // updateWarnPanel()이 채움 — 대시보드의 경고 항목 타일/요약 카드가 재사용

// 배합비/총 배치량/단위 중 무엇이 바뀌든 항상 이 함수 하나로 들어와서 화면 전체(배합표·영양성분·
// 아미노산·AAFCO/NRC 판정·경고 패널·대시보드·차트 등)를 다시 그린다 — 개별 값이 바뀔 때마다
// 부분적으로만 갱신하는 별도 로직을 만들지 않는다.
function calculate() {
  // g/kg 모드에서는 총 배치량을 원료 중량 합계로 먼저 맞춘 뒤 계산해야, 이후 getMixRows()가
  // 정확한 %로 환산한다(% 모드에서는 총 배치량이 사용자가 정하는 기준값이라 그대로 둔다).
  syncTotalGFromRows();
  const rows     = getMixRows();
  const ptype    = document.getElementById('sb-ptype').value;
  const species  = document.getElementById('sb-species')?.value || '개';
  const vitk     = parseFloat(document.getElementById('vitk-inp')?.value) || 0;
  const amino    = getAminoManual();
  // 계산 엔진에 필요한 외부 의존성(원료 조회·종별 기준표)을 명시적으로 전달한다.
  const stdTable = species === '고양이' ? STANDARDS_CAT : STANDARDS;
  const result   = calcNutrition(rows, ptype, vitk, amino, species, ingIndex, stdTable);
  lastResult = result;
  // 수분함량(%)은 더 이상 수동 입력값이 아니라 배합 원료 기준으로 자동 계산된 값 — 표시만 동기화
  document.getElementById('sb-moist').value = result.dmb.moist.toFixed(1);
  const productClass = applyManualPtypeOverride(classifyProductPurpose(result, rows), ptype);
  lastProductClass = productClass;

  updateMixRowVals(rows);
  updateMixAllergyWarnings();
  updateTotBar(result, rows);
  updateCards(result, productClass);
  updateAnaTable(result, productClass);
  renderStdVerify(result, productClass);
  updateWarnPanel(result, productClass);
  updateAminoJudges(result, productClass);
  renderAminoLimitingCard(result);
  renderAminoContribHeatmap(result, rows);
  renderAminoScoreCard(result);
  updateDashboard(result, productClass);
  renderEnergyAnalysis(result, productClass);
  renderAnaContribPanel(result, rows);
  saveToStorage();
  syncPanelWidths();
  recordUndoSnapshot();
  chDetectRecipeChanges();
}

function syncPanelWidths() {
  [
    ['ana-table', ['ana-cards', 'ana-legend']],
    ['warn-table', ['cap-card', 'warn-info-line']],
  ].forEach(([tableId, elIds]) => {
    const table = document.getElementById(tableId);
    if (!table || !table.offsetWidth) return;
    const w = table.offsetWidth;
    elIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.maxWidth = w + 'px';
      el.style.marginLeft = 'auto';
      el.style.marginRight = 'auto';
    });
  });
}
window.addEventListener('resize', () => { if (lastResult) syncPanelWidths(); });

function updateTotBar(result, rows) {
  const unit = document.getElementById('unit-select')?.value || 'pct';
  const totalG = getMixTotalG();
  const tot = result.totalRatio;
  const bar = document.getElementById('tot-bar');
  const ratioEl = document.getElementById('tot-ratio');
  const meEl    = document.getElementById('tot-me');

  if (unit === 'g')       ratioEl.textContent = `중량 합계: ${(tot*totalG/100).toFixed(1)}g / ${totalG}g`;
  else if (unit === 'kg') ratioEl.textContent = `중량 합계: ${(tot*totalG/100/1000).toFixed(3)}kg / ${(totalG/1000)}kg`;
  else                    ratioEl.textContent = `배합비 합계: ${tot.toFixed(1)}%  (총 배치량 ${totalG.toLocaleString('ko')}g 기준 — 실제 중량 ${(tot*totalG/100).toLocaleString('ko',{maximumFractionDigits:1})}g)`;

  meEl.textContent = `ME(as-is): ${result.meAsis.toFixed(0)} kcal/kg  |  ME(DMB): ${result.meDmb.toFixed(0)} kcal/kg  |  DM%: ${(result.dmPct*100).toFixed(1)}%`;

  // 입력 오류 상태(F2·F3): 기존 실패색(빨강) 막대를 그대로 재사용해 원인을 표시하고, 아래 정상 색상 분기는 건너뛴다.
  if (result.blendError) {
    ratioEl.textContent = '⚠ ' + result.blendError;
    bar.style.background = 'var(--fail-bg)';
    bar.style.borderTopColor = 'var(--fail-t)';
    ratioEl.style.color = 'var(--fail-t)';
    return;
  }

  if (Math.abs(tot-100) < 0.01) {
    bar.style.background = 'var(--pass-bg)';
    bar.style.borderTopColor = 'var(--pass-t)';
    ratioEl.style.color = 'var(--pass-t)';
  } else if (Math.abs(tot-100) < 5) {
    bar.style.background = 'var(--warn-bg)';
    bar.style.borderTopColor = 'var(--warn-t)';
    ratioEl.style.color = 'var(--warn-t)';
  } else {
    bar.style.background = 'var(--fail-bg)';
    bar.style.borderTopColor = 'var(--fail-t)';
    ratioEl.style.color = 'var(--fail-t)';
  }
}

function updateCards(result, pc) {
  const stds = result.standards;
  const isCat = (document.getElementById('sb-species')?.value || '개') === '고양이';
  const policy = getEvaluationPolicy(pc);
  const nf = stds.filter(s => s.nrc_j==='fail' || s.nrc_j==='over').length;
  const af = stds.filter(s => s.aafco_j==='fail').length;
  const ff = stds.filter(s => s.fediaf_j==='fail').length;

  document.getElementById('c-me-asis').textContent = result.meAsis.toLocaleString('ko',{maximumFractionDigits:0});
  document.getElementById('c-me-dmb').textContent  = result.meDmb.toLocaleString('ko',{maximumFractionDigits:0});
  document.getElementById('c-dm').textContent      = (result.dmPct*100).toFixed(1)+'%';
  document.getElementById('c-tot').textContent     = result.totalRatio.toFixed(1)+'%';
  // 배합비(%)만으로는 실제 배치 크기를 알 수 없으므로 총 배치량(g)도 함께 보여준다.
  document.getElementById('c-tot-g').textContent   = getMixTotalG().toLocaleString('ko') + ' g';

  // 카드 값(아이콘+문구)과 색을 함께 설정 — 이모지가 스스로 색을 갖던 것과 달리 SVG 아이콘은
  // currentColor를 쓰므로, 판정 상태에 맞는 색(--pass-t/--fail-t/--sub)을 같이 지정해야
  // 예전과 같은 정상/부족 색 구분이 유지된다(판정값 nf/af/ff/gf 자체는 미변경).
  function setJudgeCard(id, tone, html, title) {
    const el = document.getElementById(id);
    el.innerHTML = html;
    el.style.color = tone === 'pass' ? 'var(--pass-t)' : tone === 'fail' ? 'var(--fail-t)' : 'var(--sub)';
    el.title = title || '';
  }

  // 입력 오류 상태(F2·F3): 잘못된 분모로 나온 값이므로 충족/부족 개수를 표시하지 않고 "평가 제외"로 통일
  if (result.blendError) {
    setJudgeCard('c-nrc',    'gated', statusIconText('gated'), result.blendError);
    setJudgeCard('c-aafco',  'gated', statusIconText('gated'), result.blendError);
    setJudgeCard('c-fediaf', 'gated', statusIconText('gated'), result.blendError);
    return;
  }

  // 간식/직접급여불가는 결핍 평가 자체를 적용하지 않음 — 요약 카드도 "평가 제외"로 통일
  if (!policy.evalMinDeficiency) {
    const note = `주식 기준 미적용 (${pc.short} 유형)`;
    setJudgeCard('c-nrc',    'gated', statusIconText('gated'), note);
    setJudgeCard('c-aafco',  'gated', statusIconText('gated'), note);
    setJudgeCard('c-fediaf', 'gated', statusIconText('gated'), note);
    return;
  }

  const gf = stds.filter(s => s.aafco_gr_j==='fail').length;
  // 판정 개수(nf/af/ff/gf) 자체는 그대로 — 문구/아이콘/색만 STATUS_TONE 기준(정상/부족)으로 통일.
  if (policy.showCompleteness) {
    // 주식: 완전·균형식 인증
    setJudgeCard('c-nrc',    nf===0?'pass':'fail', nf===0 ? statusIconText('pass') : `${statusIconText('fail')} ${nf}개`);
    setJudgeCard('c-aafco',  af===0?'pass':'fail', af===0 ? `${statusIconText('pass')} ${isCat ? '성묘' : '성견'}` : `${statusIconText('fail')} ${af}개`,
      `${isCat ? '성장묘' : '성장견'} 미달: ${gf}개`);
    setJudgeCard('c-fediaf', ff===0?'pass':'fail', ff===0 ? statusIconText('pass') : `${statusIconText('fail')} ${ff}개`);
  } else {
    // 보조식: 완전·균형식 인증 문구는 쓰지 않고, 부족(개선 필요) 항목 개수만 안내
    setJudgeCard('c-nrc',    nf===0?'pass':'fail', nf===0 ? statusIconText('pass') : `${statusIconText('fail')} ${nf}개`,
      '보조식은 완전·균형식 판정을 적용하지 않으며, 주식 전환 시 개선이 필요한 항목만 안내합니다.');
    setJudgeCard('c-aafco',  af===0?'pass':'fail', af===0 ? statusIconText('pass') : `${statusIconText('fail')} ${af}개`,
      `${isCat ? '성장묘' : '성장견'} 미달: ${gf}개 (보조식 참고용, 완전·균형식 판정 아님)`);
    setJudgeCard('c-fediaf', ff===0?'pass':'fail', ff===0 ? statusIconText('pass') : `${statusIconText('fail')} ${ff}개`,
      '보조식 참고용 — 완전·균형식 판정 아님');
  }
}

// 판정값(pass/fail/over/gated)은 그대로, 화면 문구/아이콘만 STATUS_TONE 기준으로 통일
// ("적합/충족" → 정상, "미달/결핍" → 부족, "RA초과" 포함 모든 초과 → 초과, "주식기준 외" → 평가 제외).
const J_LABEL = {pass:statusIconText('pass'),fail:statusIconText('fail'),over:statusIconText('over'),gated:statusIconText('gated'),'─':'─'};
const J_NRC   = {pass:statusIconText('pass'),fail:statusIconText('fail'),over:statusIconText('over'),gated:statusIconText('gated'),'─':'─'};

function updateAnaTable(result, pc) {
  const tbody = document.getElementById('ana-body');
  const isCat = (document.getElementById('sb-species')?.value || '개') === '고양이';
  const policy = getEvaluationPolicy(pc);
  renderPtypeBanner('ana-ptype-banner', pc);

  const tblWrap  = document.getElementById('ana-table').closest('.tbl-wrap');
  const legend   = document.getElementById('ana-legend');
  const basicPanel = document.getElementById('ana-basic-panel');
  if (policy.hideStandardsTable) {
    if (tblWrap) tblWrap.style.display = 'none';
    if (legend)  legend.style.display  = 'none';
    basicPanel.style.display = '';
    const fmt = n => (n == null ? '─' : n.toFixed(2));
    basicPanel.innerHTML = `
      <div style="padding:10px 8px;font-size:11.5px;color:var(--sub)">${pc.short} 유형은 AAFCO/NRC/FEDIAF 영양 기준 비교를 적용하지 않습니다. 아래 원료 구성 기반 기본 영양성분만 참고하세요.</div>
      <table class="ana-basic-table"><tbody>
        ${(pc.topNutrients || []).map(n => `<tr><td class="left">${n.name}</td><td class="num">${fmt(n.value)}</td><td style="font-size:10px;color:var(--sub)">${n.unit}</td></tr>`).join('')}
      </tbody></table>`;
    return;
  }
  if (tblWrap) tblWrap.style.display = '';
  if (legend)  legend.style.display  = '';
  basicPanel.style.display = 'none';
  basicPanel.innerHTML = '';

  let html = ''; let curCat = '';

  const JN  = J_NRC;
  const JA  = J_LABEL;

  function jClass(j) {
    return j==='pass'?'pass':j==='fail'?'fail':j==='over'?'over':j==='gated'?'none':'';
  }

  // 이 표는 hideStandardsTable(간식)이면 위에서 이미 return되어 여기까지 오지 않는다. 남는 경우는
  // 주식(그대로 평가)·보조식(그대로 평가, 완전균형식 인증만 카드에서 생략)·직접급여불가(결핍·초과 모두
  // 미평가)뿐이므로 gate()는 사실상 직접급여불가에서만 'gated'를 반환한다 — 자세한 규칙은 gateJudge() 참고.
  function gate(j) { return gateJudge(j, policy); }

  function tooltip(label, min, max, origJ, gatedJ) {
    let tip = label;
    if (min) tip += ` Min:${min}`;
    if (max) tip += ` Max:${max}`;
    if (gatedJ === 'gated') {
      tip += origJ === 'fail'
        ? ` — 완전·균형식 결핍 판정 미적용(${pc.short} 유형으로 분석됨)`
        : ` — 평가 제외(${pc.short} 유형으로 분석됨)`;
    }
    return tip;
  }

  result.standards.forEach((s,i) => {
    if (s.cat !== curCat) {
      curCat = s.cat;
      html += `<tr class="cat-row"><td colspan="13">── ${s.cat} ──</td></tr>`;
    }
    const v   = s.value;
    const vs  = v != null ? v.toFixed(4) : '─';
    const nj  = gate(s.nrc_j);
    const aj  = gate(s.aafco_j);
    const gj  = gate(s.aafco_gr_j);
    const rj  = gate(s.aafco_rp_j);
    const fj  = gate(s.fediaf_j);
    const rowBg = aj==='fail'?'fail':aj==='over'?'over':aj==='pass'?'pass':'';
    // 행의 "한눈 상태" — 핵심 판정(AAFCO 성견)이 부족/초과일 때만 표시용 클래스(CSS에서 강조).
    // 판정값(aj) 자체는 기존 gate() 결과 그대로, 여기서는 클래스명만 매핑한다.
    const rowStatus = aj==='fail' ? 'ana-row-fail' : aj==='over' ? 'ana-row-over' : '';

    html += `<tr class="${rowStatus}">
      <td class="left" style="font-size:10px;color:var(--sub)">${s.cat}</td>
      <td class="left">${s.name}</td>
      <td style="font-size:10px;color:var(--sub)">${s.unit}</td>
      <td class="num ${rowBg}">${vs}</td>
      <td class="num" style="background:var(--nrc-bg);font-size:10px">${s.nrc_mr??'─'}</td>
      <td class="num" style="background:var(--nrc-bg);font-size:10px">${s.nrc_ra??'─'}</td>
      <td class="center ${jClass(nj)}" title="${tooltip('NRC',s.nrc_mr,s.nrc_ra,s.nrc_j,nj)}" style="background:var(--nrc-bg)">${JN[nj]||'─'}</td>
      <td class="num" style="background:var(--aa-bg);font-size:10px">${s.aa_min??'─'}</td>
      <td class="num" style="background:var(--aa-bg);font-size:10px">${s.aa_max??'─'}</td>
      <td class="center ${jClass(aj)}" title="${tooltip(isCat?'AAFCO 성묘':'AAFCO 성견',s.aa_min,s.aa_max,s.aafco_j,aj)}" style="background:var(--aa-bg)">${JA[aj]||'─'}</td>
      <td class="center ${jClass(gj)}" title="${tooltip(isCat?'AAFCO 성장묘':'AAFCO 성장견',s.aa_gr,null,s.aafco_gr_j,gj)}" style="background:var(--aa-bg)">${JA[gj]||'─'}</td>
      <td class="center ${jClass(rj)}" title="${tooltip('AAFCO 임신수유',s.aa_rp,null,s.aafco_rp_j,rj)}" style="background:var(--aa-bg)">${JA[rj]||'─'}</td>
      <td class="center ${jClass(fj)}" title="${tooltip('FEDIAF',s.fed_ad,null,s.fediaf_j,fj)}" style="background:var(--fed-bg)">${JA[fj]||'─'}</td>
    </tr>`;
  });
  const incompleteNote = result.dataIncomplete
    ? `<tr class="cat-row"><td colspan="13">※ 일부 원료의 영양소 데이터가 없어 해당 항목은 판정에서 제외됩니다(값 · 판정 모두 ─).</td></tr>`
    : '';
  tbody.innerHTML = incompleteNote + html;
}

// ════════════════════════════════════════════════════════════════════════════
// 영양 분석 탭 — 원료별 영양소 기여도 분석 (Ingredient Nutrient Contribution)
// 기존 calcNutrition()의 계산 결과(result.asis)를 그대로 재사용해 분해만 하는 부가 분석 기능.
// 배합 계산·판정 로직(calcNutrition/updateAnaTable/updateWarnPanel 등)은 전혀 건드리지 않음.
// ════════════════════════════════════════════════════════════════════════════
// asis 인덱스는 calcNutrition()의 주석과 동일: ing[idx+1] === asis[idx]
const CONTRIB_NUTRIENTS = [
  { key:'protein', label:'단백질',     unit:'g',  asisIdx:ING_IDX.PROTEIN, get: ing => ing[ING_ARR_COL.PROTEIN] || 0 },
  { key:'fat',     label:'지방',       unit:'g',  asisIdx:ING_IDX.FAT,     get: ing => ing[ING_ARR_COL.FAT]     || 0 },
  { key:'carb',    label:'탄수화물',   unit:'g',  asisIdx:ING_IDX.CARB,    get: ing => ing[ING_ARR_COL.CARB]    || 0 },
  { key:'ca',      label:'칼슘',       unit:'mg', asisIdx:ING_IDX.CA,      get: ing => ing[ING_ARR_COL.CA]      || 0 },
  { key:'p',       label:'인',         unit:'mg', asisIdx:ING_IDX.P,       get: ing => ing[ING_ARR_COL.P]       || 0 },
  { key:'na',      label:'나트륨',     unit:'mg', asisIdx:ING_IDX.NA,      get: ing => ing[ING_ARR_COL.NA]      || 0 },
  { key:'k',       label:'칼륨',       unit:'mg', asisIdx:ING_IDX.K,       get: ing => ing[ING_ARR_COL.K]       || 0 },
  { key:'mg',      label:'마그네슘',   unit:'mg', asisIdx:ING_IDX.MG,      get: ing => ing[ING_ARR_COL.MG]      || 0 },
  { key:'fe',      label:'철',         unit:'mg', asisIdx:ING_IDX.FE,      get: ing => ing[ING_ARR_COL.FE]      || 0 },
  { key:'zn',      label:'아연',       unit:'mg', asisIdx:ING_IDX.ZN,      get: ing => ing[ING_ARR_COL.ZN]      || 0 },
  { key:'cu',      label:'구리',       unit:'mg', asisIdx:ING_IDX.CU,      get: ing => ing[ING_ARR_COL.CU]      || 0 },
  { key:'mn',      label:'망간',       unit:'mg', asisIdx:ING_IDX.MN,      get: ing => ing[ING_ARR_COL.MN]      || 0 },
  { key:'vitA',    label:'비타민 A',   unit:'IU', asisIdx:ING_IDX.VIT_A,   get: ing => ing[ING_ARR_COL.VIT_A]   || 0 },
  { key:'vitD',    label:'비타민 D',   unit:'IU', asisIdx:ING_IDX.VIT_D,   get: ing => ing[ING_ARR_COL.VIT_D]   || 0 },
  { key:'vitE',    label:'비타민 E',   unit:'mg', asisIdx:ING_IDX.VIT_E,   get: ing => ing[ING_ARR_COL.VIT_E]   || 0 },
  // ω-6는 원료DB의 리놀레산(LA)을, ω-3는 ALA+EPA+DHA 합산을 사용 — 둘 다 원료DB 실측값 그대로 조합한 것으로,
  // DB에 없는 값을 임의로 만든 것이 아님(대시보드 등 기존 화면의 EPA+DHA 합산 표기와 동일한 방식)
  { key:'omega6',  label:'ω-6',   unit:'g',  asisIdx:ING_IDX.LA, get: ing => ing[ING_ARR_COL.LA] || 0 },
  { key:'omega3',  label:'ω-3',   unit:'mg', asisIdx:null, get: ing => (ing[ING_ARR_COL.ALA]||0)*1000 + (ing[ING_ARR_COL.EPA]||0) + (ing[ING_ARR_COL.DHA]||0) },
];

let lastContribAnalysis = null;
let contribActiveNutrient = 'protein';
let contribActiveIngredient = null;

function computeContribAnalysis(result, rows, defs = CONTRIB_NUTRIENTS) {
  const activeRows = rows
    .filter(([nm, ratio]) => nm && ratio > 0 && getIng(nm))
    .sort((a, b) => b[1] - a[1]); // 배합비 내림차순 — 히트맵 등에서 안정적인 순서로 사용
  const order = activeRows.map(r => r[0]);

  const nutrients = {};
  defs.forEach(def => {
    // 원료DB의 raw 컬럼(=asis 인덱스 + 1)이 null이면 "데이터 없음"(실제 0이 아님).
    // omega3처럼 복합 asisIdx가 아닌 단일 영양소 def에만 적용한다. amount/pct 계산식은 종전 그대로.
    const rawCol = (def.key !== 'omega3' && def.asisIdx != null) ? def.asisIdx + 1 : null;
    const rawItems = activeRows.map(([nm, ratio]) => {
      const ing = getIng(nm);
      const missing = rawCol != null && ing[rawCol] == null;
      const amount = def.get(ing) * (ratio / 100); // calcNutrition의 asis[i]+=ing[i+1]*f 와 동일한 식
      return { name: nm, ratio, amount, missing };
    });
    // 총량은 기존 calcNutrition 결과(result.asis)에서 그대로 가져와 기존 표시값과 절대 어긋나지 않게 함
    const total = def.key === 'omega3'
      ? result.asis[ING_IDX.ALA] * 1000 + result.asis[ING_IDX.EPA] + result.asis[ING_IDX.DHA]
      : result.asis[def.asisIdx];
    const byName = {};
    rawItems.forEach(it => {
      it.pct = total > 0 ? (it.amount / total * 100) : 0;
      byName[it.name] = it;
    });
    const items = rawItems.slice().sort((a, b) => b.amount - a.amount);
    const anyMissing = rawItems.some(it => it.missing);
    nutrients[def.key] = { total, unit: def.unit, label: def.label, items, byName, anyMissing };
  });

  return { order, nutrients };
}

function fmtContribAmount(v, unit) {
  if (unit === 'IU') return v.toFixed(0) + ' IU';
  if (v >= 100) return v.toFixed(0) + unit;
  return v.toFixed(2) + unit;
}

function renderAnaContribPanel(result, rows) {
  const panel = document.getElementById('ana-contrib-panel');
  if (!panel) return;

  const hasRows = rows.some(([nm, ratio]) => nm && ratio > 0 && getIng(nm));
  if (!hasRows) {
    lastContribAnalysis = null;
    document.getElementById('ana-contrib-nutsel').innerHTML = '';
    document.getElementById('ana-contrib-summary').innerHTML = '';
    document.getElementById('ana-contrib-chart').innerHTML =
      '<div class="ana-contrib-empty">배합 설계 탭에서 원료와 배합비를 입력하면<br>영양소 기여도가 여기에 표시됩니다.</div>';
    document.getElementById('ana-contrib-detail').style.display = 'none';
    document.getElementById('ana-contrib-heatmap').innerHTML = '';
    return;
  }

  lastContribAnalysis = computeContribAnalysis(result, rows);
  renderContribNutSel();
  renderContribChart();
  renderContribHeatmap();
  if (contribActiveIngredient && lastContribAnalysis.order.includes(contribActiveIngredient)) {
    renderContribDetail(contribActiveIngredient);
  } else {
    contribActiveIngredient = null;
    document.getElementById('ana-contrib-detail').style.display = 'none';
  }
}

function renderContribNutSel() {
  document.getElementById('ana-contrib-nutsel').innerHTML = CONTRIB_NUTRIENTS.map(def => `
    <button class="ana-contrib-nutbtn ${def.key === contribActiveNutrient ? 'active' : ''}"
            onclick="setContribNutrient('${def.key}')">${def.label}</button>
  `).join('');
}

function setContribNutrient(key) {
  contribActiveNutrient = key;
  if (!lastContribAnalysis) return;
  renderContribNutSel();
  renderContribChart();
}

function renderContribChart() {
  const def = CONTRIB_NUTRIENTS.find(d => d.key === contribActiveNutrient);
  const data = lastContribAnalysis.nutrients[contribActiveNutrient];
  const summaryEl = document.getElementById('ana-contrib-summary');
  const chartEl = document.getElementById('ana-contrib-chart');

  if (!data || data.total <= 0 || !data.items.length) {
    summaryEl.innerHTML = `<b>${def.label}</b>을(를) 공급하는 원료가 배합에 없습니다.`;
    chartEl.innerHTML = '';
    return;
  }

  const top = data.items[0];
  summaryEl.innerHTML = top.pct > 0
    ? `<b>${def.label}</b>의 <span style="color:var(--acc)">${top.pct.toFixed(1)}%</span>는 <b>${escHtml(top.name)}</b>에서 공급됩니다.`
    : `<b>${def.label}</b> 데이터가 없는 원료로만 구성되어 있습니다.`;

  chartEl.innerHTML = data.items.map(it => `
    <div class="ana-contrib-bar-row" data-ing="${escHtml(it.name)}" onclick="showContribDetail(this.dataset.ing)" role="button" tabindex="0" aria-label="${escHtml(it.name)} 기여도 상세 보기">
      <div class="ana-contrib-bar-toprow">
        <span class="ana-contrib-bar-name">${escHtml(it.name)}</span>
        <span class="ana-contrib-bar-meta">배합비 ${it.ratio.toFixed(1)}% · ${fmtContribAmount(it.amount, def.unit)}</span>
      </div>
      <div style="display:flex;align-items:center">
        <div class="ana-contrib-bar-track">
          <div class="ana-contrib-bar-fill" style="width:${Math.min(it.pct, 100)}%"></div>
        </div>
        <span class="ana-contrib-bar-pct">${it.pct.toFixed(1)}%</span>
      </div>
    </div>
  `).join('');
}

function showContribDetail(name) {
  contribActiveIngredient = name;
  renderContribDetail(name);
}

function closeContribDetail() {
  contribActiveIngredient = null;
  document.getElementById('ana-contrib-detail').style.display = 'none';
}

function renderContribDetail(name) {
  const wrap = document.getElementById('ana-contrib-detail');
  if (!lastContribAnalysis) { wrap.style.display = 'none'; return; }
  const anyKey = CONTRIB_NUTRIENTS[0].key;
  const rowInfo = lastContribAnalysis.nutrients[anyKey].byName[name];
  if (!rowInfo) { wrap.style.display = 'none'; return; }

  const rows = CONTRIB_NUTRIENTS.map(def => {
    const item = lastContribAnalysis.nutrients[def.key].byName[name];
    return { label: def.label, pct: item ? item.pct : 0 };
  }).sort((a, b) => b.pct - a.pct);
  const top = rows[0];

  wrap.style.display = '';
  wrap.innerHTML = `
    <h4>
      <span>${escHtml(name)} <span style="font-weight:400;color:var(--sub);font-size:10px">· 배합비 ${rowInfo.ratio.toFixed(1)}%</span></span>
      <span style="cursor:pointer;color:var(--sub)" onclick="closeContribDetail()" role="button" tabindex="0" aria-label="닫기">✕</span>
    </h4>
    <div class="ana-contrib-detail-note">
      이 원료는 <b style="color:var(--acc)">${top.label}</b> 공급에 가장 크게 기여합니다 (전체 ${top.label} 공급량의 ${top.pct.toFixed(1)}%).
    </div>
    ${rows.map(r => `
      <div class="ana-contrib-detail-row ${r === top && top.pct > 0 ? 'top' : ''}">
        <span class="lbl">${r.label}</span>
        <span class="track"><span class="fill" style="width:${Math.min(r.pct,100)}%"></span></span>
        <span class="val">${r.pct.toFixed(1)}%</span>
      </div>
    `).join('')}
  `;
}

function renderContribHeatmap() {
  renderContribHeatmapInto('ana-contrib-heatmap', lastContribAnalysis, CONTRIB_NUTRIENTS, 'showContribDetail');
}

// 원료×영양소 기여도 히트맵을 그리는 공용 렌더러 — 영양 분석 탭/아미노산 탭이 같은 로직을 공유
function renderContribHeatmapInto(containerId, analysis, defs, rowClickFn) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const order = analysis ? analysis.order : [];
  if (!order.length) { wrap.innerHTML = ''; return; }

  let html = '<table><thead><tr><th class="left" style="position:sticky;left:0;z-index:1">원료</th>' +
    defs.map(d => `<th>${d.label}</th>`).join('') + '</tr></thead><tbody>';
  order.forEach(name => {
    const clickAttr = rowClickFn ? ` data-ing="${escHtml(name)}" onclick="${rowClickFn}(this.dataset.ing)"` : '';
    html += `<tr><td class="left"${clickAttr}>${escHtml(name)}</td>`;
    defs.forEach(def => {
      const nut = analysis.nutrients[def.key];
      const item = nut.byName[name];
      // 이 원료의 셀이 결측이거나, 열 전체가 결측이라 총량조차 0이면 "데이터 없음"으로 명시 표시(─와 구분).
      const colDataless = nut.anyMissing && !(nut.total > 0);
      if ((item && item.missing) || colDataless) {
        // ─(실제 0/소량 기여)와 확실히 구분되도록 빗금 패턴 + 이탤릭 "n/a". 색은 테마 변수만 사용.
        html += `<td style="background:repeating-linear-gradient(45deg,var(--side2),var(--side2) 4px,var(--gray-l) 4px,var(--gray-l) 8px);color:var(--sub);font-style:italic" title="원료 영양 데이터 없음 — 기여도 계산 불가">n/a</td>`;
      } else {
        const pct = item ? item.pct : 0;
        if (pct < 0.5) {
          html += `<td style="background:var(--side2);color:var(--sub)">─</td>`;
        } else {
          const bg = `color-mix(in srgb, var(--acc) ${Math.min(pct, 100).toFixed(0)}%, var(--side2))`;
          const color = pct > 55 ? '#fff' : 'var(--text)';
          html += `<td style="background:${bg};color:${color}">${pct.toFixed(0)}%</td>`;
        }
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function updateWarnPanel(result, pc) {
  const dmb = result.dmb;
  const cap = result.dmb.cap;
  const species = document.getElementById('sb-species')?.value || '개';
  const isCat = species === '고양이';
  const policy = getEvaluationPolicy(pc);
  renderPtypeBanner('warn-ptype-banner', pc,
    (policy.evalMaxExcess && !policy.showCompleteness)
      ? '아래 최대 기준 초과 여부는 이 제품을 100% 급여했다고 가정한 수치이며, 보조식은 소량 급여가 일반적이므로 참고용으로만 활용하세요.'
      : undefined);

  // Ca:P 카드 — 판정 자체는 evaluateCapStatus()에서 정책에 따라 한 곳에서 계산(로직 중복 방지).
  // 여기서는 그 결과(level/text/bg/color)를 그대로 쓰고, 앞에 붙는 아이콘만 다른 상태 배지와
  // 같은 규칙(STATUS_TONE)으로 통일한다 — evaluateCapStatus() 자체는 미변경.
  const capStatus = evaluateCapStatus(cap, policy, isCat);
  const CAP_LEVEL_ICON = { pass:'check', warn:'alert-circle', fail:'warning', reference:'info', excluded:'minus', unknown:'alert-circle' };
  const capCard = document.getElementById('cap-card');
  capCard.innerHTML = `${svgIcon(CAP_LEVEL_ICON[capStatus.level] || 'minus', 12)} ${capStatus.text}`;
  capCard.style.background = capStatus.bg;
  capCard.style.color = capStatus.color;

  // 간식(기준 비교 제외)·직접급여불가(배합용 원료)는 과다·안전성 평가 자체를 적용하지 않는다
  if (!policy.evalMaxExcess) {
    lastWarnItems = [];
    document.getElementById('warn-body').innerHTML =
      `<tr><td colspan="8" class="table-empty-row">
        ${pc.short} 유형으로 판단되어 일반 식품 기준의 과다·안전성 평가를 적용하지 않습니다.
      </td></tr>`;
    renderDashWarnSummary('warn-summary-list');
    return;
  }

  // 과잉위험 테이블
  const items = isCat ? [
    ["칼슘(Ca)",   dmb.ca,    "% DMB",    null,   "고양이 AAFCO 공식 최대치 미설정","AAFCO 2023 (Max 미설정)"],
    ["인(P)",      dmb.p,     "% DMB",    null,   "과잉 인 섭취 시 신장 부담 우려 (공식 Max 미설정)","AAFCO 2023 (Max 미설정)"],
    ["철(Fe)",     dmb.fe,    "mg/kg DMB",null,   "고양이 AAFCO 공식 최대치 미설정","AAFCO 2023 (Max 미설정)"],
    ["아연(Zn)",  dmb.zn,   "mg/kg DMB",2000,   "구리흡수 차단·빈혈·췌장염","AAFCO 2023 Max 2000 mg/kg"],
    ["셀레늄(Se)",dmb.se,   "mg/kg DMB",null,   "고양이 AAFCO 공식 최대치 미설정","AAFCO 2023 (Max 미설정)"],
    ["비타민A",   dmb.vitA, "IU/kg DMB",750000, "간독성·기형(임신묘 위험)","AAFCO 2023 Max 750,000 IU/kg"],
    ["비타민D",   dmb.vitD, "IU/kg DMB",10000,  "고칼슘혈증·연조직 석회화·신부전","AAFCO 2023 Max 10,000 IU/kg"],
    ["나트륨(Na)",dmb.na,   "% DMB",    null,   "고혈압·심장신장 부담 (공식 Max 미설정)","FEDIAF 참고 0.08~0.2%"],
    ["칼륨(K)",   dmb.k,    "% DMB",    null,   "고칼륨혈증 (신장질환묘 주의)","AAFCO 2023 RA 0.6% 참고"],
    ["구리(Cu)",  dmb.cu,   "mg/kg DMB", null,  "고양이 AAFCO 공식 최대치 미설정","AAFCO 2023 (Max 미설정)"],
    ["요오드(I)", dmb.iodine,"mg/kg DMB", null,  "요오드 과잉→갑상선 기능 이상 (공식 Max 미설정)","AAFCO 2023 (Max 미설정)"],
  ] : [
    ["칼슘(Ca)",   dmb.ca,    "% DMB",    2.5,    "골격기형·부갑상선 기능저하·Zn·Fe 흡수방해","AAFCO 2023 Max 2.5% DMB"],
    ["인(P)",      dmb.p,     "% DMB",    1.6,    "신장부하·Ca:P 불균형","AAFCO 2023 Max 1.6% DMB"],
    ["철(Fe)",     dmb.fe,    "mg/kg DMB",3000,   "산화스트레스·간손상·구리 길항","AAFCO 2023 Max 3000 mg/kg"],
    ["아연(Zn)",  dmb.zn,   "mg/kg DMB",1000,   "구리흡수 차단·빈혈·췌장염","AAFCO 2023 Max 1000 mg/kg"],
    ["셀레늄(Se)",dmb.se,   "mg/kg DMB",2.0,    "셀레노시스: 탈모·신경독성·보행장애","AAFCO 2023 Max 2.0 mg/kg"],
    ["비타민A",   dmb.vitA, "IU/kg DMB",250000, "간독성·골격이상·기형(임신견 위험)","AAFCO 2023 Max 250000 IU/kg"],
    ["비타민D",   dmb.vitD, "IU/kg DMB",3000,   "고칼슘혈증·연조직 석회화·신부전","AAFCO 2023 Max 3000 IU/kg"],
    ["나트륨(Na)",dmb.na,   "% DMB",    null,   "고혈압·심장신장 부담 (AAFCO Max 미설정)","NRC 2006 RA 0.2% 참고"],
    ["칼륨(K)",   dmb.k,    "% DMB",    null,   "고칼륨혈증 (신장질환견 주의)","NRC 2006 RA 0.56% 참고"],
    ["구리(Cu)",  dmb.cu,   "mg/kg DMB", 250,   "구리 과잉→아연 길항, 간독성", "AAFCO 2023 Max 250 mg/kg"],
    ["요오드(I)", dmb.iodine,"mg/kg DMB", 50,   "요오드 과잉→갑상선 기능 이상", "AAFCO 2023 Max 50 mg/kg"],
  ];

  // 이 표의 각 영양소가 만들어지는 asis 인덱스 — result.missingCols에 있으면 "실제 0"이 아니라 "데이터 없음".
  const WARN_COL = {"칼슘(Ca)":7,"인(P)":8,"철(Fe)":11,"아연(Zn)":12,"셀레늄(Se)":14,"비타민A":15,"비타민D":16,"나트륨(Na)":9,"칼륨(K)":10,"구리(Cu)":28,"요오드(I)":30};
  const warnMissing = new Set(result.missingCols || []);

  let html = '';
  lastWarnItems = [];
  items.forEach(([nm,val,unit,mx,risk,src]) => {
    const isMissing = WARN_COL[nm] != null && warnMissing.has(WARN_COL[nm]);
    const vs = isMissing ? '─' : val.toFixed(5);
    const mxs = mx ? String(mx) : '─';
    let ratio='─', status='', cls='';
    let ratioPct = null;
    if (isMissing) {
      ratio = '─';
      status = `${statusIconText('none')} (데이터 없음)`; cls = 'none';
    } else if (mx) {
      if (val === 0) {
        ratio = '0.0%';
        status = `${statusIconText('none')} (원료 미포함)`; cls = 'none';
      } else {
        const r = val/mx;
        ratioPct = r*100;
        ratio = ratioPct.toFixed(1)+'%';
        // 판정 임계값(1.0/0.8)은 그대로 — "초과"(실제로 최대기준을 넘음)는 --fail, "주의"(아직
        // 넘진 않았지만 80% 이상 근접)는 --warn 클래스(.warn, 위 STATUS_TONE과 동일 색 규칙)로
        // 구분한다. 예전엔 이 "주의" 상태가 다른 탭의 "초과"와 같은 .over 클래스를 공유해
        // 색이 서로 반대로 보였다 — 클래스명만 분리, 조건식(r>1.0/r>0.8)은 미변경.
        if (r > 1.0) { status=`${statusIconText('over')} (${(r*100).toFixed(0)}%)`; cls='fail'; }
        else if (r > 0.8) { status=`${statusIconText('warn')} (${(r*100).toFixed(0)}%)`; cls='warn'; }
        else { status=`${statusIconText('pass')} (${(r*100).toFixed(0)}%)`; cls='pass'; }
      }
    } else {
      status=`${statusIconText('info')}: ${vs} (Max 미설정)`; cls='info';
    }
    if (cls === 'fail' || cls === 'warn') {
      lastWarnItems.push({ name: nm, cls, ratioPct, risk });
    }
    html += `<tr>
      <td class="left" style="font-weight:bold">${nm}</td>
      <td class="num">${vs}</td>
      <td class="center" style="font-size:10px">${unit}</td>
      <td class="num">${mxs}</td>
      <td class="num">${ratio}</td>
      <td class="${cls}" style="text-align:left">${status}</td>
      <td class="left" style="font-size:10px;color:var(--sub)">${risk}</td>
      <td class="left" style="font-size:10px;color:var(--sub)">${src}</td>
    </tr>`;
  });
  document.getElementById('warn-body').innerHTML = html;
  renderDashWarnSummary('warn-summary-list');
}

// ════════════════════════════════════════════════════════════════════════════
// 전문 용어 사전 탭 — 이 계산기 전반에서 쓰이는 수의영양학·AAFCO 용어를 사전 형태로 정리한다.
// 현재 배합·반려동물 정보와 무관한 정적 레퍼런스이므로 init() 시 1회만 그리고, 이후는 검색/카테고리
// 필터 조작 시 renderGlossary()가 다시 그린다.
// ════════════════════════════════════════════════════════════════════════════
const GLOSSARY_TERMS = [
  // ── 기관·기준 ──
  { term: 'AAFCO', abbr: 'Association of American Feed Control Officials', cat: '기관·기준',
    def: '미국 사료관리협회. 각 주(州)의 사료 규제당국 대표들이 모여 동물사료의 영양소 기준과 라벨링 규정을 제정하는 자율규제기구입니다. 이 계산기가 표시하는 "AAFCO 기준"은 AAFCO Dog and Cat Food Nutrient Profiles(2023년 개정판)를 의미합니다.' },
  { term: 'NRC', abbr: 'National Research Council', cat: '기관·기준',
    def: '미국국립학술원 산하 연구위원회. 2006년 발간한 「Nutrient Requirements of Dogs and Cats」는 안전계수를 더하지 않은 순수 생리학적 최소요구량(MR)과 권장섭취량(RA)을 제시하는 학술 기준으로, AAFCO 기준의 과학적 토대가 되었습니다.' },
  { term: 'FEDIAF', abbr: 'European Pet Food Industry Federation', cat: '기관·기준',
    def: '유럽 반려동물사료산업연맹. AAFCO와 성격이 유사한 유럽판 영양 가이드라인을 매년 발간하며, 오메가지방산·일부 미량 미네랄 등에서 AAFCO와 다른 기준값을 제시합니다.' },
  { term: 'WSAVA', abbr: 'World Small Animal Veterinary Association', cat: '기관·기준',
    def: '세계소동물수의사회. 임상 수의사를 위한 「Global Nutrition Guidelines」를 발간하며, 이 계산기의 활동량·생애주기별 에너지 계수 상당 부분이 이 가이드라인과 NRC 2006을 기반으로 합니다.', tab: 'calcbasis' },

  // ── 제품 분류 ──
  { term: '완전·균형식', abbr: 'Complete and Balanced', cat: '제품 분류',
    def: 'AAFCO 최소기준을 모두 충족해 다른 보충 없이 그 자체로 주식으로 급여할 수 있는 사료. 라벨에 이 문구를 표시하려면 AAFCO 영양소 프로파일을 충족하거나 급여시험으로 입증해야 합니다.' },
  { term: '간헐적·보조적 급여 전용', abbr: 'Intermittent or Supplemental Feeding Only', cat: '제품 분류',
    def: '완전·균형식 기준을 충족하지 못해 주식으로 쓸 수 없는 제품에 AAFCO가 의무적으로 표시하도록 하는 라벨 문구. 간식·토퍼·보조식이 여기 해당하며, 반려동물 하루 총 섭취 열량의 10% 이하로만 급여하도록 권장됩니다.' },
  { term: '주식 / 간식 / 보조식·보충식 / 직접급여불가', cat: '제품 분류',
    def: '이 계산기가 배합 데이터를 분석해 자동으로 분류하는 4개 제품 유형입니다. 유형에 따라 결핍·과다 경고를 얼마나 엄격하게 적용할지가 달라집니다. 자세한 판정 조건은 계산 기준 탭 8번 항목을 참고하세요.', tab: 'calcbasis' },

  // ── 에너지·급여량 ──
  { term: 'ME (대사에너지)', abbr: 'Metabolizable Energy', cat: '에너지·급여량',
    def: '사료가 실제로 체내에서 에너지원으로 쓸 수 있는 열량. 총에너지에서 소화되지 않고 분·소변·가스로 손실되는 양을 뺀 값이며, 이 계산기는 AAFCO가 채택한 Modified Atwater 공식으로 추정합니다.', tab: 'ana-energy' },
  { term: 'Modified Atwater 계수', cat: '에너지·급여량',
    def: '단백질 3.5, 지방 8.5, 탄수화물 3.5 kcal/g의 열량 환산계수. 사람용 Atwater 계수(4-9-4)를 반려동물의 소화흡수율에 맞게 보정한 값으로, AAFCO Model Regulation PF9가 ME 계산의 공식 방법으로 지정하고 있습니다.', tab: 'calcbasis' },
  { term: 'RER (기초대사량)', abbr: 'Resting Energy Requirement', cat: '에너지·급여량',
    def: '체중만으로 추정하는 안정 시 에너지 소비량. RER = 70 × 체중(kg)^0.75 공식을 쓰며, 모든 급여량 계산의 출발점이 됩니다.', tab: 'ana-energy' },
  { term: 'MER / DER (유지에너지요구량)', abbr: 'Maintenance / Daily Energy Requirement', cat: '에너지·급여량',
    def: 'RER에 생애주기·활동량·체형(BCS)·중성화 여부를 반영한 계수를 곱해 구하는 하루 실제 에너지 요구량. 이 계산기는 MER과 DER을 같은 의미로 사용합니다.', tab: 'ana-energy' },

  // ── 영양성분 표기 ──
  { term: 'DM / DMB (건물, 건물 기준)', abbr: 'Dry Matter / Dry Matter Basis', cat: '영양성분 표기',
    def: '사료에서 수분을 제외한 나머지 성분(그리고 그 기준으로 환산한 값). 제품마다 수분 함량이 크게 달라(습식 75~80% vs 건식 8~12%) 있는 그대로(as-is)의 값으로는 공정한 비교가 불가능하므로, NRC·AAFCO·FEDIAF 기준은 모두 건물 기준(DMB)으로 환산한 값을 씁니다.', tab: 'calcbasis' },
  { term: 'as-is (원물 기준)', cat: '영양성분 표기',
    def: '수분을 포함해 실제 포장·급여 상태 그대로 측정한 값. 급여량(g/일) 계산이나 라벨 표시값은 as-is 기준을 쓰고, 서로 다른 제품 간 영양소 함량 비교는 DMB 기준을 씁니다.' },
  { term: '조단백 / 조지방 / 조섬유 / 조회분', abbr: 'Crude Protein / Fat / Fiber / Ash', cat: '영양성분 표기',
    def: '사료 성분 분석의 기본 5대 항목(수분 포함) 중 4가지. "조(粗)"는 개별 성분을 정밀 분리한 값이 아니라 특정 화학적 분석법(예: 단백질은 질소 함량×6.25)으로 일괄 추정한 값임을 의미합니다.' },
  { term: 'NFE (가용무질소물)', abbr: 'Nitrogen-Free Extract', cat: '영양성분 표기',
    def: '흔히 "탄수화물"로 표기되는 값으로, 직접 측정이 아니라 100%에서 수분·조단백·조지방·조섬유·조회분을 뺀 나머지로 계산하는 추정치입니다. ME 계산식의 탄수화물 항목이 바로 이 NFE입니다.', tab: 'calcbasis' },
  { term: '프리믹스', abbr: 'Premix', cat: '영양성분 표기',
    def: '비타민·미네랄 등을 미리 배합해둔 첨가제 원료. 완전식에는 보통 1~5% 소량만 들어가며, 배합비의 상당 부분(50% 이상)을 차지하면 이 계산기는 "직접 급여 불가(배합용 원료)"로 자동 분류합니다.', tab: 'calcbasis' },

  // ── 판정·단위 ──
  { term: 'MR / RA', abbr: 'Minimum Requirement / Recommended Allowance', cat: '판정·단위',
    def: 'NRC 2006이 제시하는 두 단계 기준. MR은 결핍을 막는 최소 생리학적 요구량이고, RA는 여기에 개체차·흡수율 변동을 감안한 안전 여유를 더해 실무적으로 권장하는 섭취량입니다.', tab: 'calcbasis' },
  { term: 'Min / Max (AAFCO 최소·최대기준)', cat: '판정·단위',
    def: 'AAFCO 영양소 프로파일이 제시하는 규제 기준값. Min 미만이면 결핍(fail), Max를 초과하면 과다(over)로 판정합니다. 모든 영양소에 Max가 설정된 것은 아닙니다.' },
  { term: 'g/1000kcal ME', cat: '판정·단위',
    def: '아미노산처럼 "체중당"이 아니라 "섭취 열량당" 함량으로 비교해야 하는 영양소에 쓰는 단위. 같은 체중이라도 사료의 열량 밀도에 따라 실제 먹는 양이 달라지므로, 실제 하루 섭취량을 비교하려면 체중이 아니라 열량이 기준이 되어야 합니다(NRC 2006 방식).', tab: 'amino' },
  { term: '제한 아미노산', abbr: 'Limiting Amino Acid', cat: '판정·단위',
    def: '배합에 포함된 필수아미노산 중 기준 대비 상대 충족률이 가장 낮은 아미노산. 이 값이 100% 미만일 때만 실제 "제한"이 존재하며, 그 아미노산부터 보강해야 전체 단백질 이용 효율이 개선됩니다(최소량의 법칙과 같은 개념).', tab: 'amino' },
  { term: '필수아미노산', abbr: 'Essential Amino Acid', cat: '판정·단위',
    def: '체내에서 합성되지 않거나 충분히 합성되지 않아 반드시 사료로 섭취해야 하는 아미노산. 개·고양이는 아르기닌·히스티딘·이소류신·류신·라이신·메티오닌+시스틴·페닐알라닌+티로신·트레오닌·트립토판·발린 10종이 해당합니다.' },
  { term: '타우린', abbr: 'Taurine', cat: '판정·단위',
    def: '고양이에게는 조건부 필수아미노산이지만 개에게는 일반적으로 필수가 아닌 함황아미노산. 결핍 시 고양이는 확장성 심근증·망막변성(실명) 위험이 있어 AAFCO 고양이 기준에만 별도 최소치가 설정되어 있습니다.' },
  { term: '필수지방산 (LA · AA · ALA · EPA/DHA)', cat: '판정·단위',
    def: '체내 합성이 안 되거나 부족한 지방산. 특히 아라키돈산(AA)은 고양이에서만 필수로 지정되는데, 고양이는 리놀레산(LA)으로부터 아라키돈산을 합성하는 효소(Δ6-불포화효소) 활성이 낮기 때문입니다.' },
  { term: 'AAFCO 열량 밀도 보정', abbr: 'Caloric Density Adjustment', cat: '판정·단위',
    def: 'AAFCO의 %DMB 최소기준은 4000kcal ME/kg DM 사료를 전제로 정해져 있어, 이보다 열량 밀도가 높은 사료는 최소기준에 (배합 ME ÷ 4000) 배율을 곱해 보정해야 실제 필요량과 맞습니다.', tab: 'ana-energy' },

  // ── 반려동물 상태 ──
  { term: 'Ca:P 비율 (칼슘:인 비율)', cat: '반려동물 상태',
    def: '칼슘과 인은 절대량뿐 아니라 상대 비율이 골격 발달·유지에 중요합니다. AAFCO 허용범위는 1:1~2:1이며, 특히 대형견 성장기에 비율이 심하게 무너지면 골격 기형 위험이 커집니다.', tab: 'warn' },
  { term: 'BCS (체형점수)', abbr: 'Body Condition Score', cat: '반려동물 상태',
    def: '갈비뼈·허리 라인 등 체형을 만져보고 관찰해 1~9단계로 매기는 표준화된 비만도 평가 척도. 5단계가 이상적 체형이며, 이 계산기는 BCS에 따라 급여 열량을 자동으로 가감합니다.', tab: 'product' },
  { term: '활동량 계수 · 중성화 계수', cat: '반려동물 상태',
    def: '같은 생애주기라도 활동량이 많거나 중성화하지 않은 개체는 기초 에너지 소비가 더 높아, 각각 별도의 배율을 곱해 실제 필요 열량에 가깝게 보정합니다.', tab: 'calcbasis' },
];

function setGlossaryCat(cat, btn) {
  document.querySelectorAll('.gl-chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  renderGlossary();
}

function buildGlossaryChips() {
  const chipsEl = document.getElementById('gl-chips');
  if (!chipsEl) return;
  const cats = ['전체', ...Array.from(new Set(GLOSSARY_TERMS.map(t => t.cat)))];
  chipsEl.innerHTML = cats.map((c, i) =>
    `<span class="gl-chip${i===0 ? ' active' : ''}" onclick="setGlossaryCat('${c}', this)" role="button" tabindex="0" aria-pressed="${i===0}">${c}</span>`
  ).join('');
}

function renderGlossary() {
  const listEl = document.getElementById('gl-list');
  if (!listEl) return;
  const q = (document.getElementById('gl-search')?.value || '').trim().toLowerCase();
  const activeCat = document.querySelector('.gl-chip.active')?.textContent || '전체';

  const filtered = GLOSSARY_TERMS.filter(t => {
    const matchesCat = activeCat === '전체' || t.cat === activeCat;
    const haystack = (t.term + ' ' + (t.abbr||'') + ' ' + t.def).toLowerCase();
    return matchesCat && (!q || haystack.includes(q));
  });

  document.getElementById('gl-count').textContent = `${filtered.length}개 용어`;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="gl-empty">"${escHtml(q)}"에 해당하는 용어를 찾을 수 없습니다.</div>`;
    return;
  }

  const order = [];
  filtered.forEach(t => { if (!order.includes(t.cat)) order.push(t.cat); });

  listEl.innerHTML = `<div class="gl-groups">${order.map(cat => `
    <div class="gl-group">
      <div class="gl-cat-hdr">${cat}</div>
      <div class="gl-group-items">
        ${filtered.filter(t => t.cat === cat).map(t => `
          <div class="gl-entry" data-term="${t.term.replace(/"/g,'&quot;')}">
            <div class="gl-entry-hdr">
              <span class="gl-term">${t.term}</span>
              ${t.abbr ? `<span class="gl-abbr">${t.abbr}</span>` : ''}
            </div>
            <div class="gl-def">${t.def}</div>
            ${t.tab ? `<span class="gl-link" onclick="goTab('${t.tab}')">→ 관련 탭에서 확인</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('')}</div>`;
}

// ── 법령·광고기준 탭: 실무 체크리스트 상태 저장/복원 ──────────────────────────
// 순수 정보 탭이라 계산/DB/저장 로직과 무관하다. 체크 상태만 localStorage(JSON 배열)에 담는다
// — 알림 읽음 표시(NOTIF_READ_STORAGE_KEY)와 동일한 "체크된 key 목록" 패턴. 로그인/서버와 무관.
const LAW_CHECKLIST_KEY = 'feedcalc_v4_law_checklist';
function loadLawChecklist() {
  try { return new Set(JSON.parse(localStorage.getItem(LAW_CHECKLIST_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function saveLawChecklist(set) {
  try { localStorage.setItem(LAW_CHECKLIST_KEY, JSON.stringify([...set])); } catch (e) {}
}
function initLawChecklist() {
  const wrap = document.getElementById('law-checklist');
  if (!wrap) return;
  const checked = loadLawChecklist();
  wrap.querySelectorAll('.law-check').forEach(cb => {
    cb.checked = checked.has(cb.dataset.key);
  });
  // 이벤트 위임 — 체크박스가 바뀔 때마다 현재 상태를 다시 저장한다(중복 바인딩 방지 플래그).
  if (!wrap.dataset.bound) {
    wrap.addEventListener('change', (e) => {
      const cb = e.target.closest('.law-check');
      if (!cb) return;
      const set = loadLawChecklist();
      if (cb.checked) set.add(cb.dataset.key); else set.delete(cb.dataset.key);
      saveLawChecklist(set);
    });
    wrap.dataset.bound = '1';
  }
}

// ── 표시사항 작성 탭 (V1) ────────────────────────────────────────────────────
// 계산/DB/레시피 로직과 무관한 정보 화면이다. 자동값은 sb-* 입력 · getMixRows() · lastResult 에서
// "읽기만" 해서 표시하고(계산 미접촉), 사용자가 입력/수정한 값만 localStorage(JSON)에 저장한다.
// 저장 형식은 레시피 파일(collectRecipeData)과 무관 — 표시사항 초안은 브라우저에만 남는다.
const LABEL_DRAFT_KEY = 'feedcalc_v4_label_draft';
// 등록성분량으로 보여줄 항목 [키, 라벨, ING_IDX 키, 비교표기]
const LABEL_GUARANTEED_DEFS = [
  ['prot',     '조단백질', 'PROTEIN',     '이상'],
  ['fat',      '조지방',   'FAT',         '이상'],
  ['fiber',    '조섬유',   'CRUDE_FIBER', '이하'],
  ['ash',      '조회분',   'ASH',         '이하'],
  ['moisture', '수분',     'MOISTURE',    '이하'],
];

function loadLabelDraft() {
  try { const d = JSON.parse(localStorage.getItem(LABEL_DRAFT_KEY) || '{}'); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}; }
  catch (e) { return {}; }
}
function saveLabelDraft(d) {
  try { localStorage.setItem(LABEL_DRAFT_KEY, JSON.stringify(d)); } catch (e) {}
}

// 제품유형(sb-ptype: 주식/보조식/간식) → 법정 유형 표기 "초안"(편집 가능 기본값일 뿐, 확정값 아님)
function labelPtypeDefault() {
  const p = document.getElementById('sb-ptype')?.value || '';
  if (p === '주식')   return '반려동물완전사료';
  if (p === '보조식') return '반려동물 기타사료';
  if (p === '간식')   return '반려동물 기타사료(간식)';
  return '';
}
function labelTargetText() {
  const sp = document.getElementById('sb-species')?.value || '';
  const tg = document.getElementById('sb-target')?.value || '';
  return [sp, tg].filter(Boolean).join(' · ');
}
// 현재 배합의 원료(이름 있고 배합비 > 0)를 배합비 내림차순으로
function labelIngredientRows() {
  if (typeof getMixRows !== 'function') return [];
  return getMixRows().filter(([nm, pct]) => nm && pct > 0).sort((a, b) => b[1] - a[1]);
}
// as-fed(100g) 등록성분량 참고값 = asis[i] * dmScale. lastResult 없음/blendError면 null.
function labelGuaranteedAuto() {
  const r = (typeof lastResult !== 'undefined') ? lastResult : null;
  if (!r || r.blendError || !Array.isArray(r.asis) || typeof ING_IDX === 'undefined') return null;
  if (!(r.totalRatio > 0)) return null;   // 배합비 입력 전 — 참고값 없음
  const dmScale = 100 / r.totalRatio;
  const out = {};
  let anyMissing = false;
  LABEL_GUARANTEED_DEFS.forEach(([key, , idxName]) => {
    const i = ING_IDX[idxName];
    out[key] = r.asis[i] * dmScale;
    if (Array.isArray(r.missingCols) && r.missingCols.includes(i)) anyMissing = true;
  });
  out._anyMissing = anyMissing;
  return out;
}
function fmtLabelPct(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(1) : ''; }

// 화면 입력값 → draft 객체 (편집된 값만 담는다 — 자동 기본값과 같으면 저장 안 함)
function collectLabelDraft() {
  const g = document.getElementById('tab-label'); if (!g) return {};
  const val = id => (document.getElementById(id)?.value ?? '').trim();
  const ingredientNames = {};
  g.querySelectorAll('.lbl-ing-name-input').forEach(inp => {
    const dbn = inp.dataset.dbname; const v = inp.value.trim();
    if (dbn && v && v !== dbn) ingredientNames[dbn] = v;
  });
  const guaranteed = {};
  g.querySelectorAll('.lbl-guar-input').forEach(inp => {
    const k = inp.dataset.key; const v = inp.value.trim();
    if (k && v !== '') guaranteed[k] = v;
  });
  return {
    regNo: val('lbl-reg-no'), netContent: val('lbl-net'), mfgDate: val('lbl-mfg-date'),
    expiry: val('lbl-expiry'), ptypeLabel: val('lbl-ptype'),
    companyName: val('lbl-company-name'), companyAddr: val('lbl-company-addr'), companyTel: val('lbl-company-tel'),
    drug: val('lbl-drug'), caution: val('lbl-caution'), storage: val('lbl-storage'), feeding: val('lbl-feeding'),
    ingredientNames, guaranteed,
  };
}

// 탭 진입 / init 시 전체를 다시 그린다. 입력 중에는 renderLabelPreview()만 갱신(포커스 유지).
function renderLabelDraft() {
  const root = document.getElementById('tab-label');
  if (!root) return;
  const d = loadLabelDraft();

  const setIf = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  const totalG = (typeof getMixTotalG === 'function') ? getMixTotalG() : 0;
  // 제품명·급여대상은 제품 설정에서만 바뀌는 값 — 읽기 전용으로 그대로 비춘다(draft에 저장 안 함).
  setIf('lbl-name-ro', (document.getElementById('sb-name')?.value || '').trim());
  setIf('lbl-target-ro', labelTargetText());
  setIf('lbl-reg-no', d.regNo || '');
  setIf('lbl-net', d.netContent || (totalG ? `${Math.round(totalG).toLocaleString()} g` : ''));
  setIf('lbl-mfg-date', d.mfgDate || '');
  setIf('lbl-expiry', d.expiry || '');
  setIf('lbl-ptype', d.ptypeLabel || labelPtypeDefault());
  setIf('lbl-company-name', d.companyName || (document.getElementById('sb-maker')?.value || '').trim());
  setIf('lbl-company-addr', d.companyAddr || '');
  setIf('lbl-company-tel', d.companyTel || '');
  setIf('lbl-drug', d.drug || '');
  setIf('lbl-caution', d.caution || '');
  setIf('lbl-storage', d.storage || '');
  setIf('lbl-feeding', d.feeding || '');

  const ingEl = document.getElementById('lbl-ing-list');
  if (ingEl) {
    const ings = labelIngredientRows();
    ingEl.innerHTML = !ings.length
      ? `<div class="lbl-empty" style="padding:8px 2px">배합 설계에서 원료·배합비를 입력하면 자동으로 표시됩니다.</div>`
      : `<div class="lbl-row lbl-row-hd"><span>배합 원료 (계산기 DB명)</span><span class="lbl-num">배합비</span><span>표시용 원료명</span></div>` +
        ings.map(([nm, pct]) => {
          const disp = (d.ingredientNames && d.ingredientNames[nm]) || nm;
          return `<div class="lbl-row">
            <span class="lbl-dbn">${escHtml(nm)}</span>
            <span class="lbl-num">${pct.toFixed(1)}%</span>
            <input class="lbl-ing-name-input" type="text" data-dbname="${escHtml(nm)}" value="${escHtml(disp)}">
          </div>`;
        }).join('');
  }

  const guarEl = document.getElementById('lbl-guaranteed');
  const auto = labelGuaranteedAuto();
  if (guarEl) {
    guarEl.innerHTML =
      `<div class="lbl-row lbl-row-hd"><span>항목</span><span class="lbl-num">계산값</span><span>표시값 (%)</span></div>` +
      LABEL_GUARANTEED_DEFS.map(([key, label, , sign]) => {
        const autoVal = auto ? fmtLabelPct(auto[key]) : '';
        const cur = (d.guaranteed && d.guaranteed[key] != null && d.guaranteed[key] !== '') ? d.guaranteed[key] : autoVal;
        return `<div class="lbl-row">
          <span>${label} <span class="lbl-empty">${sign}</span></span>
          <span class="lbl-num">${autoVal !== '' ? autoVal : '─'}</span>
          <span class="lbl-guar-cell"><input class="lbl-guar-input" type="text" inputmode="decimal" data-key="${key}" value="${escHtml(String(cur))}"><span class="lbl-unit">%</span></span>
        </div>`;
      }).join('');
  }
  const noteEl = document.getElementById('lbl-guaranteed-note');
  if (noteEl) noteEl.textContent = !auto
    ? '배합 설계를 완료하면 계산값이 채워집니다. 값은 실제 성분 분석 결과로 반드시 검증하세요.'
    : (auto._anyMissing ? '⚠ 일부 배합 원료에 해당 성분 데이터가 없어 계산값이 실제보다 낮게 나올 수 있습니다. 실제 분석값으로 수정하세요.'
                        : '계산값은 as-fed(있는 그대로) 100g 기준입니다. 실제 성분 분석 결과로 검증한 뒤 표시값을 확정하세요.');

  renderLabelStatus();
  renderLabelPreview();

  if (!root.dataset.bound) {
    const onEdit = debounce(() => { saveLabelDraft(collectLabelDraft()); renderLabelStatus(); renderLabelPreview(); }, 200);
    root.addEventListener('input', (e) => {
      if (e.target.closest('#lbl-manual-product, .lbl-ing-name-input, .lbl-guar-input, .lbl-textareas')) onEdit();
    });
    root.dataset.bound = '1';
  }
}

// 상단 상태 요약 — 표시사항 필수 항목 중 아직 비어 있는 것의 개수·이름
function labelMissingRequired() {
  if (!document.getElementById('tab-label')) return [];
  const filled = id => !!(document.getElementById(id)?.value || '').trim();
  const req = [
    ['제품명',           !!(document.getElementById('sb-name')?.value || '').trim()],
    ['사료의 유형',      filled('lbl-ptype')],
    ['성분등록번호',     filled('lbl-reg-no')],
    ['내용량',           filled('lbl-net')],
    ['제조/수입 연월일', filled('lbl-mfg-date')],
    ['유통기한',         filled('lbl-expiry')],
    ['업체 상호',        filled('lbl-company-name')],
    ['업체 주소',        filled('lbl-company-addr')],
    ['업체 전화번호',    filled('lbl-company-tel')],
    ['주의사항',         filled('lbl-caution')],
    ['원료(배합)',       labelIngredientRows().length > 0],
    ['등록성분량(배합)', !!labelGuaranteedAuto()],
  ];
  return req.filter(([, ok]) => !ok).map(([k]) => k);
}
function renderLabelStatus() {
  const el = document.getElementById('lbl-status');
  if (!el) return;
  const miss = labelMissingRequired();
  el.innerHTML = miss.length
    ? `<span class="lbl-status-badge">필수 항목 ${miss.length}개 미입력</span><span class="lbl-status-list">${miss.map(escHtml).join(' · ')}</span>`
    : `<span class="lbl-status-badge ok">필수 항목 입력 완료</span><span class="lbl-status-list">표시 전 값·문구를 최종 검토하세요.</span>`;
}

function renderLabelPreview() {
  const el = document.getElementById('lbl-preview');
  if (!el) return;
  const d = collectLabelDraft();
  const name = (document.getElementById('sb-name')?.value || '').trim();
  const ings = labelIngredientRows().map(([nm]) => (d.ingredientNames && d.ingredientNames[nm]) || nm);
  const auto = labelGuaranteedAuto();
  const guar = LABEL_GUARANTEED_DEFS.map(([key, label, , sign]) => {
    const v = (d.guaranteed && d.guaranteed[key] != null && d.guaranteed[key] !== '') ? d.guaranteed[key] : (auto ? fmtLabelPct(auto[key]) : '');
    return v === '' ? null : `${label} ${escHtml(String(v))}% ${sign}`;
  }).filter(Boolean).join(' / ');

  const miss = s => (s && s.trim()) ? escHtml(s) : '<span class="lbl-empty">(미입력)</span>';
  const line = (k, v) => `<div class="lbl-pv-line"><span class="lbl-pv-k">${k}</span><span class="lbl-pv-v">${v}</span></div>`;

  el.innerHTML = `
    <div class="lbl-pv-name">${name ? escHtml(name) : '<span class="lbl-empty">(제품명 미입력)</span>'}</div>
    ${line('사료의 유형', miss(d.ptypeLabel))}
    ${line('급여대상', labelTargetText() ? escHtml(labelTargetText()) : '<span class="lbl-empty">(제품 설정에서 지정)</span>')}
    ${line('성분등록번호', miss(d.regNo))}
    ${line('등록성분량', guar ? guar + ' <span class="lbl-empty">(as-fed, 100g 기준 · 검증 필요)</span>' : '<span class="lbl-empty">(배합 미완성)</span>')}
    ${line('원료명', ings.length ? escHtml(ings.join(', ')) : '<span class="lbl-empty">(배합 원료 없음)</span>')}
    ${line('내용량', miss(d.netContent))}
    ${line('동물용의약품 첨가내용', miss(d.drug))}
    ${line('주의사항', miss(d.caution))}
    ${line('보관방법', miss(d.storage))}
    ${line('급여방법·급여량', miss(d.feeding))}
    ${line('제조 / 수입 연월일', miss(d.mfgDate))}
    ${line('유통기한', miss(d.expiry))}
    ${line('제조원 / 수입판매원', [d.companyName, d.companyAddr, d.companyTel].filter(s => s && s.trim()).map(escHtml).join(' · ') || '<span class="lbl-empty">(업체정보 미입력)</span>')}
  `;
}

// 영양소명/현재값/판정 상태(qi-badge)/게이지를 렌더링하는 카드 HTML을 만든다.
// "분석 현황" 탭의 주요 영양소 빠른 확인과 대시보드 탭의 요약 카드가 이 함수를 공유해
// 판정 로직(gateJudge)과 상태 스타일(qi-badge)이 두 곳에서 절대 어긋나지 않게 한다.
function buildNutrientQuickHtml(stds, policy, nameList) {
  let quickHtml = '';
  nameList.forEach(nm => {
    const s = stds.find(st => st.name === nm);
    if (!s) return;
    const j = gateJudge(s.aafco_j, policy);
    // 판정값(j)은 그대로 — tone은 "어떤 아이콘/문구/색으로 보여줄지"만 결정(STATUS_TONE 기준).
    const tone = j === 'gated' ? 'gated' : (j === 'pass' || j === 'fail' || j === 'over') ? j : 'none';
    const gaugeColor = tone === 'pass' ? 'var(--pass-t)' : (tone === 'fail' || tone === 'over') ? 'var(--fail-t)' : 'var(--sub)';
    const hasVal = typeof s.value === 'number' && !Number.isNaN(s.value);
    const valueText = hasVal ? `${s.value.toFixed(2)} ${s.unit || ''}`.trim() : '─';
    const hasMin = typeof s.aa_min === 'number' && !Number.isNaN(s.aa_min) && s.aa_min > 0;
    const gaugePct = (hasVal && hasMin) ? Math.max(0, Math.min(150, s.value / s.aa_min * 100)) : 0;
    quickHtml += `<div class="dash-quick-item">
      <span class="qi-name">${nm}</span>
      <span class="qi-value">${valueText}</span>
      ${statusBadge(tone)}
      <div class="qi-gauge-track"><div class="qi-gauge-fill" style="width:${(gaugePct/150*100).toFixed(1)}%;background:${gaugeColor}"></div></div>
    </div>`;
  });
  return quickHtml;
}

function updateDashboard(result, pc) {
  const dmb  = result.dmb;
  const stds = result.standards;
  const isCat = (document.getElementById('sb-species')?.value || '개') === '고양이';
  const policy = getEvaluationPolicy(pc);
  document.getElementById('dk-quick-species').textContent = isCat ? '성묘' : '성견';
  syncSegmentedControls();
  syncBcsGauge();
  renderProductTypeCard(pc);

  // 배합 설계 탭 상단 컨텍스트 — 새 판정 로직 없이 제품/정보 탭과 같은 제품명·유형(pc)을
  // 그대로 보여준다. ptype-banner는 기존 ana/amino/warn/stdverify와 동일한 renderPtypeBanner()
  // 재사용(주식이면 비워지는 기존 규칙 그대로).
  const mixCtxEl = document.getElementById('mix-product-context');
  if (mixCtxEl) {
    const mixName = document.getElementById('sb-name').value || '제품명 미입력';
    mixCtxEl.textContent = (pc && pc.type) ? `${mixName} · ${pc.short}` : `${mixName} · 배합비 입력 전`;
  }
  renderPtypeBanner('mix-ptype-banner', pc);

  document.getElementById('dp-name').textContent   = document.getElementById('sb-name').value  || '─';
  document.getElementById('dp-maker').textContent  = document.getElementById('sb-maker').value || '─';
  document.getElementById('dp-ptype').textContent  = document.getElementById('sb-ptype').value;
  document.getElementById('dp-species').textContent = document.getElementById('sb-species')?.value || '개';
  document.getElementById('dp-target').textContent = document.getElementById('sb-target').value;

  document.getElementById('dp-me-asis').textContent = result.meAsis.toLocaleString('ko',{maximumFractionDigits:0});
  document.getElementById('dp-me-dmb').textContent  = result.meDmb.toLocaleString('ko',{maximumFractionDigits:0});

  document.getElementById('dk-me-asis').textContent = result.meAsis.toLocaleString('ko',{maximumFractionDigits:0});
  document.getElementById('dk-me-dmb').textContent  = result.meDmb.toLocaleString('ko',{maximumFractionDigits:0});
  document.getElementById('dk-dm').textContent      = (result.dmPct*100).toFixed(1);
  document.getElementById('dk-tot').textContent     = result.totalRatio.toFixed(1);
  document.getElementById('dk-prot').textContent    = dmb.prot.toFixed(1);
  document.getElementById('dk-fat').textContent     = dmb.fat.toFixed(1);

  const feed = computeFeedingPlan(result);
  document.getElementById('dp-bw-note').textContent = feed.bwUsed ? feed.bwUsed : (document.getElementById('sb-bw')?.value || '─');
  document.getElementById('dk-rer').textContent      = feed.rer    ? feed.rer.toFixed(0)    : '─';
  document.getElementById('dk-mer').textContent      = feed.mer    ? feed.mer.toFixed(0)    : '─';
  document.getElementById('dk-daily-g').textContent  = feed.dailyG ? feed.dailyG.toFixed(0) : '─';
  document.getElementById('dk-meal-g').textContent   = feed.mealG  ? feed.mealG.toFixed(0)  : '─';

  document.getElementById('dp-rer').textContent      = feed.rer    ? feed.rer.toFixed(0)    : '─';
  document.getElementById('dp-mer').textContent      = feed.mer    ? feed.mer.toFixed(0)    : '─';
  document.getElementById('dp-daily-g').textContent  = feed.dailyG ? feed.dailyG.toFixed(0) : '─';
  document.getElementById('dp-meal-g').textContent   = feed.mealG  ? feed.mealG.toFixed(0)  : '─';

  const nrcPass = stds.filter(s => s.nrc_j   === 'pass').length;
  const nrcFail = stds.filter(s => s.nrc_j   === 'fail').length;
  const nrcOver = stds.filter(s => s.nrc_j   === 'over').length;
  const aaPass  = stds.filter(s => s.aafco_j === 'pass').length;
  const aaFail  = stds.filter(s => s.aafco_j === 'fail').length;
  const aaOver  = stds.filter(s => s.aafco_j === 'over').length;
  const fedPass = stds.filter(s => s.fediaf_j === 'pass').length;
  const fedFail = stds.filter(s => s.fediaf_j === 'fail').length;

  if (policy.evalMinDeficiency) {
    // 주식·보조식: 실측 결핍/초과 판정 그대로 표시(보조식은 완전균형식 "인증" 카드만 아래에서 생략)
    document.getElementById('dc-nrc-pass').textContent = nrcPass + '개';
    document.getElementById('dc-nrc-fail').textContent = nrcFail + '개';
    document.getElementById('dc-nrc-over').textContent = nrcOver + '개';
    document.getElementById('dc-aa-pass').textContent  = aaPass  + '개';
    document.getElementById('dc-aa-fail').textContent  = aaFail  + '개';
    document.getElementById('dc-aa-over').textContent  = aaOver  + '개';
    document.getElementById('dc-fed-pass').textContent = fedPass + '개';
    document.getElementById('dc-fed-fail').textContent = fedFail + '개';
    ['dc-nrc-pass','dc-nrc-fail','dc-nrc-over','dc-aa-pass','dc-aa-fail','dc-aa-over','dc-fed-pass','dc-fed-fail']
      .forEach(id => { document.getElementById(id).title = ''; });
  } else {
    // 간식(영양 기준 비교 제외)·직접급여불가(배합용 원료): 평가 자체를 적용하지 않음
    const note = policy.mode === 'not_for_direct_feeding'
      ? '배합용 원료로 판단되어 일반 영양 평가를 적용하지 않습니다.'
      : `${pc.short} 유형은 영양 기준 비교를 적용하지 않습니다.`;
    ['dc-nrc-pass','dc-nrc-fail','dc-nrc-over','dc-aa-pass','dc-aa-fail','dc-aa-over','dc-fed-pass','dc-fed-fail']
      .forEach(id => { const el = document.getElementById(id); el.textContent = '평가 제외'; el.title = note; });
  }

  const keyNutrients = ['조단백','조지방','칼슘(Ca)','인(P)','나트륨(Na)','칼륨(K)','마그네슘(Mg)',
                        '비타민A','비타민D','비타민E(α-TE)','철(Fe)','아연(Zn)','리놀레산(LA,n-6)','ALA(α-리놀렌,n-3)','콜린'];
  document.getElementById('dk-quick-grid').innerHTML = buildNutrientQuickHtml(stds, policy, keyNutrients);
  const cap = dmb.cap;

  // ── 요약 통계 타일(전체 충족률/경고/에너지/급여량) ──
  const aaJudged = stds.filter(s => s.aafco_j === 'pass' || s.aafco_j === 'fail' || s.aafco_j === 'over');
  const overallPct = aaJudged.length ? Math.round(aaJudged.filter(s => s.aafco_j === 'pass').length / aaJudged.length * 100) : 0;
  const overallLabel = document.getElementById('ds-overall-label');
  const overallFill = document.getElementById('ds-overall-fill');
  const overallPctEl = document.getElementById('ds-overall-pct');
  const overallCard = document.getElementById('ds-overall-card');
  if (policy.showCompleteness) {
    overallPctEl.innerHTML = overallPct + '<span class="dash-stat-unit">%</span>';
    overallPctEl.title = '';
    if (overallLabel) overallLabel.textContent = '전체 충족률 (AAFCO)';
    overallFill.style.width = overallPct + '%';
    // 카드 배경 톤도 막대 색과 같은 구간(80%/50%)을 그대로 재사용 — 새 판정 기준 아님
    const overallTone = overallPct >= 80 ? 'pass' : overallPct >= 50 ? 'warn' : 'fail';
    overallFill.style.background = `var(--${overallTone}-t)`;
    if (overallCard) {
      overallCard.classList.remove('pass', 'warn', 'fail');
      overallCard.classList.add(overallTone);
    }
  } else {
    // 보조식·간식·직접급여불가는 "완전·균형식 충족률"이라는 지표 자체가 성립하지 않으므로,
    // 퍼센트 숫자 대신 "해당없음"을 표시해 완전식 평가 결과로 오해되지 않게 한다.
    const overallText = {
      supplement: ['완전·균형식 평가', '보조식은 완전·균형식 판정을 적용하지 않습니다. 부족 영양소는 영양 분석 탭에서 확인하세요.'],
      snack: ['영양 기준 비교', `${pc.short} 유형은 영양 기준 비교를 적용하지 않습니다.`],
      not_for_direct_feeding: ['영양 적합성 평가', '배합용 원료로 판단되어 영양 적합성 평가를 적용하지 않습니다.'],
    }[policy.mode] || ['완전·균형식 평가', ''];
    overallPctEl.textContent = '해당없음';
    overallPctEl.title = overallText[1];
    if (overallLabel) overallLabel.textContent = overallText[0];
    overallFill.style.width = '0%';
    overallFill.style.background = 'var(--sub)';
    if (overallCard) overallCard.classList.remove('pass', 'warn', 'fail');
  }

  const warnCritical  = lastWarnItems.filter(w => w.cls === 'fail').length;
  const warnWarning   = lastWarnItems.filter(w => w.cls === 'warn').length;
  const allergyCount  = getMixAllergyMatches().length;
  const warnTotalCount = warnCritical + warnWarning + allergyCount;
  document.getElementById('ds-warn-total').textContent = warnTotalCount + '개';
  // "위험/주의" 문구를 다른 상태 배지와 같은 아이콘 규칙(STATUS_TONE)으로 통일 — 집계 로직은 미변경.
  document.getElementById('ds-warn-breakdown').innerHTML =
    `${svgIcon('warning', 10)}위험 ${warnCritical}건 · ${svgIcon('alert-circle', 10)}주의 ${warnWarning}건`
    + (allergyCount ? ` · 알레르기 ${allergyCount}건` : '');
  // 카드 배경 톤 — 위험(또는 알레르기)이 하나라도 있으면 fail, 주의만 있으면 warn,
  // 전부 0이면 pass. 위험/주의를 나누는 기준(w.cls)은 그대로이고 표시 톤만 매핑한다.
  const warnCard = document.getElementById('ds-warn-card');
  if (warnCard) {
    const warnTone = (warnCritical + allergyCount) > 0 ? 'fail' : warnWarning > 0 ? 'warn' : 'pass';
    warnCard.classList.remove('pass', 'warn', 'fail');
    warnCard.classList.add(warnTone);
  }

  document.getElementById('ds-me-val').textContent = result.meAsis.toLocaleString('ko', {maximumFractionDigits:0});
  document.getElementById('ds-me-dmb').textContent = result.meDmb.toLocaleString('ko', {maximumFractionDigits:0});
  document.getElementById('ds-daily').textContent  = feed.dailyG ? feed.dailyG.toFixed(0) : '─';
  document.getElementById('ds-meal').textContent   = feed.mealG  ? feed.mealG.toFixed(0)  : '─';

  renderDashBarChart('ds-amino-bars', stds, DASH_AMINO_BAR_LIST);
  renderDashCapGauge(cap, policy, isCat);
  renderDashIngredientDonut();
  renderDashWarnSummary();
}

// ════════════════════════════════════════════════════════════════════════════
// 에너지 분석 탭 — ME(대사에너지)·RER/MER 급여량·칼로리 조성·AAFCO 열량 밀도 보정을 한 화면에 모은다.
// 값 계산 자체는 새로 만들지 않고 calcNutrition()의 result와 computeFeedingPlan()의 급여 계획을 그대로 재사용한다.
// ════════════════════════════════════════════════════════════════════════════

// AAFCO Dog/Cat Food Nutrient Profiles(2016 개정)는 조단백·조지방 등 최소기준을 "4000kcal ME/kg DM" 사료를
// 전제로 설정했다 — 이보다 열량 밀도가 높은 사료는 같은 양을 먹어도 섭취하는 영양소 총량이 적어지므로,
// 실제 비교 시에는 최소기준에 (자사 배합의 kcal ME/kg DM ÷ 4000)를 곱해 보정해야 한다(AAFCO PFC 개·고양이
// 공통 기준 밀도). 열량 밀도가 4000 이하인 사료는 보정 없이 원래 기준을 그대로 적용한다.
const AAFCO_REFERENCE_KCAL_PER_KG_DM = 4000;

function renderEnergyAnalysis(result, pc) {
  const wrap = document.getElementById('tab-ana-energy');
  if (!wrap) return;

  document.getElementById('ae-me-asis').textContent = result.meAsis.toLocaleString('ko', {maximumFractionDigits:0});
  document.getElementById('ae-me-dmb').textContent  = result.meDmb.toLocaleString('ko', {maximumFractionDigits:0});

  const feed = computeFeedingPlan(result);
  document.getElementById('ae-rer').textContent     = feed.rer    ? feed.rer.toFixed(0)    : '─';
  document.getElementById('ae-mer').textContent     = feed.mer    ? feed.mer.toFixed(0)    : '─';
  document.getElementById('ae-daily-g').textContent = feed.dailyG ? feed.dailyG.toFixed(0) : '─';
  document.getElementById('ae-meal-g').textContent  = feed.mealG  ? feed.mealG.toFixed(0)  : '─';

  // ── DER 계수 분해: MER = RER × (생애주기 기초계수 × 활동계수 × BCS계수 × 중성화계수) ──
  const chips = [
    { label: '생애주기', name: feed.target || '─', val: feed.baseFactor },
    { label: '활동량',   name: feed.activity || '─', val: feed.activityMult },
    { label: 'BCS',      name: (feed.bcs ?? '─') + '단계', val: feed.bcsMult },
  ];
  if (feed.neuterApplicable) chips.push({ label: '중성화', name: feed.neuter || '─', val: feed.neuterMult });
  const chainHtml = chips.map((c, i) =>
    (i > 0 ? '<span class="ae-fc-op">×</span>' : '') +
    `<div class="ae-factor-chip"><span class="ae-fc-label">${c.label}</span><span class="ae-fc-name">${c.name}</span><span class="ae-fc-val">${c.val.toFixed(2)}</span></div>`
  ).join('') +
  `<span class="ae-fc-op">=</span><div class="ae-factor-chip ae-fc-final"><span class="ae-fc-label">최종 DER 계수</span><span class="ae-fc-val">${feed.factor ? feed.factor.toFixed(2) : '─'}</span></div>`;
  document.getElementById('ae-factor-rows').innerHTML = `<div class="ae-factor-chain">${chainHtml}</div>`;

  // ── 칼로리 조성: AAFCO Modified Atwater(단백질 3.5 / 지방 8.5 / 탄수화물 3.5 kcal/g)로 ME를 구성한 3대 영양소 비중 ──
  const asis = result.asis;
  const kcalProt = (asis[ING_IDX.PROTEIN] || 0) * 3.5 * 10;
  const kcalFat  = (asis[ING_IDX.FAT] || 0) * 8.5 * 10;
  // F4: ME 기여분도 조섬유를 뺀 NFE 기준(= meAsis 계산과 동일) — 3개 값의 합이 ME(as-is)와 일치해야 함
  const kcalCarb = Math.max((asis[ING_IDX.CARB] || 0) - (asis[ING_IDX.CRUDE_FIBER] || 0), 0) * 3.5 * 10;
  const kcalTot  = kcalProt + kcalFat + kcalCarb;
  const macros = [
    { label: '단백질',   kcal: kcalProt, color: 'var(--acc)',   dmb: result.dmb.prot },
    { label: '지방',     kcal: kcalFat,  color: 'var(--warn-t)', dmb: result.dmb.fat },
    { label: '탄수화물', kcal: kcalCarb, color: 'var(--nrc-t)',  dmb: result.dmb.nfe },
  ];
  document.getElementById('ae-calorie-bars').innerHTML = macros.map(m => {
    const pct = kcalTot > 0 ? (m.kcal / kcalTot * 100) : 0;
    const gPer1000 = result.meDmb > 0 ? (m.dmb * 10000 / result.meDmb) : 0;
    return `<div class="dash-bar-row">
      <div class="dash-bar-label">${m.label}</div>
      <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct.toFixed(1)}%;background:${m.color}"></div></div>
      <div class="dash-bar-pct">${pct.toFixed(0)}%<span style="font-weight:400;color:var(--sub);margin-left:4px">· ${gPer1000.toFixed(0)}g/1000kcal</span></div>
    </div>`;
  }).join('');
  document.getElementById('ae-calorie-note').textContent =
    kcalTot > 0
      ? `%kcal = 각 영양소의 ME 기여분(kcal/kg as-is) ÷ 전체 ME(as-is) — 3개 값의 합은 항상 ME(as-is)와 일치합니다.`
      : '배합비를 입력하면 칼로리 조성이 계산됩니다.';

  // ── AAFCO 열량 밀도 보정: 기준 밀도(4000kcal/kg DM) 대비 현재 배합 ME(DMB)의 배율 ──
  const ratio = result.meDmb > 0 ? result.meDmb / AAFCO_REFERENCE_KCAL_PER_KG_DM : 0;
  const densityBody = document.getElementById('ae-density-body');
  const policy = getEvaluationPolicy(pc);
  if (policy.mode === 'not_for_direct_feeding') {
    densityBody.innerHTML = `<div style="font-size:11px;color:var(--sub)">배합용 원료로 판단되어 열량 밀도 보정 평가를 적용하지 않습니다.</div>`;
  } else if (!ratio) {
    densityBody.innerHTML = `<div style="font-size:11px;color:var(--sub)">배합비를 입력하면 계산됩니다.</div>`;
  } else {
    const target = feed.target || (document.getElementById('sb-target')?.value);
    const findMin = nm => {
      const s = result.standards.find(st => st.name === nm);
      if (!s) return null;
      if (target && target.includes('성장')) return s.aa_gr;
      if (target && target.includes('임신')) return s.aa_rp;
      return s.aa_min;
    };
    const protMin = findMin('조단백');
    const fatMin  = findMin('조지방');
    if (ratio > 1.01) {
      const adjProt = protMin != null ? (protMin * ratio).toFixed(1) : null;
      const adjFat  = fatMin  != null ? (fatMin  * ratio).toFixed(1) : null;
      densityBody.innerHTML = `
        <div class="dash-cap-bar" style="background:var(--warn-bg);border-color:transparent">
          <span class="dash-cap-label" style="color:var(--warn-t)">${svgIcon('warning', 12)} 열량 밀도 ${ratio.toFixed(2)}배</span>
          <span style="font-size:11px;color:var(--text)">ME(DMB) ${result.meDmb.toFixed(0)}kcal/kg — AAFCO 기준 밀도(${AAFCO_REFERENCE_KCAL_PER_KG_DM.toLocaleString()}kcal/kg DM)를 초과합니다.</span>
        </div>
        <div style="font-size:10.5px;color:var(--sub);margin-top:8px;line-height:1.7">
          AAFCO 영양기준(2016 개정)은 4000kcal ME/kg DM 사료를 전제로 설정되어, 이보다 열량 밀도가 높은 사료는
          같은 체중을 유지하기 위해 더 적은 양을 먹게 되므로 필수영양소도 그만큼 더 진하게 들어있어야 합니다.
          이 배합에 보정을 적용하면 조단백·조지방의 실질 최소기준은 다음과 같이 올라갑니다.
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          ${adjProt ? `<div class="ae-factor-chip"><span class="ae-fc-label">조단백 보정 최소치</span><span class="ae-fc-name">${protMin}% → </span><span class="ae-fc-val">${adjProt}% DMB</span></div>` : ''}
          ${adjFat  ? `<div class="ae-factor-chip"><span class="ae-fc-label">조지방 보정 최소치</span><span class="ae-fc-name">${fatMin}% → </span><span class="ae-fc-val">${adjFat}% DMB</span></div>` : ''}
        </div>`;
    } else {
      densityBody.innerHTML = `
        <div class="dash-cap-bar" style="background:var(--pass-bg);border-color:transparent">
          <span class="dash-cap-label" style="color:var(--pass-t)">✅ 열량 밀도 ${ratio.toFixed(2)}배</span>
          <span style="font-size:11px;color:var(--text)">ME(DMB) ${result.meDmb.toFixed(0)}kcal/kg — AAFCO 기준 밀도(${AAFCO_REFERENCE_KCAL_PER_KG_DM.toLocaleString()}kcal/kg DM) 이하이므로 별도 보정 없이 영양 분석 탭의 기준치를 그대로 적용할 수 있습니다.</span>
        </div>`;
    }
  }
}

// 대시보드 막대 차트에 표시할 아미노산 목록(AAFCO 최소치 대비 %로 표시)
const DASH_AMINO_BAR_LIST = ['아르기닌(Arg)','히스티딘(His)','이소류신(Ile)','류신(Leu)','라이신(Lys)','메티오닌+시스틴','페닐알라닌+티로신','트레오닌(Thr)','트립토판(Trp)','발린(Val)'];

function renderDashBarChart(containerId, stds, nameList) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let html = '';
  nameList.forEach(nm => {      
    const s = stds.find(st => st.name === nm);
    if (!s || !s.aa_min || s.value == null) return;
    const pct = s.value / s.aa_min * 100;
    const clamped = Math.max(0, Math.min(150, pct));
    const goodPct = Math.min(clamped, 100);
    const overPct = Math.max(0, clamped - 100);
    const goodWidth = (goodPct / 150 * 100).toFixed(1);
    const overWidth = (overPct / 150 * 100).toFixed(1);
    const overLeft = (100 / 150 * 100).toFixed(1);
    const label = nm.replace(/\([^)]*\)/, '');
    html += `<div class="dash-bar-row">
      <div class="dash-bar-label">${label}</div>
      <div class="dash-bar-track">
        <div class="dash-bar-fill" style="width:${goodWidth}%;background:var(--pass-t);border-radius:${overPct > 0 ? '999px 0 0 999px' : '999px'}"></div>
        ${overPct > 0 ? `<div class="dash-bar-fill" style="left:${overLeft}%;width:${overWidth}%;background:var(--fail-t);border-radius:0 999px 999px 0"></div>` : ''}
      </div>
      <div class="dash-bar-pct">${pct.toFixed(0)}%</div>
    </div>`;
  });
  el.innerHTML = html || '<div class="dash-warn-empty">데이터 없음</div>';
}

function renderDashCapGauge(cap, policy, isCat) {
  const donut = document.getElementById('ds-cap-donut');
  const valEl = document.getElementById('ds-cap-val');
  const badge = document.getElementById('ds-cap-badge');
  if (!donut) return;
  valEl.textContent = cap ? cap.toFixed(2) + ':1' : '─';

  // 판정은 evaluateCapStatus()로 통일(경고 패널 cap-card·대시보드 요약 배지와 동일 로직 재사용).
  // 아이콘만 cap-card와 같은 STATUS_TONE 규칙으로 붙인다 — evaluateCapStatus() 자체는 미변경.
  const status = evaluateCapStatus(cap, policy || { mode: 'complete' }, isCat);
  const color = status.color;
  const CAP_LEVEL_ICON = { pass:'check', warn:'alert-circle', fail:'warning', reference:'info', excluded:'minus', unknown:'alert-circle' };
  badge.style.background = status.bg; badge.style.color = status.color;
  badge.innerHTML = `${svgIcon(CAP_LEVEL_ICON[status.level] || 'minus', 10.5)}${status.label}`;

  const domainMax = 3.0; // 게이지가 표현하는 전체 범위(0~3.0) — Ca:P는 통상 0.5~3 사이에서 움직임
  const deg = status.level === 'excluded' ? 0 : Math.max(0, Math.min(1, (cap || 0) / domainMax)) * 360;
  donut.style.background = `conic-gradient(${color} 0deg ${deg.toFixed(1)}deg, var(--gray-l) ${deg.toFixed(1)}deg 360deg)`;
}

function renderDashIngredientDonut() {
  const donutEl = document.getElementById('ds-ing-donut');
  const legendEl = document.getElementById('ds-ing-legend');
  if (!donutEl || !legendEl) return;

  const rows = getMixRows().filter(([nm, pct]) => nm && pct > 0).sort((a,b) => b[1]-a[1]);
  if (!rows.length) {
    donutEl.style.background = 'var(--gray-l)';
    legendEl.innerHTML = '<div class="dash-warn-empty">배합비를 입력하면 표시됩니다</div>';
    return;
  }

  const top5 = rows.slice(0, 5);
  const restSum = rows.slice(5).reduce((s,r) => s + r[1], 0);
  const slices = top5.map(r => ({ name: r[0], pct: r[1] }));
  if (restSum > 0) slices.push({ name: '기타', pct: restSum });

  const colors = ['var(--acc)','var(--nrc-t)','var(--fed-t)','var(--warn-t)','var(--aa-t)','var(--sub)'];
  const total = slices.reduce((s,x) => s + x.pct, 0) || 1;
  let acc = 0;
  const stops = slices.map((s,i) => {
    const start = acc / total * 360;
    acc += s.pct;
    const end = acc / total * 360;
    return `${colors[i % colors.length]} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
  });
  donutEl.style.background = `conic-gradient(${stops.join(',')})`;

  legendEl.innerHTML = slices.map((s,i) => `
    <div class="dash-legend-row">
      <span class="dash-legend-dot" style="background:${colors[i % colors.length]}"></span>
      <span class="dash-legend-name">${escHtml(s.name)}</span>
      <span class="dash-legend-pct">${s.pct.toFixed(0)}%</span>
    </div>`).join('');
}

function renderDashWarnSummary(elId = 'ds-warn-list') {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!lastWarnItems.length) {
    el.innerHTML = `<div class="dash-warn-empty" style="color:var(--pass-t)">${svgIcon('check', 12)} 현재 경고 항목이 없습니다</div>`;
    return;
  }
  const sorted = [...lastWarnItems].sort((a,b) => (b.ratioPct||0) - (a.ratioPct||0)).slice(0, 6);
  el.innerHTML = sorted.map(w => `
    <div class="dash-warn-item">
      <span class="dash-warn-badge ${w.cls === 'fail' ? 'critical' : 'warning'}">${svgIcon(w.cls === 'fail' ? 'warning' : 'alert-circle', 10)}${w.cls === 'fail' ? '위험' : '주의'}</span>
      <span class="dash-warn-name">${w.name}</span>
      <span class="dash-warn-desc">${w.risk}</span>
    </div>`).join('');
}

async function initAuthGate() {
  // 1. 앱 시작
  authLog('1. 앱 시작 — initAuthGate() 진입', {
    url: window.location.href,
    supabaseClientReady: !!supabaseClient,
  });
  
  // 저장된 "아이디 저장" 설정을 로그인 화면에 반영
  const savedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY);
  if (savedEmail) {
    document.getElementById('login-email').value = savedEmail;
    document.getElementById('login-remember-id').checked = true;
  }

  document.getElementById('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
  document.getElementById('login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
  document.getElementById('forgot-email').addEventListener('keydown', e => { if (e.key === 'Enter') trySendResetEmail(); });
  document.getElementById('reset-pw2').addEventListener('keydown', e => { if (e.key === 'Enter') trySetNewPassword(); });

  if (!supabaseClient) {
    // 5. 로그인 화면을 표시한 이유
    authLog('5. 로그인 화면 표시 이유: supabaseClient가 초기화되지 않음(CDN 로드 실패 등)');
    document.getElementById('login-err').textContent = friendlyAuthError();
    return;
  }

  // 비밀번호 재설정 이메일의 링크를 타고 들어온 경우 URL에 type=recovery가 포함된다 —
  // 이 경우는 세션이 있어도(임시 세션) 계산기로 바로 들여보내지 않고 새 비밀번호 설정 화면을 보여준다.
  const isRecoveryLink = /type=recovery/.test(window.location.hash) || /type=recovery/.test(window.location.search);

  // 4. 현재 auth state — onAuthStateChange가 발생시키는 모든 이벤트를 그대로 로그로 남긴다.
  // (v2 SDK는 초기화 시 INITIAL_SESSION을 포함해 여러 이벤트를 이 콜백으로 보낸다.)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    authLog('4. auth state 변경', { event, hasSession: !!session, userEmail: session?.user?.email ?? null });
    if (event === 'PASSWORD_RECOVERY') {
      authLog('5. 로그인 화면 표시 이유: PASSWORD_RECOVERY 이벤트(비밀번호 재설정 링크로 진입)');
      document.getElementById('login-overlay').classList.remove('hidden');
      showAuthView('reset');
    } else if (event === 'SIGNED_OUT') {
      // 다른 탭에서 로그아웃된 경우까지 포함해 항상 안전하게 새로고침으로 초기 상태로 되돌림
      if (appStarted) {
        authLog('5. 로그인 화면 표시 이유: SIGNED_OUT 이벤트 수신 + 앱이 이미 시작된 상태 → 새로고침으로 초기화');
        location.reload();
      } else {
        authLog('5. 로그인 화면 표시 이유: SIGNED_OUT 이벤트 수신(앱 시작 전) — 로그인 오버레이 노출 유지');
        document.getElementById('login-overlay').classList.remove('hidden');
      }
    }
  });

  // 2. getSession() 호출
  authLog('2. getSession() 호출');
  // Supabase JS SDK가 세션(리프레시 토큰)을 자체적으로 localStorage에 저장·복원하므로,
  // 새로고침해도 로그인 상태가 유지된다(요구사항 9).
  const { data: { session }, error: sessionErr } = await supabaseClient.auth.getSession();
  // 3. getSession() 결과(session 존재 여부)
  authLog('3. getSession() 결과', {
    hasSession: !!session,
    userEmail: session?.user?.email ?? null,
    expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    error: sessionErr ? sessionErr.message : null,
  });
  if (sessionErr) console.warn('getSession() 실패 — 저장된 세션을 복원하지 못했습니다:', sessionErr.message);

  if (isRecoveryLink) {
    authLog('5. 로그인 화면 표시 이유: URL에 비밀번호 재설정 링크(type=recovery) 포함');
    document.getElementById('login-overlay').classList.remove('hidden');
    showAuthView('reset');
  } else if (session) {
    authLog('6. 메인 화면 표시 이유: getSession()이 유효한 세션을 반환함 → enterApp() 호출');
    enterApp(session);
  } else {
    authLog('5. 로그인 화면 표시 이유: getSession()이 세션을 찾지 못함(session=null) → 로그인 폼 유지');
    document.getElementById('login-email').focus();
  }
}

async function init() {
  // 원료 테이블/검색/계산이 모두 ING_DB에 의존하므로 나머지 초기화보다 먼저 채운다.
  await loadBaseIngDB();
  syncThemeButtons();
  initSegmentedControls();
  initBcsGauge();
  initAllergyControl();
  buildMixHdr();
  buildAminoGrid();
  buildStdTable();
  renderIngInitial();
  renderCalcBasisPage();
  buildGlossaryChips();
  renderGlossary();
  initLawChecklist();
  renderNotifList();

  // 이전 버전에서 남아있을 수 있는 레시피 작업 자동 저장분을 정리한다 —
  // 레시피 작업 상태는 더 이상 세션 간에 저장하지 않으므로, 새로 실행하면 항상 빈 상태로 시작한다.
  localStorage.removeItem('feedcalc_v4');
  loadIngDBFromStorage();
  for (let i = 0; i < 6; i++) addMixRow();

  renderIngInitial();
  updateUnitHint();
  calculate();
  initRecipeFolder();
  renderRecentRecipes();
  renderLabelDraft();

  // 새로고침·뒤로가기 후 같은 화면 복원: URL 해시 > sessionStorage > 대시보드.
  const startTab = initialTabId();
  syncTabHash(startTab, true);   // 히스토리 항목 없이 현재 탭을 해시에 반영
  goTab(startTab);
  // 여기까지 와서야 실제로 보여줄 탭이 확정된다 — <head>에서 걸어 둔 부팅용 숨김을 해제해
  // 인증 대기 중 정적 대시보드가 잠깐 노출되던 문제를 없앤다.
  document.documentElement.classList.remove('tabs-booting');

  // 변경 시마다 dirty 플래그를 세운다(원료DB 갱신 목적의 저장은 saveToStorage()가 계속 담당).
  // 레시피 작업 자체는 더 이상 localStorage에 자동 저장하지 않는다 — 새로고침/재실행 시 항상 새 작업으로 시작한다.
  document.getElementById('sb-name').addEventListener('input', debounce(() => { calculate(); saveToStorage(); }, 300));
  document.getElementById('sb-maker').addEventListener('input', debounce(() => { calculate(); saveToStorage(); }, 300));
  document.getElementById('sb-ptype').addEventListener('change', saveToStorage);
  document.getElementById('sb-species')?.addEventListener('change', saveToStorage);
  document.getElementById('sb-target').addEventListener('change', saveToStorage);
  document.getElementById('sb-moist').addEventListener('change', saveToStorage);
  document.getElementById('sb-bw').addEventListener('change', saveToStorage);
  document.getElementById('vitk-inp')?.addEventListener('change', saveToStorage);
  document.getElementById('pet-target-bw')?.addEventListener('change', saveToStorage);
  document.getElementById('pet-weight-goal')?.addEventListener('change', saveToStorage);
  document.getElementById('pet-bcs')?.addEventListener('change', saveToStorage);
  document.getElementById('pet-activity')?.addEventListener('change', saveToStorage);

  // 초기 렌더링 중 calculate() 등이 saveToStorage()를 호출해 생긴 오탐을 걷어내고,
  // 이 시점부터는 실제 사용자 입력만 dirty로 반영한다.
  isDirty  = false;
  appReady = true;
}

// 수정 중인 내용이 있는 상태로 탭을 닫거나 새로고침하면(=프로그램 종료) 브라우저 기본 확인창을 띄운다.
// 취소하면 그대로 페이지에 남고(=프로그램으로 복귀), 종료를 선택하면 현재 작업은 저장되지 않은 채
// 그대로 사라진다 — 레시피 작업 상태를 애초에 localStorage에 쓰지 않으므로 별도로 지울 것이 없다.
window.addEventListener('beforeunload', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

initAuthGate();
