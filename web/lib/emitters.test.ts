import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindLabel, millions, nearby } from './emitters';

test('facility type in plain words, with fuel for power plants', () => {
  assert.equal(kindLabel({ sector: 'power', subsector: 'electricity-generation', asset_type: 'coal, oil' }, 'id'), 'Pembangkit listrik · batu bara');
  assert.equal(kindLabel({ sector: 'manufacturing', subsector: 'iron-and-steel', asset_type: 'BF/BOF' }, 'en'), 'Steel plant');
  assert.equal(kindLabel({ sector: 'waste', subsector: 'something-new', asset_type: null }, 'en'), 'Waste site');
});

test('millions of tonnes, rounded for reading', () => {
  assert.equal(millions(19746000, 'en'), '20');
  assert.equal(millions(1592699, 'en'), '1.6');
  assert.equal(millions(412000, 'en'), '0.41');
  assert.equal(millions(1592699, 'id'), '1,6');
});

test('nearby: within the radius, biggest PM2.5 first', () => {
  const list = [
    { id: 1, name: 'a', subsector: 'x', asset_type: null, lon: 106.03, lat: -5.89, sector: 'power', co2e_t: 2e7, pm25_t: 3000 },     // Suralaya, ~95 km from Jakarta
    { id: 2, name: 'b', subsector: 'x', asset_type: null, lon: 106.99, lat: -6.35, sector: 'waste', co2e_t: 3e6, pm25_t: null },     // Bantar Gebang, ~25 km
    { id: 3, name: 'c', subsector: 'x', asset_type: null, lon: 113.58, lat: -7.71, sector: 'power', co2e_t: 2e7, pm25_t: 5000 },     // Paiton, far away
  ];
  const r = nearby(list, -6.2088, 106.8456);
  assert.deepEqual(r.map((x) => x.id), [1, 2]);
  assert.ok(r[1].km > 15 && r[1].km < 35);
});

test('emitter disc radius is a style expression MapLibre accepts', async () => {
  const { validateStyleMin } = await import('@maplibre/maplibre-gl-style-spec');
  const { emitRadius } = await import('./emitters');
  for (const pad of [0, 3]) {
    const errors = validateStyleMin({
      version: 8, sources: { emit: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'emit-dot', type: 'circle', source: 'emit', paint: { 'circle-radius': emitRadius(pad) } }],
    });
    assert.deepEqual(errors.map((e) => e.message), []);
  }
});
