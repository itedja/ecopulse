// Weather, wind, air-quality forecast and earthquakes. Runs every 30 minutes.
//   Open-Meteo forecast  → weather_forecasts (wind + rain, next 72 h) for cities + fire zones
//   Open-Meteo air API   → weather_forecasts.pm25/aqi (the 24-hour strip on the home screen)
//   BMKG                 → earthquakes (M5+ list and latest felt quake)
// Open-Meteo needs no key for non-commercial use.
import { isMain } from './lib/main.ts';
import { fetchRetry } from './lib/http.ts';
import { db, upsertChunked } from './lib/db.ts';
import { runJob } from './lib/run.ts';
import { pm25ToAqi } from './lib/aqi.ts';

// Grid points over historic haze sources (peatland in Sumatra and Kalimantan).
// Wind here tells the app where smoke will drift.
const FIRE_ZONES: [number, number][] = [
  [1.5, 101.5], [0.5, 101.5], [0.5, 102.5],          // Riau
  [-1.5, 103.5], [-1.0, 104.0],                      // Jambi
  [-3.0, 104.5], [-3.0, 105.5],                      // South Sumatra
  [-0.5, 110.0], [0.5, 110.5],                       // West Kalimantan
  [-2.0, 113.0], [-2.5, 114.5], [-1.5, 112.0],       // Central Kalimantan
  [-3.0, 115.0],                                     // South Kalimantan
  [0.0, 116.5], [-1.0, 116.0],                       // East Kalimantan
];

type Point = { id: number; latitude: number; longitude: number; kind: string };

type MeteoHourly = { time: string[]; [k: string]: (number | null)[] | string[] };
type MeteoLoc = { latitude: number; longitude: number; hourly: MeteoHourly };

// Open-Meteo returns one object for one location, an array for several.
const asArray = <T,>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x]);
const iso = (t: string) => new Date(t.endsWith('Z') ? t : `${t}Z`).toISOString();
const r1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

export function forecastRows(points: Point[], locs: MeteoLoc[]) {
  const rows: Record<string, unknown>[] = [];
  locs.forEach((loc, i) => {
    const p = points[i];
    const h = loc.hourly;
    h.time.forEach((t, j) => {
      const g = (k: string) => (h[k] as (number | null)[] | undefined)?.[j] ?? null;
      rows.push({
        point_id: p.id, valid_at: iso(t),
        temperature_c: r1(g('temperature_2m')),
        precipitation_mm: r1(g('precipitation')),
        wind_speed_kmh: r1(g('wind_speed_10m')),
        wind_direction_deg: g('wind_direction_10m') == null ? null : Math.round(g('wind_direction_10m')!),
        wind_gusts_kmh: r1(g('wind_gusts_10m')),
      });
    });
  });
  return rows;
}

export function airForecastRows(points: Point[], locs: MeteoLoc[]) {
  const rows: Record<string, unknown>[] = [];
  locs.forEach((loc, i) => {
    const h = loc.hourly;
    h.time.forEach((t, j) => {
      const pm = (h['pm2_5'] as (number | null)[])[j];
      rows.push({ point_id: points[i].id, valid_at: iso(t), pm25_forecast: r1(pm), aqi_forecast: pm25ToAqi(pm) });
    });
  });
  return rows;
}

// BMKG publishes coordinates as "lat,lon" and magnitude/depth as strings.
type BmkgQuake = { DateTime: string; Coordinates: string; Magnitude: string; Kedalaman?: string; Wilayah?: string; Dirasakan?: string; Potensi?: string };

export function quakeRows(quakes: BmkgQuake[]) {
  return quakes.flatMap((q) => {
    const [lat, lon] = (q.Coordinates ?? '').split(',').map(Number);
    const mag = Number(q.Magnitude);
    const at = new Date(q.DateTime);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag) || Number.isNaN(at.getTime())) return [];
    return [{
      source: 'bmkg', source_id: at.toISOString(), occurred_at: at.toISOString(),
      magnitude: mag, depth_km: Number.parseFloat(q.Kedalaman ?? '') || null,
      latitude: lat, longitude: lon, region_text: q.Wilayah ?? null, felt_text: q.Dirasakan ?? null,
      tsunami_risk: q.Potensi ? /berpotensi tsunami/i.test(q.Potensi) && !/tidak berpotensi/i.test(q.Potensi) : null,
    }];
  });
}

async function ensureFireZonePoints() {
  await upsertChunked('weather_points',
    FIRE_ZONES.map(([latitude, longitude]) => ({ kind: 'fire_zone', latitude, longitude })),
    'latitude,longitude', { ignoreDuplicates: true });
}

async function main() {
  await runJob('weather', async () => {
    const warnings: string[] = [];
    await ensureFireZonePoints();
    const { data, error } = await db().from('weather_points').select('id, latitude, longitude, kind').order('id');
    if (error) throw error;
    const points = data as Point[];
    let total = 0;

    // 1. Wind + rain for every point, one request.
    const lat = points.map((p) => p.latitude).join(',');
    const lon = points.map((p) => p.longitude).join(',');
    const wx = await fetchRetry(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m&forecast_days=3&timezone=GMT`);
    total += await upsertChunked('weather_forecasts', forecastRows(points, asArray(await wx.json())), 'point_id,valid_at');

    // 2. PM2.5 forecast for cities only (the home-screen strip).
    try {
      const cityPts = points.filter((p) => p.kind === 'city');
      const aq = await fetchRetry(`https://air-quality-api.open-meteo.com/v1/air-quality?` +
        `latitude=${cityPts.map((p) => p.latitude).join(',')}&longitude=${cityPts.map((p) => p.longitude).join(',')}` +
        `&hourly=pm2_5&forecast_days=3&timezone=GMT`);
      total += await upsertChunked('weather_forecasts', airForecastRows(cityPts, asArray(await aq.json())), 'point_id,valid_at');
    } catch (err) {
      warnings.push(`air forecast: ${err instanceof Error ? err.message : err}`);
    }

    // 3. Earthquakes from BMKG.
    try {
      const [list, latest] = await Promise.all([
        fetchRetry('https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json').then((r) => r.json()),
        fetchRetry('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json').then((r) => r.json()),
      ]);
      const quakes: BmkgQuake[] = [...asArray(list?.Infogempa?.gempa ?? []), ...asArray(latest?.Infogempa?.gempa ?? [])];
      total += await upsertChunked('earthquakes', quakeRows(quakes), 'source,source_id');
    } catch (err) {
      warnings.push(`BMKG quakes: ${err instanceof Error ? err.message : err}`);
    }

    return { rows: total, partial: warnings.length ? warnings.join(' | ') : undefined };
  });
}

if (isMain(import.meta.url)) main();
