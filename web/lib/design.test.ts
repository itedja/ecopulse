import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrast } from './contrast.ts';
import { CATEGORIES } from './aqi.ts';

const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
  assert.ok(m, `--${name} is defined as a hex colour`);
  return m![1];
};

test('contrast: known values', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
});

test('interface text meets WCAG AA (4.5:1) on both backgrounds', () => {
  for (const text of ['ink', 'slate', 'muted']) for (const bg of ['ground', 'surface']) {
    const c = contrast(token(text), token(bg));
    assert.ok(c >= 4.5, `--${text} on --${bg} is ${c.toFixed(2)}:1`);
  }
});

test('every AQI badge keeps its label readable', () => {
  for (const c of CATEGORIES) assert.ok(contrast(c.ink, c.color) >= 4.5, `${c.key}: ${contrast(c.ink, c.color).toFixed(2)}:1`);
});

test('no text is set below 12px in the stylesheets', () => {
  const landing = readFileSync(fileURLToPath(new URL('../app/landing.css', import.meta.url)), 'utf8');
  for (const [name, sheet] of [['globals.css', css], ['landing.css', landing]] as const) {
    const small = [...sheet.matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((n) => n < 12);
    assert.deepEqual(small, [], `${name} has text below 12px`);
  }
});
