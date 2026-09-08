// export-excel.js — Excel 내보내기(SheetJS) + 배합표 Excel 다운로드(ExcelJS). index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// Excel 내보내기 (SheetJS 사용)
// ════════════════════════════════════════════════════════════════════════════
function exportExcel() {
  if (!lastResult) { alert('먼저 계산을 실행하세요.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.'); return; }
  // 유효하지 않은 배합(음수 배합비·이름 없는 행·합계 100% 초과 등)은 잘못된 수치가 파일로 나가지 않도록 내보내기를 막는다.
  if (lastResult.blendError) { alert('배합에 오류가 있어 Excel로 내보낼 수 없습니다.\n\n' + lastResult.blendError); return; }

  const result  = lastResult;
  const totalG  = getMixTotalG();
  const feed    = computeFeedingPlan(result);
  const rawName = document.getElementById('sb-name').value || '레시피';
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_');

  const wb = XLSX.utils.book_new();

  // 1. 제품정보 + 요약
  const infoAOA = [
    ['제품명',   document.getElementById('sb-name').value || ''],
    ['제조사',   document.getElementById('sb-maker').value || ''],
    ['제품유형', document.getElementById('sb-ptype').value],
    ['종류',     document.getElementById('sb-species')?.value || '개'],
    ['생애주기', document.getElementById('sb-target').value],
    ['수분함량(%)',   document.getElementById('sb-moist').value],
    ['기준체중(kg)',  document.getElementById('sb-bw').value],
    ['총 배치량(g)',  totalG],
    [],
    ['ME (as-is, kcal/kg)', result.meAsis.toFixed(0)],
    ['ME (DMB, kcal/kg)',   result.meDmb.toFixed(0)],
    ['건물 DM(%)',          (result.dmPct*100).toFixed(1)],
    ['배합비 합계(%)',      result.totalRatio.toFixed(1)],
    ['Ca:P 비율',           result.dmb.cap.toFixed(2)],
    [],
    ['기초대사량 RER(kcal/일)',       feed.rer.toFixed(0)],
    ['유지에너지요구량 MER(kcal/일)', feed.mer.toFixed(0)],
    ['일일 급여량(g, as-is)',         feed.dailyG.toFixed(0)],
    ['1회 급여량(g, 2회 기준)',       feed.mealG.toFixed(0)],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoAOA);
  wsInfo['!cols'] = [{wch:26},{wch:22}];
  XLSX.utils.book_append_sheet(wb, wsInfo, '제품정보');

  // 2. 배합설계
  const mixAOA = [['No','원료명','배합비(%)','중량(g)']];
  getMixRows().forEach(([nm, pct], i) => {
    if (!nm) return;
    mixAOA.push([i+1, nm, +pct.toFixed(2), +(pct/100*totalG).toFixed(1)]);
  });
  const wsMix = XLSX.utils.aoa_to_sheet(mixAOA);
  wsMix['!cols'] = [{wch:5},{wch:22},{wch:12},{wch:12}];
  XLSX.utils.book_append_sheet(wb, wsMix, '배합설계');

  // 3. 영양분석
  const anaHeader = ['카테고리','영양소','단위','실측(DMB)','NRC MR','NRC RA','NRC 판정',
                      'AAFCO Min','AAFCO Max','AAFCO 성견','AAFCO 성장견','임신수유','FEDIAF 성견'];
  const anaAOA = [anaHeader];
  result.standards.forEach(s => {
    anaAOA.push([
      s.cat, s.name, s.unit,
      s.value != null ? +s.value.toFixed(4) : '─',
      s.nrc_mr ?? '─', s.nrc_ra ?? '─', J_NRC[s.nrc_j] || '─',
      s.aa_min ?? '─', s.aa_max ?? '─',
      J_LABEL[s.aafco_j] || '─', J_LABEL[s.aafco_gr_j] || '─', J_LABEL[s.aafco_rp_j] || '─',
      J_LABEL[s.fediaf_j] || '─',
    ]);
  });
  if (result.dataIncomplete) {
    anaAOA.push([]);
    anaAOA.push(['※ 일부 원료의 영양소 데이터가 없어 해당 항목은 판정에서 제외됨(값·판정 ─).']);
  }
  const wsAna = XLSX.utils.aoa_to_sheet(anaAOA);
  wsAna['!cols'] = anaHeader.map(() => ({wch:14}));
  XLSX.utils.book_append_sheet(wb, wsAna, '영양분석');

  XLSX.writeFile(wb, `${safeName}_영양계산.xlsx`);
}

// ════════════════════════════════════════════════════════════════════════════
// 배합표 Excel 다운로드 (ExcelJS, 서식 있는 단일 시트 "배합설계")
// ── buildMixReportHtml()/printMixReport()와 마찬가지로 lastResult/lastProductClass/
//    getMixRows()/getMixTotalG()만 읽어 시트에 옮겨 적을 뿐, 배합·영양성분 계산식이나
//    판정 로직(gateJudge/STATUS_TONE)은 새로 만들지 않고 그대로 재사용한다.
// ════════════════════════════════════════════════════════════════════════════
async function exportMixExcel() {
  if (!lastResult) { alert('먼저 배합 설계를 입력해 계산을 실행하세요.'); return; }
  if (typeof ExcelJS === 'undefined') { alert('Excel 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.'); return; }
  // 유효하지 않은 배합(음수 배합비·이름 없는 행·합계 100% 초과 등)은 잘못된 수치가 파일로 나가지 않도록 막는다.
  if (lastResult.blendError) { alert('배합에 오류가 있어 Excel로 내보낼 수 없습니다.\n\n' + lastResult.blendError); return; }

  const result = lastResult;
  const policy = getEvaluationPolicy(lastProductClass);
  const totalG = getMixTotalG();
  const rows   = getMixRows().filter(([nm]) => nm);

  const rawName  = (document.getElementById('sb-name').value || '').trim();
  const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_').trim();
  const today    = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

  // 색·서식은 "배합표 미리보기" A4 보고서(#mixreport-page, .mr-* 클래스, index.html:1494-1539)를
  // 그대로 옮긴 값이다 — 새 디자인을 만들지 않고 PDF에 이미 쓰던 색상·굵기·정렬만 재사용한다.
  const COLS = 5;
  const NAVY = 'FF1E2733', WHITE = 'FFFFFFFF', SUM_BG = 'FFDBE6F5', SUB = 'FF5C6773', BORDER = 'FFD6DBE0';
  const CAT_BG = 'FFEEF1F3';           // .mr-cat-row 배경
  const INFO_LINE = 'FFE1E5E9';        // .mr-info-row border-bottom
  const BODY_FONT_SIZE = 9;            // PDF 표 본문(8.5px)에 대응
  // .mr-badge-pass/fail/over/none의 반투명 배경색을 흰 바탕 위 단색으로 근사(알파 블렌딩 결과)
  const JUDGE_TONE = {
    pass:  { bg: 'FFE2F2E5', fg: 'FF1E7E34' },
    fail:  { bg: 'FFF9E2E2', fg: 'FFC0392B' },
    over:  { bg: 'FFF9E2E2', fg: 'FFC0392B' },
    gated: { bg: CAT_BG,     fg: SUB },
    none:  { bg: CAT_BG,     fg: SUB },
  };
  const thinBorder = () => ({
    top: { style: 'thin', color: { argb: BORDER } }, left: { style: 'thin', color: { argb: BORDER } },
    bottom: { style: 'thin', color: { argb: BORDER } }, right: { style: 'thin', color: { argb: BORDER } },
  });
  function styleHeaderRow(r) {
    r.eachCell(c => {
      c.font = { bold: true, size: BODY_FONT_SIZE, color: { argb: WHITE } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = thinBorder();
    });
    r.height = 16;
  }
  // labelCol: 이 표에서 원료명/영양성분명처럼 왼쪽 정렬해야 하는 열 번호(1-based)
  function styleDataRow(r, labelCol) {
    r.eachCell((c, colNum) => {
      c.font = c.font ? { ...c.font, size: BODY_FONT_SIZE } : { size: BODY_FONT_SIZE, color: { argb: NAVY } };
      c.border = thinBorder();
      c.alignment = { horizontal: colNum === labelCol ? 'left' : 'center', vertical: 'middle' };
    });
  }
  function styleSumRow(r) {
    r.eachCell(c => {
      c.font = { bold: true, size: BODY_FONT_SIZE, color: { argb: NAVY } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_BG } };
      c.border = thinBorder();
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }
  // .mr-cat-row: 카테고리 구분 행 — 전체 폭 병합, 옅은 회색 배경에 굵은 회색 글자, 왼쪽 정렬
  function styleCatRow(ws, catName) {
    const r = ws.addRow([catName]);
    ws.mergeCells(r.number, 1, r.number, COLS);
    const c = r.getCell(1);
    c.font = { bold: true, size: BODY_FONT_SIZE, color: { argb: SUB } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CAT_BG } };
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    c.border = thinBorder();
    return r;
  }
  function mergedBarRow(ws, text, size) {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, COLS);
    const cell = r.getCell(1);
    cell.font = { bold: true, size: size || 11, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    r.height = 20;
    return r;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nutri Circulator';
  wb.created = new Date();
  const ws = wb.addWorksheet('배합설계', {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      showGridLines: false,
    },
  });
  ws.columns = [{ width: 10 }, { width: 26 }, { width: 14 }, { width: 14 }, { width: 16 }];

  // ── 상단(보고서 제목) — PDF .mr-title/.mr-subtitle과 동일하게 큰 제목 + 작은 부제 ──
  const titleRow = ws.addRow(['배합 설계 보고서']);
  ws.mergeCells(titleRow.number, 1, titleRow.number, COLS);
  titleRow.getCell(1).font = { bold: true, size: 18, color: { argb: NAVY } };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 26;

  const subRow = ws.addRow(['Nutri Circulator']);
  ws.mergeCells(subRow.number, 1, subRow.number, COLS);
  subRow.getCell(1).font = { bold: true, size: BODY_FONT_SIZE, color: { argb: SUB } };
  subRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.addRow([]);

  // ── 제품 정보 — PDF .mr-info-row(밑줄 1px)와 동일하게 각 행 아래에 얇은 구분선만 사용 ──
  [
    ['제품명', rawName || '─'],
    ['제품 유형', document.getElementById('sb-ptype').value || '─'],
    ['배합 총량', `${totalG.toLocaleString('ko')} g`],
    ['작성일', today],
  ].forEach(([label, val]) => {
    const r = ws.addRow([label, val]);
    r.getCell(1).font = { bold: true, size: BODY_FONT_SIZE, color: { argb: SUB } };
    r.getCell(2).font = { size: BODY_FONT_SIZE, color: { argb: NAVY } };
    ws.mergeCells(r.number, 2, r.number, COLS);
    for (let i = 1; i <= COLS; i++) r.getCell(i).border = { bottom: { style: 'thin', color: { argb: INFO_LINE } } };
  });
  ws.addRow([]);

  // ── 1. 배합비 ── (원료명은 2열 → styleDataRow(r, 2)로 왼쪽 정렬)
  mergedBarRow(ws, '1. 배합비');
  styleHeaderRow(ws.addRow(['No.', '원료명', '배합비 (%)', '투입량 (g)', '투입량 (kg)']));

  rows.forEach(([nm, pct], i) => {
    const g = pct / 100 * totalG;
    const r = ws.addRow([i + 1, nm, pct / 100, g, g / 1000]);
    r.getCell(3).numFmt = '0.00%';
    r.getCell(4).numFmt = '#,##0.0';
    r.getCell(5).numFmt = '#,##0.000';
    styleDataRow(r, 2);
  });
  const sumRow = ws.addRow(['', '합계', result.totalRatio / 100, totalG, totalG / 1000]);
  sumRow.getCell(3).numFmt = '0.00%';
  sumRow.getCell(4).numFmt = '#,##0.0';
  sumRow.getCell(5).numFmt = '#,##0.000';
  styleSumRow(sumRow);
  ws.addRow([]);

  // ── 2. 영양성분 분석 ── (영양성분명은 1열 → styleDataRow(r, 1)로 왼쪽 정렬. 판정은 대시보드
  //    "주요 영양소 빠른 확인"과 동일하게 gateJudge(s.aafco_j, policy) + STATUS_TONE 라벨을
  //    그대로 재사용 — 새 판정 로직 없음. 카테고리 구분 행은 PDF의 .mr-cat-row 그대로 재현)
  mergedBarRow(ws, '2. 영양성분 분석');
  const anaHeaderRowNum = ws.rowCount + 1;
  styleHeaderRow(ws.addRow(['영양성분', '배합 결과', '기준', '판정', '단위']));

  let curCat = '';
  result.standards.forEach(s => {
    if (s.cat !== curCat) { curCat = s.cat; styleCatRow(ws, curCat); }
    const j = gateJudge(s.aafco_j, policy);
    const tone = (j === 'pass' || j === 'fail' || j === 'over' || j === 'gated') ? j : 'none';
    const label = (STATUS_TONE[tone] || STATUS_TONE.none).label;
    let stdTxt = '─';
    if (s.aa_min != null && s.aa_max != null) stdTxt = `${s.aa_min}~${s.aa_max}`;
    else if (s.aa_min != null) stdTxt = `≥${s.aa_min}`;
    const hasVal = typeof s.value === 'number' && !Number.isNaN(s.value);
    const r = ws.addRow([s.name, hasVal ? s.value : null, stdTxt, label, s.unit || '']);
    if (hasVal) r.getCell(2).numFmt = '#,##0.0000';
    styleDataRow(r, 1);
    const jt = JUDGE_TONE[tone] || JUDGE_TONE.none;
    r.getCell(4).font = { bold: true, size: BODY_FONT_SIZE, color: { argb: jt.fg } };
    r.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: jt.bg } };
  });
  if (result.dataIncomplete) {
    const nr = ws.addRow(['※ 일부 원료의 영양소 데이터가 없어 해당 항목은 판정에서 제외됨(값·판정 공란/─).']);
    nr.getCell(1).font = { italic: true, size: BODY_FONT_SIZE, color: { argb: SUB } };
  }

  // 표가 페이지를 넘어가도 이 헤더 행이 반복 인쇄되도록(PDF의 thead 반복과 동일한 목적).
  // 배합표 미리보기 문서는 스크롤용 표가 아니라 PDF와 같은 "보고서"이므로 틀 고정(freeze panes)은 쓰지 않는다.
  ws.pageSetup.printTitlesRow = `${anaHeaderRowNum}:${anaHeaderRowNum}`;
  ws.views = [{ showGridLines: false }];

  // 열 너비: 실제 내용 길이에 맞춰(긴 원료명·영양성분명이 잘리지 않도록) 최소/최대 폭 안에서 자동 조정
  // 1열은 배합비표에선 "No.", 영양성분표에선 긴 영양성분명을 담으므로 최소폭을 넉넉히 둔다.
  for (let i = 1; i <= COLS; i++) {
    const col = ws.getColumn(i);
    let max = 8;
    col.eachCell({ includeEmpty: true }, cell => {
      const v = cell.value == null ? '' : String(cell.value);
      max = Math.max(max, v.length);
    });
    col.width = Math.min(Math.max(max + 2, i === 2 ? 20 : i === 1 ? 12 : 8), 40);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName ? safeName + ' - 배합설계' : '배합설계'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
