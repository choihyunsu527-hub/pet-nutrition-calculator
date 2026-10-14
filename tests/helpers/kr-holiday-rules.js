'use strict';
// 대한민국 공휴일 "규칙 기반 생성기" — js/kr-holidays.js 의 정적 데이터 표를 교차 검증하기 위한 독립 구현이다.
// (런타임 앱은 이 파일을 쓰지 않는다. 앱은 검토된 정적 표를 쓰고, 테스트가 표 == 규칙 계산 결과인지 확인한다.)
//
// 규칙(관공서의 공휴일에 관한 규정 / 공휴일에 관한 법률):
//  · 양력 고정: 신정 1/1, 삼일절 3/1, 노동절 5/1(2026~), 어린이날 5/5, 현충일 6/6, 제헌절 7/17(2026~),
//    광복절 8/15, 개천절 10/3, 한글날 10/9, 성탄절 12/25
//  · 음력: 설날(음력 1/1) 전날·당일·다음날, 부처님오신날(음력 4/8), 추석(음력 8/15) 전날·당일·다음날
//    — 음력→양력은 한국 음력(ICU 'dangi' 달력, Asia/Seoul)으로 계산한다.
//  · 대체공휴일(2024~ 기준 적용 대상): 설날·추석 연휴(일요일 또는 다른 공휴일과 겹칠 때 — 토요일은 제외),
//    어린이날·삼일절·노동절·부처님오신날·제헌절·광복절·개천절·한글날·성탄절(토/일요일 또는 다른 공휴일과 겹칠 때).
//    신정·현충일·선거일·임시공휴일은 대체공휴일이 없다.
//    대체일 = 해당 공휴일(연휴는 마지막 날) 다음의 첫 번째 "토·일·공휴일이 아닌 날".
//  · 선거일·임시공휴일은 정부가 따로 지정하므로 extras 로 직접 넘긴다.

const LUNAR = new Intl.DateTimeFormat('en-u-ca-dangi-nu-latn', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });
const p2 = n => String(n).padStart(2, '0');
const iso = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return iso(Date.UTC(y, m - 1, d) + n * 86400000); };
const weekday = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };   // 0=일, 6=토

// 해당 연도의 음력 (월, 일) → 양력 ISO. 윤달은 제외(평달만).
function lunarToSolar(year, lm, ld) {
  for (let ms = Date.UTC(year, 0, 1); ms < Date.UTC(year + 1, 0, 1); ms += 86400000) {
    const parts = Object.fromEntries(LUNAR.formatToParts(new Date(ms + 12 * 3600000)).map(x => [x.type, x.value]));
    if (parts.month === String(lm) && Number(parts.day) === ld) return iso(ms);
  }
  return null;
}

function generateKrHolidays(year, extras = {}) {
  const items = [];    // { date, name, sub: 대체공휴일 대상 여부 }
  const blocks = [];   // 설날/추석 연휴 [{ name, dates:[전날,당일,다음날] }]
  const fixed = [['01-01', '신정', false], ['03-01', '삼일절', true], ['05-05', '어린이날', true], ['06-06', '현충일', false],
    ['08-15', '광복절', true], ['10-03', '개천절', true], ['10-09', '한글날', true], ['12-25', '성탄절', true]];
  if (year >= 2026) fixed.push(['05-01', '노동절', true], ['07-17', '제헌절', true]);
  fixed.forEach(([md, name, sub]) => items.push({ date: `${year}-${md}`, name, sub }));
  const buddha = lunarToSolar(year, 4, 8);
  if (buddha) items.push({ date: buddha, name: '부처님오신날', sub: true });
  [['설날', 1, 1], ['추석', 8, 15]].forEach(([name, lm, ld]) => {
    const d = lunarToSolar(year, lm, ld);
    if (d) blocks.push({ name, dates: [addDays(d, -1), d, addDays(d, 1)] });
  });
  const out = {};
  const add = (d, n) => { out[d] = out[d] ? `${out[d]}·${n}` : n; };
  items.forEach(i => add(i.date, i.name));
  blocks.forEach(b => b.dates.forEach((d, k) => add(d, k === 1 ? b.name : `${b.name} 연휴`)));
  Object.entries(extras).forEach(([d, n]) => add(d, n));

  // 대체공휴일 필요 목록(앵커 = 이 날짜 다음부터 대체일 탐색)
  const needs = [];
  const blockDates = new Set(blocks.flatMap(b => b.dates));
  const eligible = items.filter(i => i.sub);
  const byDate = {};
  eligible.forEach(i => { (byDate[i.date] = byDate[i.date] || []).push(i); });
  Object.entries(byDate).forEach(([date, list]) => {
    if (blockDates.has(date)) return;                                  // 연휴와 겹치는 경우는 연휴 쪽에서 1회 처리
    const wd = weekday(date);
    const overlapsOther = list.length > 1 || items.some(o => o.date === date && !o.sub) || !!extras[date];
    if (wd === 0 || wd === 6 || overlapsOther) needs.push({ anchor: date, name: list[0].name });
  });
  blocks.forEach(b => {
    const hasSunday = b.dates.some(d => weekday(d) === 0);
    const hasOther = b.dates.some(d => items.some(i => i.date === d) || (extras[d] && true));
    if (hasSunday || hasOther) needs.push({ anchor: b.dates[2], name: b.name });
  });
  needs.sort((a, b) => (a.anchor < b.anchor ? -1 : 1));
  needs.forEach(n => {
    let d = addDays(n.anchor, 1);
    while (weekday(d) === 0 || weekday(d) === 6 || out[d]) d = addDays(d, 1);
    out[d] = `대체공휴일(${n.name})`;
  });
  return out;
}

module.exports = { generateKrHolidays, lunarToSolar, addDays, weekday };
