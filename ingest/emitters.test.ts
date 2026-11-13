import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNamedFacility, addGas, isBig, type ApiSource, type Facility } from './emitters.ts';

const src = (o: Partial<ApiSource>): ApiSource => ({
  id: 1, name: 'Banten Suralaya power station', sector: 'power', subsector: 'electricity-generation', assetType: 'coal, oil',
  sourceType: 'point-source', centroid: { longitude: 106.0336, latitude: -5.8892 }, emissionsQuantity: 19746000,
  capacity: 5065, capacityUnits: 'MW', year: 2025, ...o,
});

test('named facilities only: basin-wide, unnamed, area and out-of-country rows are left out', () => {
  assert.equal(isNamedFacility(src({})), true);
  assert.equal(isNamedFacility(src({ name: 'Indonesia_OtherBasins_OtherResources' })), false);
  assert.equal(isNamedFacility(src({ name: 'Unknown name' })), false);
  assert.equal(isNamedFacility(src({ sourceType: 'gadm-aggregation', name: 'Padang Lawas Regency' })), false);
  assert.equal(isNamedFacility(src({ centroid: { longitude: 2.3, latitude: 48.8 } })), false);
});

test('gases merge into one facility; zero and negative values are not stored', () => {
  const map = new Map<number, Facility>();
  addGas(map, [src({})], 'co2e', 2025);
  addGas(map, [src({ emissionsQuantity: 78230 })], 'so2', 2025);
  addGas(map, [src({ emissionsQuantity: 0 })], 'pm25', 2025);
  addGas(map, [src({ id: 2, name: 'Some carbon sink', emissionsQuantity: -5 })], 'co2e', 2025);
  const f = map.get(1)!;
  assert.equal(f.co2e_t, 19746000);
  assert.equal(f.so2_t, 78230);
  assert.equal(f.pm25_t, null);
  assert.equal(f.capacity, 5065);
  assert.equal(f.capacity_unit, 'MW');
  assert.equal(map.get(2)!.co2e_t, null);
  assert.equal(isBig(map.get(2)!), false);
  assert.equal(isBig(f), true);
});

test('"license restricted" capacity units are not shown', () => {
  const map = new Map<number, Facility>();
  addGas(map, [src({ capacity: 0, capacityUnits: 'license restricted' })], 'co2e', 2025);
  assert.equal(map.get(1)!.capacity, null);
  assert.equal(map.get(1)!.capacity_unit, null);
});

test('a smelter with modest CO2e but heavy PM2.5 is kept', () => {
  const map = new Map<number, Facility>();
  addGas(map, [src({ id: 9, name: 'Some nickel smelter', sector: 'manufacturing', emissionsQuantity: 40000 })], 'co2e', 2025);
  addGas(map, [src({ id: 9, name: 'Some nickel smelter', sector: 'manufacturing', emissionsQuantity: 120 })], 'pm25', 2025);
  assert.equal(isBig(map.get(9)!), true);
});
