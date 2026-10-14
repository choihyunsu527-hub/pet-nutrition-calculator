'use strict';
// 달력 일요일·공휴일 날짜 숫자 색 대비(WCAG 2.x) 검사 — css/variables.css 의 토큰을 직접 읽어 계산한다.
//  · 라이트: --cal-holiday 가 칸 배경(--gray-l)·흰 배경 위에서 4.5:1 이상
//  · 다크:   --cal-holiday 가 칸 실효 배경(--side2 위 --gray-l 반투명)·패널 위에서 4.5:1 이상
//  · 오늘 칸(청록 --acc 배경): 날짜 숫자는 흰 칩(--cal-chip-bg) 위 --cal-holiday-on-chip 로 4.5:1 이상 (라이트/다크 모두)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'variables.css'), 'utf8');
function block(selectorRe) {
  const m = css.match(selectorRe);
  assert.ok(m, `블록 없음: ${selectorRe}`);
  const body = m[1];
  const vars = {};
  for (const [, k, v] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[k] = v.trim();
  return vars;
}
const light = block(/:root\s*\{([\s\S]*?)\n\}/);
const dark = { ...light, ...block(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/) };

const hex = h => { const s = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)); };
const parseColor = v => {
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return { rgb: p.slice(0, 3), a: p[3] === undefined ? 1 : p[3] }; }
  return { rgb: hex(v), a: 1 };
};
const blend = (fg, bg) => fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));
const lum = rgb => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('라이트: 일요일·공휴일 빨강이 칸 배경/흰 배경 위에서 4.5:1 이상', () => {
  const red = parseColor(light['cal-holiday']).rgb;
  const cell = parseColor(light['gray-l']).rgb;
  assert.ok(ratio(red, cell) >= 4.5, `칸 배경 대비 ${ratio(red, cell).toFixed(2)}`);
  assert.ok(ratio(red, [255, 255, 255]) >= 4.5);
});

test('다크: 일요일·공휴일 빨강이 칸 실효 배경/패널 위에서 4.5:1 이상', () => {
  const red = parseColor(dark['cal-holiday']).rgb;
  const panel = parseColor(dark['side2']).rgb;
  const cell = blend(parseColor(dark['gray-l']), panel);     // 칸 배경은 반투명 흰색(0.04)을 패널 위에 얹은 값
  assert.ok(ratio(red, cell) >= 4.5, `칸 배경 대비 ${ratio(red, cell).toFixed(2)}`);
  assert.ok(ratio(red, panel) >= 4.5, `패널 대비 ${ratio(red, panel).toFixed(2)}`);
});

test('오늘 칸: 흰 칩 위 빨강 4.5:1 이상(라이트/다크), 칩이 오늘 칸 배경(--acc)과 구분됨', () => {
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    const chipBg = parseColor(t['cal-chip-bg']).rgb;
    const fg = parseColor(t['cal-holiday-on-chip']).rgb;
    assert.ok(ratio(fg, chipBg) >= 4.5, `${name}: 칩 위 대비 ${ratio(fg, chipBg).toFixed(2)}`);
    assert.ok(ratio(chipBg, parseColor(t['acc']).rgb) >= 1.5, `${name}: 칩/오늘 배경 구분`);
  }
});

test('빨강은 라이트·다크 모두 순수 빨강 계열(R 최대, G·B 낮음) — 주황/분홍 아님', () => {
  for (const t of [light, dark]) {
    const [r, g, b] = parseColor(t['cal-holiday']).rgb;
    assert.ok(r >= 224 && g <= 140 && b <= 140 && Math.abs(g - b) <= 20, `rgb(${r},${g},${b})`);
  }
});
