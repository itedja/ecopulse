// One-off (and re-runnable) archive load for "repeat-fire areas".
// Pulls NASA FIRMS VIIRS detections for the last 5 calendar years, from the two satellites that
// cover the whole period (S-NPP and NOAA-20), and stores, for each ~2 km cell and year, which days
// had a detection. Uses the quality-checked archive ("SP") where NASA has published it and the
// near-real-time feed ("NRT") for the most recent months. Safe to run again: days are merged with OR.
//
// Run from GitHub Actions (needs FIRMS_MAP_KEY and the Supabase service key):
//   YEARS=5 npm run ingest:fire-history
import { isMain } from './lib/main.ts';
import { env } from './lib/env.ts';
import { fetchRetry, sleep } from './lib/http.ts';
import { db } from './lib/db.ts';
import { runJob } from './lib/run.ts';
import { INDONESIA_BBOX, inIndonesiaBox } from './lib/geo.ts';

const SENSORS = ['SNPP', 'NOAA20'] as const;
const LOCAL_OFFSET_MS = 7 * 3600_000;   // Jakarta time, the same day boundary the database uses
const DAY_MS = 86400_000;

export type Detection = { cx: number; cy: number; yr: number; doy: number; month: number; frp: number | null };
export type ParseStats = { kept: number; lowConf: number; nonVegetation: number; outside: number; hasType: boolean };

export const cellOf = (lon: number, lat: number) => ({ cx: Math.floor(lon * 50), cy: Math.floor(lat * 50) });

// Parses a FIRMS area CSV. Keeps nominal/high confidence detections inside the Indonesia box.
// If NASA includes the "type" column (archive data), keeps only type 0 = presumed vegetation fire;
// 1 = volcano, 2 = other static land source (e.g. industry), 3 = offshore.
export function parseArchiveCsv(csv: string): { rows: Detection[]; stats: ParseStats } {
  const lines = csv.trim().split(/\r?\n/);
  const stats: ParseStats = { kept: 0, lowConf: 0, nonVegetation: 0, outside: 0, hasType: false };
  if (lines.length < 1 || !lines[0]) return { rows: [], stats };
  const header = lines[0].split(',').map((h) => h.trim());
  if (!header.includes('latitude')) throw new Error(`FIRMS did not return CSV: ${lines[0].slice(0, 120)}`);
  const c = (n: string) => header.indexOf(n);
  const iLat = c('latitude'), iLon = c('longitude'), iDate = c('acq_date'), iTime = c('acq_time');
  const iConf = c('confidence'), iFrp = c('frp'), iType = c('type');
  stats.hasType = iType >= 0;

  const rows: Detection[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split(',');
    const lat = Number(f[iLat]), lon = Number(f[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inIndonesiaBox(lat, lon)) { stats.outside++; continue; }
    const conf = (f[iConf] ?? '').trim().toLowerCase();
    if (conf !== 'n' && conf !== 'h' && conf !== 'nominal' && conf !== 'high') { stats.lowConf++; continue; }
    if (iType >= 0 && (f[iType] ?? '').trim() !== '0') { stats.nonVegetation++; continue; }

    const t = (f[iTime] ?? '').trim().padStart(4, '0');
    const utc = Date.parse(`${f[iDate]}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`);
    if (Number.isNaN(utc)) continue;
    const local = new Date(utc + LOCAL_OFFSET_MS);
    const yr = local.getUTCFullYear();
    const doy = Math.floor((Date.UTC(yr, local.getUTCMonth(), local.getUTCDate()) - Date.UTC(yr, 0, 1)) / DAY_MS) + 1;
    const frp = iFrp >= 0 && f[iFrp] !== '' && Number.isFinite(Number(f[iFrp])) ? Number(f[iFrp]) : null;
    rows.push({ ...cellOf(lon, lat), yr, doy, month: local.getUTCMonth() + 1, frp });
    stats.kept++;
  }
  return { rows, stats };
}

// One cell-year: a 366-bit day set, a 12-bit month set, the strongest fire.
export type CellYear = { cx: number; cy: number; yr: number; days: Uint8Array; months: number; frp: number | null };

export function addDetections(map: Map<string, CellYear>, rows: Detection[]): void {
  for (const r of rows) {
    const k = `${r.cx},${r.cy},${r.yr}`;
    let cell = map.get(k);
    if (!cell) { cell = { cx: r.cx, cy: r.cy, yr: r.yr, days: new Uint8Array(366), months: 0, frp: null }; map.set(k, cell); }
    cell.days[r.doy - 1] = 1;
    cell.months |= 1 << (r.month - 1);
    if (r.frp != null && (cell.frp == null || r.frp > cell.frp)) cell.frp = r.frp;
  }
}

export const bitString = (days: Uint8Array) => Array.from(days, (b) => (b ? '1' : '0')).join('');

// Splits [from, to] into requests of at most 10 days, using the archive (SP) up to the last day
// NASA has published it and the near-real-time feed (NRT) after that.
export type Window = { source: string; start: string; days: number };
export function planWindows(sensor: string, from: string, to: string, spMax: string | null): Window[] {
  const out: Window[] = [];
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const end = Date.parse(to);
  const spEnd = spMax ? Date.parse(spMax) : -Infinity;
  let d = Date.parse(from);
  while (d <= end) {
    const useSp = d <= spEnd;
    const limit = Math.min(end, useSp ? spEnd : end, d + 9 * DAY_MS);
    out.push({ source: `VIIRS_${sensor}_${useSp ? 'SP' : 'NRT'}`, start: iso(d), days: Math.round((limit - d) / DAY_MS) + 1 });
    d = limit + DAY_MS;
  }
  return out;
}

// data_availability CSV: data_id,min_date,max_date
export function parseAvailability(csv: string): Record<string, { min: string; max: string }> {
  const lines = csv.trim().split(/\r?\n/);
  const h = lines[0].split(',').map((x) => x.trim());
  const iId = h.indexOf('data_id'), iMin = h.indexOf('min_date'), iMax = h.indexOf('max_date');
  if (iId < 0 || iMax < 0) throw new Error(`Unexpected data_availability response: ${lines[0].slice(0, 120)}`);
  const out: Record<string, { min: string; max: string }> = {};
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    if (f[iId]) out[f[iId].trim()] = { min: (f[iMin] ?? '').trim(), max: (f[iMax] ?? '').trim() };
  }
  return out;
}

async function flush(map: Map<string, CellYear>): Promise<number> {
  const all = [...map.values()];
  let n = 0;
  for (let i = 0; i < all.length; i += 1000) {
    const part = all.slice(i, i + 1000).map((c) => ({ cx: c.cx, cy: c.cy, yr: c.yr, days: bitString(c.days), months: c.months, frp: c.frp ?? '' }));
    const { data, error } = await db().rpc('merge_fire_cell_years', { p_rows: part });
    if (error) throw new Error(`merge_fire_cell_years: ${error.message}`);
    n += Number(data ?? 0);
  }
  return n;
}

async function main() {
  await runJob('fire-history', async () => {
    const key = env('FIRMS_MAP_KEY');
    const years = Math.min(10, Math.max(1, Number(process.env.YEARS ?? 5)));
    const nowLocal = new Date(Date.now() + LOCAL_OFFSET_MS);
    const lastYear = nowLocal.getUTCFullYear();
    const firstYear = lastYear - years + 1;
    const today = nowLocal.toISOString().slice(0, 10);
    const b = INDONESIA_BBOX;
    const area = `${b.west},${b.south},${b.east},${b.north}`;

    const avail = parseAvailability(await (await fetchRetry(`https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/${key}/ALL`)).text());
    for (const s of SENSORS) console.log(`  ${s}: SP ${avail[`VIIRS_${s}_SP`]?.min ?? '?'} → ${avail[`VIIRS_${s}_SP`]?.max ?? 'none'}, NRT ${avail[`VIIRS_${s}_NRT`]?.min ?? '?'} → ${avail[`VIIRS_${s}_NRT`]?.max ?? '?'}`);

    let written = 0, requests = 0;
    const totals: ParseStats = { kept: 0, lowConf: 0, nonVegetation: 0, outside: 0, hasType: false };
    const gaps: string[] = [];
    const seenHeader = new Set<string>();

    for (let yr = firstYear; yr <= lastYear; yr++) {
      const map = new Map<string, CellYear>();
      const from = `${yr}-01-01`, to = yr === lastYear ? today : `${yr}-12-31`;
      for (const s of SENSORS) {
        const nrtMin = avail[`VIIRS_${s}_NRT`]?.min;
        for (const w of planWindows(s, from, to, avail[`VIIRS_${s}_SP`]?.max ?? null)) {
          if (w.source.endsWith('_NRT') && nrtMin && w.start < nrtMin) { gaps.push(`${w.source} ${w.start}`); continue; }
          const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${w.source}/${area}/${w.days}/${w.start}`;
          const csv = await (await fetchRetry(url, {}, { timeoutMs: 180_000, retries: 4 })).text();
          requests++;
          const { rows, stats } = parseArchiveCsv(csv);
          if (!seenHeader.has(w.source)) { seenHeader.add(w.source); console.log(`  ${w.source} columns: ${csv.split('\n')[0]}`); }
          totals.kept += stats.kept; totals.lowConf += stats.lowConf; totals.nonVegetation += stats.nonVegetation; totals.outside += stats.outside;
          totals.hasType ||= stats.hasType;
          addDetections(map, rows);
          await sleep(1200);   // stay well inside NASA's request limits
        }
      }
      const n = await flush(map);
      written += n;
      console.log(`  ${yr}: ${map.size} cell-years (${n} merged)`);
    }

    const { data: cells, error } = await db().rpc('refresh_repeat_fire');
    if (error) throw new Error(`refresh_repeat_fire: ${error.message}`);
    console.log(`  requests ${requests}; detections kept ${totals.kept}, low confidence ${totals.lowConf}, non-vegetation ${totals.nonVegetation} (type column ${totals.hasType ? 'present' : 'absent'}), outside box ${totals.outside}`);
    console.log(`  repeat-fire cells (2+ years) after refresh: ${cells}`);
    return { rows: written, partial: gaps.length ? `no NRT data for ${gaps.length} windows, first: ${gaps[0]}` : undefined };
  });
}

if (isMain(import.meta.url)) main();
