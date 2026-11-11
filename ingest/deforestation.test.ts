import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterPoints, summaryPrompt, keyNeedsRenewal } from './deforestation.ts';

test('Alert points group onto a ~1 km grid with first/last dates and area', () => {
  const c = clusterPoints([
    { latitude: -2.7512, longitude: 114.2509, gfw_integrated_alerts__date: '2026-11-02', area__ha: 0.01 },
    { latitude: -2.7488, longitude: 114.2531, gfw_integrated_alerts__date: '2026-11-09', area__ha: 0.01 },
    { latitude: -2.7400, longitude: 114.2500, gfw_integrated_alerts__date: '2026-11-05', area__ha: 0.02 },
    { latitude: NaN, longitude: 1, gfw_integrated_alerts__date: '2026-11-05' },
  ]).sort((a, b) => a.grid_lat - b.grid_lat);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { grid_lat: -2.75, grid_lon: 114.25, first_detected: '2026-11-02', last_detected: '2026-11-09', alert_count: 2, area_ha: 0.02 });
  assert.equal(c[1].grid_lat, -2.74);
});

test('Summary prompt forbids accusations and carries the facts', () => {
  const p = summaryPrompt([{ i: 0, province: 'Central Kalimantan', area_ha: 12.5, alerts: 900, first: '2026-10-14', last: '2026-11-09', fires: 23, news: ['Peat fires flare'] }]);
  assert.ok(p.includes('Never name or accuse'));
  assert.ok(p.includes('~12.5 ha') && p.includes('23') && p.includes('"Peat fires flare"'));
});

test('GFW key: create when missing, keep when valid, renew 14 days before expiry', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(keyNeedsRenewal(null, now), true);
  assert.equal(keyNeedsRenewal({ api_key: 'k', expires_on: '2027-11-12T00:00:00Z' }, now), false);
  assert.equal(keyNeedsRenewal({ api_key: 'k', expires_on: '2026-11-20T00:00:00Z' }, now), true);
  assert.equal(keyNeedsRenewal({ api_key: 'k' }, now), false);
});
