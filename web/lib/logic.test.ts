import { test } from 'node:test';
import assert from 'node:assert/strict';
import { category, cleanestWindow, advice, isNextLocalDay } from './aqi.ts';
import { upwindFires, bearing, compass } from './smoke.ts';
import { cityTimeZone, hhmm, T } from './i18n.ts';

test('AQI categories', () => {
  assert.equal(category(50)!.key, 'good');
  assert.equal(category(51)!.key, 'moderate');
  assert.equal(category(158)!.key, 'unhealthy');
  assert.equal(category(450)!.key, 'hazardous');
  assert.equal(category(null), null);
  assert.equal(advice('unhealthy', 'id').exercise, 'Di dalam ruangan');
});

test('Cleanest window: picks the best 2 h between 05:00 and 21:00 local', () => {
  // 24 hours starting 22:00 WIB (15:00Z). Lowest pair overall is 02:00–03:00 WIB (night) and must be ignored.
  const base = Date.parse('2026-11-11T15:00:00Z');
  const aqi = [150, 140, 120, 100, 40, 40, 90, 70, 60, 58, 65, 80, 100, 120, 130, 140, 150, 150, 150, 150, 150, 150, 150, 150];
  const pts = aqi.map((a, i) => ({ valid_at: new Date(base + i * 3600_000).toISOString(), aqi_forecast: a }));
  const w = cleanestWindow(pts, 'Asia/Jakarta')!;
  assert.equal(hhmm(w.start, 'Asia/Jakarta'), '06:00');
  assert.equal(hhmm(w.end, 'Asia/Jakarta'), '08:00');
});

test('Smoke: only upwind, non-low, within range counts', () => {
  const jkt = { latitude: -6.2, longitude: 106.85 };
  const fires = [
    { latitude: -3.0, longitude: 104.5, confidence: 'high' },     // South Sumatra, NW of Jakarta (~430 km? keep in range check)
    { latitude: -4.5, longitude: 105.5, confidence: 'nominal' },  // Lampung, NW ~240 km
    { latitude: -4.5, longitude: 105.5, confidence: 'low' },      // low confidence: ignored
    { latitude: -7.5, longitude: 110.0, confidence: 'high' },     // Central Java, SE: downwind
  ];
  const nwBearing = bearing(jkt.latitude, jkt.longitude, -4.5, 105.5);
  assert.ok(nwBearing > 290 && nwBearing < 340, String(nwBearing));
  const r = upwindFires(jkt, 315, 15, fires);           // wind FROM the northwest
  assert.equal(r.count >= 1, true);
  assert.ok(r.nearestKm! > 200 && r.nearestKm! < 280);
  assert.equal(upwindFires(jkt, 135, 15, fires).count, 1);  // wind from SE: only Central Java fire
  assert.equal(upwindFires(jkt, 315, 1, fires).count, 0);   // calm
  assert.equal(compass(315, 'en'), 'NW');
  assert.equal(compass(315, 'id'), 'BL');
});

test('Time zones per city', () => {
  assert.equal(cityTimeZone('jakarta').label, 'WIB');
  assert.equal(cityTimeZone('makassar').label, 'WITA');
  assert.equal(cityTimeZone('jayapura').label, 'WIT');
  assert.equal(T.en.updated(0), 'Updated just now');
  assert.equal(T.id.updated(90), 'Diperbarui 2 jam lalu');
});

import { calibrateForecast, pm25ToAqi, aqiToPm25 } from './aqi.ts';

test('PM2.5 <-> AQI round-trips', () => {
  assert.equal(pm25ToAqi(84.7), 171);
  for (const a of [25, 75, 120, 154, 250, 400]) assert.ok(Math.abs(pm25ToAqi(aqiToPm25(a)) - a) <= 1, String(a));
});

test('Forecast calibration: matches the live reading now, keeps the shape', () => {
  // Model says ~150 µg/m³ (purple) now and halves by afternoon; sensors say 84.7 µg/m³ (AQI 154 band).
  const raw = [150, 140, 120, 75].map((pm, i) => ({ valid_at: `2026-11-12T0${i}:00:00Z`, pm25_forecast: pm, aqi_forecast: pm25ToAqi(pm) }));
  assert.equal(raw[0].aqi_forecast > 200, true);
  const cal = calibrateForecast(raw, { pm25: 84.7, aqi: 154 });
  assert.ok(Math.abs(cal[0].aqi_forecast - 154) <= 1);            // first hour == the AQI on the card
  assert.ok(cal[3].aqi_forecast < cal[0].aqi_forecast);           // still improves later
  assert.ok(cal.every((p) => p.aqi_forecast <= 200));             // no more purple
  // No live PM2.5 (AQICN-only city): derive it from the AQI.
  assert.ok(Math.abs(calibrateForecast(raw, { pm25: null, aqi: 154 })[0].aqi_forecast - 154) <= 1);
  // No live reading: unchanged.
  assert.equal(calibrateForecast(raw, null)[0].aqi_forecast, raw[0].aqi_forecast);
});

import { rankProgress, errorCode, span } from './community';

test('rank progress matches the database thresholds', () => {
  assert.deepEqual(rankProgress(0), { rank: 'pengamat', next: 'penjaga', toNext: 100, pct: 0 });
  assert.deepEqual(rankProgress(140), { rank: 'penjaga', next: 'pelindung', toNext: 360, pct: 10 });
  assert.equal(rankProgress(2500).next, null);
});

test('database error codes are recognised inside any message', () => {
  assert.equal(errorCode(new Error('too_far')), 'too_far');
  assert.equal(errorCode({ message: 'P0001: daily_limit' }), 'daily_limit');
  assert.equal(errorCode('weird'), 'generic');
});

test('time spans read naturally', () => {
  assert.equal(span(30 * 60_000, 'en'), '30 min');
  assert.equal(span(5 * 3600_000, 'id'), '5 jam');
  assert.equal(span(3 * 86400_000, 'en'), '3 days');
});

test('Cleanest window says "tomorrow" only when it is on the next local day', () => {
  // 18:47 WIB on 14 Nov. A window starting 11:00 WIB on 15 Nov is tomorrow; 20:00 WIB on 14 Nov is not.
  const now = new Date('2026-11-14T11:47:00Z');
  assert.equal(isNextLocalDay(new Date('2026-11-15T04:00:00Z'), now, 'Asia/Jakarta'), true);
  assert.equal(isNextLocalDay(new Date('2026-11-14T13:00:00Z'), now, 'Asia/Jakarta'), false);
  // Same instant is already "tomorrow" in Jayapura (WIT) after 22:00 WIB, but still today in Jakarta.
  const late = new Date('2026-11-14T15:30:00Z');   // 22:30 WIB = 00:30 WIT on the 15th
  assert.equal(isNextLocalDay(new Date('2026-11-15T01:00:00Z'), late, 'Asia/Jakarta'), true);
  assert.equal(isNextLocalDay(new Date('2026-11-15T01:00:00Z'), late, 'Asia/Jayapura'), false);
  assert.equal(T.id.cleanest('11:00', '13:00', true), 'Udara paling bersih: besok 11:00–13:00.');
  assert.equal(T.en.cleanest('11:00', '13:00'), 'Cleanest window: 11:00–13:00.');
});

test('Emitter list on the city card labels tonnages as Climate TRACE estimates', () => {
  assert.match(T.id.emitCard.nearTitle, /perkiraan Climate TRACE/);
  assert.match(T.en.emitCard.nearTitle, /Climate TRACE estimates/);
  assert.equal(T.id.emitCard.nearMeta(31, '5.640'), '31 km · perkiraan 5.640 t PM2.5/thn');
  assert.equal(T.en.emitCard.nearMeta(31, '5,640'), '31 km · est. 5,640 t PM2.5/yr');
  assert.equal(T.id.emitCard.nearMeta(31, null), '31 km');
});
