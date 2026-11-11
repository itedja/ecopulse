// Air quality → aq_stations, aq_readings, city_aq_snapshots. Runs every 30 minutes.
//
// OpenAQ (history + rankings): PM2.5 concentrations, kept 90 days.
// AQICN  (live only): one request for every station in Indonesia. Their terms don't
//         allow redistributing cached/archived data, so only the last 6 hours are kept.
import { isMain } from './lib/main.ts';
import { env } from './lib/env.ts';
import { fetchRetry, sleep } from './lib/http.ts';
import { db, upsertChunked } from './lib/db.ts';
import { runJob } from './lib/run.ts';
import { INDONESIA_BBOX, inIndonesiaBox, nearestCity, distanceKm, type City } from './lib/geo.ts';
import { pm25ToAqi, median } from './lib/aqi.ts';

const PM25 = 2;                         // OpenAQ parameter id for PM2.5
const FRESH_HOURS = 3;                  // readings older than this don't count as "now"
const CITY_RADIUS_KM = 30;
const AQICN_KEEP_HOURS = 6;

type Station = {
  source: 'openaq' | 'aqicn';
  source_station_id: string;
  name: string | null;
  latitude: number;
  longitude: number;
  attribution: string | null;
};
type Reading = { stationKey: string; measured_at: string; pm25_ugm3: number | null; aqi_us: number | null };

const key = (s: { source: string; source_station_id: string }) => `${s.source}:${s.source_station_id}`;

// ---------- AQICN ----------
export type AqicnStation = { lat: number; lon: number; uid: number; aqi: string; station?: { name?: string; time?: string } };

export function parseAqicn(json: { status: string; data: AqicnStation[] | string }): { stations: Station[]; readings: Reading[] } {
  if (json.status !== 'ok' || !Array.isArray(json.data)) {
    throw new Error(`AQICN error: ${typeof json.data === 'string' ? json.data : json.status}`);
  }
  const stations: Station[] = [];
  const readings: Reading[] = [];
  for (const s of json.data) {
    if (!inIndonesiaBox(s.lat, s.lon)) continue;
    const st: Station = {
      source: 'aqicn', source_station_id: String(s.uid), name: s.station?.name ?? null,
      latitude: s.lat, longitude: s.lon, attribution: 'World Air Quality Index Project',
    };
    stations.push(st);
    const aqi = Number(s.aqi);                         // "-" when the station has no data
    const t = s.station?.time ? new Date(s.station.time) : null;
    if (Number.isFinite(aqi) && aqi >= 0 && aqi <= 999 && t && !Number.isNaN(t.getTime())) {
      readings.push({ stationKey: key(st), measured_at: t.toISOString(), pm25_ugm3: null, aqi_us: Math.round(aqi) });
    }
  }
  return { stations, readings };
}

async function fetchAqicn() {
  const b = INDONESIA_BBOX;
  const url = `https://api.waqi.info/v2/map/bounds?latlng=${b.south},${b.west},${b.north},${b.east}&networks=all&token=${env('AQICN_TOKEN')}`;
  return parseAqicn(await (await fetchRetry(url)).json());
}

// ---------- OpenAQ ----------
type OaqLocation = {
  id: number; name: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  sensors: { id: number; parameter: { id: number } }[];
  datetimeLast: { utc: string } | null;
  provider?: { name?: string } | null;
};
type OaqLatest = { datetime: { utc: string }; value: number; sensorsId: number };

export function pm25SensorIds(loc: OaqLocation): Set<number> {
  return new Set(loc.sensors.filter((s) => s.parameter?.id === PM25).map((s) => s.id));
}

export function pickPm25(latest: OaqLatest[], sensorIds: Set<number>): { at: string; value: number } | null {
  const vals = latest.filter((r) => sensorIds.has(r.sensorsId) && r.value >= 0 && r.value < 1000);
  if (!vals.length) return null;
  vals.sort((a, b) => b.datetime.utc.localeCompare(a.datetime.utc));
  return { at: new Date(vals[0].datetime.utc).toISOString(), value: vals[0].value };
}

async function fetchOpenAq(): Promise<{ stations: Station[]; readings: Reading[]; warnings: string[] }> {
  const headers = { 'X-API-Key': env('OPENAQ_API_KEY') };
  const b = INDONESIA_BBOX;
  const locUrl = `https://api.openaq.org/v3/locations?bbox=${b.west},${b.south},${b.east},${b.north}&parameters_id=${PM25}&limit=1000`;
  const { results } = (await (await fetchRetry(locUrl, { headers })).json()) as { results: OaqLocation[] };

  const cutoff = Date.now() - 6 * 3600_000;
  const active = results.filter((l) =>
    l.coordinates && l.datetimeLast && new Date(l.datetimeLast.utc).getTime() > cutoff);

  const stations: Station[] = [];
  const readings: Reading[] = [];
  const warnings: string[] = [];

  for (const loc of active) {
    const st: Station = {
      source: 'openaq', source_station_id: String(loc.id), name: loc.name,
      latitude: loc.coordinates!.latitude, longitude: loc.coordinates!.longitude,
      attribution: loc.provider?.name ? `OpenAQ · ${loc.provider.name}` : 'OpenAQ',
    };
    stations.push(st);
    try {
      const res = await fetchRetry(`https://api.openaq.org/v3/locations/${loc.id}/latest`, { headers });
      const { results: latest } = (await res.json()) as { results: OaqLatest[] };
      const pm = pickPm25(latest, pm25SensorIds(loc));
      if (pm) readings.push({ stationKey: key(st), measured_at: pm.at, pm25_ugm3: Math.round(pm.value * 10) / 10, aqi_us: pm25ToAqi(pm.value) });
    } catch (err) {
      warnings.push(`openaq ${loc.id}: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(1100);   // OpenAQ allows 60 requests/minute
  }
  return { stations, readings, warnings };
}

// ---------- City averages ----------
export type CityReading = { latitude: number; longitude: number; pm25_ugm3: number | null; aqi_us: number | null; measured_at: string };

export function citySnapshot(city: City, readings: CityReading[], now = Date.now()) {
  const fresh = readings.filter((r) =>
    now - new Date(r.measured_at).getTime() <= FRESH_HOURS * 3600_000 &&
    distanceKm(city.latitude, city.longitude, r.latitude, r.longitude) <= CITY_RADIUS_KM);
  const aqis = fresh.map((r) => r.aqi_us).filter((x): x is number => x != null);
  if (!aqis.length) return null;
  const pms = fresh.map((r) => r.pm25_ugm3).filter((x): x is number => x != null);
  return {
    city_id: city.id,
    aqi_us: Math.round(median(aqis)!),     // median: one broken sensor can't skew the city
    pm25_ugm3: pms.length ? Math.round((pms.reduce((a, b) => a + b, 0) / pms.length) * 10) / 10 : null,
    station_count: aqis.length,
  };
}

async function main() {
  await runJob('air_quality', async () => {
    const warnings: string[] = [];
    const [aq, oa] = await Promise.allSettled([fetchAqicn(), fetchOpenAq()]);
    const stations: Station[] = [];
    const readings: Reading[] = [];
    if (aq.status === 'fulfilled') { stations.push(...aq.value.stations); readings.push(...aq.value.readings); }
    else warnings.push(`AQICN: ${aq.reason}`);
    if (oa.status === 'fulfilled') { stations.push(...oa.value.stations); readings.push(...oa.value.readings); warnings.push(...oa.value.warnings); }
    else warnings.push(`OpenAQ: ${oa.reason}`);
    if (!stations.length) throw new Error(warnings.join(' | ') || 'No stations returned');

    const { data: cities, error: cErr } = await db().from('cities').select('id, slug, latitude, longitude').eq('is_featured', true);
    if (cErr) throw cErr;

    // 1. Stations
    const now = new Date().toISOString();
    await upsertChunked('aq_stations', stations.map((s) => ({
      ...s, city_id: nearestCity(s.latitude, s.longitude, cities as City[], CITY_RADIUS_KM)?.id ?? null, last_seen_at: now,
    })), 'source,source_station_id');

    const { data: ids, error: iErr } = await db().from('aq_stations').select('id, source, source_station_id');
    if (iErr) throw iErr;
    const idOf = new Map((ids ?? []).map((r) => [key(r), r.id as number]));

    // 2. Readings
    const rows = readings
      .filter((r) => idOf.has(r.stationKey))
      .map((r) => ({ station_id: idOf.get(r.stationKey)!, measured_at: r.measured_at, pm25_ugm3: r.pm25_ugm3, aqi_us: r.aqi_us }));
    const written = await upsertChunked('aq_readings', rows, 'station_id,measured_at');

    // 3. AQICN: keep only recent values (licence: no archives)
    const aqicnIds = (ids ?? []).filter((r) => r.source === 'aqicn').map((r) => r.id as number);
    for (let i = 0; i < aqicnIds.length; i += 200) {
      await db().from('aq_readings').delete()
        .in('station_id', aqicnIds.slice(i, i + 200))
        .lt('measured_at', new Date(Date.now() - AQICN_KEEP_HOURS * 3600_000).toISOString());
    }

    // 4. City snapshots
    const byKey = new Map(stations.map((s) => [key(s), s]));
    const cityReadings: CityReading[] = readings.map((r) => ({ ...byKey.get(r.stationKey)!, ...r }));
    const computedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const snaps = (cities as City[])
      .map((c) => citySnapshot(c, cityReadings))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({ ...s, computed_at: computedAt }));
    await upsertChunked('city_aq_snapshots', snaps, 'city_id,computed_at');
    console.log(`  ${stations.length} stations, ${rows.length} readings, ${snaps.length}/${cities!.length} cities with data`);

    return { rows: written + snaps.length, partial: warnings.length ? warnings.slice(0, 10).join(' | ') : undefined };
  });
}

if (isMain(import.meta.url)) main();
