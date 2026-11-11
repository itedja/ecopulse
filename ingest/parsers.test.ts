import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFirmsCsv } from './firms.ts';
import { parseAqicn, citySnapshot, pickPm25, pm25SensorIds } from './air-quality.ts';
import { forecastRows, airForecastRows, quakeRows } from './weather.ts';
import { lastWeekStart } from './maintenance.ts';
import { pm25ToAqi } from './lib/aqi.ts';
import { redact } from './lib/http.ts';

test('FIRMS CSV: parses, pads time, drops out-of-box rows and bad confidence', () => {
  const csv = [
    'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
    '-2.21614,113.91352,335.2,0.4,0.4,2026-11-10,542,N20,VIIRS,h,2.0NRT,290.1,12.3,D',
    '-1.5,103.6,301.0,0.4,0.4,2026-11-10,1830,N20,VIIRS,n,2.0NRT,288.0,,N',
    '35.0,139.0,330.0,0.4,0.4,2026-11-10,0100,N20,VIIRS,h,2.0NRT,290.0,5.0,D',
    '-3.0,104.0,330.0,0.4,0.4,2026-11-10,0100,N20,VIIRS,x,2.0NRT,290.0,5.0,D',
  ].join('\n');
  const rows = parseFirmsCsv(csv, 'VIIRS_NOAA20_NRT');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].acquired_at, '2026-11-10T05:42:00.000Z');
  assert.equal(rows[0].confidence, 'high');
  assert.equal(rows[1].frp_mw, null);
  assert.equal(rows[1].daynight, 'N');
});

test('FIRMS: a text error instead of CSV throws a clear message', () => {
  assert.throws(() => parseFirmsCsv('Invalid MAP_KEY.\nx', 'VIIRS_SNPP_NRT'), /did not return CSV/);
});

test('AQICN: skips "-" values, keeps Indonesian stations', () => {
  const { stations, readings } = parseAqicn({ status: 'ok', data: [
    { lat: -6.2, lon: 106.8, uid: 1, aqi: '158', station: { name: 'Jakarta', time: '2026-11-11T13:00:00+07:00' } },
    { lat: -6.3, lon: 106.9, uid: 2, aqi: '-', station: { name: 'Broken', time: '2026-11-11T13:00:00+07:00' } },
    { lat: 13.7, lon: 100.5, uid: 3, aqi: '80', station: { name: 'Bangkok', time: '2026-11-11T13:00:00+07:00' } },
  ] });
  assert.equal(stations.length, 2);
  assert.equal(readings.length, 1);
  assert.equal(readings[0].measured_at, '2026-11-11T06:00:00.000Z');
});

test('AQICN: bad token surfaces the message', () => {
  assert.throws(() => parseAqicn({ status: 'error', data: 'Invalid key' }), /Invalid key/);
});

test('OpenAQ: picks newest PM2.5 sensor value only', () => {
  const loc = { id: 9, name: 'x', coordinates: { latitude: 0, longitude: 0 }, datetimeLast: null,
    sensors: [{ id: 1, parameter: { id: 2 } }, { id: 5, parameter: { id: 1 } }] };
  const pm = pickPm25([
    { datetime: { utc: '2026-11-11T05:00:00Z' }, value: 40, sensorsId: 1 },
    { datetime: { utc: '2026-11-11T06:00:00Z' }, value: 55, sensorsId: 1 },
    { datetime: { utc: '2026-11-11T07:00:00Z' }, value: 999, sensorsId: 5 },
  ], pm25SensorIds(loc));
  assert.deepEqual(pm, { at: '2026-11-11T06:00:00.000Z', value: 55 });
});

test('City snapshot: median AQI, only fresh and nearby stations', () => {
  const now = Date.parse('2026-11-11T07:00:00Z');
  const city = { id: 1, slug: 'jakarta', latitude: -6.2088, longitude: 106.8456 };
  const snap = citySnapshot(city, [
    { latitude: -6.21, longitude: 106.85, pm25_ugm3: 65, aqi_us: 156, measured_at: '2026-11-11T06:30:00Z' },
    { latitude: -6.25, longitude: 106.80, pm25_ugm3: null, aqi_us: 160, measured_at: '2026-11-11T06:00:00Z' },
    { latitude: -6.22, longitude: 106.84, pm25_ugm3: null, aqi_us: 400, measured_at: '2026-11-11T06:00:00Z' },
    { latitude: -6.20, longitude: 106.84, pm25_ugm3: 10, aqi_us: 50, measured_at: '2026-11-11T01:00:00Z' },   // stale
    { latitude: -7.25, longitude: 112.75, pm25_ugm3: 10, aqi_us: 50, measured_at: '2026-11-11T06:00:00Z' },   // Surabaya
  ], now);
  assert.deepEqual(snap, { city_id: 1, aqi_us: 160, pm25_ugm3: 65, station_count: 3 });
});

test('AQI matches the 2024 EPA breakpoints and the database function', () => {
  assert.equal(pm25ToAqi(9.0), 50);
  assert.equal(pm25ToAqi(35.4), 100);
  assert.equal(pm25ToAqi(35.5), 101);
  assert.equal(pm25ToAqi(158), 233);
  assert.equal(pm25ToAqi(400), 500);
  assert.equal(pm25ToAqi(null), null);
});

test('Open-Meteo: maps hourly arrays to rows per point', () => {
  const pts = [{ id: 1, latitude: 0, longitude: 0, kind: 'city' }, { id: 2, latitude: 1, longitude: 1, kind: 'fire_zone' }];
  const loc = (w: number) => ({ latitude: 0, longitude: 0, hourly: {
    time: ['2026-11-11T00:00', '2026-11-11T01:00'], temperature_2m: [27.04, 26.9], precipitation: [0, 1.25],
    wind_speed_10m: [w, w], wind_direction_10m: [90.4, 91], wind_gusts_10m: [null, 20] } });
  const rows = forecastRows(pts, [loc(10), loc(20)]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { point_id: 1, valid_at: '2026-11-11T00:00:00.000Z', temperature_c: 27, precipitation_mm: 0,
    wind_speed_kmh: 10, wind_direction_deg: 90, wind_gusts_kmh: null });
  assert.equal(rows[3].wind_speed_kmh, 20);
  const aq = airForecastRows([pts[0]], [{ latitude: 0, longitude: 0, hourly: { time: ['2026-11-11T00:00'], pm2_5: [65.2] } }]);
  assert.deepEqual(aq[0], { point_id: 1, valid_at: '2026-11-11T00:00:00.000Z', pm25_forecast: 65.2, aqi_forecast: 158 });
});

test('BMKG quakes: parses strings, tsunami wording', () => {
  const rows = quakeRows([
    { DateTime: '2026-11-10T21:05:11+00:00', Coordinates: '-3.12,129.45', Magnitude: '5.4', Kedalaman: '10 km',
      Wilayah: 'Seram', Potensi: 'Tidak berpotensi tsunami' },
    { DateTime: 'bad', Coordinates: 'x', Magnitude: '?' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].depth_km, 10);
  assert.equal(rows[0].tsunami_risk, false);
});

test('Weekly stats target last Monday', () => {
  assert.equal(lastWeekStart(new Date('2026-11-11T12:00:00Z')), '2026-11-02');  // Wed
  assert.equal(lastWeekStart(new Date('2026-11-09T01:00:00Z')), '2026-11-02');  // Mon
  assert.equal(lastWeekStart(new Date('2026-11-08T23:00:00Z')), '2026-10-26');  // Sun
});

test('Keys never appear in logs', () => {
  assert.equal(redact('https://api.waqi.info/v2/map/bounds?latlng=1&token=SECRET&x=1'), 'https://api.waqi.info/v2/map/bounds?latlng=1&token=***&x=1');
  assert.equal(redact('https://firms.modaps.eosdis.nasa.gov/api/area/csv/SECRET/VIIRS/1,2,3,4/2'), 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/***/VIIRS/1,2,3,4/2');
});
