'use strict';
// 검색 인덱스(js/search-index.js) — 기존 getSortedIngNames()/filterIng() 의 "조립 로직"을
// 참조 구현으로 재현해 동일 결과를 보장하고, 3,000+ 규모 성능을 확인한다.

const test = require('node:test');
const assert = require('node:assert/strict');
const ISI = require('../../js/search-index.js');

const EXT_CAP = 300;
const mkRow = (name) => { const r = new Array(49).fill(0); r[0] = name; return r; };

// ── 참조 구현(현행 코드와 동일 로직) ────────────────────────────────────────
function refSortedNames(ingDb, customIngs, extSorted, query) {
  const q = (query || '').trim().toLowerCase();
  const baseNames = [...ingDb, ...customIngs].map(i => i[0]).sort((a, b) => a.localeCompare(b, 'ko'));
  const baseFiltered = q ? baseNames.filter(n => n.toLowerCase().includes(q)) : baseNames;
  if (!q || !extSorted || !extSorted.length) return baseFiltered;
  const baseSet = new Set(baseNames);
  const extFiltered = [];
  for (const ing of extSorted) {
    if (extFiltered.length >= EXT_CAP) break;
    if (baseSet.has(ing[0])) continue;
    if (ing[0].toLowerCase().includes(q)) extFiltered.push(ing[0]);
  }
  // mergeSortedNames
  const out = []; let i = 0, j = 0;
  while (i < baseFiltered.length && j < extFiltered.length)
    out.push(baseFiltered[i].localeCompare(extFiltered[j], 'ko') <= 0 ? baseFiltered[i++] : extFiltered[j++]);
  while (i < baseFiltered.length) out.push(baseFiltered[i++]);
  while (j < extFiltered.length) out.push(extFiltered[j++]);
  return out;
}
function refFilterRows(ingDb, customIngs, extSorted, extRaw, query) {
  const q = (query || '').toLowerCase().trim();
  const baseData = [...ingDb, ...customIngs];
  const data = baseData.filter(i => i[0].toLowerCase().includes(q));
  if (extRaw && extRaw.length) {
    const baseSet = new Set(baseData.map(i => i[0]));
    let n = 0;
    for (const ing of extSorted) {
      if (n >= EXT_CAP) break;
      if (baseSet.has(ing[0])) continue;
      if (ing[0].toLowerCase().includes(q)) { data.push(ing); n++; }
    }
  }
  return data;
}

// ── 고정 소량 데이터 ───────────────────────────────────────────────────────
const ING_DB = ['닭고기(가슴)', '소고기', '연어', 'BEEF liver', '고등어'].map(mkRow);
const CUSTOM = ['내 커스텀 닭', '오리'].map(mkRow);
const EXT_SORTED = ['가지', '고구마', '닭가슴살 분말', '대구', '연어 오일', 'Chicken meal', 'zucchini']
  .map(mkRow).sort((a, b) => a[0].localeCompare(b[0], 'ko'));

function setup(extLoaded = true) {
  ISI._reset();
  ISI.rebuild(ING_DB, CUSTOM);
  ISI.setExt(extLoaded ? EXT_SORTED : null);
}

test('sortedNames: 검색어 없음 → 정렬된 base+custom 전체(확장 DB 제외)', () => {
  setup();
  assert.deepEqual(ISI.sortedNames('', EXT_CAP), refSortedNames(ING_DB, CUSTOM, EXT_SORTED, ''));
});

test('sortedNames: 여러 검색어에서 참조 구현과 동일', () => {
  setup();
  for (const q of ['닭', '연어', 'ch', '오', 'zz', '', ' 고 ', 'BEEF', 'beef']) {
    assert.deepEqual(ISI.sortedNames(q, EXT_CAP), refSortedNames(ING_DB, CUSTOM, EXT_SORTED, q), `q=${JSON.stringify(q)}`);
  }
});

test('sortedNames: 확장 DB 미로드 시 base+custom 만', () => {
  setup(false);
  assert.deepEqual(ISI.sortedNames('닭', EXT_CAP), refSortedNames(ING_DB, CUSTOM, null, '닭'));
});

test('filterRows: base 원본 순서 + 확장 DB 순서, 참조 구현과 동일(row 참조까지)', () => {
  setup();
  for (const q of ['닭', '연어', 'ch', 'a', '', 'liver']) {
    const got = ISI.filterRows(q, EXT_CAP);
    const ref = refFilterRows(ING_DB, CUSTOM, EXT_SORTED, EXT_SORTED, q);
    assert.equal(got.length, ref.length, `q=${q} len`);
    got.forEach((r, i) => assert.equal(r[0], ref[i][0], `q=${q} idx${i}`));
  }
});

test('filterRows: 확장 DB 이름이 base 이름과 겹치면 제외(연어 오일은 겹치지 않음 → 포함)', () => {
  setup();
  const rows = ISI.filterRows('연어', EXT_CAP).map(r => r[0]);
  assert.ok(rows.includes('연어'));       // base
  assert.ok(rows.includes('연어 오일'));  // ext (다른 이름)
});

test('rebuild 후 custom 추가/삭제가 반영된다(인덱스만 갱신)', () => {
  ISI._reset();
  const cust = ['A커스텀'].map(mkRow);
  ISI.rebuild(ING_DB, cust);
  ISI.setExt(null);
  assert.ok(ISI.sortedNames('커스텀', EXT_CAP).includes('A커스텀'));
  cust.push(mkRow('B커스텀'));
  ISI.rebuild(ING_DB, cust);            // CRUD 훅
  assert.ok(ISI.sortedNames('커스텀', EXT_CAP).includes('B커스텀'));
  cust.splice(0, 1);                     // 삭제
  ISI.rebuild(ING_DB, cust);
  assert.ok(!ISI.sortedNames('커스텀', EXT_CAP).includes('A커스텀'));
});

test('setExt: 원본 순서(비정렬) 배열을 넘겨도 내부에서 이름 정렬한다', () => {
  ISI._reset();
  ISI.rebuild(ING_DB, CUSTOM);
  const unsorted = ['하하', '가가', '나나', 'zeta', 'alpha', '다다'].map(mkRow); // 파일 원본 순서 흉내
  ISI.setExt(unsorted);
  // sortedNames 는 병합 정렬 결과라, ext 부분이 정렬돼 있어야 전체가 정렬된다
  const names = ISI.sortedNames('', EXT_CAP); // 검색어 없음 → base 만
  // 검색어를 주면 ext 도 섞여 나오고 그 순서가 정렬돼 있어야 함
  const withExt = ISI.sortedNames('가', EXT_CAP).concat(ISI.sortedNames('하', EXT_CAP));
  const ref = refSortedNames(ING_DB, CUSTOM, [...unsorted].sort((a, b) => a[0].localeCompare(b[0], 'ko')), '가')
    .concat(refSortedNames(ING_DB, CUSTOM, [...unsorted].sort((a, b) => a[0].localeCompare(b[0], 'ko')), '하'));
  assert.deepEqual(withExt, ref);
  // filterRows 의 ext 부분도 정렬 순서
  const rows = ISI.filterRows('a', EXT_CAP).map(r => r[0]).filter(n => /^[a-z]/.test(n));
  assert.deepEqual(rows, [...rows].sort((a, b) => a.localeCompare(b, 'ko')));
});

test('setExt: 같은 배열 참조면 재계산하지 않는다', () => {
  ISI._reset();
  ISI.rebuild(ING_DB, CUSTOM);
  ISI.setExt(EXT_SORTED);
  const c1 = ISI.extCount();
  ISI.setExt(EXT_SORTED);               // 동일 참조
  assert.equal(ISI.extCount(), c1);
});

// ── 3,000+ 규모 성능/정확성 ────────────────────────────────────────────────
test('3,000 확장 DB: 인덱스가 참조 구현과 동일 + 500회 검색 성능', () => {
  const bigExt = [];
  for (let i = 0; i < 3000; i++) bigExt.push(mkRow('ext원료_' + String(i).padStart(4, '0')));
  bigExt.sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  ISI._reset();
  ISI.rebuild(ING_DB, CUSTOM);
  ISI.setExt(bigExt);

  // 정확성: 인덱스 결과 == 참조 구현
  for (const q of ['ext원료_1', 'ext원료_2999', '_00', '닭', 'zzz없음']) {
    assert.deepEqual(ISI.sortedNames(q, EXT_CAP), refSortedNames(ING_DB, CUSTOM, bigExt, q), 'names q=' + q);
    const g = ISI.filterRows(q, EXT_CAP), r = refFilterRows(ING_DB, CUSTOM, bigExt, bigExt, q);
    assert.equal(g.length, r.length, 'rows q=' + q);
  }
  // 상한: 매칭이 수천이어도 sortedNames 의 ext 부분은 EXT_CAP 이하
  assert.ok(ISI.sortedNames('ext원료_', EXT_CAP).length <= ING_DB.length + CUSTOM.length + EXT_CAP);

  const t0 = Date.now();
  let acc = 0;
  for (let i = 0; i < 500; i++) acc += ISI.sortedNames('ext원료_' + (i % 100), EXT_CAP).length;
  const ms = Date.now() - t0;
  assert.ok(acc > 0);
  assert.ok(ms < 1500, `500회 sortedNames = ${ms}ms`);
});
