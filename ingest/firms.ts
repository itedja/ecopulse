// NASA FIRMS → fire_hotspots. Runs every 3 hours.
// Pulls the last 2 days from the three VIIRS satellites over Indonesia's bounding box.
// Rows are deduplicated by (source, lat, lon, time), so overlapping runs are harmless.
import { isMain } from './lib/main.ts';
import { env } from './lib/env.ts';
import { fetchRetry, sleep } from './lib/http.ts';
import { upsertChunked } from './lib/db.ts';
import { runJob } from './lib/run.ts';
import { INDONESIA_BBOX, inIndonesiaBox } from './lib/geo.ts';

const SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT'] as const;
const DAY_RANGE = 2;

export type HotspotRow = {
  source: string;
  latitude: number;
  longitude: number;
  acquired_at: string;
  brightness_k: number | null;
  frp_mw: number | null;
  confidence: 'low' | 'nominal' | 'high';
  daynight: string | null;
};

const CONF: Record<string, HotspotRow['confidence']> = {
  l: 'low', low: 'low', n: 'nominal', nominal: 'nominal', h: 'high', high: 'high',
};

export function parseFirmsCsv(csv: string, source: string): HotspotRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  if (!header.includes('latitude')) {
    // FIRMS returns a plain-text message (e.g. "Invalid MAP_KEY") instead of CSV on errors.
    throw new Error(`FIRMS did not return CSV for ${source}: ${lines[0].slice(0, 120)}`);
  }
  const col = (name: string) => header.indexOf(name);
  const iLat = col('latitude'), iLon = col('longitude'), iDate = col('acq_date'), iTime = col('acq_time');
  const iBright = col('bright_ti4'), iFrp = col('frp'), iConf = col('confidence'), iDn = col('daynight');

  const out: HotspotRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split(',');
    const lat = Number(f[iLat]);
    const lon = Number(f[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inIndonesiaBox(lat, lon)) continue;

    const conf = CONF[(f[iConf] ?? '').trim().toLowerCase()];
    if (!conf) continue;

    const t = (f[iTime] ?? '').trim().padStart(4, '0');            // "542" → "0542"
    const acquired = new Date(`${f[iDate]}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`);
    if (Number.isNaN(acquired.getTime())) continue;

    const num = (i: number) => (i >= 0 && f[i] !== '' && Number.isFinite(Number(f[i])) ? Number(f[i]) : null);
    out.push({
      source,
      latitude: Math.round(lat * 1e5) / 1e5,
      longitude: Math.round(lon * 1e5) / 1e5,
      acquired_at: acquired.toISOString(),
      brightness_k: num(iBright),
      frp_mw: num(iFrp),
      confidence: conf,
      daynight: iDn >= 0 ? (f[iDn] ?? '').trim().slice(0, 1) || null : null,
    });
  }
  return out;
}

async function main() {
  await runJob('firms', async () => {
    const key = env('FIRMS_MAP_KEY');
    const b = INDONESIA_BBOX;
    const area = `${b.west},${b.south},${b.east},${b.north}`;
    let total = 0;
    const problems: string[] = [];

    for (const source of SOURCES) {
      try {
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/${DAY_RANGE}`;
        const csv = await (await fetchRetry(url, {}, { timeoutMs: 60_000 })).text();
        const rows = parseFirmsCsv(csv, source);
        // ignoreDuplicates: a hotspot already stored is left untouched.
        total += await upsertChunked('fire_hotspots', rows, 'source,latitude,longitude,acquired_at', { ignoreDuplicates: true });
        console.log(`  ${source}: ${rows.length} hotspots`);
      } catch (err) {
        problems.push(`${source}: ${err instanceof Error ? err.message : err}`);
      }
      await sleep(500);
    }

    if (problems.length === SOURCES.length) throw new Error(problems.join(' | '));
    return { rows: total, partial: problems.length ? problems.join(' | ') : undefined };
  });
}

if (isMain(import.meta.url)) main();
