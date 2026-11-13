// "Big emitters" layer: facility types in plain words, number formatting, nearest-first lists.
// Data: Climate TRACE (CC BY 4.0).
import type { Lang } from './i18n';
import { distanceKm } from './smoke';

export type EmitterPoint = { id: number; name: string; lon: number; lat: number; sector: string; subsector: string; asset_type: string | null; co2e_t: number | null; pm25_t: number | null };
export type Emitter = EmitterPoint & {
  province_id: number | null; year: number;
  so2_t: number | null; nox_t: number | null; capacity: number | null; capacity_unit: string | null;
  owners: string[] | null; confidence: string | null; rank_co2e: number | null; rank_pm25: number | null;
};

const KIND: Record<string, Record<Lang, string>> = {
  'electricity-generation': { en: 'Power plant', id: 'Pembangkit listrik' },
  'iron-and-steel': { en: 'Steel plant', id: 'Pabrik baja' },
  cement: { en: 'Cement plant', id: 'Pabrik semen' },
  aluminum: { en: 'Aluminium smelter', id: 'Smelter aluminium' },
  'other-metals': { en: 'Metal smelter', id: 'Smelter logam' },
  'pulp-and-paper': { en: 'Pulp and paper mill', id: 'Pabrik pulp dan kertas' },
  chemicals: { en: 'Chemical plant', id: 'Pabrik kimia' },
  'other-chemicals': { en: 'Chemical plant', id: 'Pabrik kimia' },
  'petrochemical-steam-cracking': { en: 'Petrochemical plant', id: 'Pabrik petrokimia' },
  lime: { en: 'Lime plant', id: 'Pabrik kapur' },
  glass: { en: 'Glass plant', id: 'Pabrik kaca' },
  'food-beverage-tobacco': { en: 'Food or beverage factory', id: 'Pabrik makanan atau minuman' },
  'oil-and-gas-refining': { en: 'Oil refinery', id: 'Kilang minyak' },
  'oil-and-gas-production': { en: 'Oil and gas field', id: 'Lapangan migas' },
  'oil-and-gas-transport': { en: 'Oil and gas pipeline or terminal', id: 'Pipa atau terminal migas' },
  'coal-mining': { en: 'Coal mine', id: 'Tambang batu bara' },
  'copper-mining': { en: 'Copper mine', id: 'Tambang tembaga' },
  'iron-mining': { en: 'Iron ore mine', id: 'Tambang bijih besi' },
  'bauxite-mining': { en: 'Bauxite mine', id: 'Tambang bauksit' },
  'solid-waste-disposal': { en: 'Landfill or dumpsite', id: 'TPA / tempat pembuangan sampah' },
};
const SECTOR: Record<string, Record<Lang, string>> = {
  power: { en: 'Power plant', id: 'Pembangkit listrik' },
  manufacturing: { en: 'Factory', id: 'Pabrik' },
  'fossil-fuel-operations': { en: 'Oil, gas or coal site', id: 'Lokasi migas atau batu bara' },
  'mineral-extraction': { en: 'Mine', id: 'Tambang' },
  waste: { en: 'Waste site', id: 'Lokasi sampah' },
};
const FUEL: Record<string, Record<Lang, string>> = {
  coal: { en: 'coal', id: 'batu bara' }, gas: { en: 'gas', id: 'gas' }, oil: { en: 'oil', id: 'minyak' },
  'coal, oil': { en: 'coal', id: 'batu bara' }, biomass: { en: 'biomass', id: 'biomassa' },
};

export function kindLabel(e: Pick<Emitter, 'sector' | 'subsector' | 'asset_type'>, lang: Lang): string {
  const base = KIND[e.subsector]?.[lang] ?? SECTOR[e.sector]?.[lang] ?? e.subsector;
  const fuel = e.sector === 'power' && e.asset_type ? FUEL[e.asset_type.toLowerCase()]?.[lang] : undefined;
  return fuel ? `${base} · ${fuel}` : base;
}

// 19,746,000 → "19.7"; 1,592,699 → "1.6"; 412,000 → "0.41"
export function millions(t: number, lang: Lang): string {
  const m = t / 1e6;
  return m.toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: m >= 10 ? 0 : m >= 1 ? 1 : 2 });
}
export function tonnes(t: number, lang: Lang): string {
  return Math.round(t >= 100 ? t : t).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: t < 10 ? 1 : 0 });
}

// Biggest local polluters first: PM2.5 when known, then CO2e. Within maxKm only.
export function nearby<T extends EmitterPoint>(list: T[], lat: number, lon: number, maxKm = 100, n = 3): (T & { km: number })[] {
  return list
    .map((e) => ({ ...e, km: Math.round(distanceKm(lat, lon, e.lat, e.lon)) }))
    .filter((e) => e.km <= maxKm)
    .sort((a, b) => (b.pm25_t ?? 0) - (a.pm25_t ?? 0) || (b.co2e_t ?? 0) - (a.co2e_t ?? 0))
    .slice(0, n);
}

export const EMIT_POINT_COLS = 'id,name,lon,lat,sector,subsector,asset_type,co2e_t,pm25_t';
