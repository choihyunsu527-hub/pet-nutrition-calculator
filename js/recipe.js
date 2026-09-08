// recipe.js — 레시피 저장/불러오기/undo·redo/폴더 연동/최근·즐겨찾기/변경이력/반려동물 프로필. index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 반려동물 프로필 — 요소ID ↔ 저장용 키 매핑을 한 곳에 정의해 로컬 저장(saveToStorage)과
// 레시피 파일 저장(saveRecipe) 양쪽에서 재사용한다(필드 추가 시 중복 작성 방지).
// ════════════════════════════════════════════════════════════════════════════
const PET_PROFILE_FIELDS = [
  ['pet-name',        'petName'],
  ['pet-breed',       'petBreed'],
  ['pet-sex',         'petSex'],
  ['pet-neuter',      'petNeuter'],
  ['pet-age',         'petAge'],
  ['pet-activity',    'petActivity'],
  ['pet-bcs',         'petBcs'],
  ['pet-health',      'petHealth'],
  ['pet-allergy',     'petAllergy'],
  ['pet-target-bw',   'petTargetBw'],
  ['pet-weight-goal', 'petWeightGoal'],
];
function collectPetProfileData() {
  const out = {};
  PET_PROFILE_FIELDS.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) out[key] = el.value;
  });
  return out;
}
function applyPetProfileData(data) {
  if (!data) return;
  PET_PROFILE_FIELDS.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && data[key] != null && data[key] !== '') el.value = data[key];
  });
  syncSegmentedControls();
  syncBcsGauge();
  syncAllergyControl();
}

// ════════════════════════════════════════════════════════════════════════════
// 변경 이력 (Change History) — localStorage 전용. 기존 Undo/Redo(undoStack/redoStack)와
// 완전히 분리된 별도 기록이다. calculate() 끝에서 배합 상태를 직전 스냅샷과 비교해
// (원료 추가/삭제/배합비 변경/총 배합량 변경) 이벤트를 만들고, 저장/불러오기는 해당
// 함수에서 직접 recordChangeHistory()를 호출한다.
// ════════════════════════════════════════════════════════════════════════════
const CHANGE_HISTORY_KEY = 'feedcalc_v4_change_history';
const CHANGE_HISTORY_MAX = 200;

let chBaseline = null;     // { rows: Map<원료명, 배합비%>, totalG:number } — 마지막으로 비교한 상태
let chSuppressDetect = false; // 레시피 불러오기 등 일괄 변경 중에는 행 단위 감지를 끈다

function getChangeHistory() {
  try { return JSON.parse(localStorage.getItem(CHANGE_HISTORY_KEY) || '[]'); }
  catch (e) { return []; }
}

function recordChangeHistory(type, recipeName, detail) {
  try {
    const list = getChangeHistory();
    list.unshift({
      ts: Date.now(),
      recipe: (recipeName || '').trim() || '(제목 없음)',
      type: type,
      detail: detail || '',
    });
    if (list.length > CHANGE_HISTORY_MAX) list.length = CHANGE_HISTORY_MAX;
    localStorage.setItem(CHANGE_HISTORY_KEY, JSON.stringify(list));
  } catch (e) { /* 저장 실패는 조용히 무시 — 본 기능 흐름을 막지 않는다 */ }
  renderChangeHistory();
}

function chFmtPct(v) { return (Math.round((Number(v) || 0) * 10) / 10) + '%'; }
function chFmtG(v)   { return (Math.round((Number(v) || 0) * 10) / 10) + 'g'; }
function chFmtTime(ts) {
  const d = new Date(ts), now = new Date();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}

// 현재 배합 상태(원료명→배합비%, 총 배합량)를 스냅샷으로 만든다. 배합비 0%(아직 값을
// 입력하지 않은 행)나 이름 없는 행은 "레시피에 없는 것"으로 취급한다.
function chSnapshotMixState() {
  const rows = new Map();
  getMixRows().forEach(([nm, pct]) => {
    const p = Number(pct) || 0;
    if (!nm || !(p > 0)) return;
    rows.set(nm, (rows.get(nm) || 0) + p);
  });
  return { rows, totalG: getMixTotalG() };
}

// calculate() 끝에서 호출 — 직전 스냅샷(chBaseline)과 비교해 변경 이벤트를 기록한다.
function chDetectRecipeChanges() {
  if (chSuppressDetect || isRestoringRecipeHistory) return;
  const cur = chSnapshotMixState();
  if (!chBaseline) { chBaseline = cur; return; } // 최초 1회는 기준점만 세운다
  const prev = chBaseline;
  const name = document.getElementById('sb-name')?.value || '';
  const unit = document.getElementById('unit-select')?.value || 'pct';

  cur.rows.forEach((pct, nm) => {
    if (!prev.rows.has(nm)) {
      recordChangeHistory('원료 추가', name, `${nm} ${chFmtPct(pct)}`);
    } else {
      const p0 = prev.rows.get(nm);
      if (Math.abs(p0 - pct) >= 0.05 && chFmtPct(p0) !== chFmtPct(pct)) {
        recordChangeHistory('배합비 변경', name, `${nm} ${chFmtPct(p0)} → ${chFmtPct(pct)}`);
      }
    }
  });
  prev.rows.forEach((pct, nm) => {
    if (!cur.rows.has(nm)) {
      recordChangeHistory('원료 삭제', name, `${nm} ${chFmtPct(pct)}`);
    }
  });

  // 총 배합량은 사용자가 직접 편집하는 %모드에서만 기록한다(g/kg 모드에서는 원료 중량
  // 합계로 자동 파생되므로 "배합비 변경"과 중복 기록되는 것을 피한다). 단위(g/kg/%)
  // 전환 자체는 getMixRows()·getMixTotalG() 결과가 그대로라 아무 이벤트도 만들지 않는다.
  if (unit === 'pct' && Math.abs(prev.totalG - cur.totalG) >= 0.5) {
    recordChangeHistory('총 배합량 변경', name, `${chFmtG(prev.totalG)} → ${chFmtG(cur.totalG)}`);
  }

  chBaseline = cur;
}

function renderChangeHistory() {
  const body = document.getElementById('change-history-body');
  if (!body) return;
  const list = getChangeHistory();
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="4" class="table-empty-row">기록된 변경 이력이 없습니다.</td></tr>';
    return;
  }
  body.innerHTML = list.map(e => `<tr>
      <td>${chFmtTime(e.ts)}</td>
      <td>${escHtml(e.recipe)}</td>
      <td>${escHtml(e.type)}</td>
      <td class="left">${escHtml(e.detail)}</td>
    </tr>`).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// 레시피 저장 / 불러오기
// ════════════════════════════════════════════════════════════════════════════
function collectRecipeData() {
  return {
    name:    document.getElementById('sb-name').value,
    maker:   document.getElementById('sb-maker').value,
    ptype:   document.getElementById('sb-ptype').value,
    species: document.getElementById('sb-species')?.value,
    target:  document.getElementById('sb-target').value,
    moisture:document.getElementById('sb-moist').value,
    bw:      document.getElementById('sb-bw').value,
    totalG:  getMixTotalG(),
    rows:    getMixRows(),
    vitk:    document.getElementById('vitk-inp')?.value,
    amino:   getAminoManual(),
    customIngs: customIngs,
    pet:     collectPetProfileData(),
  };
}

// 저장 = 현재 "열려 있는" 레시피(currentRecipeFilename/currentRecipeFileHandle)가 있으면
// 그 문서를 그대로 업데이트한다(레시피명을 바꿔도 새 파일을 만들지 않는다).
// 열린 문서가 없는 경우(새 레시피)에만 레시피명을 파일명으로 삼아 새로 만들고, 그 순간부터
// 이 문서가 "열린" 상태가 된다 — 이후 저장은 다시 이 파일을 업데이트한다.
async function saveRecipe() {
  try {
    const data = collectRecipeData();

    // 1) showOpenFilePicker로 직접 연 파일 — 폴더 연동 여부와 무관하게 그 파일에 곧바로 덮어쓴다.
    if (currentRecipeFileHandle) {
      try {
        const writable = await currentRecipeFileHandle.createWritable();
        await writable.write(JSON.stringify(data,null,2));
        await writable.close();
        document.getElementById('recipe-name').innerHTML = svgIcon('file', 12) + ' ' + escHtml(currentRecipeFilename);
        isDirty = false;
        recordChangeHistory('레시피 저장', data.name, currentRecipeFilename);
        showToast('레시피를 업데이트했습니다: ' + currentRecipeFilename);
        return;
      } catch(e) {
        alert('열려 있던 파일에 저장하지 못해 새로 저장합니다.\n' + e.message);
        currentRecipeFileHandle = null;
      }
    }

    await ensureRecipeDirHandle();

    // 2) 연결된 폴더 안에 있는, 이미 열려 있는 레시피 — 같은 파일명으로 덮어써 업데이트한다.
    if (currentRecipeFilename && recipeDirHandle) {
      try {
        const fh = await recipeDirHandle.getFileHandle(currentRecipeFilename, {create:true});
        const writable = await fh.createWritable();
        await writable.write(JSON.stringify(data,null,2));
        await writable.close();
        document.getElementById('recipe-name').innerHTML = svgIcon('folder', 12) + ' ' + escHtml(currentRecipeFilename);
        await refreshRecipeList();
        const sel = document.getElementById('top-recipe-select');
        if (sel) sel.value = currentRecipeFilename;
        isDirty = false;
        recordChangeHistory('레시피 저장', data.name, currentRecipeFilename);
        showToast('레시피를 업데이트했습니다: ' + currentRecipeFilename);
        return;
      } catch(e) {
        alert('연결된 폴더에 저장하지 못해 파일 다운로드로 대체합니다.\n' + e.message);
      }
    }

    // 3) 폴더에 새로 저장 — 이미 열려 있던 문서라면(폴더 접근이 막혀 2번을 건너뛴 경우)
    //    그 파일명을 그대로 쓰고, 한 번도 저장한 적 없는 새 레시피라면 레시피명으로 파일명을 만든다.
    const filename = currentRecipeFilename || ((data.name||'레시피') + '.json');

    if (recipeDirHandle) {
      try {
        const fh = await recipeDirHandle.getFileHandle(filename, {create:true});
        const writable = await fh.createWritable();
        await writable.write(JSON.stringify(data,null,2));
        await writable.close();
        document.getElementById('recipe-name').innerHTML = svgIcon('folder', 12) + ' ' + escHtml(filename);
        await refreshRecipeList();
        const sel = document.getElementById('top-recipe-select');
        if (sel) sel.value = filename;
        currentRecipeFilename   = filename;
        currentRecipeFileHandle = null;
        isDirty = false;
        recordChangeHistory('레시피 저장', data.name, filename);
        showToast('레시피를 폴더에 저장했습니다: ' + filename);
        return;
      } catch(e) {
        alert('연결된 폴더에 저장하지 못해 파일 다운로드로 대체합니다.\n' + e.message);
      }
    }

    // 폴더 연동이 없으면 항상 다운로드로만 저장할 수 있다(브라우저가 기존 다운로드 파일을
    // 덮어쓰게 해주지 않음) — 그래도 파일명(=문서 ID)만은 계속 유지해, 다음 저장에서도
    // 레시피명을 바꾼 것과 무관하게 "같은 문서"로 취급되도록 한다.
    const isUpdate = !!currentRecipeFilename;
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    document.getElementById('recipe-name').innerHTML = svgIcon('folder', 12) + ' ' + escHtml(filename);
    currentRecipeFilename   = filename;
    currentRecipeFileHandle = null;
    isDirty = false;
    recordChangeHistory('레시피 저장', data.name, filename);
    if (!recipeDirHandle) {
      // 폴더 직접 저장 API(File System Access) 자체를 지원하지 않는 브라우저(Chrome/Edge 외)에서는
      // 폴더 연결을 안내해도 chooseRecipeFolder()가 다시 안내 alert만 띄우므로, 원인이 "아직 연결
      // 안 함"이 아니라 "이 브라우저는 지원 안 함"임을 여기서 바로 알려준다(별도 팝업 추가 없이
      // 기존 다운로드 완료 Toast의 안내 문구만 브라우저 지원 여부에 따라 다르게 표시).
      const tip = window.showDirectoryPicker
        ? '(우측 상단 폴더 아이콘으로 폴더를 연결하면 그 폴더에 바로 덮어써 저장됩니다.)'
        : '(Chrome 또는 Edge 브라우저에서는 폴더에 직접 저장할 수 있습니다.)';
      showToast(
        (isUpdate ? '연결된 폴더가 없어 같은 파일명으로 다시 다운로드했습니다: ' : '연결된 폴더가 없어 다운로드로 저장했습니다: ')
        + filename + '\n' + tip
      );
    }
  } catch(e) {
    alert('저장 중 오류가 발생했습니다: ' + e.message);
  }
}

// 다른 이름으로 저장 — 현재 열린 레시피를 복제해 새 문서(새 파일)를 만든다.
// 저장이 끝나면 그 새 문서가 "현재 열린 레시피"가 된다(원본은 그대로 남는다).
async function saveRecipeAs() {
  const suggested = document.getElementById('sb-name').value || '레시피';
  const newName = prompt('다른 이름으로 저장 — 새 레시피 이름을 입력하세요:', suggested + ' 사본');
  if (newName === null) return; // 취소
  const trimmed = newName.trim();
  if (!trimmed) { alert('레시피 이름을 입력하세요.'); return; }

  document.getElementById('sb-name').value = trimmed;
  syncMixRecipeNameField();
  calculate();

  // 원본 문서와의 연결을 끊어야 saveRecipe()가 "새 레시피" 경로를 타 새 파일을 만든다.
  currentRecipeFilename   = null;
  currentRecipeFileHandle = null;

  await saveRecipe();
}

function applyRecipeData(data, displayName, fileHandle=null) {
  // 이 레시피를 "연다" — 이후 저장 시 새 파일을 만들지 않고 이 문서를 업데이트한다.
  currentRecipeFilename   = displayName || null;
  currentRecipeFileHandle = fileHandle || null;

  // 저장 데이터(collectRecipeData)는 항상 배합비(%) + totalG 기준이므로, 불러오기 시
  // 입력 단위가 g/kg로 남아 있으면 복원한 숫자가 그램으로 오해되어 총 배치량이
  // 행 합계로 덮어써진다 — 행을 다시 그리기 전에 단위 입력을 %로 되돌린다.
  const unitSelEl = document.getElementById('unit-select');
  if (unitSelEl && unitSelEl.value !== 'pct') {
    unitSelEl.value = 'pct';
    onUnitChange();
  }

  // 불러오기는 여러 행을 한꺼번에 다시 그리므로, 행 단위 변경 감지는 끄고 뒤에서
  // "레시피 불러오기" 한 건만 기록한다(변경 이력 전용 — Undo/Redo와 무관).
  chSuppressDetect = true;

  document.getElementById('sb-name').value   = data.name||'';
  syncMixRecipeNameField();
  document.getElementById('sb-maker').value  = data.maker||'';
  // 기존 저장 데이터의 제품유형은 건식/습식/간식(형태 기준)이었으나 주식/보조식/간식(용도 기준)으로 개편됨 —
  // "간식"만 그대로 이어받고, 건식/습식 등 옛 값이나 빈 값은 기본값 "주식"으로 대체한다.
  document.getElementById('sb-ptype').value  = data.ptype==='간식' ? '간식' : '주식';
  if (document.getElementById('sb-species')) {
    document.getElementById('sb-species').value = data.species||'개';
    onSpeciesChange();
  }
  document.getElementById('sb-target').value = data.target||'성견(성체유지)';
  document.getElementById('sb-moist').value  = data.moisture||10;
  document.getElementById('sb-bw').value     = data.bw||15;
  document.getElementById('mix-total-g').value = data.totalG||1000;
  mixBasisTotalG = parseFloat(data.totalG) || 1000; // 저장된 기준 총량으로 초기화
  if (document.getElementById('vitk-inp')) document.getElementById('vitk-inp').value = data.vitk||0;

  applyPetProfileData(data.pet);
  // 옛 레시피 파일처럼 목표 체중 정보가 없으면 현재 체중을 기본값으로 채운다.
  if (!data.pet || !data.pet.petTargetBw) {
    document.getElementById('pet-target-bw').value = data.bw||15;
  }

  if (Array.isArray(data.customIngs)) {
    // 외부에서 불러온 파일이므로 형식만 방어적으로 검증한다 — 원소가 배열([이름, ...])이 아닌
    // 것은 버린다(형식/데이터 의미는 그대로, 손상·악의적 파일로 인한 오류만 차단).
    customIngs = data.customIngs.filter(r => Array.isArray(r) && typeof r[0] === 'string');
    // 레시피 저장 형식은 이름 기반(ID 미포함) 그대로다 — 실려온 원료마다 안정 ID를 새로 매핑한다.
    CustomIngredients.syncRows(customIngs, { allocMissing: true });
    rebuildIngIndex();   // 레시피에 실려온 사용자 원료로 교체됐으니 조회 인덱스도 갱신
    renderIngInitial();
  }

  // 배합 복원
  document.getElementById('mix-body').innerHTML = '';
  mixRows = [];
  mixSortKey = null; mixSortDir = 0; refreshMixSortIcons();
  const savedRows = data.rows || [];
  const rowCount = Math.max(savedRows.length, 6);
  for (let i=0;i<rowCount;i++) {
    const [nm,ratio] = savedRows[i]||['',0];
    addMixRow(nm, ratio);
  }

  // 아미노산 복원
  if (data.amino) {
    Object.entries(data.amino).forEach(([nm,v]) => {
      const el = document.getElementById(`amino-${nm}`);
      if (el) el.value = v;
    });
  }

  document.getElementById('recipe-name').innerHTML = (fileHandle ? svgIcon('file', 12) : svgIcon('folder', 12)) + ' ' + escHtml(displayName);
  const tr2 = document.getElementById('top-recipe-select');
  if (tr2) tr2.value = [...tr2.options].some(o => o.value === displayName) ? displayName : '__none__';
  recordRecentRecipe(displayName);
  updateUnitHint();
  calculate();

  // 변경 이력: 일괄 렌더가 끝났으니 감지를 다시 켜고 기준점을 불러온 레시피 상태로
  // 재설정한다. Undo/Redo 복원(restoreRecipeSnapshot) 경로에서는 이력을 남기지 않는다.
  chSuppressDetect = false;
  chBaseline = chSnapshotMixState();
  if (!isRestoringRecipeHistory) {
    recordChangeHistory('레시피 불러오기', data.name || displayName || '', displayName || '');
  }

  // calculate() 내부의 saveToStorage()가 dirty 플래그를 세우지만, 방금 불러온 레시피는
  // 아직 아무것도 수정하지 않은 상태이므로 되돌린다(= 문서를 "연" 것이지 "수정"한 게 아니다).
  isDirty = false;

  // Undo/Redo 복원(restoreRecipeSnapshot)이 이 함수를 재사용할 때는 히스토리를 건드리면 안
  // 되므로 건너뛴다 — 그 외(파일 열기/최근·즐겨찾기에서 열기)에는 다른 문서를 연 것이므로
  // 이전 문서의 되돌리기 기록은 의미가 없어 초기화한다.
  if (!isRestoringRecipeHistory) resetRecipeHistory();
}

// ════════════════════════════════════════════════════════════════════════════
// 실행 취소 / 다시 실행 — collectRecipeData() 스냅샷을 메모리 스택에 쌓아두고,
// 복원은 기존 applyRecipeData()를 재사용한다(파일 저장/불러오기 구조는 건드리지 않음).
// 스택은 새로고침 시(= 새 레시피/`newRecipe()`가 location.reload()로 처리) 자연히 비워진다.
// ════════════════════════════════════════════════════════════════════════════
let undoStack = [];
let redoStack = [];
let lastRecipeSnapshot = null;       // 마지막으로 확정(커밋)된 상태의 JSON 문자열
let isRestoringRecipeHistory = false; // undo/redo 복원 중에는 스냅샷을 다시 기록하지 않기 위한 가드

// calculate() 끝에서 매번 호출된다. calculate()는 debounce가 걸린 입력 핸들러(예:
// debouncedMixChange/debouncedTotalGChange)의 콜백으로만 실행되거나, 행 추가/삭제 같은
// 즉시 확정되는 동작에서 직접 호출되므로, 여기서 기록하면 "타이핑 한 글자마다"가 아니라
// 300ms 디바운스가 끝나 값이 확정된 시점(또는 명시적 액션 시점) 기준으로 기록된다.
function recordUndoSnapshot() {
  if (isRestoringRecipeHistory) return;
  const snap = JSON.stringify(collectRecipeData());
  if (lastRecipeSnapshot === null) {
    // 아직 기준 상태가 없으면(최초 로드) 지금 상태를 기준점으로만 세우고 스택에는 쌓지 않는다.
    lastRecipeSnapshot = snap;
    updateUndoRedoButtons();
    return;
  }
  if (snap === lastRecipeSnapshot) return; // 실제 변경이 없으면 기록하지 않는다.
  undoStack.push(lastRecipeSnapshot);
  lastRecipeSnapshot = snap;
  redoStack = []; // 새 변경이 생기면 다시 실행 스택은 비운다.
  updateUndoRedoButtons();
}

// 다른 레시피를 열었을 때(로드/최근/즐겨찾기) 이전 문서의 되돌리기 기록은 의미가 없으므로
// 스택을 비우고, 방금 로드된 상태를 새 기준점으로 삼는다.
function resetRecipeHistory() {
  undoStack = [];
  redoStack = [];
  lastRecipeSnapshot = JSON.stringify(collectRecipeData());
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('top-undo-btn');
  const redoBtn = document.getElementById('top-redo-btn');
  if (undoBtn) undoBtn.disabled = !undoStack.length;
  if (redoBtn) redoBtn.disabled = !redoStack.length;
}

// applyRecipeData()로 스냅샷을 복원한다 — 문서 식별자(현재 열려 있는 파일명/핸들)는 그대로
// 유지해 "다른 레시피를 연 것"이 아니라 "같은 문서를 편집 취소/다시 실행한 것"으로 취급한다.
function restoreRecipeSnapshot(snapJSON) {
  isRestoringRecipeHistory = true;
  const data = JSON.parse(snapJSON);
  applyRecipeData(data, currentRecipeFilename, currentRecipeFileHandle);
  isRestoringRecipeHistory = false;
  // applyRecipeData()는 "레시피를 여는" 흐름이라 끝에서 isDirty = false로 되돌리지만,
  // 실행 취소/다시 실행은 저장되지 않은 편집 상태이므로 여기서 다시 true로 바꾼다.
  isDirty = true;
  updateUndoRedoButtons();
}

function undoRecipeChange() {
  if (!undoStack.length) return;
  const prev = undoStack.pop();
  redoStack.push(lastRecipeSnapshot);
  lastRecipeSnapshot = prev;
  restoreRecipeSnapshot(prev);
}

function redoRecipeChange() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  undoStack.push(lastRecipeSnapshot);
  lastRecipeSnapshot = next;
  restoreRecipeSnapshot(next);
}

// 레시피 불러오기 = 기존 문서를 "여는" 동작이다(복사본을 만들지 않음).
// showOpenFilePicker를 지원하는 브라우저(Chrome/Edge)에서는 파일 핸들을 그대로 쥐고 있다가
// 저장 시 같은 파일에 덮어써 진짜 "열기→수정→저장" 흐름을 구현한다. 지원하지 않는 브라우저에서는
// 기존 방식(파일 선택 → 읽기 전용 File)으로 대체하되, 파일명을 문서 ID로 취급해 저장 시 항상
// 같은 이름으로 재다운로드한다(그래야 이름을 바꿔도 "저장"이 새 사본을 만들지 않는다).
async function loadRecipe() {
  if (window.showOpenFilePicker) {
    try {
      const [fh] = await window.showOpenFilePicker({
        types: [{ description: 'FeedCalc 레시피', accept: { 'application/json': ['.json'] } }],
      });
      const file = await fh.getFile();
      const data = JSON.parse(await file.text());
      applyRecipeData(data, file.name, fh);
      showToast('레시피를 열었습니다.');
    } catch(e) {
      if (e.name !== 'AbortError') alert('파일을 읽을 수 없습니다: ' + e.message);
    }
    return;
  }

  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        applyRecipeData(data, file.name, null);
        showToast('레시피를 열었습니다.');
      } catch(err) {
        alert('파일을 읽을 수 없습니다: '+err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// 현재 열려 있는 레시피와의 연결을 끊고 빈 상태에서 새로 시작한다(= 레시피 ID 초기화).
// init()이 만드는 초기 빈 상태를 그대로 재사용하기 위해 새로고침한다.
function newRecipe() {
  if (isDirty && !confirm('수정 중인 내용이 있습니다.\n저장하지 않은 변경 내용은 모두 사라집니다.\n그래도 새 레시피를 시작하시겠습니까?')) return;
  isDirty = false; // 이미 사용자가 확인했으므로 새로고침 시 beforeunload 확인창을 다시 띄우지 않는다
  location.reload();
}

// ════════════════════════════════════════════════════════════════════════════
// 레시피 폴더 연동 (같은 폴더에 저장된 레시피 목록 — File System Access API)
// ════════════════════════════════════════════════════════════════════════════
let recipeDirHandle = null;

// 현재 "열려 있는" 레시피 문서의 정체성 — 파일 기반 저장 방식이라 별도 DB ID 대신
// 파일명을 ID로 삼는다. null이면 아직 한 번도 저장하지 않은 새 레시피.
//   - currentRecipeFilename: 연결된 폴더 안에서 이 이름으로 덮어써야 "업데이트"가 된다.
//   - currentRecipeFileHandle: showOpenFilePicker로 폴더 연동과 무관하게 직접 연 파일의 핸들 —
//     있으면 연결된 폴더 대신 이 파일에 곧바로 덮어쓴다.
let currentRecipeFilename   = null;
let currentRecipeFileHandle = null;

function recipeDirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('feedcalc_recipe_dir', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function recipeDirGet(key) {
  try {
    const db = await recipeDirDB();
    return await new Promise(resolve => {
      const tx = db.transaction('handles', 'readonly').objectStore('handles').get(key);
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => resolve(null);
    });
  } catch(e) { return null; }
}
async function recipeDirSet(key, val) {
  try {
    const db = await recipeDirDB();
    await new Promise(resolve => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(val, key);
      tx.oncomplete = resolve; tx.onerror = resolve;
    });
  } catch(e) { /* ignore */ }
}

function setTopRecipeOptions(html) {
  const sel = document.getElementById('top-recipe-select');
  if (sel) sel.innerHTML = html;
}

async function initRecipeFolder() {
  if (!window.showDirectoryPicker) {
    setTopRecipeOptions('<option value="__none__">레시피 없음</option>');
    const btn = document.getElementById('top-recipe-folder-btn');
    if (btn) btn.title = '이 브라우저는 폴더 연동을 지원하지 않습니다 (Chrome/Edge 권장)';
    return;
  }
  const handle = await recipeDirGet('dir');
  if (!handle) { setTopRecipeOptions('<option value="__none__">폴더 미연결</option>'); return; }
  try {
    const perm = await handle.queryPermission({mode:'readwrite'});
    if (perm === 'granted') {
      recipeDirHandle = handle;
      await refreshRecipeList();
    } else {
      setTopRecipeOptions('<option value="__reconnect__">폴더 재연결 (클릭)</option>');
    }
  } catch(e) {
    setTopRecipeOptions('<option value="__none__">폴더 미연결</option>');
  }
}

// 저장된 핸들의 권한만 다시 요청 (같은 폴더 재선택 없이 재연결)
async function reconnectRecipeFolder() {
  const handle = await recipeDirGet('dir');
  if (!handle) { await chooseRecipeFolder(); return; }
  try {
    const perm = await handle.requestPermission({mode:'readwrite'});
    if (perm !== 'granted') { alert('폴더 접근 권한이 필요합니다.'); return false; }
    recipeDirHandle = handle;
    await refreshRecipeList();
    return true;
  } catch(e) {
    await chooseRecipeFolder();
    return !!recipeDirHandle;
  }
}

// 저장 직전 폴더 핸들 확보 — 연결은 돼있지만 권한이 빠졌으면(재시작 등) 재요청
async function ensureRecipeDirHandle() {
  if (recipeDirHandle) return recipeDirHandle;
  const handle = await recipeDirGet('dir');
  if (!handle) return null;
  try {
    const perm = await handle.requestPermission({mode:'readwrite'});
    if (perm === 'granted') {
      recipeDirHandle = handle;
      await refreshRecipeList();
      return handle;
    }
  } catch(e) { /* 무시하고 다운로드로 대체 */ }
  return null;
}

async function chooseRecipeFolder() {
  if (!window.showDirectoryPicker) {
    alert('이 브라우저는 폴더 접근 기능을 지원하지 않습니다. Chrome 또는 Edge를 사용해 주세요.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    const perm = await handle.requestPermission({mode:'readwrite'});
    if (perm !== 'granted') { alert('폴더 접근 권한이 필요합니다.'); return; }
    recipeDirHandle = handle;
    await recipeDirSet('dir', handle);
    await refreshRecipeList();
  } catch(e) {
    if (e.name !== 'AbortError') alert('폴더를 여는 중 오류: ' + e.message);
  }
}

async function refreshRecipeList() {
  if (!recipeDirHandle) return;
  const names = [];
  try {
    for await (const [name, h] of recipeDirHandle.entries()) {
      if (h.kind === 'file' && /\.json$/i.test(name)) names.push(name);
    }
  } catch(e) { /* ignore */ }
  names.sort((a,b) => a.localeCompare(b, 'ko'));
  const opts = ['<option value="__none__">' + recipeDirHandle.name + ' (' + names.length + '개)</option>']
    .concat(names.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n.replace(/\.json$/i,'')}</option>`))
    .concat(['<option value="__change__">폴더 변경…</option>']);
  setTopRecipeOptions(opts.join(''));

  // 최근/즐겨찾기에는 있지만 실제 폴더에는 없는(삭제된) 파일을 정리한다 — names가 실제
  // 폴더 상태의 source of truth. 변경이 있을 때만 localStorage를 다시 쓰고 다시 그린다.
  const nameSet = new Set(names);
  const recentList = getRecentRecipes();
  const prunedRecent = recentList.filter(r => nameSet.has(r.name));
  if (prunedRecent.length !== recentList.length) {
    localStorage.setItem(RECENT_RECIPES_KEY, JSON.stringify(prunedRecent));
    renderRecentRecipes();
  }
  const favoriteList = getFavoriteRecipes();
  const prunedFavorite = favoriteList.filter(r => nameSet.has(r.name));
  if (prunedFavorite.length !== favoriteList.length) {
    localStorage.setItem(FAVORITE_RECIPES_KEY, JSON.stringify(prunedFavorite));
    renderFavoriteRecipes();
  }
}

async function onTopRecipeChange(name) {
  if (name === '__change__') { await chooseRecipeFolder(); return; }
  if (name === '__reconnect__') { await reconnectRecipeFolder(); return; }
  if (!name || name === '__none__' || !recipeDirHandle) return;
  try {
    const fh = await recipeDirHandle.getFileHandle(name);
    const file = await fh.getFile();
    const data = JSON.parse(await file.text());
    // 폴더 안 파일은 recipeDirHandle을 통해 파일명으로 다시 찾아 덮어쓸 수 있으므로
    // fileHandle은 넘기지 않는다(파일명 기반 업데이트 경로를 그대로 탄다).
    applyRecipeData(data, name);
  } catch(e) {
    alert('레시피를 불러올 수 없습니다: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 최근 레시피 (localStorage) — 파일 저장/불러오기 구조는 그대로 두고, 최근에
// "연" 레시피의 식별 정보(파일명)만 별도로 기록한다. 파일 핸들/전체 데이터는
// 저장하지 않으며, 다시 열 때는 기존 onTopRecipeChange 흐름(연결된 폴더에서
// 같은 파일명 찾기)을 그대로 재사용한다.
// ════════════════════════════════════════════════════════════════════════════
const RECENT_RECIPES_KEY = 'feedcalc_v4_recent_recipes';
const RECENT_RECIPES_MAX = 10;

function getRecentRecipes() {
  try { return JSON.parse(localStorage.getItem(RECENT_RECIPES_KEY) || '[]'); }
  catch(e) { return []; }
}

// 같은 이름의 레시피를 다시 불러오면 기존 항목을 지우고 맨 앞(최신)으로 옮긴다.
function recordRecentRecipe(name) {
  if (!name) return;
  let list = getRecentRecipes().filter(r => r.name !== name);
  list.unshift({ name, ts: Date.now() });
  if (list.length > RECENT_RECIPES_MAX) list = list.slice(0, RECENT_RECIPES_MAX);
  localStorage.setItem(RECENT_RECIPES_KEY, JSON.stringify(list));
  renderRecentRecipes();
}

// 대시보드의 세로 목록으로 렌더링한다(드롭다운 대신 클릭 가능한 항목 리스트).
// 즐겨찾기 탭이 보이는 중이면 그 목록을 덮어쓰지 않는다(renderFavoriteRecipes()가 담당).
// 표시용 상대 시간(부가정보) — 저장된 ts(Date.now())를 사람이 읽는 문구로만 바꾼다.
function dashRelTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s/60)}분 전`;
  if (s < 86400) return `${Math.floor(s/3600)}시간 전`;
  if (s < 86400*7) return `${Math.floor(s/86400)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}
// 목록이 비어 있을 때의 Empty State(아이콘 + 안내 한 줄) — 새 색상/카드 없이 기존 톤.
function dashRecipeEmptyHtml(msg) {
  return `<div class="dash-recent-empty">${svgIcon('file', 20)}<span>${escHtml(msg)}</span></div>`;
}

function renderRecentRecipes() {
  const box = document.getElementById('dash-recent-recipe-list');
  if (!box || dashRecipeView !== 'recent') return;
  const list = getRecentRecipes();
  box.innerHTML = !list.length
    ? dashRecipeEmptyHtml('최근 불러온 레시피가 없습니다.')
    : list.map(r => dashRecipeRowHtml(r.name, r.ts)).join('');
  applyDashRecipeFilter();
}

// 최근 레시피 클릭 — 연결된 폴더 안에서 같은 파일명을 찾아 여는 기존 onTopRecipeChange를 그대로 재사용한다.
async function onRecentRecipeSelect(name) {
  if (!name) return;
  if (!recipeDirHandle) {
    alert('레시피 폴더가 연결되어 있지 않습니다.\n폴더를 연결한 뒤 다시 시도하세요.');
    return;
  }
  await onTopRecipeChange(name);
}

// ════════════════════════════════════════════════════════════════════════════
// 즐겨찾기 레시피 (localStorage) — 최근 레시피와 같은 방식(파일명만 최소 저장)을 따르고,
// 다시 열 때도 위 onRecentRecipeSelect()를 그대로 재사용한다. 대시보드 "최근 레시피" 카드
// 안에서 탭으로 전환해서 보여준다(상단 툴바에는 추가하지 않음).
// ════════════════════════════════════════════════════════════════════════════
const FAVORITE_RECIPES_KEY = 'feedcalc_v4_favorite_recipes';
let dashRecipeView = 'recent'; // 'recent' | 'favorite' — 카드 안에서만 쓰는 화면 상태(저장하지 않음)

function getFavoriteRecipes() {
  try { return JSON.parse(localStorage.getItem(FAVORITE_RECIPES_KEY) || '[]'); }
  catch(e) { return []; }
}

function isFavoriteRecipe(name) {
  return !!name && getFavoriteRecipes().some(r => r.name === name);
}

// "최근 레시피" ↔ "즐겨찾기" 탭 전환.
function setDashRecipeView(view) {
  dashRecipeView = view;
  document.querySelectorAll('.dash-recent-tabs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'favorite') renderFavoriteRecipes(); else renderRecentRecipes();
}

// 최근 레시피와 동일한 .dash-recent-item 톤으로 렌더링하고, 클릭 시 onRecentRecipeSelect()를 재사용한다.
function renderFavoriteRecipes() {
  const box = document.getElementById('dash-recent-recipe-list');
  if (!box || dashRecipeView !== 'favorite') return;
  const list = getFavoriteRecipes();
  box.innerHTML = !list.length
    ? dashRecipeEmptyHtml('즐겨찾기한 레시피가 없습니다.')
    : list.map(r => dashRecipeRowHtml(r.name, r.ts)).join('');
  applyDashRecipeFilter();
}

// 레시피를 여는 버튼(.dash-recent-item)과 즐겨찾기 별 버튼(.dash-fav-toggle-btn)을 형제로
// 묶어 한 행을 그린다(최근/즐겨찾기 탭 공용) — 별 클릭이 레시피 열기 이벤트와 완전히 분리된다.
// 이름(.dash-recent-name)이 1순위, 시간(.dash-recent-meta)이 2순위. onclick/데이터는 그대로.
function dashRecipeRowHtml(name, ts) {
  const safe = escHtml(name).replace(/'/g, "\\'");
  const fav = isFavoriteRecipe(name);
  const meta = dashRelTime(ts);
  return `<div class="dash-recent-row">
    <button type="button" class="dash-recent-item" onclick="onRecentRecipeSelect('${safe}')" title="${escHtml(name)} — 클릭하면 불러옵니다">
      <span class="dash-recent-name">${escHtml(name.replace(/\.json$/i,''))}</span>
      ${meta ? `<span class="dash-recent-meta">${escHtml(meta)}</span>` : ''}
    </button>
    <button type="button" class="dash-fav-toggle-btn${fav ? ' active' : ''}" aria-pressed="${fav}" onclick="toggleRecentFavorite('${safe}')" aria-label="${fav ? '즐겨찾기에서 제거' : '즐겨찾기에 추가'}">${svgStarIcon(fav, 14)}</button>
  </div>`;
}

// 카드 안 검색 — 목록을 다시 그리지 않고 현재 DOM 행만 이름으로 보이기/숨기기 한다.
// 저장/불러오기/삭제/즐겨찾기/스토리지 로직과 무관한 순수 표시 필터.
function applyDashRecipeFilter() {
  const box = document.getElementById('dash-recent-recipe-list');
  const inp = document.getElementById('dash-recipe-search');
  if (!box || !inp) return;
  const q = inp.value.trim().toLowerCase();
  const rows = [...box.querySelectorAll('.dash-recent-row')];
  let shown = 0;
  rows.forEach(row => {
    const nm = (row.querySelector('.dash-recent-name')?.textContent || '').toLowerCase();
    const hit = !q || nm.includes(q);
    row.hidden = !hit;
    if (hit) shown++;
  });
  let noHit = box.querySelector('.dash-recent-empty.is-search');
  if (rows.length && shown === 0) {
    if (!noHit) {
      noHit = document.createElement('div');
      noHit.className = 'dash-recent-empty is-search';
      box.appendChild(noHit);
    }
    noHit.innerHTML = `${svgIcon('file', 20)}<span>${escHtml('"' + inp.value.trim() + '"에 해당하는 레시피가 없습니다.')}</span>`;
    noHit.hidden = false;
  } else if (noHit) {
    noHit.hidden = true;
  }
}

// 목록 항목의 별 버튼 클릭 — feedcalc_v4_favorite_recipes에 추가/제거하고,
// 현재 보이는 탭(최근/즐겨찾기)만 즉시 다시 그린다(즐겨찾기 탭에서 제거 시 바로 사라짐).
function toggleRecentFavorite(name) {
  if (!name) return;
  let list = getFavoriteRecipes();
  const idx = list.findIndex(r => r.name === name);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift({ name, ts: Date.now() });
  localStorage.setItem(FAVORITE_RECIPES_KEY, JSON.stringify(list));
  if (dashRecipeView === 'favorite') renderFavoriteRecipes(); else renderRecentRecipes();
}
