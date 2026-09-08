// nutrition-engine.js — DOM/브라우저 API를 참조하지 않는 순수 영양 계산 로직.
// js/nutrition.js 에서 "원문 그대로" 옮긴 것이며 계산식·상수·입출력 형식은 동일하다.
// index.html에서 js/ingredients.js 다음, js/nutrition.js 앞에 로드된다(전역 함수는 그대로 유지).
// 필요 전역: ING_IDX / ING_COL_COUNT / STANDARDS / STANDARDS_CAT (ingredients.js), getIng (ingredients.js).

// ════════════════════════════════════════════════════════════════════════════
// 계산 엔진 (v4 수식 기준)
// NRC 2006 / AAFCO 2023 Appendix I
// ════════════════════════════════════════════════════════════════════════════

// 계산 엔진: 외부 조회(getIng)·기준표 선택을 전역에서 읽지 않고 인자로만 받는다.
//   ingredientMap  — 원료명 → 원료 배열(48열) 조회. Map 또는 { get(name) } 형태(기본: 전역 ingIndex).
//   standardsTable — 종별 영양기준 배열(기본: species 로 STANDARDS / STANDARDS_CAT 선택).
// 계산 공식·결측 처리·기준 판정·result 구조는 종전과 동일하다.
function calcNutrition(rows, productType, vitkManual, aminoManual, species, ingredientMap, standardsTable) {
  const lookupIng = (ingredientMap && typeof ingredientMap.get === 'function')
      ? (name => ingredientMap.get(name))
      : (name => (ingredientMap ? ingredientMap[name] : undefined));
  // asis[]는 0-based 영양소 위치별 합산값(원료배열에서는 ing[위치 + 1]).
  // 위치 ↔ 영양소 대응은 상단 ING_IDX 한 곳에서만 정의한다.
  const asis = new Array(ING_COL_COUNT).fill(0);
  let totalRatio = 0;
  // 원료DB 셀이 null이면 "실제 0"이 아니라 "데이터 없음" — 해당 영양소는 이 원료가 기여하지 않고,
  // asis 인덱스를 missingCols에 기록해 두었다가 기준 판정에서 fail 대신 '─'(평가 제외)로 처리한다.
  // (숫자 0은 그대로 실제 0으로 합산 — 기존 계산식·F1~F4 로직은 건드리지 않는다.)
  const missingCols = new Set();

  for (const [name, ratio] of rows) {
    if (!name || ratio <= 0) continue;
    const ing = lookupIng(name);
    if (!ing) continue;
    totalRatio += ratio;
    const f = ratio / 100;
    for (let i = 0; i < ING_COL_COUNT; i++) {
      const raw = ing[i + 1];
      if (raw == null) { missingCols.add(i); continue; }   // null/undefined = 결측
      asis[i] += raw * f;
    }
  }

  // ── 배합 유효성 (F3) ──────────────────────────────────────────────────────
  // 원료명이 비어 있는데 배합비만 입력된 행은 조용히 무시하지 않고 "유효하지 않은 배합"으로 본다.
  const hasNamelessRatio = rows.some(([nm, r]) => !nm && r > 0);
  // 이름 있는 행에 음수 배합비가 들어오면(붙여넣기·JS 입력 등) 계산에서 조용히 빠지지 않도록
  // "유효하지 않은 배합비"로 처리한다(0은 정상 — 미사용 행). loop의 ratio<=0 스킵은 그대로 둔다.
  const hasNegativeRatio = rows.some(([nm, r]) => nm && r < 0);

  // ── 상대 배합비 정규화 (F1) ───────────────────────────────────────────────
  // DMB·기준판정은 "상대 배합비" 기준으로 계산한다 — 배합비 합계로 정규화해 배치 크기(합계<100%)와
  // 무관하게 농도가 일정해진다. 합계가 100%면 dmScale === 1 이라 기존 계산값과 완전히 동일하다.
  const dmScale = totalRatio > 0 ? 100 / totalRatio : 0;
  const nrm = i => asis[i] * dmScale;   // 정규화된 "최종 100g당" 함량

  // 수분함량은 배합에 들어간 원료들의 실제 수분값을 배합비로 가중평균해 자동 계산한다.
  const autoMoisturePct = nrm(1);
  const dmFrac = 1 - autoMoisturePct / 100;

  // ── 입력 오류 상태 (F2) ───────────────────────────────────────────────────
  // 배합비 합계가 100%를 넘거나, 정규화 후에도 건물률이 비정상(수분 ≥ 100% 또는 건물 < 1%)이면
  // DMB/ME를 하한값으로 억지 계산해 폭주시키지 않고 "입력 오류"로 표시한다(기준판정은 전부 '─').
  const blendError =
      hasNegativeRatio
        ? '배합비에 음수 값이 입력된 행이 있습니다. 0 이상의 값으로 수정해 주세요.'
    : hasNamelessRatio
        ? '원료명이 선택되지 않은 행에 배합비가 입력되어 있습니다. 해당 행의 원료를 지정하거나 배합비를 비워 주세요.'
    : totalRatio > 100 + 0.01
        ? `배합비 합계가 ${totalRatio.toFixed(1)}%로 100%를 초과합니다. 합계를 100% 이하로 맞춰 주세요.`
    : (totalRatio > 0 && dmFrac < 0.01)
        ? `건물률(${(dmFrac * 100).toFixed(1)}%)이 비정상입니다 — 수분이 100%에 가까운 배합은 영양 기준을 평가할 수 없습니다.`
    : null;

  const dmPct = Math.max(dmFrac, 0.001);
  // F4: 원료DB의 "탄수화물"은 차이법 값(= NFE + 조섬유)이므로, Modified Atwater 3.5 kcal/g은
  // 조섬유를 뺀 가용무질소물(NFE)에만 적용한다. 조섬유(asis[ING_IDX.CRUDE_FIBER])가 0이면 기존 계산과 동일.
  const nfeAsis = Math.max(asis[ING_IDX.CARB] - asis[ING_IDX.CRUDE_FIBER], 0);
  const meAsis = (asis[ING_IDX.PROTEIN]*3.5 + asis[ING_IDX.FAT]*8.5 + nfeAsis*3.5) * 10;   // as-is: 실제 배합 그대로(정규화 전)
  const meDmb  = meAsis * dmScale / dmPct;   // 정규화·DMB도 동일 원칙(dmScale 선형 반영)

  const pct    = i => nrm(i) / dmPct;
  const mgPct  = i => nrm(i) / 1000 / dmPct;
  const mgKg   = i => nrm(i) * 10 / dmPct;
  const ugMgKg = i => nrm(i) / 100 / dmPct;
  const ugUgKg = i => nrm(i) * 10 / dmPct;
  const IUkg   = i => nrm(i) * 10 / dmPct;

  const caPct = mgPct(ING_IDX.CA);
  const pPct  = mgPct(ING_IDX.P);
  const cap   = pPct > 0 ? caPct / pPct : 0;

  const dmb = {
    kcal: nrm(ING_IDX.KCAL) / dmPct, moist: autoMoisturePct,
    prot: pct(ING_IDX.PROTEIN),  fat:  pct(ING_IDX.FAT),  nfe:  pct(ING_IDX.CARB),  ash:  pct(ING_IDX.ASH),  chol: mgKg(ING_IDX.CHOLESTEROL),
    ca:   caPct,   p:    pPct,    cap:  cap,
    na:   mgPct(ING_IDX.NA), k:   mgPct(ING_IDX.K), mg: mgPct(ING_IDX.MG),
    fe:   mgKg(ING_IDX.FE), zn:  mgKg(ING_IDX.ZN), se:  ugMgKg(ING_IDX.SE),
    vitA: IUkg(ING_IDX.VIT_A), vitD: IUkg(ING_IDX.VIT_D), vitE: mgKg(ING_IDX.VIT_E), vitK: mgKg(ING_IDX.VIT_K),
    b1:   mgKg(ING_IDX.VIT_B1), b2:  mgKg(ING_IDX.VIT_B2), b3:  mgKg(ING_IDX.VIT_B3),
    b5:   mgKg(ING_IDX.VIT_B5), b6:  mgKg(ING_IDX.VIT_B6), b9:  ugMgKg(ING_IDX.FOLATE), b12: ugUgKg(ING_IDX.VIT_B12),
    epa:  mgKg(ING_IDX.EPA), dha: mgKg(ING_IDX.DHA),
    epaKcal: meDmb > 0 ? mgKg(ING_IDX.EPA) / (meDmb/1000) : 0,
    dhaKcal: meDmb > 0 ? mgKg(ING_IDX.DHA) / (meDmb/1000) : 0,
    cu:      mgKg(ING_IDX.CU),
    mn:      mgKg(ING_IDX.MN),
    iodine:  ugMgKg(ING_IDX.IODINE),
    cl:      mgPct(ING_IDX.CL),
    choline: mgKg(ING_IDX.CHOLINE),
    biotin:  ugUgKg(ING_IDX.BIOTIN),
    la:      pct(ING_IDX.LA),
    ala:     pct(ING_IDX.ALA),
    fiber:   pct(ING_IDX.CRUDE_FIBER),
    arg:     pct(ING_IDX.ARG),
    his:     pct(ING_IDX.HIS),
    ile:     pct(ING_IDX.ILE),
    leu:     pct(ING_IDX.LEU),
    lys:     pct(ING_IDX.LYS),
    metcys:  pct(ING_IDX.MET_CYS),
    phetyr:  pct(ING_IDX.PHE_TYR),
    thr:     pct(ING_IDX.THR),
    trp:     pct(ING_IDX.TRP),
    val:     pct(ING_IDX.VAL),
    tau:     mgKg(ING_IDX.TAURINE),
    omega6_3ratio: (pct(ING_IDX.LA) > 0 && (mgKg(ING_IDX.EPA) + mgKg(ING_IDX.DHA) + pct(ING_IDX.ALA)) > 0)
                   ? pct(ING_IDX.LA) / (mgKg(ING_IDX.EPA)/1000 + mgKg(ING_IDX.DHA)/1000 + pct(ING_IDX.ALA))
                   : 0,
  };

  const valMap = {
    "조단백": dmb.prot, "조지방": dmb.fat,
    "칼슘(Ca)": dmb.ca, "인(P)": dmb.p, "Ca:P 비율": dmb.cap,
    "나트륨(Na)": dmb.na, "칼륨(K)": dmb.k, "마그네슘(Mg)": dmb.mg,
    "철(Fe)": dmb.fe, "아연(Zn)": dmb.zn, "셀레늄(Se)": dmb.se,
    "비타민A": dmb.vitA, "비타민D": dmb.vitD, "비타민E(α-TE)": dmb.vitE,
    "비타민K": dmb.vitK,
    "비타민B1(티아민)": dmb.b1, "비타민B2(리보플라빈)": dmb.b2,
    "비타민B3(나이아신)": dmb.b3, "비타민B5(판토텐산)": dmb.b5,
    "비타민B6(피리독신)": dmb.b6, "비타민B9(엽산)": dmb.b9,
    "비타민B12(코발라민)": dmb.b12,
    "EPA": dmb.epaKcal, "DHA": dmb.dhaKcal,
    "EPA+DHA": (dmb.epa + dmb.dha) / 10000,
    "구리(Cu)":     dmb.cu,
    "망간(Mn)":     dmb.mn,
    "요오드(I)":    dmb.iodine,
    "염소(Cl)":     dmb.cl,
    "콜린":         dmb.choline,
    "비오틴(B7)":   dmb.biotin,
    "리놀레산(LA,n-6)": dmb.la,
    "ALA(α-리놀렌,n-3)": dmb.ala,
    "조섬유": dmb.fiber,
    "수분":                 dmb.moist,
    "ω-6:ω-3 비율": dmb.la > 0 && (dmb.epa + dmb.dha + dmb.ala) > 0
                            ? dmb.la / (dmb.epa + dmb.dha + dmb.ala)
                            : null,
    "조회분":              dmb.ash,
    "탄수화물(NFE)":       dmb.nfe,
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

  function judge(v, lo, hi) {
    if (v == null || lo == null || lo === 0) return "─";
    if (hi && v > hi) return "over";
    if (v >= lo) return "pass";
    return "fail";
  }

  // 기준 영양소명 → 그 값을 만드는 asis 인덱스(들). 배합에 쓰인 어느 원료든 이 인덱스가 결측이면
  // 해당 기준은 "데이터 없음"이라 판정하지 않는다(값 null → judge()가 기존대로 '─' 반환).
  const STD_ASIS_COL = {
    "수분":ING_IDX.MOISTURE, "조단백":ING_IDX.PROTEIN, "조지방":ING_IDX.FAT, "탄수화물(NFE)":ING_IDX.CARB, "조회분":ING_IDX.ASH,
    "칼슘(Ca)":ING_IDX.CA, "인(P)":ING_IDX.P, "Ca:P 비율":[ING_IDX.CA,ING_IDX.P], "나트륨(Na)":ING_IDX.NA, "칼륨(K)":ING_IDX.K,
    "철(Fe)":ING_IDX.FE, "아연(Zn)":ING_IDX.ZN, "마그네슘(Mg)":ING_IDX.MG, "셀레늄(Se)":ING_IDX.SE,
    "비타민A":ING_IDX.VIT_A, "비타민D":ING_IDX.VIT_D, "비타민E(α-TE)":ING_IDX.VIT_E, "비타민K":ING_IDX.VIT_K,
    "비타민B1(티아민)":ING_IDX.VIT_B1, "비타민B2(리보플라빈)":ING_IDX.VIT_B2, "비타민B3(나이아신)":ING_IDX.VIT_B3,
    "비타민B5(판토텐산)":ING_IDX.VIT_B5, "비타민B6(피리독신)":ING_IDX.VIT_B6, "비타민B9(엽산)":ING_IDX.FOLATE, "비타민B12(코발라민)":ING_IDX.VIT_B12,
    "EPA":ING_IDX.EPA, "DHA":ING_IDX.DHA, "EPA+DHA":[ING_IDX.EPA,ING_IDX.DHA],
    "구리(Cu)":ING_IDX.CU, "망간(Mn)":ING_IDX.MN, "요오드(I)":ING_IDX.IODINE, "염소(Cl)":ING_IDX.CL, "콜린":ING_IDX.CHOLINE, "비오틴(B7)":ING_IDX.BIOTIN,
    "리놀레산(LA,n-6)":ING_IDX.LA, "ALA(α-리놀렌,n-3)":ING_IDX.ALA, "조섬유":ING_IDX.CRUDE_FIBER, "ω-6:ω-3 비율":[ING_IDX.LA,ING_IDX.ALA,ING_IDX.EPA,ING_IDX.DHA],
    "아르기닌(Arg)":ING_IDX.ARG, "히스티딘(His)":ING_IDX.HIS, "이소류신(Ile)":ING_IDX.ILE, "류신(Leu)":ING_IDX.LEU, "라이신(Lys)":ING_IDX.LYS,
    "메티오닌+시스틴":ING_IDX.MET_CYS, "페닐알라닌+티로신":ING_IDX.PHE_TYR, "트레오닌(Thr)":ING_IDX.THR, "트립토판(Trp)":ING_IDX.TRP,
    "발린(Val)":ING_IDX.VAL, "타우린(Tau)*":ING_IDX.TAURINE,
  };
  const stdColMissing = nm => {
    const c = STD_ASIS_COL[nm];
    if (c == null) return false;
    return Array.isArray(c) ? c.some(x => missingCols.has(x)) : missingCols.has(c);
  };

  const STD = standardsTable || (species === '고양이' ? STANDARDS_CAT : STANDARDS);
  const standards = STD.map(std => {
    const [nm,unit,mr,ra,aa,aaMax,aaGr,aaRp,fed,fedGr,cat] = std;
    // 입력 오류 상태(F2·F3)이거나, 배합 원료 중 해당 영양소 데이터가 결측이면 판정하지 않는다 — 값 null → 전부 '─'.
    const v = (blendError || stdColMissing(nm)) ? null : valMap[nm];
    return {
      name:nm, unit, value:v, cat,
      nrc_mr:mr, nrc_ra:ra,
      aa_min:aa, aa_max:aaMax, aa_gr:aaGr, aa_rp:aaRp,
      fed_ad:fed, fed_gr:fedGr,
      // RA(권장섭취량)는 상한섭취량이 아니라 "권장" 수치일 뿐이므로, RA를 넘겼다고 'over'(초과)로
      // 판정하지 않는다 — NRC MR(최소요구량)만 충족하면 'pass'. RA는 표에 참고값으로만 표시.
      nrc_j:     judge(v, mr,   null),
      aafco_j:   judge(v, aa,   aaMax),
      aafco_gr_j:judge(v, aaGr, null),
      aafco_rp_j:judge(v, aaRp, null),
      fediaf_j:  judge(v, fed,  null),
    };
  });

  // missingCols: 결측이 기록된 asis 인덱스 목록. dataIncomplete: 화면 안내용(기준이 있는 영양소 중 결측 존재 여부).
  const missingColsArr = [...missingCols];
  const dataIncomplete = standards.some(s => stdColMissing(s.name) && (s.aa_min != null || s.nrc_mr != null || s.fed_ad != null));
  return { totalRatio, asis, dmPct, meAsis, meDmb, dmb, valMap, standards, blendError, missingCols: missingColsArr, dataIncomplete };
}

function getAminoStds(species) {
  return (species === '고양이' ? STANDARDS_CAT : STANDARDS).filter(s => s[10] === '아미노산');
}
// 필수아미노산 10종만 대상 — 타우린은 전형적인 필수아미노산이 아니라(고양이 특이 조건부 필수) 제외
const LIMITING_AA_LIST = ['아르기닌(Arg)','히스티딘(His)','이소류신(Ile)','류신(Leu)','라이신(Lys)',
                          '메티오닌+시스틴','페닐알라닌+티로신','트레오닌(Thr)','트립토판(Trp)','발린(Val)'];
// "1.50% DMB"처럼 % 단위는 숫자에 붙이고, g처럼 % 아닌 단위는 띄어서 표기
function fmtAminoAmt(value, unit) {
  if (value == null) return '─';
  return unit && unit.startsWith('%') ? `${value.toFixed(2)}${unit}` : `${value.toFixed(2)} ${unit || ''}`;
}
const PTYPE_META = {
  staple: {
    short: '주식', en: 'Complete &amp; Balanced', icon: 'beef',
    label: '주식 유형으로 분석됨',
    desc: '입력된 영양성분을 분석한 결과, AAFCO 완전·균형식(주식) 프로파일에 가까운 제품으로 분석됩니다.',
  },
  supplement: {
    short: '보조식', en: 'Supplementary / Complementary', icon: 'soup',
    label: '보조식 유형으로 분석됨',
    desc: '특정 영양소나 기능성 원료를 보충하는 목적의 보조식 유형으로 분석됩니다. 완전·균형식 판정은 적용하지 않으며, 주식으로 전환하려면 어떤 영양소가 더 필요한지를 안내합니다.',
  },
  treat: {
    short: '간식', en: 'Treat / Snack', icon: 'bone',
    label: '간식 유형으로 분석됨',
    desc: '전체 영양소 요구량을 충족하도록 설계되지 않은 간식(기호식) 유형으로 분석됩니다. 주식용 AAFCO 완전·균형식 기준은 적용하지 않습니다.',
  },
  unsuitable: {
    short: '직접 급여 불가', en: 'Not for Direct Feeding', icon: 'ban',
    label: '직접 급여 불가로 분석됨',
    desc: '배합용 고농축 영양소 원료(미네랄·비타민 프리믹스 등)가 배합비의 대부분을 차지해, 이 상태로는 단독 급여용 완제품이 아니라 다른 원료와 배합해야 하는 원료로 분석됩니다.',
  },
};
const PTYPE_CONF_LABEL = { high: '높은 신뢰도', medium: '중간 신뢰도', low: '낮은 신뢰도' };
// pc(제품 유형 판정 결과)가 없거나 유형이 확정되지 않았으면 기존 동작(주식 기준 그대로 적용)을 유지 —
// 이 기능은 "명확하게 간식/보조식으로 판정됐을 때만" 결핍·초과 표시를 완화한다.
function isStapleClass(pc) { return !pc || !pc.type || pc.type === 'staple'; }
const EVAL_MODE_BY_TYPE = { staple: 'complete', treat: 'snack', supplement: 'supplement', unsuitable: 'not_for_direct_feeding' };
const EVAL_MODE_META = {
  complete: {
    label: '완전·균형식(AAFCO)',
    evalMinDeficiency: true, evalMaxExcess: true, showCompleteness: true, hideStandardsTable: false,
    summary: '평가 기준: AAFCO 완전·균형식',
    bannerNote: null, // 주식은 배너 자체를 표시하지 않음(isStapleClass)
  },
  snack: {
    label: '간식(기준 비교 제외)',
    evalMinDeficiency: false, evalMaxExcess: false, showCompleteness: false, hideStandardsTable: true,
    summary: '평가 기준: 영양 기준 비교 제외 / 원료구성·칼로리·기본 영양성분만 표시',
    bannerNote: '간식 유형은 AAFCO/NRC/FEDIAF 영양 기준 비교와 결핍·초과 경고를 적용하지 않으며, 원료 구성·칼로리·기본 영양성분만 참고용으로 표시합니다.',
  },
  supplement: {
    label: '보조식(결핍 표시, 완전균형식 판정 제외)',
    evalMinDeficiency: true, evalMaxExcess: true, showCompleteness: false, hideStandardsTable: false,
    summary: '평가 기준: AAFCO/NRC 결핍·과다 평가 적용 / 완전·균형식 판정은 미적용',
    bannerNote: '보조식은 완전·균형식 판정을 내리지 않지만, 주식으로 전환할 때 보완이 필요한 부족 영양소는 아래에서 그대로 확인할 수 있습니다.',
  },
  not_for_direct_feeding: {
    label: '배합용 원료(평가 제외)',
    evalMinDeficiency: false, evalMaxExcess: false, showCompleteness: false, hideStandardsTable: false,
    summary: '평가 기준: 일반 식품 영양 평가 제외 / 배합 원료로 관리',
    bannerNote: '직접 급여용 제품이 아닌 배합용 원료로 판단되어 일반적인 주식/간식 영양 평가를 적용하지 않습니다.',
  },
};
// pc(제품 유형 판정 결과)를 받아 현재 적용할 평가 정책을 반환. pc가 없거나 유형 미확정이면 주식(complete) 정책 유지.
function getEvaluationPolicy(pc) {
  const mode = (pc && pc.evaluationMode) || (pc && pc.type && EVAL_MODE_BY_TYPE[pc.type]) || 'complete';
  return { mode, ...EVAL_MODE_META[mode] };
}
// judge() 결과값(pass/fail/over/─)을 평가 정책에 따라 화면 표시용 값으로 변환.
// - complete(주식)·supplement(보조식): 그대로 — 결핍(fail)·초과(over) 모두 실측 판정 유지
// - snack(간식)·not_for_direct_feeding(직접급여불가): fail/over 모두 'gated'(평가 제외)
function gateJudge(j, policy) {
  if (j !== 'fail' && j !== 'over') return j;
  if (j === 'fail' && !policy.evalMinDeficiency) return 'gated';
  if (j === 'over' && !policy.evalMaxExcess) return 'gated';
  return j;
}
// Ca:P 비율 평가를 한 곳에서 계산해 경고 패널(cap-card)·대시보드 게이지(renderDashCapGauge)
// 두 곳이 동일한 판정을 재사용하도록 한다(로직 중복 방지).
// Ca:P 수치·정상범위(1.1~2.0, 심각 <0.8 또는 >2.5) 계산 자체는 그대로 두고, "그 판정을 얼마나
// 심각하게 보여줄지"만 평가 정책에 따라 완화한다 — 보조식은 위험 대신 참고로, 간식·직접급여불가는 평가 제외.
function evaluateCapStatus(cap, policy, isCat) {
  const lowPass = isCat ? 1.0 : 1.1;
  if (!policy.evalMaxExcess) {
    const reason = policy.mode === 'not_for_direct_feeding'
      ? '배합용 원료로 판단되어 일반 식품 기준을 적용하지 않습니다.'
      : `${policy.label} 유형은 영양 기준 비교를 적용하지 않습니다.`;
    return { level: 'excluded', label: '평가 제외', text: `Ca:P 평가 제외 — ${reason}`,
      color: 'var(--sub)', bg: 'var(--gray-l)' };
  }
  if (cap === 0) {
    return { level: 'unknown', label: '계산 불가', text: 'Ca 또는 P = 0 — 계산 불가', color: 'var(--warn-t)', bg: 'var(--warn-bg)' };
  }
  if (cap >= lowPass && cap <= 2.0) {
    return { level: 'pass', label: '정상',
      text: `[정상] Ca:P=${cap.toFixed(2)} — 정상 범위 (${isCat?'고양이':'AAFCO 성견'} 권장 ${lowPass}~2.0)`,
      color: 'var(--pass-t)', bg: 'var(--pass-bg)' };
  }
  const severe = cap < 0.8 || cap > 2.5;
  const dir = cap < lowPass ? '낮음' : '높음';
  if (!policy.showCompleteness) {
    // 보조식: 적정 범위를 벗어나도 주식과 동일한 "위험/심각" 판정을 적용하지 않고 참고 수준으로 완화
    return { level: 'reference', label: '참고',
      text: `[참고] Ca:P=${cap.toFixed(2)} — 권장 범위(${lowPass}~2.0)에서 벗어남(${dir}). ${policy.label} 유형은 주식과 동일한 위험 판정을 적용하지 않습니다.`,
      color: 'var(--warn-t)', bg: 'var(--warn-bg)' };
  }
  if (severe) {
    const reason = cap < 0.8 ? 'Ca 심각 부족 (골격기형 위험' : 'Ca 과잉 (연골석회화 위험';
    return { level: 'fail', label: '위험',
      text: `[심각] Ca:P=${cap.toFixed(2)} — ${reason}, 권장 ${lowPass}~2.0)`, color: 'var(--fail-t)', bg: 'var(--fail-bg)' };
  }
  return { level: 'warn', label: '주의',
    text: `[주의] Ca:P=${cap.toFixed(2)} — ${dir} (권장 ${lowPass}~2.0)`, color: 'var(--warn-t)', bg: 'var(--warn-bg)' };
}
// 배합용 고농축 영양소 원료(미네랄·비타민 프리믹스, 단일 합성 무기염류 등) 이름 패턴 판별.
// getIngCategory()(원료DB 표 분류)와 같은 방식 — 원료명 패턴 매칭 — 을 재사용한다.
// 핵심은 "영양소 함량이 높다"가 아니라 "원료 자체가 배합용 첨가제/보충제 성격"인지를 이름으로
// 구분하는 것 — 육류·생선 등 일반 식품은 미량영양소 함량이 아무리 높아도 여기 해당하지 않는다.
// (원료DB에는 현재 이런 원료가 없어 대량의 하드코딩 목록 대신 이름 패턴만으로 판별한다.)
function isConcentrateSupplementIngredient(name) {
  return /프리믹스|premix|비타민|미네랄|무기질|킬레이트|chelate|^(DL-|L-)|탄산칼슘|인산칼슘|황산아연|황산구리|황산망간|황산철|황산마그네슘|산화마그네슘|아셀렌산|요오드산/i.test(name);
}
function classifyProductPurpose(result, rows) {
  if (!result || !(result.totalRatio > 0)) return { type: null, noData: true };

  // 기존 AAFCO 최소/최대 기준 충족률 계산 — 그대로 유지(주식/보조식 판정의 핵심 신호)
  const stds = result.standards || [];
  const essential = stds.filter(s => s.aa_min != null && s.aa_min > 0);
  // value === null 은 "원료 데이터 결측 → 판정 불가(미평가)"다. 완전성(completeness) 계산에서는
  // 이런 항목을 pass/fail 어느 쪽도 아닌 "평가 제외"로 보고 분모·분자 모두에서 뺀다.
  // (실측 0은 종전대로 "원료에 해당 영양소가 없음"으로 보고 분모에 남겨 completeness를 낮춘다.)
  // withData / minPassRate / failItems / overMaxItems 는 이미 value>0 만 대상이라 결과가 종전과 동일하다.
  const evaluableEssential = essential.filter(s => s.value != null);
  const withData  = evaluableEssential.filter(s => s.value > 0);
  const completeness = evaluableEssential.length ? withData.length / evaluableEssential.length : 0;
  const metMin  = withData.filter(s => s.value >= s.aa_min);
  const minPassRate = withData.length ? metMin.length / withData.length : 0;
  const failItems = withData.filter(s => s.value < s.aa_min)
    .map(s => ({ name: s.name, value: s.value, min: s.aa_min, unit: s.unit }));
  const overMaxItems = withData.filter(s => s.aa_max != null && s.value > s.aa_max)
    .map(s => ({ name: s.name, value: s.value, max: s.aa_max, unit: s.unit }));

  const dmb = result.dmb;
  const topNutrients = [
    { name: '조단백', value: dmb.prot,  unit: '% DMB' },
    { name: '조지방', value: dmb.fat,   unit: '% DMB' },
    { name: '조섬유', value: dmb.fiber, unit: '% DMB' },
    { name: '조회분', value: dmb.ash,   unit: '% DMB' },
    { name: '수분',   value: dmb.moist, unit: '%' },
    { name: 'ME(대사에너지)', value: result.meAsis, unit: 'kcal/kg' },
  ];
  const baseStats = {
    completeness, minPassRate,
    essentialCount: essential.length, evaluableEssentialCount: evaluableEssential.length,
    withDataCount: withData.length, metMinCount: metMin.length,
    failItems, overMaxItems, topNutrients,
  };
  function build(type, confidence, reasons) {
    const evaluationMode = EVAL_MODE_BY_TYPE[type];
    return {
      type, ...PTYPE_META[type], confidence, confidenceLabel: PTYPE_CONF_LABEL[confidence], ...baseStats, reasons,
      evaluationMode, evaluationPolicy: EVAL_MODE_META[evaluationMode],
    };
  }

  // 배합에 실제로 사용된(이름 있고 배합비>0, 원료DB에 존재하는) 원료만 이름 기준으로 집계
  // — 동일 원료가 여러 행에 나뉘어 입력된 경우 합산한다.
  const activeByName = {};
  (rows || []).forEach(([name, ratio]) => {
    if (!name || !(ratio > 0) || !getIng(name)) return;
    activeByName[name] = (activeByName[name] || 0) + ratio;
  });
  const activeNames = Object.keys(activeByName);
  const totalRatio  = result.totalRatio;

  // ── ① 직접 급여 불가 원료 판정(최우선) ──────────────────────────────
  // 미네랄·비타민 프리믹스 등 배합용 첨가제 원료가 배합비의 절반 이상을 차지하면, 정상적인
  // "완전식에 소량(보통 1~5%) 배합된 프리믹스"가 아니라 원료 자체를 완제품처럼 입력한 상태로 보고
  // 직접 급여 불가로 판정한다.
  const supplementNames = activeNames.filter(isConcentrateSupplementIngredient);
  const supplementRatio = supplementNames.reduce((s, nm) => s + activeByName[nm], 0);
  if (totalRatio > 0 && supplementRatio / totalRatio >= 0.5) {
    return build('unsuitable', 'high', [
      `${supplementNames.join(', ')} 등 배합용 영양소 원료(미네랄·비타민 프리믹스 등)가 배합비의 ${Math.round(supplementRatio / totalRatio * 100)}%를 차지합니다.`,
      '일반적인 단독 급여용 식품이 아니라, 완제품 배합을 위한 원료로 사용해야 합니다.',
    ]);
  }

  // 실제 원료(생것/자연식품) 데이터로 검증한 결과, 완전성(completeness)만으로는 간식과 보조식을 잘
  // 구분하지 못했다 — 예: 닭가슴살 하나로만 구성된 전형적인 간식도 원료DB(USDA 기반)에 미량영양소
  // 흔적치가 폭넓게 잡혀 있어 완전성이 87%까지 나온다. 반면 실제로 AAFCO 최소기준을 "충족"하는
  // 비율(minPassRate)은 합성 비타민·미네랄 프리믹스가 들어가야만 높게 나오므로, 주식 여부를 가르는
  // 핵심 신호는 completeness가 아니라 minPassRate다. completeness는 "데이터가 거의 없는" 극단적인
  // 경우(예: 단백질·지방만 입력된 경우)를 추가로 잡아내는 보조 신호로만 사용한다.
  // 안전장치: 결측이 많아 "평가 가능한" 필수 영양소가 절반도 안 되면, completeness가 높게 나와도
  // (예: 5/5=100%) 주식이라고 확신할 근거가 부족하므로 주식 판정을 하지 않는다.
  const enoughEvaluable = essential.length === 0 || evaluableEssential.length >= essential.length * 0.5;
  const nutritionSaysStaple = enoughEvaluable && completeness >= 0.85 && minPassRate >= 0.90 && overMaxItems.length === 0;

  // ── ②·③ 단일 식품 원료 100%는 기본적으로 간식 ───────────────────────
  // 단, "단일 원료 = 무조건 간식"으로 하드코딩하지 않는다 — 그 원료 하나만으로도 이미 영양학적으로
  // 완전·균형식 기준을 충족한다고 판단되면(nutritionSaysStaple) 기존 주식 판정 로직을 그대로 우선시킨다.
  if (activeNames.length === 1 && !nutritionSaysStaple) {
    return build('treat', 'high', [
      `${activeNames[0]} 단일 식품 원료 100% 배합입니다.`,
      '여러 필수 영양소를 보강하는 완전·균형식 설계가 아닌 단일 원료 제품입니다.',
      '주식보다는 간식 또는 토핑 용도에 적합합니다.',
    ]);
  }

  // ── ④ 복합 배합 제품(또는 완전식으로 판정된 단일 원료): 기존 AAFCO 충족률 기반 주식/보조식 판정 ──
  if (nutritionSaysStaple) {
    const confidence = (completeness >= 0.95 && minPassRate >= 0.97) ? 'high' : 'medium';
    return build('staple', confidence, [
      `AAFCO 최소기준이 있는 필수 영양소 ${essential.length}개 중 ${withData.length}개(${Math.round(completeness*100)}%)에 데이터가 입력되어 있습니다.`,
      `입력된 영양소 중 AAFCO 최소 기준 충족 ${metMin.length}/${withData.length}개(${Math.round(minPassRate*100)}%)입니다.`,
      'AAFCO 최대 기준을 초과한 영양소가 없습니다.',
    ]);
  }

  const veryLow = overMaxItems.length === 0 && (minPassRate < 0.5 || completeness < 0.3);
  const nearBoundary = Math.abs(minPassRate - 0.90) < 0.08 || Math.abs(minPassRate - 0.5) < 0.08 || Math.abs(completeness - 0.3) < 0.06;
  const confidence = veryLow ? 'high' : (nearBoundary ? 'low' : 'medium');
  const reasons = [
    `복수의 원료(${activeNames.length}종)가 배합된 제품입니다.`,
    `필수 영양소 ${essential.length}개 중 ${withData.length}개(${Math.round(completeness*100)}%)에 데이터가 입력되어 있으나, 모든 필수 영양소를 AAFCO 완전식 수준으로 충족하지는 않습니다.`,
    `입력된 영양소 중 AAFCO 최소 기준 충족 ${metMin.length}/${withData.length}개(${Math.round(minPassRate*100)}%)입니다.`,
  ];
  if (overMaxItems.length) reasons.push(`${overMaxItems.map(o => o.name).join(', ')} 항목이 AAFCO 최대 기준을 초과해, 특정 영양소를 고농도로 보충하는 제품 특성과 부합합니다.`);
  reasons.push('완전·균형식 기준을 충족하지 않아, 주식의 영양을 보충하는 보조식·보충식으로 분류됩니다.');
  return build('supplement', confidence, reasons);
}
// 제품 설정의 "제품유형" 선택(주식/보조식/간식)은 "간식"만 자동판정 결과를 덮어쓰는 수동 스위치로 쓴다 —
// 주식 vs 보조식 구분은 여전히 classifyProductPurpose()의 영양 기반 자동판정을 그대로 따른다(사용자가
// 직접 "주식"/"보조식"을 골라도 실제 영양 분석 결과가 다르면 자동판정값이 우선한다). 배합용 원료(직접
// 급여 불가) 판정은 안전 신호이므로 수동 간식 지정보다 항상 우선한다.
function applyManualPtypeOverride(pc, manualPtype) {
  if (!pc || !pc.type || pc.type === 'unsuitable' || pc.type === 'treat') return pc;
  if (manualPtype !== '간식') return pc;
  const evaluationMode = EVAL_MODE_BY_TYPE.treat;
  return {
    ...pc, type: 'treat', ...PTYPE_META.treat,
    confidence: 'high', confidenceLabel: PTYPE_CONF_LABEL.high,
    reasons: ['제품 설정 화면에서 "간식"으로 수동 지정되었습니다.'],
    evaluationMode, evaluationPolicy: EVAL_MODE_META[evaluationMode],
    manualOverride: true,
  };
}
function judgeGeneric(v, lo, hi) {
  if (v == null || lo == null) return '─';
  if (hi != null && v > hi) return 'over';
  if (v >= lo) return 'pass';
  return 'fail';
}
const FEEDING_FACTOR = {
  '성견(성체유지)': 1.6,
  '성장견':         2.0,
  '임신·수유견':     3.0,
  '노령견':         1.4,
  '성묘(성체유지)': 1.2,
  '성장묘':         2.5,
  '임신·수유묘':     2.0,
  '노령묘':         1.1,
};

const SPECIES_TARGETS = {
  '개':   ['성견(성체유지)', '성장견', '임신·수유견', '노령견'],
  '고양이': ['성묘(성체유지)', '성장묘', '임신·수유묘', '노령묘'],
};

// 활동량에 따른 DER 가감 배율(생애단계 기본 계수 위에 곱해서 적용) — '보통'을 1.0 기준으로 함
const ACTIVITY_MULT = { '저활동': 0.9, '보통': 1.0, '고활동': 1.2 };

// BCS(Body Condition Score, 1~9단계)에 따른 DER 가감 배율 — 5단계(이상적 체형)를 1.0 기준으로,
// 저체중(1~4)은 체중 증량을 돕기 위해 가산, 과체중(6~9)은 감량을 돕기 위해 감산한다.
// (수의영양학의 일반적인 체중 관리 가이드라인을 참고한 근사치이며, 실제 급여량은 수의사와 상의해 조정 필요)
const BCS_MULT = { 1: 1.30, 2: 1.20, 3: 1.12, 4: 1.05, 5: 1.00, 6: 0.93, 7: 0.85, 8: 0.75, 9: 0.65 };

// 중성화 여부에 따른 DER 가감 배율 — FEEDING_FACTOR의 "성체유지"/"노령" 계수는 중성화 완료
// 개체 기준의 통용치(WSAVA/OSU 임상영양 가이드: 성견 1.6=중성화, 1.8=미중성화 / 성묘 1.2=중성화,
// 1.4=미중성화)이므로, 미완료(중성화 안 함) 개체는 그 비율만큼 상향 적용한다.
// 성장기·임신/수유기는 이미 그 자체로 훨씬 높은 기본 계수를 쓰고 중성화 여부가 적용되는 구간이
// 아니므로(성장 중이거나 임신 중인 개체는 통상 미중성화) 이 배율을 적용하지 않는다.
const NEUTER_ADULT_MULT = {
  '개':   { '완료': 1.0, '미완료': 1.8 / 1.6 },
  '고양이': { '완료': 1.0, '미완료': 1.4 / 1.2 },
};
const NEUTER_APPLICABLE_TARGETS = new Set(['성견(성체유지)', '노령견', '성묘(성체유지)', '노령묘']);

// 목표 체중을 기준으로 계산해야 하는 상황인지 판정: 감량/증량을 명시했거나, BCS가 과체중(≥6)/저체중(≤4) 범위인 경우.
// 이 경우 실제 급여 열량은 "지금 체중"이 아니라 "도달하고자 하는 목표 체중"에 맞춰 계산해야
// 체중 감량·증량이 실제로 반영된다(RER이 체중^0.75에 비례하므로, 기준 체중 자체를 바꾸는 것이 핵심).
function shouldUseTargetWeight(weightGoal, bcs) {
  return weightGoal !== '유지' || bcs >= 6 || bcs <= 4;
}
