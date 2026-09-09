// mix.js — 배합 설계 탭(행·검색 드롭다운·정렬·단위·알레르기 경고). index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 배합 설계 탭
// ════════════════════════════════════════════════════════════════════════════
let mixRows = [];
let mixRowSeq = 0; // 행 생성 순서 카운터 — 정렬을 "기본 상태"로 되돌릴 때 이 순서로 복원한다
// unit-select의 onchange 시점엔 select.value가 이미 새 단위로 바뀌어 있어, 변경 "전" 단위를
// 알기 위해 별도로 추적한다. onUnitChange()에서 환산 후 최신 단위로 갱신된다.
let currentMixUnit = 'pct';
// "기준 총량" — %↔g↔kg 환산의 분모(= 100% 에 해당하는 그램). mix-total-g 필드는 g/kg
// 모드에서 syncTotalGFromRows()가 원료 합계로 계속 덮어쓰므로, 사용자가 정한 기준을
// 잃지 않도록 별도로 보존한다. 단위 "전환"만으로는 절대 바뀌지 않고, (1) %모드에서
// 사용자가 mix-total-g를 직접 편집할 때 (2) g/kg 모드에서 원료를 편집해 합계가 바뀔 때
// (3) 레시피 로드 시 에만 갱신된다.
let mixBasisTotalG = 1000;
// onUnitChange() 실행 중에는 syncTotalGFromRows()가 mixBasisTotalG를 갱신하지 않도록 막는다
// (전환 자체는 기준 총량을 바꾸면 안 됨).
let mixUnitSwitching = false;

function getSortedIngNames(query) {
  // 이름 목록·정렬·확장DB 병합·상한 규칙은 IngSearchIndex 가 그대로 재현한다(매 입력마다
  // [...ING_DB,...customIngs] 재생성·재정렬·toLowerCase 를 없앤 것뿐, 결과는 동일).
  if (typeof IngSearchIndex !== 'undefined') {
    if (!IngSearchIndex.ready()) { IngSearchIndex.rebuild(ING_DB, customIngs); IngSearchIndex.setExt(extIngs); }
    return IngSearchIndex.sortedNames(query, EXT_ING_SEARCH_CAP);
  }
  // 폴백(인덱스 미로드) — 기존 로직 그대로.
  const q = (query || '').trim().toLowerCase();
  const baseNames = [...ING_DB, ...customIngs].map(i => i[0]).sort((a, b) => a.localeCompare(b, 'ko'));
  const baseFiltered = q ? baseNames.filter(n => n.toLowerCase().includes(q)) : baseNames;
  const extSorted = (typeof extIngsSortedFallback === 'function') ? extIngsSortedFallback() : [];
  if (!q || !extSorted.length) return baseFiltered;
  const baseSet = new Set(baseNames);
  const extFiltered = [];
  for (const ing of extSorted) {
    if (extFiltered.length >= EXT_ING_SEARCH_CAP) break;
    if (baseSet.has(ing[0])) continue;
    if (ing[0].toLowerCase().includes(q)) extFiltered.push(ing[0]);
  }
  return mergeSortedNames(baseFiltered, extFiltered);
}

// (더 이상 배합 행에서 쓰지 않는다 — 행별 <select>/<option>은 공용 드롭다운으로 대체됨.
//  하위 호환/재사용 여지를 위해 함수 자체는 남겨 둔다.)
function buildIngOptions() {
  const names = getSortedIngNames();
  return '<option value="">-- 원료 선택 --</option>' +
         names.map(n => `<option value="${n}">${n}</option>`).join('');
}

// 맨 위에 항상 "선택 안 함"을 붙여, 이미 고른 원료를 다시 공란으로 되돌릴 수 있게 한다
// (검색어로 걸러지지 않고 항상 노출). data-name=""은 하단 클릭 핸들러에서 그대로 빈 값
// 선택으로 처리되어 별도의 새 드롭다운 없이 기존 컴포넌트만으로 동작한다.
// 원료명에서 검색어와 일치하는 첫 구간만 강조용 <span>으로 감싼다(대소문자 무시).
// 검색 매칭 로직 자체(getSortedIngNames)는 건드리지 않고 표시만 바꾼다.
function highlightIngMatch(name, query) {
  const q = (query || '').trim();
  if (!q) return escHtml(name);
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escHtml(name);
  return escHtml(name.slice(0, i)) +
         '<span class="mix-ing-hl">' + escHtml(name.slice(i, i + q.length)) + '</span>' +
         escHtml(name.slice(i + q.length));
}

function ingListItemsHTML(query) {
  const noneItem = '<div class="mix-ing-opt mix-ing-opt-none" data-name="">— 선택 안 함 —</div>';
  const names = getSortedIngNames(query);
  if (names.length === 0) {
    return noneItem +
      `<div class="mix-ing-noresult">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></svg>
        <span>검색 결과가 없습니다</span>
      </div>`;
  }
  // 매칭 순서·우선순위는 그대로 두고, 실제 DOM에 그리는 항목만 상한선까지 자른다.
  const shown = names.slice(0, ING_SEARCH_RENDER_CAP);
  let html = noneItem + shown.map(n =>
    `<div class="mix-ing-opt" data-name="${escHtml(n)}">${highlightIngMatch(n, query)}</div>`
  ).join('');
  if (names.length > shown.length) {
    html += `<div class="mix-ing-empty">상위 ${shown.length}개만 표시</div>`;
  }
  return html;
}

// 재료 검색 드롭다운 패널은 배합 테이블(스크롤 컨테이너) 안에서 잘리지 않도록
// 행마다 만들지 않고 body에 하나만 붙여 재사용하며, 열릴 때마다 대상 표시 버튼
// 위치에 맞춰 fixed로 배치한다.
//
// 열림/닫힘 상태는 focus/blur가 아니라 명시적인 mixIngOpenWrap 변수 하나로만 관리한다.
// (이전 구현은 입력창의 blur에 setTimeout으로 닫기를 예약했는데, 공유 패널이 하나뿐이라
// 다른 행을 연속으로 클릭하면 "새로 연 패널"이 "이전 패널의 지연된 닫기"에 의해 곧바로
// 닫혀버리는 경쟁 상태가 있었다 — 이게 클릭 시 드롭다운이 열렸다가 바로 사라지던 원인.)
let mixIngListEl = null;
let mixIngOpenWrap = null;
let mixIngSelectCallback = null;
let mixIngActiveIdx = -1; // 키보드 ↑/↓ 커서 위치(옵션 목록 기준). -1 = 아직 없음

// 키보드 ↑/↓ 대상 — 실제 원료 항목만("— 선택 안 함 —"은 마우스 클릭 전용으로 남겨둔다).
function mixIngOptEls() {
  return mixIngListEl ? Array.from(mixIngListEl.querySelectorAll('.mix-ing-options .mix-ing-opt:not(.mix-ing-opt-none)')) : [];
}
// 옵션 목록을 다시 그린 직후 호출 — 키보드 커서를 초기화한다.
function resetMixIngActive() { mixIngActiveIdx = -1; }
function setMixIngActive(idx) {
  const els = mixIngOptEls();
  if (!els.length) { mixIngActiveIdx = -1; return; }
  idx = (idx + els.length) % els.length; // 위/아래 끝에서 순환
  els.forEach((el, i) => el.classList.toggle('active', i === idx));
  els[idx].scrollIntoView({ block: 'nearest' });
  mixIngActiveIdx = idx;
}

function getMixIngListEl() {
  if (!mixIngListEl) {
    mixIngListEl = document.createElement('div');
    mixIngListEl.className = 'mix-ing-list';
    mixIngListEl.innerHTML = `
      <div class="mix-ing-search-wrap">
        <input type="text" class="mix-ing-search-input" placeholder="원료 검색..." autocomplete="off">
      </div>
      <div class="mix-ing-options"></div>
    `;
    document.body.appendChild(mixIngListEl);

    const searchInput = mixIngListEl.querySelector('.mix-ing-search-input');
    const optionsEl = mixIngListEl.querySelector('.mix-ing-options');
    // 입력마다 즉시 다시 그리면 확장 DB(수천 종) 검색 시 키 입력이 끊길 수 있어 디바운스한다.
    const renderMixOptions = debounce(() => {
      optionsEl.innerHTML = ingListItemsHTML(searchInput.value);
      resetMixIngActive();
    }, 120);
    searchInput.addEventListener('input', renderMixOptions);
    // 마우스가 항목 위로 오면 키보드 커서도 그 위치로 옮겨, 이후 ↑/↓가 자연스럽게 이어지게 한다.
    optionsEl.addEventListener('mouseover', (e) => {
      const opt = e.target.closest('.mix-ing-opt:not(.mix-ing-opt-none)');
      if (!opt) return;
      const i = mixIngOptEls().indexOf(opt);
      if (i >= 0) setMixIngActive(i);
    });
    optionsEl.addEventListener('click', (e) => {
      const opt = e.target.closest('.mix-ing-opt');
      if (!opt || !mixIngOpenWrap) return;
      // 배합 설계 행(기본 동작)은 선택한 원료를 그 행에 그대로 반영하고 재계산하지만,
      // 알레르기 등록처럼 다른 용도로 이 컴포넌트를 재사용하는 곳은 openIngDropdown()에
      // 넘긴 onSelect 콜백만 실행한다(디자인·동작은 100% 재사용, 결과 처리만 분기).
      if (mixIngSelectCallback) {
        mixIngSelectCallback(opt.dataset.name);
      } else {
        const name = opt.dataset.name;
        setIngComboValue(mixIngOpenWrap, name);
        // "선택 안 함" — 원료뿐 아니라 배합비(중량) 입력도 새 행과 같은 초기 상태(0)로 되돌린다.
        // calculate()가 뒤이어 실행되며 실제 중량·영양 계산값과 알레르기 경고 배지까지 함께 갱신된다.
        if (!name) {
          const ratioInput = mixIngOpenWrap.closest('.mix-row')?.querySelector('input[type=number]');
          if (ratioInput) ratioInput.value = 0;
        }
        onMixChange();
      }
      searchInput.value = ''; // 선택 후 검색창은 초기화(다음에 열 때 전체 목록부터)
      closeIngDropdown();
    });
    // 키보드: ↑/↓ 로 항목 이동, Enter 로 선택, Esc 로 닫기.
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeIngDropdown(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMixIngActive(mixIngActiveIdx < 0 ? 0 : mixIngActiveIdx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMixIngActive(mixIngActiveIdx < 0 ? -1 : mixIngActiveIdx - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const els = mixIngOptEls();
        const target = mixIngActiveIdx >= 0 ? els[mixIngActiveIdx] : els[0];
        if (target) target.click();
      }
    });

    // 패널 안(검색창/목록)에서의 클릭은 바깥 클릭으로 취급하지 않는다.
    mixIngListEl.addEventListener('mousedown', (e) => e.stopPropagation());

    document.getElementById('mix-body')?.addEventListener('scroll', closeIngDropdown, true);
    document.querySelector('.mix-table-wrap')?.addEventListener('scroll', closeIngDropdown, true);
    window.addEventListener('resize', closeIngDropdown);
    // 드롭다운이 열린 상태에서 패널·표시버튼 바깥을 클릭하면 닫는다(닫힘 버그의 원인이었던
    // blur+setTimeout 방식 대신, 열려 있는 대상 하나만 명시적으로 추적해 닫는다).
    document.addEventListener('mousedown', (e) => {
      if (!mixIngOpenWrap) return;
      if (mixIngOpenWrap.contains(e.target) || mixIngListEl.contains(e.target)) return;
      closeIngDropdown();
    });
  }
  return mixIngListEl;
}

// 이 앱은 body 전체에 zoom:1.1이 걸려 있다. getBoundingClientRect()는 이미 그 배율이
// 반영된 실제 화면 좌표를 돌려주지만, 우리가 만드는 드롭다운 패널도 body의 자손이라
// 같은 zoom 배율이 한 번 더 적용된다 — 그 실제 좌표를 그대로 top/left에 대입하면 배율이
// 중복 적용돼(예: 270px 대상이 270×1.1=297px로 렌더링) 원본 위치에서 점점 벗어나
// 대각선으로 밀려나 보였다. 대입 전에 배율만큼 나눠 상쇄한다.
function getBodyZoom() {
  const z = parseFloat(getComputedStyle(document.body).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

// 위치를 계산해 반영하고, 열림 애니메이션이 목표로 삼을 최대 높이(px)를 반환한다.
function positionIngList(list, trigger) {
  const zoom = getBodyZoom();
  const r = trigger.getBoundingClientRect();
  const width = Math.max(r.width, 200);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  list.style.width = (width / zoom) + 'px';
  list.style.left = (left / zoom) + 'px';
  const spaceBelow = window.innerHeight - r.bottom;
  const spaceAbove = r.top;
  let targetMaxHeight;
  if (spaceBelow < 200 && spaceAbove > spaceBelow) {
    list.style.top = '';
    list.style.bottom = ((window.innerHeight - r.top) / zoom) + 'px';
    targetMaxHeight = Math.max(160, spaceAbove - 12) / zoom;
  } else {
    list.style.bottom = '';
    list.style.top = (r.bottom / zoom) + 'px';
    targetMaxHeight = Math.max(160, spaceBelow - 12) / zoom;
  }
  return targetMaxHeight;
}

// 배합 행의 선택 원료 값은 숨은 <input type="hidden" class="mix-ing-value">에 원료명 문자열로
// 보관한다(예전엔 행마다 <select>+전체 <option>을 만들었으나, 원료가 많아지면 행 × 원료 수만큼
// option DOM이 폭증해 제거했다 — 공용 드롭다운 하나만 사용). 저장 형식(원료명 기반)은 그대로다.
function setIngComboValue(wrap, name) {
  const valueEl = wrap.querySelector('.mix-ing-value');
  if (valueEl) valueEl.value = name || '';
  syncIngDisplayFromWrap(wrap);
}

// 원료DB 추가/편집/삭제/불러오기 등으로 선택값이 바뀔 수 있는 지점에서, 표시 버튼 텍스트를
// 숨은 값(.mix-ing-value)에 맞춰 다시 그린다.
function syncIngDisplayFromWrap(wrap) {
  if (!wrap) return;
  const valueEl = wrap.querySelector('.mix-ing-value');
  const display = wrap.querySelector('.mix-ing-display');
  if (!display) return;
  const v = valueEl ? valueEl.value : '';
  const txt = display.querySelector('.mix-ing-display-txt');
  txt.textContent = v || '원료명을 선택하세요';
  display.classList.toggle('placeholder', !v);
}

function openIngDropdown(wrap, onSelect) {
  loadExtIngsOnce(); // 원료 선택 드롭다운을 여는 시점에만 확장 DB를 1회 lazy-load
  const display = wrap.querySelector('.mix-ing-display');
  const list = getMixIngListEl();
  const searchInput = list.querySelector('.mix-ing-search-input');
  const optionsEl = list.querySelector('.mix-ing-options');

  mixIngOpenWrap = wrap;
  mixIngSelectCallback = onSelect || null;
  searchInput.value = '';
  optionsEl.innerHTML = ingListItemsHTML('');
  resetMixIngActive();

  // 사이드바 아코디언과 같은 방식(높이를 0에서 목표값으로 트랜지션)으로 펼쳐지도록,
  // 위치 계산 직후 일단 0으로 접어둔 채 시작하고, 다음 프레임에 목표 높이로 올려
  // max-height 트랜지션이 실제로 발생하게 한다(같은 프레임에 두 값을 바로 바꾸면
  // 브라우저가 시작값을 무시하고 트랜지션 없이 바로 최종값을 그려버린다).
  list.classList.remove('open');
  list.style.maxHeight = '0px';
  const targetMaxHeight = positionIngList(list, display);
  requestAnimationFrame(() => {
    list.classList.add('open');
    list.style.maxHeight = targetMaxHeight + 'px';
  });
  searchInput.focus();
}

function closeIngDropdown() {
  if (mixIngListEl) {
    mixIngListEl.classList.remove('open');
    mixIngListEl.style.maxHeight = '0px';
  }
  mixIngOpenWrap = null;
  mixIngSelectCallback = null;
}

// onSelect를 넘기면 배합 설계 행 대신 그 콜백만 호출한다(예: 알레르기 원료 등록) —
// 드롭다운 디자인·검색·위치 계산 로직은 그대로 재사용하고 선택 결과 처리만 바꾼다.
function initIngCombo(wrap, onSelect) {
  const display = wrap.querySelector('.mix-ing-display');
  display.addEventListener('click', () => {
    if (mixIngOpenWrap === wrap) { closeIngDropdown(); return; }
    openIngDropdown(wrap, onSelect);
  });
}

const MIX_HDR = [
  {label:'에너지<br>(kcal)',           col:1,  w:72},
  {label:'수분<br>(g)',                col:2,  w:62},
  {label:'단백질<br>(g)',              col:3,  w:68},
  {label:'지방<br>(g)',                col:4,  w:62},
  {label:'탄수화물<br>(g)',            col:5,  w:65},
  {label:'회분<br>(g)',                col:6,  w:62},
  {label:'콜레스테롤<br>(mg)',         col:7,  w:80},
  {label:'칼슘 Ca<br>(mg)',            col:8,  w:62},
  {label:'인 P<br>(mg)',               col:9,  w:62},
  {label:'나트륨 Na<br>(mg)',          col:10, w:62},
  {label:'칼륨 K<br>(mg)',             col:11, w:62},
  {label:'철 Fe<br>(mg)',              col:12, w:62},
  {label:'아연 Zn<br>(mg)',            col:13, w:62},
  {label:'마그네슘 Mg<br>(mg)',        col:14, w:62},
  {label:'셀레늄 Se<br>(μg)',          col:15, w:62},
  {label:'구리 Cu<br>(mg)',            col:29, w:62},
  {label:'망간 Mn<br>(mg)',            col:30, w:62},
  {label:'요오드 I<br>(μg)',           col:31, w:62},
  {label:'염소 Cl<br>(mg)',            col:32, w:62},
  {label:'비타민 A<br>(IU)',           col:16, w:72},
  {label:'비타민 D<br>(IU)',           col:17, w:72},
  {label:'비타민 E<br>(mg)',           col:18, w:72},
  {label:'비타민 K<br>(mg)',           col:19, w:72},
  {label:'비타민 B1<br>티아민<br>(mg)',    col:20, w:68},
  {label:'비타민 B2<br>리보플라빈<br>(mg)',col:21, w:68},
  {label:'비타민 B3<br>나이아신<br>(mg)', col:22, w:68},
  {label:'비타민 B5<br>판토텐산<br>(mg)', col:23, w:68},
  {label:'비타민 B6<br>피리독신<br>(mg)', col:24, w:68},
  {label:'엽산 B9<br>(μg)',            col:25, w:68},
  {label:'비타민 B12<br>(μg)',         col:26, w:68},
  {label:'콜린<br>(mg)',               col:33, w:68},
  {label:'비오틴 B7<br>(μg)',          col:34, w:68},
  {label:'리놀레산 LA<br>(g)',         col:35, w:68},
  {label:'알파리놀렌산 ALA<br>(g)',    col:36, w:68},
  {label:'EPA<br>(mg)',                col:27, w:68},
  {label:'DHA<br>(mg)',                col:28, w:68},
  {label:'조섬유<br>(g)',              col:37, w:68},
  {label:'아르기닌<br>(g)',            col:38, w:80},
  {label:'히스티딘<br>(g)',            col:39, w:80},
  {label:'이소류신<br>(g)',            col:40, w:80},
  {label:'류신<br>(g)',                col:41, w:68},
  {label:'라이신<br>(g)',              col:42, w:68},
  {label:'메티오닌+시스틴<br>(g)',     col:43, w:100},
  {label:'페닐알라닌+티로신<br>(g)',   col:44, w:110},
  {label:'트레오닌<br>(g)',            col:45, w:80},
  {label:'트립토판<br>(g)',            col:46, w:80},
  {label:'발린<br>(g)',                col:47, w:68},
  {label:'타우린<br>(mg)',             col:48, w:80},
];

// 그룹 마지막 열 인덱스(기본정보/미네랄/비타민/지방산/조섬유 뒤에 구분선)
const MIX_HDR_GROUP_END = new Set([6, 18, 31, 35, 36]);

// ════════════════════════════════════════════════════════════════════════════
// 배합표 컬럼 정렬 — 화면 표시 순서만 바꾼다. calculate()/원료DB/저장 데이터는 그대로 두고,
// #mix-body 안의 .mix-row DOM 요소(선택된 원료·배합비 입력을 그대로 담고 있는 행 통째)만
// 재배치한다 — 각 행은 자기 값을 스스로 들고 있어 순서와 무관하게 항상 올바르게 계산되므로
// (calculate()는 합계일 뿐 행 순서에 의존하지 않음), 재배치만으로 안전하게 정렬된다.
// mixSortKey===null(기본)일 때는 각 행에 생성 시 매긴 mixSeq 순으로 되돌려 "최초 순서"를 복원한다.
// ════════════════════════════════════════════════════════════════════════════
let mixSortKey = null; // null=기본, 'name'/'ratio'/'actualG'/'mixhdr:N'
let mixSortDir = 0;    // 1=오름차순, -1=내림차순 (mixSortKey가 있을 때만 의미 있음)

function mixSortIconSvg(state) {
  const name = state === 'asc' ? 'arrow-up' : state === 'desc' ? 'arrow-down' : 'chevrons-up-down';
  return svgIcon(name, 11);
}

// 헤더 span(기존 텍스트를 이미 담고 있는 상태)에, 그 텍스트를 라벨용 span으로 감싸고
// 정렬 아이콘 버튼을 옆에 붙인다 — 원본 문구·폭·스타일은 건드리지 않는다.
function makeMixHeaderSortable(span, sortKey, labelId) {
  if (!span) return;
  const label = document.createElement('span');
  label.className = 'mix-hdr-label';
  if (labelId) label.id = labelId;
  while (span.firstChild) label.appendChild(span.firstChild);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mix-sort-btn';
  btn.title = '정렬';
  btn.setAttribute('aria-label', '정렬');
  btn.dataset.sortKey = sortKey;
  btn.innerHTML = mixSortIconSvg('neutral');
  btn.onclick = (e) => { e.stopPropagation(); onMixSortClick(sortKey); };
  span.appendChild(label);
  span.appendChild(btn);
}

function onMixSortClick(key) {
  if (mixSortKey !== key) { mixSortKey = key; mixSortDir = 1; }
  else if (mixSortDir === 1) { mixSortDir = -1; }
  else { mixSortKey = null; mixSortDir = 0; }
  applyMixSort();
}

// 정렬 기준 컬럼의 "화면에 표시된 값"을 읽는다 — 계산 로직을 따로 타지 않고 이미 렌더링된
// 텍스트/입력값을 그대로 읽으므로 계산 결과에는 전혀 영향이 없다. 원료 미선택/값 없음('─')은
// null로 반환해 정렬 시 항상 마지막으로 보낸다.
function mixColValue(row, key) {
  if (key === 'name') {
    const el = row.querySelector('.mix-ing-value');
    return (el && el.value) ? el.value : null;
  }
  let text = null;
  if (key === 'ratio') text = row.querySelector('input[type=number]')?.value;
  else if (key === 'actualG') text = row.querySelector('.mix-actual-g')?.textContent;
  else if (key.startsWith('mixhdr:')) text = row.querySelectorAll('.mix-val')[+key.slice(7)]?.textContent;
  if (text === undefined || text === null) return null;
  const n = parseFloat(String(text).replace(/,/g, '')); // 실제중량(g)은 천단위 콤마가 붙어 표시됨
  return Number.isFinite(n) ? n : null;
}

function applyMixSort() {
  const body = document.getElementById('mix-body');
  let ordered;
  if (!mixSortKey) {
    ordered = mixRows.slice().sort((a, b) => (+a.dataset.mixSeq) - (+b.dataset.mixSeq));
  } else {
    const key = mixSortKey, dir = mixSortDir;
    ordered = mixRows.slice().sort((a, b) => {
      const va = mixColValue(a, key), vb = mixColValue(b, key);
      if (va === null && vb === null) return (+a.dataset.mixSeq) - (+b.dataset.mixSeq);
      if (va === null) return 1;  // 빈 값/잘못된 값은 정렬 방향과 무관하게 항상 마지막
      if (vb === null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb, 'ko') : va - vb;
      return dir === 1 ? cmp : -cmp;
    });
  }
  // appendChild는 이미 DOM에 있는 노드를 "이동"시킬 뿐 새로 만들지 않으므로, 각 행의
  // select/input 값과 이벤트 리스너가 그대로 유지된다.
  ordered.forEach(row => body.appendChild(row));
  mixRows = ordered;
  document.querySelectorAll('.mix-no').forEach((el, i) => el.textContent = i + 1);
  document.querySelectorAll('.mix-row').forEach((row, i) => {
    const wrap = row.querySelector('.mix-ing-wrap');
    if (wrap) wrap.style.background = i % 2 === 0 ? 'var(--odd)' : 'var(--even)';
  });
  refreshMixSortIcons();
}

function refreshMixSortIcons() {
  document.querySelectorAll('#mix-hdr .mix-sort-btn').forEach(btn => {
    const key = btn.dataset.sortKey;
    const state = key !== mixSortKey ? 'neutral' : (mixSortDir === 1 ? 'asc' : 'desc');
    btn.innerHTML = mixSortIconSvg(state);
    btn.classList.toggle('active', state !== 'neutral');
  });
}

function buildMixHdr() {
  const hdr = document.getElementById('mix-hdr');
  // 고정 3개 컬럼(원료명/배합비/실제 중량)에도 나머지 영양소 컬럼과 같은 정렬 UI를 붙인다.
  makeMixHeaderSortable(document.getElementById('mix-hdr-name'), 'name');
  makeMixHeaderSortable(document.getElementById('mix-hdr-ratio'), 'ratio', 'mix-hdr-ratio-label');
  makeMixHeaderSortable(document.getElementById('mix-hdr-actualg'), 'actualG');

  MIX_HDR.forEach((h, i) => {
    const sp = document.createElement('span');
    const div = MIX_HDR_GROUP_END.has(i) ? 'border-right:2px solid var(--border);' : '';
    sp.style.cssText = `width:${h.w}px;flex-shrink:0;${div}`;
    sp.innerHTML = h.label;
    // 라벨(예: "수분<br>(g)")은 폭 제약상 그대로 두고, 값의 의미(원료 100g당이 아니라
    // "최종 배합 100g당 이 원료의 기여량")는 툴크립으로만 보강한다 — 헤더 텍스트/폭은 미변경.
    sp.title = `${h.label.replace(/<br>/g, ' ')} — 최종 배합 100g 기준 이 원료의 기여량`;
    makeMixHeaderSortable(sp, 'mixhdr:' + i);
    hdr.appendChild(sp);
  });
}

function addMixRow(name='', ratio=0) {
  if (mixRows.length >= 25) { alert('최대 25행까지 입력 가능합니다.'); return; }
  const idx = mixRows.length;
  const bg = idx % 2 === 0 ? 'var(--odd)' : 'var(--even)';
  const div = document.createElement('div');
  div.className = 'mix-row';
  div.dataset.mixSeq = mixRowSeq++;
  div.innerHTML = `
    <span style="width:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center">
      <input type="checkbox" class="mix-chk">
    </span>
    <span class="mix-no">${idx+1}</span>
    <span class="mix-ing-wrap" style="background:${bg}">
      <button type="button" class="mix-ing-display${name ? '' : ' placeholder'}">
        <span class="mix-ing-display-txt">${name ? escHtml(name) : '원료명을 선택하세요'}</span>
        <span class="mix-ing-arrow">▼</span>
      </button>
      <input type="hidden" class="mix-ing-value">
    </span>
    <input type="number" value="${ratio}" min="0" step="0.5"
           oninput="debouncedMixChange()" onfocus="this.select()" style="width:100px">
    <span class="mix-actual-g" style="width:90px">─</span>
    ${MIX_HDR.map((h, i) => `<span class="mix-val" data-idx="${i}" style="width:${h.w}px${MIX_HDR_GROUP_END.has(i) ? ';border-right:2px solid var(--border)' : ''}">─</span>`).join('')}
  `;
  if (name) {
    div.querySelector('.mix-ing-value').value = name;
  }
  initIngCombo(div.querySelector('.mix-ing-wrap'));
  document.getElementById('mix-body').appendChild(div);
  mixRows.push(div);
}

function toggleAllMixChk(el) {
  document.querySelectorAll('.mix-row .mix-chk').forEach(c => c.checked = el.checked);
}

function deleteSelectedMix() {
  const checked = Array.from(document.querySelectorAll('.mix-row .mix-chk')).filter(c => c.checked);
  if (checked.length === 0) { alert('삭제할 원료를 선택하세요.'); return; }
  if (!confirm(`선택한 ${checked.length}개 원료를 배합에서 삭제하시겠습니까?`)) return;
  checked.forEach(chk => {
    const row = chk.closest('.mix-row');
    mixRows = mixRows.filter(r => r !== row);
    row.remove();
  });
  document.querySelectorAll('.mix-no').forEach((el,i) => el.textContent = i+1);
  const selAll = document.getElementById('mix-select-all');
  if (selAll) selAll.checked = false;
  calculate();
}

function clearMix() {
  document.getElementById('mix-body').innerHTML = '';
  mixRows = [];
  mixSortKey = null; mixSortDir = 0; refreshMixSortIcons();
  addMixRow(); addMixRow(); addMixRow();
  addMixRow(); addMixRow(); addMixRow();
  calculate();
}

function getMixTotalG() {
  return parseFloat(document.getElementById('mix-total-g')?.value) || 1000;
}

// g/kg 입력 모드에서는 "총 배치량"이 원료 중량의 합계와 항상 같아야 한다 — 사용자가 직접
// 입력하는 기준값이 아니라 원료 행에서 파생되는 값이므로, 매 계산 시작 시 여기서 재계산해
// 필드에 반영한다(% 모드에서는 반대로 총 배치량이 사용자가 정하는 기준이므로 손대지 않는다).
function syncTotalGFromRows() {
  const unit = document.getElementById('unit-select')?.value || 'pct';
  if (unit === 'pct') return;
  const sumRaw = mixRows.reduce((sum, row) => {
    return sum + (parseFloat(row.querySelector('input[type=number]').value) || 0);
  }, 0);
  const totalG = unit === 'kg' ? sumRaw * 1000 : sumRaw;
  const el = document.getElementById('mix-total-g');
  if (el) el.value = totalG > 0 ? +totalG.toFixed(3) : 0;
  // g/kg 모드에서 사용자가 원료를 편집해 합계가 바뀌면 그 합계가 새 기준 총량이 된다.
  // 단, 단위 전환 중(onUnitChange)에는 기준을 보존해야 하므로 건드리지 않는다.
  if (!mixUnitSwitching && totalG > 0) mixBasisTotalG = totalG;
}

function getMixRows() {
  const unit = document.getElementById('unit-select')?.value || 'pct';
  const totalG = getMixTotalG();
  return mixRows.map(row => {
    const nm = row.querySelector('.mix-ing-value')?.value || '';
    let val = parseFloat(row.querySelector('input[type=number]').value) || 0;
    // 항상 % 기준으로 변환해서 반환
    if (unit === 'g')  val = val * 100 / totalG;         // g 기준: 총 totalG(g) 대비 %
    if (unit === 'kg') val = val * 1000 * 100 / totalG;  // kg 기준: 총 totalG(g) 대비 %
    return [nm, val];
  });
}

// 배합 설계 각 행의 원료가 등록된 알레르기 원료와 겹치는지 확인해, 원료 선택 영역(mix-ing-wrap)에
// 빨간 강조 + ⚠️ 배지를 즉시 반영한다. calculate()가 실행될 때(원료 변경/삭제/배합비 입력)와
// 알레르기 목록 자체가 바뀔 때(syncAllergyControl) 모두 호출되어 항상 최신 상태로 갱신된다.
function getMixAllergyMatches() {
  const allergySet = new Set(getAllergyList());
  return mixRows
    .map(row => row.querySelector('.mix-ing-value')?.value || '')
    .filter(name => name && allergySet.has(name));
}
function updateMixAllergyWarnings() {
  const allergySet = new Set(getAllergyList());
  mixRows.forEach(row => {
    const wrap = row.querySelector('.mix-ing-wrap');
    const valueEl = row.querySelector('.mix-ing-value');
    if (!wrap || !valueEl) return;
    const display = wrap.querySelector('.mix-ing-display');
    const isAllergy = !!valueEl.value && allergySet.has(valueEl.value);
    wrap.classList.toggle('mix-ing-allergy', isAllergy);
    let badge = display.querySelector('.mix-ing-allergy-badge');
    if (isAllergy && !badge) {
      badge = document.createElement('span');
      badge.className = 'mix-ing-allergy-badge';
      badge.title = '등록된 알레르기 원료입니다';
      badge.innerHTML = svgIcon('warning', 12);
      display.insertBefore(badge, display.firstChild);
    } else if (!isAllergy && badge) {
      badge.remove();
    }
  });
}


function updateUnitHint() {
  const unit = document.getElementById('unit-select')?.value || 'pct';
  const totalG = getMixTotalG();
  const totalKg = totalG / 1000;
  const hintMap = {
    pct: `100% = ${totalG}g = ${totalKg}kg 기준`,
    g:   `${totalG}g 기준 — 예: 닭가슴살 ${(totalG*0.3).toFixed(0)}g → ${(totalG*0.3).toFixed(0)} 입력`,
    kg:  `${totalKg}kg 기준 — 예: 닭가슴살 ${(totalKg*0.3).toFixed(3)}kg → ${(totalKg*0.3).toFixed(3)} 입력`,
  };
  const hint = document.getElementById('unit-hint');
  if (hint) hint.textContent = hintMap[unit];

  const labelMap = { pct: '배합비(%)', g: '중량(g)', kg: '중량(kg)' };
  // #mix-hdr-ratio 자체가 아니라 그 안의 라벨 전용 span만 바꾼다 — buildMixHdr()가 이 span
  // 옆에 정렬 아이콘 버튼을 함께 넣어두므로, 여기서 textContent를 통째로 덮어쓰면 그 버튼도
  // 같이 지워진다.
  const rl = document.getElementById('mix-hdr-ratio-label');
  if (rl) rl.textContent = labelMap[unit];
}

function onUnitChange() {
  const unit = document.getElementById('unit-select')?.value || 'pct';
  const prevUnit = currentMixUnit;
  mixUnitSwitching = true;
  // 환산 분모는 "현재 필드값"(g/kg 모드에서 원료 합계로 덮어써짐)이 아니라 보존된 기준 총량.
  // 이래야 1000g 기준 50% → g → kg → % 왕복 후에도 다시 50%가 된다.
  const totalG = mixBasisTotalG;
  const stepMap = { pct: '0.5', g: '1', kg: '0.001' };
  mixRows.forEach(row => {
    const inp = row.querySelector('input[type=number]');
    const prevVal = parseFloat(inp.value) || 0;
    // 이전 단위 값을 g(그램) 기준으로 환산한 뒤, 새 단위로 다시 환산한다 — 배합비(%)는
    // 이 시점의 총 배치량(totalG) 기준이며, 각 행의 값만 바뀌고 다른 행/총량은 건드리지 않는다.
    let grams;
    if (prevUnit === 'g') grams = prevVal;
    else if (prevUnit === 'kg') grams = prevVal * 1000;
    else grams = totalG > 0 ? prevVal / 100 * totalG : 0;   // pct
    let newVal;
    if (unit === 'g') newVal = grams;
    else if (unit === 'kg') newVal = grams / 1000;
    else newVal = totalG > 0 ? grams * 100 / totalG : 0;    // pct
    inp.step = stepMap[unit];
    inp.value = +(Math.round(newVal * 1e6) / 1e6);
  });
  currentMixUnit = unit;

  // g/kg 모드에서는 총 배치량이 원료 중량 합계로 자동 계산되므로 직접 입력을 막는다.
  // % 모드에서는 총 배치량이 사용자가 정하는 기준값이라 다시 편집 가능하게 되돌린다.
  const totalEl = document.getElementById('mix-total-g');
  if (totalEl) {
    const isAuto = unit !== 'pct';
    totalEl.readOnly = isAuto;
    totalEl.tabIndex = isAuto ? -1 : 0;
    totalEl.title = isAuto ? '원료 중량 합계로 자동 계산됩니다' : '';
    totalEl.style.background = isAuto ? 'var(--gray-l)' : '';
    totalEl.style.cursor = isAuto ? 'not-allowed' : '';
    // %로 복귀할 땐 g/kg 모드가 덮어썼던 필드를 보존된 기준 총량으로 되돌린다.
    if (!isAuto && mixBasisTotalG > 0) totalEl.value = mixBasisTotalG;
  }

  syncTotalGFromRows();
  updateUnitHint();
  calculate();
  mixUnitSwitching = false;
}

function onTotalGChange() {
  // %모드에서 사용자가 직접 편집한 총 배치량은 곧 새 기준 총량이다.
  if ((document.getElementById('unit-select')?.value || 'pct') === 'pct') {
    mixBasisTotalG = getMixTotalG();
  }
  updateUnitHint();
  calculate();
  saveToStorage();
}
const debouncedTotalGChange = debounce(onTotalGChange, 300);

function updateMixRowVals(rows) {
  // rows는 항상 %(배합비) 기준으로 정규화되어 들어온다 — 실제 중량(g)은 입력 단위(%/g/kg)와
  // 무관하게 "총 배치량 × 배합비/100" 공식 하나로 계산해 모든 모드에서 일관되게 표시한다.
  const totalG = getMixTotalG();
  rows.forEach(([nm, ratio], i) => {
    if (i >= mixRows.length) return;
    const row = mixRows[i];
    const ing = getIng(nm);
    const spans = row.querySelectorAll('.mix-val');
    const actualGEl = row.querySelector('.mix-actual-g');
    const hasG = nm && ratio > 0;
    if (actualGEl) {
      actualGEl.innerHTML = hasG ? `${(totalG * ratio / 100).toLocaleString('ko', {maximumFractionDigits:1})}<span class="mix-unit">g</span>` : '─';
      actualGEl.classList.toggle('mix-val-filled', hasG);
    }
    if (ing && ratio > 0) {
      const f = ratio / 100;
      MIX_HDR.forEach((h, si) => {
        spans[si].textContent = (ing[h.col] * f).toFixed(2);
        spans[si].classList.add('mix-val-filled');
      });
    } else {
      spans.forEach(sp => { sp.textContent = '─'; sp.classList.remove('mix-val-filled'); });
    }
  });
}
