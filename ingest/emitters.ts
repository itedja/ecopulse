// Climate TRACE → EcoPulse "big emitters" layer. Runs monthly (Climate TRACE publishes monthly).
// For Indonesia's latest full year: every named facility (point source) in the sectors that matter
// for local air — power, manufacturing, fossil-fuel operations, mining, waste — with its estimated
// CO2e, PM2.5, SO2 and NOx per year, its listed owners and Climate TRACE's own confidence.
// Climate TRACE asks API users to keep volume low: requests are paged at 1000 and spaced out.
// Data: Climate TRACE (CC BY 4.0), climatetrace.org.
import { isMain } from './lib/main.ts';
import { fetchRetry, sleep } from './lib/http.ts';
import { db } from './lib/db.ts';
import { runJob } from './lib/run.ts';

const API = 'https://api.climatetrace.org/v7';
export const SECTORS = ['power', 'manufacturing', 'fossil-fuel-operations', 'mineral-extraction', 'waste'] as const;
const GASES = { co2e: 'co2e_100yr', pm25: 'pm2_5', so2: 'so2', nox: 'nox' } as const;
type GasKey = keyof typeof GASES;

// A facility is kept if it is big on any of these (tonnes per year).
export const KEEP = { co2e: 100_000, pm25: 50, so2: 500, nox: 500 } as const;
const MAX_DETAILS = 700;     // owner + confidence lookups (one request each)

export type ApiSource = {
  id: number; name: string; sector: string; subsector: string; assetType?: string; sourceType?: string;
  centroid?: { longitude: number; latitude: number }; emissionsQuantity?: number;
  capacity?: number; capacityUnits?: string; year?: number;
};
export type Facility = {
  id: number; name: string; sector: string; subsector: string; asset_type: string; lon: number; lat: number; year: number;
  co2e_t: number | null; pm25_t: number | null; so2_t: number | null; nox_t: number | null;
  capacity: number | null; capacity_unit: string | null; owners: string[] | null; confidence: string | null;
};

// Climate TRACE also lists basin-wide and unnamed estimates as "point sources"; those are not a place
// anyone can look at, so they are left out.
export function isNamedFacility(s: ApiSource): boolean {
  if (s.sourceType !== 'point-source' || !s.centroid) return false;
  const n = (s.name ?? '').trim();
  if (!n || /^unknown name$/i.test(n)) return false;
  if (/^Indonesia_/i.test(n) || /_OtherResources$|_OtherBasins/i.test(n)) return false;
  const { longitude: lon, latitude: lat } = s.centroid;
  return lon >= 94 && lon <= 142 && lat >= -12 && lat <= 7;
}

// Merges one gas listing into the facility map (creating facilities the first time they appear).
export function addGas(map: Map<number, Facility>, rows: ApiSource[], gas: GasKey, year: number): void {
  for (const s of rows) {
    if (!isNamedFacility(s)) continue;
    let f = map.get(s.id);
    if (!f) {
      f = { id: s.id, name: s.name.trim(), sector: s.sector, subsector: s.subsector, asset_type: (s.assetType ?? '').trim(),
        lon: s.centroid!.longitude, lat: s.centroid!.latitude, year,
        co2e_t: null, pm25_t: null, so2_t: null, nox_t: null,
        capacity: Number.isFinite(s.capacity) && (s.capacity ?? 0) > 0 ? s.capacity! : null,
        capacity_unit: s.capacityUnits && !/restricted/i.test(s.capacityUnits) ? s.capacityUnits : null,
        owners: null, confidence: null };
      map.set(s.id, f);
    }
    const q = s.emissionsQuantity;
    if (q != null && Number.isFinite(q) && q > 0) f[`${gas}_t` as 'co2e_t'] = q;
  }
}

export const isBig = (f: Facility) =>
  (f.co2e_t ?? 0) >= KEEP.co2e || (f.pm25_t ?? 0) >= KEEP.pm25 || (f.so2_t ?? 0) >= KEEP.so2 || (f.nox_t ?? 0) >= KEEP.nox;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchRetry(API + path, {}, { retries: 3, timeoutMs: 60_000 });
  return (await res.json()) as T;
}

// All sources for one sector and gas, biggest first, until the numbers stop mattering.
async function listAll(sector: string, gas: GasKey, year: number, floor: number): Promise<ApiSource[]> {
  const out: ApiSource[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const page = await getJson<ApiSource[]>(`/sources?gadmId=IDN&year=${year}&gas=${GASES[gas]}&sectors=${sector}&limit=1000&offset=${offset}`);
    await sleep(500);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    const last = page[page.length - 1]?.emissionsQuantity ?? 0;
    if (page.length < 1000 || last < floor) break;   // sorted biggest first
  }
  return out;
}

type Detail = { owners?: { name?: string }[]; confidence?: { year?: number; total_co2e_100yrgwp?: string; co2_emissions?: string }[] };

async function main() {
  await runJob('emitters', async () => {
    // Latest full year with data (Climate TRACE runs a few months behind).
    const thisYear = new Date().getUTCFullYear();
    let year = thisYear - 1;
    const probe = await getJson<ApiSource[]>(`/sources?gadmId=IDN&year=${year}&gas=co2e_100yr&sectors=power&limit=5`);
    if (!Array.isArray(probe) || probe.length === 0) year -= 1;

    const map = new Map<number, Facility>();
    for (const sector of SECTORS) {
      for (const gas of Object.keys(GASES) as GasKey[]) {
        addGas(map, await listAll(sector, gas, year, KEEP[gas] / 2), gas, year);
      }
      console.log(`  ${sector}: ${[...map.values()].filter((f) => f.sector === sector && isBig(f)).length} facilities kept`);
    }
    const keep = [...map.values()].filter(isBig)
      .sort((a, b) => (b.co2e_t ?? 0) - (a.co2e_t ?? 0) || (b.pm25_t ?? 0) - (a.pm25_t ?? 0));

    // Owners and confidence, biggest first.
    let details = 0;
    const gaps: string[] = [];
    for (const f of keep.slice(0, MAX_DETAILS)) {
      try {
        const d = await getJson<Detail>(`/sources/${f.id}`);
        const owners = [...new Set((d.owners ?? []).map((o) => (o.name ?? '').trim()).filter(Boolean))];
        f.owners = owners.length ? owners.slice(0, 6) : null;
        const c = (d.confidence ?? []).find((x) => x.year === year) ?? d.confidence?.[0];
        f.confidence = c?.total_co2e_100yrgwp ?? c?.co2_emissions ?? null;
        details++;
      } catch (e) {
        if (gaps.length < 3) gaps.push(`detail ${f.id}: ${(e as Error).message.slice(0, 80)}`);
      }
      await sleep(300);
    }

    const { data, error } = await db().rpc('replace_emission_sources', { p_rows: keep });
    if (error) throw new Error(`replace_emission_sources: ${error.message}`);
    console.log(`  year ${year}: ${keep.length} facilities stored (${details} with owner details); top: ${keep.slice(0, 3).map((f) => f.name).join(' · ')}`);
    return { rows: Number(data ?? keep.length), partial: gaps.length ? gaps.join(' | ') : undefined };
  });
}

if (isMain(import.meta.url)) main();
