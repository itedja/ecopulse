import { test } from 'node:test';
import assert from 'node:assert/strict';
import { category, cleanestWindow, advice } from './aqi.ts';
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
