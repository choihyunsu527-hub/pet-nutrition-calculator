// custom-ingredients.js — 사용자 추가 원료(customIngs)의 "안정적 ID" 계층.
// ⚠ 계산·저장 형식·레시피 형식을 바꾸지 않는다.
//   - customIngs 원소는 지금과 똑같이 49칸 배열 [이름, ...영양소 48] 그대로 둔다.
//   - ID 는 배열 안에 넣지 않고, 배열 "참조 → id" 매핑을 이 모듈이 따로 들고 있는다.
//   - getIng(name)(이름 기반 조회)·calcNutrition·레시피 저장 형식은 전혀 건드리지 않는다.
//   - localStorage 는 기존 v1 키(feedcalc_v4_custom_ings*)를 그대로 두고, v2 키를 "추가"만 한다.

const CustomIngredients = (function () {
  'use strict';

  // 배열 참조 → id ("custom:<base36 timestamp><base36 random>")
  const _idByRow = new Map();
  const _issued = new Set(); // 이번 세션에서 발급/등록된 모든 id (충돌 방지)

  function allocId() {
    let id;
    let guard = 0;
    do {
      id = 'custom:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      guard++;
    } while (_issued.has(id) && guard < 50);
    _issued.add(id);
    return id;
  }

  function isValidId(id) {
    return typeof id === 'string' && /^custom:[0-9a-z]+$/i.test(id);
  }

  // row(배열 참조)의 id 를 돌려준다. 없으면 새로 발급해 등록한다.
  function idFor(row) {
    if (!Array.isArray(row)) return null;
    let id = _idByRow.get(row);
    if (!id) { id = allocId(); _idByRow.set(row, id); }
    return id;
  }

  // 명시적으로 (row, id) 를 등록한다(v2 로드 시 사용). id 가 이상하면 새로 발급.
  function register(row, id) {
    if (!Array.isArray(row)) return null;
    const use = isValidId(id) ? id : allocId();
    _idByRow.set(row, use);
    _issued.add(use);
    return use;
  }

  function unregister(row) {
    if (Array.isArray(row)) _idByRow.delete(row);
  }

  // 이름 변경/데이터 교체로 배열 참조가 바뀔 때, 같은 id 를 새 참조로 옮긴다(= 이름 변경해도 ID 유지).
  function reassign(oldRow, newRow) {
    if (!Array.isArray(newRow)) return null;
    const id = (Array.isArray(oldRow) && _idByRow.get(oldRow)) || allocId();
    if (Array.isArray(oldRow)) _idByRow.delete(oldRow);
    _idByRow.set(newRow, id);
    _issued.add(id);
    return id;
  }

  // customIngs 배열이 통째로 교체됐을 때(레시피 복원 / v1 로드) 매핑을 현재 배열에 맞춘다.
  //  - 매핑에 없는 row 는 (allocMissing 이면) 새 id 발급
  //  - 현재 배열에 없는 낡은 매핑 엔트리는 정리
  function syncRows(rows, opts) {
    const allocMissing = !opts || opts.allocMissing !== false;
    const present = new Set(Array.isArray(rows) ? rows : []);
    for (const row of _idByRow.keys()) {
      if (!present.has(row)) _idByRow.delete(row);
    }
    if (Array.isArray(rows) && allocMissing) {
      for (const row of rows) if (Array.isArray(row) && !_idByRow.has(row)) idFor(row);
    }
  }

  // v2 로드 시: [[row, id], ...] 를 그대로 등록
  function adoptEntries(entries) {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (Array.isArray(e) && Array.isArray(e[0])) register(e[0], e[1]);
    }
  }

  // ── 조회 ────────────────────────────────────────────────────────────────
  function idOfRow(row) { return Array.isArray(row) ? (_idByRow.get(row) || null) : null; }

  function indexById(id, rows) {
    if (!Array.isArray(rows)) return -1;
    for (let i = 0; i < rows.length; i++) if (_idByRow.get(rows[i]) === id) return i;
    return -1;
  }
  function rowById(id, rows) {
    const i = indexById(id, rows);
    return i >= 0 ? rows[i] : null;
  }
  // 삭제: rows 에서 id 에 해당하는 원소를 splice 하고 매핑도 지운다. 제거된 row(또는 null) 반환.
  function removeById(id, rows) {
    const i = indexById(id, rows);
    if (i < 0) return null;
    const [removed] = rows.splice(i, 1);
    _idByRow.delete(removed);
    return removed;
  }

  // ── v2 직렬화 ───────────────────────────────────────────────────────────
  // { v:2, items:[ { id, name, row:[이름,...48] } ] }  — row 는 현재 배열 그대로(형식 불변)
  function serializeV2(rows) {
    const items = (Array.isArray(rows) ? rows : []).map(row => ({
      id: idFor(row),
      name: Array.isArray(row) ? row[0] : null,
      row: row,
    }));
    return { v: 2, items: items };
  }
  // 파싱: { rows:[...], entries:[[row,id],...] } 또는 형식이 아니면 null
  function parseV2(obj) {
    if (!obj || obj.v !== 2 || !Array.isArray(obj.items)) return null;
    const rows = [];
    const entries = [];
    for (const it of obj.items) {
      if (!it || !Array.isArray(it.row)) continue;
      rows.push(it.row);
      entries.push([it.row, isValidId(it.id) ? it.id : allocId()]);
    }
    return { rows: rows, entries: entries };
  }

  // localStorage v2 키(호출자가 currentUser id 를 넘긴다 — v1 getCustomIngsKey() 패턴과 동일)
  function keyV2(userId) {
    return userId ? ('feedcalc_v4_custom_ings_v2_' + userId) : 'feedcalc_v4_custom_ings_v2';
  }

  // 테스트/디버그용
  function _debugSize() { return _idByRow.size; }
  function _reset() { _idByRow.clear(); _issued.clear(); }

  return {
    allocId, isValidId,
    idFor, register, unregister, reassign, syncRows, adoptEntries,
    idOfRow, indexById, rowById, removeById,
    serializeV2, parseV2, keyV2,
    _debugSize, _reset,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CustomIngredients;
