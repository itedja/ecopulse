import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArchiveCsv, addDetections, addFlags, type StaticCount, bitString, planWindows, parseAvailability, cellOf, type CellYear } from './fire-history.ts';

const HEAD = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type';

test('archive CSV: keeps vegetation fires, drops low confidence, static sources and outside rows', () => {
  const csv = [HEAD,
    '-3.49,104.51,330,0.4,0.4,2023-09-10,0542,N,VIIRS,h,2,290,12.5,D,0',
    '-3.49,104.51,330,0.4,0.4,2023-09-10,0542,N,VIIRS,l,2,290,1,D,0',
    '-6.01,106.02,360,0.4,0.4,2023-09-10,0542,N,VIIRS,n,2,290,40,D,2',
    '35.0,139.0,330,0.4,0.4,2023-09-10,0542,N,VIIRS,h,2,290,5,D,0',
  ].join('\n');
  const { rows, flags, stats } = parseArchiveCsv(csv);
  assert.equal(rows.length, 1);
  assert.deepEqual(stats, { kept: 1, lowConf: 1, nonVegetation: 1, outside: 1, hasType: true });
  assert.deepEqual(flags, [{ ...cellOf(106.02, -6.01), type: 2 }]);
  assert.equal(rows[0].frp, 12.5);
  assert.deepEqual({ cx: rows[0].cx, cy: rows[0].cy }, cellOf(104.51, -3.49));
});

test('archive CSV: uses the Jakarta date, so a late-evening UTC detection lands on the next day', () => {
  const csv = [HEAD, '-3.49,104.51,330,0.4,0.4,2023-12-31,1830,N,VIIRS,n,2,290,,N,0'].join('\n');
  const { rows } = parseArchiveCsv(csv);
  assert.equal(rows[0].yr, 2024);
  assert.equal(rows[0].doy, 1);
  assert.equal(rows[0].month, 1);
  assert.equal(rows[0].frp, null);
});

test('archive CSV without a type column keeps every vegetation-confidence row', () => {
  const csv = HEAD.replace(',type', '') + '\n-3.49,104.51,330,0.4,0.4,2024-03-01,0100,N,VIIRS,n,2,290,3,D';
  const { rows, stats } = parseArchiveCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(stats.hasType, false);
  assert.equal(rows[0].doy, 61);   // 2024 is a leap year: 31 + 29 + 1
});

test('cells: two detections on the same day count once, months and strongest fire are kept', () => {
  const map = new Map<string, CellYear>();
  addDetections(map, [
    { cx: 1, cy: 2, yr: 2023, doy: 253, month: 9, frp: 4 },
    { cx: 1, cy: 2, yr: 2023, doy: 253, month: 9, frp: 9 },
    { cx: 1, cy: 2, yr: 2023, doy: 300, month: 10, frp: null },
  ]);
  const c = [...map.values()][0];
  const s = bitString(c.days);
  assert.equal(s.length, 366);
  assert.equal([...s].filter((x) => x === '1').length, 2);
  assert.equal(s[252], '1');
  assert.equal(c.months, (1 << 8) | (1 << 9));
  assert.equal(c.frp, 9);
});

test('cell grid: 0.02° steps, no floating-point off-by-one at exact boundaries', () => {
  assert.deepEqual(cellOf(104.5, -3.5), { cx: 5225, cy: -175 });
  assert.deepEqual(cellOf(104.51, -3.49), { cx: 5225, cy: -175 });
});

test('windows: archive up to the last published day, then near-real-time, max 5 days each', () => {
  const w = planWindows('SNPP', '2026-01-01', '2026-01-17', '2026-01-08');
  assert.deepEqual(w, [
    { source: 'VIIRS_SNPP_SP', start: '2026-01-01', days: 5 },
    { source: 'VIIRS_SNPP_SP', start: '2026-01-06', days: 3 },
    { source: 'VIIRS_SNPP_NRT', start: '2026-01-09', days: 5 },
    { source: 'VIIRS_SNPP_NRT', start: '2026-01-14', days: 4 },
  ]);
  assert.ok(planWindows('SNPP', '2023-01-01', '2023-12-31', null).every((x) => x.days <= 5));
  const total = planWindows('NOAA20', '2023-01-01', '2023-12-31', '2025-06-30').reduce((s, x) => s + x.days, 0);
  assert.equal(total, 365);
  assert.ok(planWindows('NOAA20', '2026-01-01', '2026-01-05', null).every((x) => x.source.endsWith('_NRT')));
});

test('data availability CSV is read by column name', () => {
  const a = parseAvailability('data_id,min_date,max_date\nVIIRS_SNPP_SP,2012-01-20,2026-06-30\nVIIRS_SNPP_NRT,2026-04-01,2026-11-12');
  assert.equal(a.VIIRS_SNPP_SP.max, '2026-06-30');
  assert.equal(a.VIIRS_SNPP_NRT.min, '2026-04-01');
  assert.throws(() => parseAvailability('Invalid MAP_KEY'), /Unexpected/);
});

test('NASA labels: volcano and fixed-source detections are flagged per cell, whatever their confidence', () => {
  const csv = [HEAD,
    '-8.108,112.922,367,0.4,0.4,2023-05-01,1800,N,VIIRS,l,2,300,30,N,1',
    '-8.108,112.922,367,0.4,0.4,2023-05-02,1800,N,VIIRS,h,2,300,30,N,1',
    '-6.01,106.02,360,0.4,0.4,2023-09-10,0542,N,VIIRS,n,2,290,40,D,2',
    '1.70,101.40,360,0.4,0.4,2023-09-10,0542,N,VIIRS,n,2,290,40,D,3',
  ].join('\n');
  const { rows, flags, stats } = parseArchiveCsv(csv);
  assert.equal(rows.length, 0);
  assert.equal(stats.lowConf, 0);
  assert.equal(stats.nonVegetation, 4);
  const map = new Map<string, StaticCount>();
  addFlags(map, flags);
  assert.deepEqual(map.get(`${cellOf(112.922, -8.108).cx},${cellOf(112.922, -8.108).cy}`), { ...cellOf(112.922, -8.108), volcano: 2, other: 0 });
  assert.equal([...map.values()].reduce((a, c) => a + c.other, 0), 2);
});

test('near-real-time CSV (no type column) produces no flags', () => {
  const csv = HEAD.replace(',type', '') + '\n-6.01,106.02,330,0.4,0.4,2026-09-01,0100,N,VIIRS,n,2,290,3,D';
  assert.deepEqual(parseArchiveCsv(csv).flags, []);
});
