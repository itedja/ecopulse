import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, KIND_LABEL } from './sources';

test('every source has both languages, a provider link and a stated limit', () => {
  const keys = new Set<string>();
  for (const s of SOURCES) {
    assert.ok(!keys.has(s.key), `duplicate ${s.key}`); keys.add(s.key);
    assert.ok(KIND_LABEL[s.kind]);
    assert.ok(s.from.length > 0);
    for (const f of s.from) assert.match(f.url, /^(https:\/\/|\/)/);
    for (const part of [s.title, s.updates, s.what, s.ours, s.limits]) {
      assert.ok(part.id.trim().length > 0 && part.en.trim().length > 0, s.key);
    }
  }
});

test('model figures are labelled as estimates or forecasts, never as measurements', () => {
  for (const s of SOURCES.filter((x) => x.kind === 'model')) {
    assert.match(s.limits.en, /not (a |stack )?measurement/i, s.key);
    assert.match(s.limits.id, /bukan pengukuran/i, s.key);
  }
});

test('the emitter entry attributes names to Climate TRACE and makes no accusation', () => {
  const e = SOURCES.find((s) => s.key === 'emit')!;
  assert.match(e.what.en, /as listed by Climate TRACE/);
  assert.match(e.limits.en, /does not mean a facility broke any rule/);
});
