// search.js — 헤더 통합 검색. index.html에서 분리.

// ════════════════════════════════════════════════════════════════════════════
// 헤더 상단 통합 검색 — 원료 DB, 영양기준 DB, 레시피/제품, 전문 용어, 메뉴를
// 한 번에 검색해 드롭다운으로 보여주고, 클릭 시 해당 화면으로 이동한다.
// ════════════════════════════════════════════════════════════════════════════
let lastSearchResults = [];
const SEARCH_MAX_PER_GROUP = 8;

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function collectGlobalSearchResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  loadExtIngsOnce(); // 아직 로드 전이면 이번 검색은 기존 데이터로만 응답하고, 다음 검색부터 반영
  const results = [];

  // allIngs()(= [...ING_DB,...customIngs,...extIngs] 전체 배열 재생성) 대신 소스별로 직접 순회하며
  // 상한(SEARCH_MAX_PER_GROUP)에서 조기 종료한다 — 순서·매칭·상한은 기존과 동일, 배열 할당만 제거.
  let n = 0;
  const scanIngs = arr => {
    if (!Array.isArray(arr)) return;
    for (const ing of arr) {
      if (n >= SEARCH_MAX_PER_GROUP) return;
      if (ing[0].toLowerCase().includes(q)) { results.push({ type:'ing', name: ing[0], src:'원료 DB' }); n++; }
    }
  };
  scanIngs(ING_DB);
  scanIngs(customIngs);
  if (extIngs && extIngs.length) scanIngs(extIngs);

  n = 0;
  const seenStd = new Set();
  for (const std of [...STANDARDS, ...STANDARDS_CAT]) {
    if (n >= SEARCH_MAX_PER_GROUP) break;
    const nm = std[0];
    if (seenStd.has(nm) || !nm.toLowerCase().includes(q)) continue;
    seenStd.add(nm);
    results.push({ type:'std', name: nm, src:'영양기준 DB' });
    n++;
  }

  n = 0;
  document.querySelectorAll('#top-recipe-select option').forEach(opt => {
    if (n >= SEARCH_MAX_PER_GROUP) return;
    if (['__none__','__change__','__reconnect__'].includes(opt.value)) return;
    if (opt.textContent.toLowerCase().includes(q)) { results.push({ type:'recipe', name: opt.textContent, src:'레시피 > 제품', value: opt.value }); n++; }
  });

  n = 0;
  for (const t of GLOSSARY_TERMS) {
    if (n >= SEARCH_MAX_PER_GROUP) break;
    const hay = (t.term + ' ' + (t.abbr||'')).toLowerCase();
    if (hay.includes(q)) { results.push({ type:'glossary', name: t.term, src:'전문 용어', term: t.term, tab: t.tab }); n++; }
  }

  n = 0;
  for (const [id, label] of Object.entries(TAB_LABELS)) {
    if (n >= SEARCH_MAX_PER_GROUP) break;
    if (label.toLowerCase().includes(q)) { results.push({ type:'tab', name: label, src:'메뉴 · 기능', tabId: id }); n++; }
  }

  return results;
}

function renderGlobalSearchResults(results) {
  const box = document.getElementById('top-search-results');
  const wrap = document.getElementById('top-search-wrap');
  if (!box || !wrap) return;
  box.innerHTML = !results.length
    ? '<div class="tsr-empty">검색 결과가 없습니다</div>'
    : results.map((r, i) => `
        <div class="tsr-item" data-idx="${i}">
          <span class="tsr-name">${escHtml(r.name)}</span>
          <span class="tsr-src">${escHtml(r.src)}</span>
        </div>`).join('');
  const zoom = getBodyZoom();
  const r = wrap.getBoundingClientRect();
  box.style.left = (r.left / zoom) + 'px';
  box.style.top = (r.bottom / zoom) + 'px';
  box.style.width = (r.width / zoom) + 'px';
  box.classList.add('open');
  wrap.classList.add('search-open');
}

function onGlobalSearchInput() {
  const q = document.getElementById('top-search-input').value;
  if (!q.trim()) { closeGlobalSearch(); return; }
  lastSearchResults = collectGlobalSearchResults(q);
  renderGlobalSearchResults(lastSearchResults);
}

function closeGlobalSearch() {
  const box = document.getElementById('top-search-results');
  if (box) { box.classList.remove('open'); box.innerHTML = ''; }
  document.getElementById('top-search-wrap')?.classList.remove('search-open');
  lastSearchResults = [];
}

function highlightSearchTarget(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({ behavior:'smooth', block:'center' });
  el.classList.remove('search-hit-flash');
  void el.offsetWidth; // 애니메이션 재시작을 위해 리플로우를 강제한다
  el.classList.add('search-hit-flash');
  setTimeout(() => el.classList.remove('search-hit-flash'), 1600);
}

function goToGlobalSearchResult(r) {
  closeGlobalSearch();
  document.getElementById('top-search-input').value = '';
  if (r.type === 'ing') {
    goTab('ing');
    // 초기 목록이 축약(상위 N행)되므로, 대상 원료가 표에 그려지도록 검색어를 채워 필터링한 뒤 하이라이트한다.
    const si = document.getElementById('ing-search');
    if (si) { si.value = r.name; filterIng(); }
    setTimeout(() => highlightSearchTarget(`#ing-body tr[data-ing-name="${CSS.escape(r.name)}"]`), 50);
  } else if (r.type === 'std') {
    goTab('std');
    setTimeout(() => highlightSearchTarget(`#std-body tr[data-std-name="${CSS.escape(r.name)}"]`), 50);
  } else if (r.type === 'recipe') {
    const sel = document.getElementById('top-recipe-select');
    if (sel) sel.value = r.value;
    onTopRecipeChange(r.value);
    goTab('product');
  } else if (r.type === 'glossary') {
    goTab(r.tab || 'glossary');
    if (!r.tab) setTimeout(() => highlightSearchTarget(`.gl-entry[data-term="${CSS.escape(r.term)}"]`), 50);
  } else if (r.type === 'tab') {
    goTab(r.tabId);
  }
}

document.getElementById('top-search-results').addEventListener('click', (e) => {
  const item = e.target.closest('.tsr-item');
  if (!item) return;
  const r = lastSearchResults[Number(item.dataset.idx)];
  if (r) goToGlobalSearchResult(r);
});

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('top-search-wrap');
  const box = document.getElementById('top-search-results');
  if (wrap && box && !wrap.contains(e.target) && !box.contains(e.target)) closeGlobalSearch();
});

// 접근성: <button>이 아닌 div/span에 role="button"으로 붙인 커스텀 클릭 요소(사이드바 메뉴,
// 프로필 드롭다운 항목 등)를 Enter/Space로도 활성화할 수 있게 하는 공통 위임 핸들러.
// 네이티브 button/a는 이미 자체적으로 처리하므로 대상에서 제외한다.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[role="button"]');
  if (!el || el.tagName === 'BUTTON' || el.tagName === 'A') return;
  e.preventDefault();
  el.click();
});

// 사이드바 아코디언 그룹 펼침/접힘 — 그룹 헤더 클릭 시 호출된다.
