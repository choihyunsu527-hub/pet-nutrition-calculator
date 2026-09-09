// export-pdf.js — 배합표 미리보기/인쇄(A4 배합 설계 보고서). index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 배합표 미리보기 (A4 배합 설계 보고서)
// ── exportExcel()과 동일하게 lastResult/lastProductClass/getMixRows()/getMixTotalG()/
//    computeFeedingPlan()만 읽어서 재배치한다 — 새 계산식·새 판정 로직은 만들지 않는다.
//    "기준/판정" 열은 대시보드 "주요 영양소 빠른 확인"과 같은 방식으로 AAFCO 기준(s.aa_min/aa_max) +
//    gateJudge(s.aafco_j, policy)를 그대로 재사용한다.
// ════════════════════════════════════════════════════════════════════════════
function buildMixReportHtml() {
  const result  = lastResult;
  // 유효하지 않은 배합이면 정상 배합표 대신 오류 안내만 반환한다(openMixPreview에서 이미 막지만 방어적으로 유지).
  if (result && result.blendError) {
    return `<div class="mr-notes" style="color:#c0392b">⚠ 유효하지 않은 배합입니다 — 배합표를 생성할 수 없습니다.<br>${escHtml(result.blendError)}</div>`;
  }
  const pc      = lastProductClass;
  const policy  = getEvaluationPolicy(pc);
  const totalG  = getMixTotalG();
  const feed    = computeFeedingPlan(result);
  const rows    = getMixRows().filter(([nm]) => nm);

  const name   = escHtml(document.getElementById('sb-name').value || '');
  const maker  = escHtml(document.getElementById('sb-maker').value || '');
  const ptype  = escHtml(document.getElementById('sb-ptype').value || '');
  const recipeName = escHtml(document.getElementById('mix-recipe-name')?.value || '');
  const today  = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });

  // ── 1. 배합비 ──
  let mixRowsHtml = '';
  rows.forEach(([nm, pct], i) => {
    const kg = pct / 100 * totalG / 1000;
    mixRowsHtml += `<tr>
      <td>${i+1}</td>
      <td class="mr-left">${escHtml(nm)}</td>
      <td>${pct.toFixed(2)}</td>
      <td>${kg.toFixed(3)}</td>
    </tr>`;
  });
  const sumPct = result.totalRatio;
  const sumKg  = sumPct / 100 * totalG / 1000;
  mixRowsHtml += `<tr class="mr-sum-row">
    <td colspan="2" class="mr-left">합계</td>
    <td>${sumPct.toFixed(1)}%</td>
    <td>${sumKg.toFixed(3)} kg</td>
  </tr>`;

  // ── 2. 영양성분 분석 ──
  let anaRowsHtml = '';
  let curCat = '';
  result.standards.forEach(s => {
    if (s.cat !== curCat) {
      curCat = s.cat;
      anaRowsHtml += `<tr class="mr-cat-row"><td colspan="4">${escHtml(curCat)}</td></tr>`;
    }
    const j = gateJudge(s.aafco_j, policy);
    // tone은 STATUS_TONE 4종(pass/fail/over/gated) 그대로 — gated(평가 제외)를 미함유(none)와 섞지 않는다.
    const tone = (j === 'pass' || j === 'fail' || j === 'over' || j === 'gated') ? j : 'none';
    const t = STATUS_TONE[tone] || STATUS_TONE.none;
    const badgeCls = tone === 'gated' ? 'none' : tone;
    const valTxt = (typeof s.value === 'number' && !Number.isNaN(s.value)) ? `${s.value.toFixed(2)} ${s.unit || ''}`.trim() : '─';
    let stdTxt = '─';
    if (s.aa_min != null && s.aa_max != null) stdTxt = `${s.aa_min}~${s.aa_max} ${s.unit || ''}`.trim();
    else if (s.aa_min != null) stdTxt = `≥${s.aa_min} ${s.unit || ''}`.trim();
    anaRowsHtml += `<tr>
      <td class="mr-left">${escHtml(s.name)}</td>
      <td>${valTxt}</td>
      <td>${stdTxt}</td>
      <td><span class="mr-badge mr-badge-${badgeCls}">${t.label}</span></td>
    </tr>`;
  });

  // ── 3. 원료 구성 비율 ──
  let compHtml = '';
  rows.forEach(([nm, pct]) => {
    compHtml += `<div class="mr-comp-chip"><span class="mr-comp-name">${escHtml(nm)}</span><span class="mr-comp-pct">${pct.toFixed(1)}%</span></div>`;
  });

  // ── 참고 사항 (기존에 이미 쓰이는 정책 문구·기준 문구만 재사용, 새 문구를 지어내지 않음) ──
  const notesHtml = `
    <div>· 본 보고서의 영양성분 값은 건물기준(DMB)이며, NRC 2006 · AAFCO 2023 · FEDIAF 2025 기준을 근거로 합니다.</div>
    <div>· ${escHtml(policy.summary)}</div>
    <div>· "기준/판정" 열은 AAFCO ${((document.getElementById('sb-species')?.value||'개')==='고양이') ? '성묘' : '성견'} 최소~최대 기준과 본 프로그램의 판정 로직을 그대로 사용한 결과입니다.</div>
    ${result.dataIncomplete ? `<div>· 일부 원료의 영양소 데이터가 없어 해당 항목은 값·판정을 ─로 표시하고 판정에서 제외했습니다.</div>` : ''}
  `;

  return `
    <div class="mr-header">
      <div style="width:120px"></div>
      <div class="mr-header-center">
        <div class="mr-title">배합 설계 보고서</div>
        <div class="mr-subtitle">Nutri Circulator</div>
      </div>
      <div class="mr-brand" style="width:120px">Nutri Circulator</div>
    </div>

    <div class="mr-info-grid">
      <div>
        <div class="mr-info-row"><span class="mr-info-label">제품명</span><span class="mr-info-val">${name || '─'}</span></div>
        <div class="mr-info-row"><span class="mr-info-label">제품 유형</span><span class="mr-info-val">${ptype || '─'}</span></div>
        <div class="mr-info-row"><span class="mr-info-label">배합 총량</span><span class="mr-info-val">${totalG.toLocaleString('ko')} g</span></div>
        <div class="mr-info-row"><span class="mr-info-label">작성자</span><span class="mr-info-val" contenteditable="true" data-ph="직접 입력"></span></div>
        <div class="mr-info-row"><span class="mr-info-label">메모</span><span class="mr-info-val" contenteditable="true" data-ph="직접 입력"></span></div>
      </div>
      <div>
        <div class="mr-info-row"><span class="mr-info-label">작성일</span><span class="mr-info-val">${today}</span></div>
        <div class="mr-info-row"><span class="mr-info-label">버전</span><span class="mr-info-val" contenteditable="true" data-ph="직접 입력"></span></div>
        <div class="mr-info-row"><span class="mr-info-label">적용 기준</span><span class="mr-info-val">NRC 2006 · AAFCO 2023 · FEDIAF 2025</span></div>
        <div class="mr-info-row"><span class="mr-info-label">설계 목적</span><span class="mr-info-val" contenteditable="true" data-ph="직접 입력"></span></div>
        <div class="mr-info-row"><span class="mr-info-label">비고</span><span class="mr-info-val" contenteditable="true" data-ph="직접 입력">${recipeName ? `레시피명: ${recipeName}` : ''}</span></div>
      </div>
    </div>

    <div class="mr-section-title">1. 배합비</div>
    <table class="mr-table">
      <thead><tr><th style="width:8%">No.</th><th style="width:42%">원료명</th><th style="width:25%">배합비 (%)</th><th style="width:25%">투입량 (kg)</th></tr></thead>
      <tbody>${mixRowsHtml}</tbody>
    </table>

    <div class="mr-section-title">2. 영양성분 분석 (배합 결과)</div>
    <table class="mr-table">
      <thead><tr><th style="width:34%">영양성분</th><th style="width:22%">배합 결과</th><th style="width:26%">기준</th><th style="width:18%">판정</th></tr></thead>
      <tbody>${anaRowsHtml}</tbody>
    </table>

    <div class="mr-section-title">3. 원료 구성 비율</div>
    <div class="mr-comp-row">${compHtml || '<span style="color:#8892a0">등록된 원료가 없습니다.</span>'}</div>

    <div class="mr-notes">${notesHtml}</div>
    <div class="mr-foot"><span>Nutri Circulator</span><span>생성 시각: ${new Date().toLocaleString('ko-KR')}</span></div>
  `;
}

function openMixPreview() {
  if (!lastResult) { alert('먼저 배합 설계를 입력해 계산을 실행하세요.'); return; }
  // 유효하지 않은 배합(음수 배합비·이름 없는 행·합계 100% 초과 등)은 잘못된 배합표가 만들어지지 않도록 막는다.
  if (lastResult.blendError) { alert('배합에 오류가 있어 배합표를 만들 수 없습니다.\n\n' + lastResult.blendError); return; }
  document.getElementById('mixreport-page').innerHTML = buildMixReportHtml();
  document.getElementById('mixreport-overlay').classList.add('open');
}

// 브라우저의 "PDF로 저장" 인쇄 대화상자는 document.title을 기본 파일명으로 제안한다 —
// exportExcel()의 safeName 치환(Windows 금지문자 \/:*?"<>|)과 동일한 규칙을 재사용해
// "{제품명} - 배합설계.pdf"가 되도록 인쇄 직전에만 title을 바꾸고 끝나면 원래대로 되돌린다.
function printMixReport() {
  const rawName  = (document.getElementById('sb-name').value || '').trim();
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_').trim();
  const prevTitle = document.title;
  document.title = safeName ? `${safeName} - 배합설계` : '배합설계';

  document.body.classList.add('mixreport-printing');
  const cleanup = () => {
    document.body.classList.remove('mixreport-printing');
    document.title = prevTitle;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  // afterprint가 지원되지 않는 환경 대비 안전장치
  setTimeout(cleanup, 3000);
}
