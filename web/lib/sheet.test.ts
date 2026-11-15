import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSnap, sheetInset } from './sheet';

test('a tap on the handle steps peek, half, full and back to peek', () => {
  assert.equal(nextSnap('peek', 0), 'half');
  assert.equal(nextSnap('half', 5), 'full');
  assert.equal(nextSnap('full', -3), 'peek');
});

test('a drag moves one step and stops at the ends', () => {
  assert.equal(nextSnap('peek', -80), 'half');
  assert.equal(nextSnap('full', -80), 'full');
  assert.equal(nextSnap('half', 80), 'peek');
  assert.equal(nextSnap('peek', 80), 'peek');
});

test('the map keeps clear of the sheet on phones only', () => {
  assert.equal(sheetInset('peek', 720, false), 0);
  assert.equal(sheetInset('peek', 720, true), 250);
  assert.equal(sheetInset('half', 720, true), 389);
  assert.equal(sheetInset('full', 720, true), 389);
  assert.equal(sheetInset('peek', 0, true), 0);
  assert.ok(sheetInset('peek', 300, true) <= 150);
});
