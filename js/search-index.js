// search-index.js — 원료 이름 검색용 파생 인덱스(순수 부가 계층).
// ⚠ getIng()/calcNutrition()/레시피 형식/데이터를 바꾸지 않는다.
//   - ING_DB + customIngs 이름 목록을 "정렬본"과 "원본 순서본"으로 미리 만들어 두고,
//     매 키 입력마다 [...ING_DB,...customIngs] 배열 재생성·재정렬·toLowerCase 를 없앤다.
//   - 확장 DB(extIngs, 원본 순서)는 이름 소문자 계산 + 이름 정렬을 setExt()에서 1회만 하고
//     그 결과(_ext)만 들고 있는다 — 원본 배열의 "정렬본 복사"를 따로 만들지 않는다.
//   - 인덱스는 rebuild()/setExt() 로만 갱신한다(원료 로드·확장DB 로드·custom CRUD·레시피 로드 시).
//   반환값·정렬·상한 규칙은 기존 getSortedIngNames()/filterIng() 와 100% 동일하게 맞춘다.

const IngSearchIndex = (function () {
  'use strict';

  let _byName = [];   // [{name, lower, row}] — 이름 기준 정렬('ko')
  let _orig  = [];    // [{name, lower, row}] — [...ING_DB, ...customIngs] concat 순서
  let _nameSet = new Set();  // base+custom 이름 집합(확장 DB 중복 제외용)
  let _ext = [];      // [{name, lower, row}] — 이름 정렬본(setExt 가 1회 생성). row 는 원본 배열 참조.
  let _extRef = null; // 마지막으로 setExt 에 넘어온 배열 참조(같으면 재계산 안 함)
  let _ready = false;

  function _entry(row) {
    const name = Array.isArray(row) ? row[0] : row;
    return { name: name, lower: String(name == null ? '' : name).toLowerCase(), row: row };
  }

  function rebuild(ingDb, customIngs) {
    const orig = [];
    if (Array.isArray(ingDb)) for (const r of ingDb) if (r) orig.push(_entry(r));
    if (Array.isArray(customIngs)) for (const r of customIngs) if (r) orig.push(_entry(r));
    _orig = orig;
    _byName = orig.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    _nameSet = new Set(orig.map(e => e.name));
    _ready = true;
  }

  // extRows: 확장 DB의 파싱 결과 배열(원본 순서). 같은 참조로 다시 부르면 재계산하지 않는다.
  // 여기서 이름 소문자 캐시 + 이름 정렬을 1회만 수행하고 그 결과(_ext)만 보관한다.
  function setExt(extRows) {
    if (extRows === _extRef) return;
    _extRef = extRows;
    _ext = Array.isArray(extRows) ? extRows.filter(Boolean).map(_entry) : [];
    _ext.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  function ready()    { return _ready; }
  function size()     { return _orig.length; }
  function extCount() { return _ext.length; }

  function _merge(a, b) {
    const out = []; let i = 0, j = 0;
    while (i < a.length && j < b.length) out.push(a[i].localeCompare(b[j], 'ko') <= 0 ? a[i++] : b[j++]);
    while (i < a.length) out.push(a[i++]);
    while (j < b.length) out.push(b[j++]);
    return out;
  }

  // getSortedIngNames(query) 대체. 반환: 이름 문자열 배열.
  //  - 검색어 없음: 정렬된 base+custom 이름 전체(확장 DB 제외 — 기존과 동일)
  //  - 검색어 있음: 정렬된 base 매칭 + (확장 DB 매칭, base 이름 제외, extCap 상한) 을 merge
  function sortedNames(query, extCap) {
    const q = (query || '').trim().toLowerCase();
    const baseFiltered = q
      ? _byName.filter(e => e.lower.includes(q)).map(e => e.name)
      : _byName.map(e => e.name);
    if (!q || !_ext.length) return baseFiltered;

    const extFiltered = [];
    for (const e of _ext) {
      if (extFiltered.length >= extCap) break;
      if (_nameSet.has(e.name)) continue;
      if (e.lower.includes(q)) extFiltered.push(e.name);
    }
    return _merge(baseFiltered, extFiltered);
  }

  // filterIng()의 data 조립 대체. 반환: 원료 배열(row) 목록.
  //  - base 매칭을 [...ING_DB,...customIngs] 원본 순서로 + 확장 DB 매칭을 extSorted 순서로(상한 extCap).
  //  - 정렬(가나다순/원래순서 토글)은 호출부(getSortedIngs)가 그대로 담당한다.
  function filterRows(query, extCap) {
    const q = (query || '').toLowerCase().trim();
    const data = [];
    for (const e of _orig) if (e.lower.includes(q)) data.push(e.row);
    if (_ext.length) {
      let n = 0;
      for (const e of _ext) {
        if (n >= extCap) break;
        if (_nameSet.has(e.name)) continue;
        if (e.lower.includes(q)) { data.push(e.row); n++; }
      }
    }
    return data;
  }

  function _reset() { _byName = []; _orig = []; _nameSet = new Set(); _ext = []; _extRef = null; _ready = false; }

  return { rebuild, setExt, ready, size, extCount, sortedNames, filterRows, _reset };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IngSearchIndex;
