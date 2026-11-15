import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingReturn } from './returnTo';

test('only a recent, allow-listed page is returned to after sign-in', () => {
  const now = 1_000_000_000;
  assert.equal(pendingReturn(JSON.stringify({ path: '/aksi', t: now - 60_000 }), now), '/aksi');
  assert.equal(pendingReturn(JSON.stringify({ path: '/aksi', t: now - 16 * 60_000 }), now), null);
  assert.equal(pendingReturn(JSON.stringify({ path: 'https://evil.example', t: now }), now), null);
  assert.equal(pendingReturn(JSON.stringify({ path: '//evil.example', t: now }), now), null);
  assert.equal(pendingReturn('not json', now), null);
  assert.equal(pendingReturn(null, now), null);
});
