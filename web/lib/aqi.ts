// Air-quality categories, colours and plain-language advice.
// Advice follows the US EPA AQI guidance for PM2.5; it is general guidance, not medical advice.
import type { Lang } from './i18n';

export type Category = 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very_unhealthy' | 'hazardous';

export const CATEGORIES: { key: Category; max: number; color: string; ink: string }[] = [
  { key: 'good', max: 50, color: '#2E9E5B', ink: '#FFFFFF' },
  { key: 'moderate', max: 100, color: '#E8B10A', ink: '#0E1116' },
  { key: 'sensitive', max: 150, color: '#F07F1E', ink: '#0E1116' },
  { key: 'unhealthy', max: 200, color: '#D93A2B', ink: '#FFFFFF' },
  { key: 'very_unhealthy', max: 300, color: '#8E3BB5', ink: '#FFFFFF' },
  { key: 'hazardous', max: Infinity, color: '#6E1423', ink: '#FFFFFF' },
];

export function category(aqi: number | null | undefined): (typeof CATEGORIES)[number] | null {
  if (aqi == null || !Number.isFinite(aqi)) return null;
  return CATEGORIES.find((c) => aqi <= c.max)!;
}

type Advice = { exercise: string; mask: string };

const ADVICE: Record<Lang, Record<Category, Advice>> = {
  en: {
    good: { exercise: 'Go for it', mask: 'Not needed' },
    moderate: { exercise: 'Fine for most', mask: 'Not needed' },
    sensitive: { exercise: 'Sensitive: go easy', mask: 'Sensitive: N95' },
    unhealthy: { exercise: 'Indoors', mask: 'N95 / KN95' },
    very_unhealthy: { exercise: 'Avoid outdoors', mask: 'N95 + purifier' },
    hazardous: { exercise: 'Stay inside', mask: 'N95, windows shut' },
  },
  id: {
    good: { exercise: 'Aman', mask: 'Tidak perlu' },
    moderate: { exercise: 'Aman untuk umum', mask: 'Tidak perlu' },
    sensitive: { exercise: 'Kelompok rentan: kurangi', mask: 'Kelompok rentan: N95' },
    unhealthy: { exercise: 'Di dalam ruangan', mask: 'N95 / KN95' },
    very_unhealthy: { exercise: 'Hindari luar ruangan', mask: 'N95 + purifier' },
    hazardous: { exercise: 'Tetap di dalam', mask: 'N95, tutup jendela' },
  },
};

export function advice(cat: Category, lang: Lang): Advice {
  return ADVICE[lang][cat];
}

export type ForecastPoint = { valid_at: string; aqi_forecast: number };

// Best 2-hour window in the next 24 h, between 05:00 and 21:00 local time (when people actually go out).
export function cleanestWindow(points: ForecastPoint[], timeZone: string): { start: Date; end: Date; aqi: number } | null {
  const sorted = [...points].sort((a, b) => a.valid_at.localeCompare(b.valid_at));
  const hourOf = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(d));
  let best: { start: Date; end: Date; aqi: number } | null = null;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = new Date(sorted[i].valid_at);
    const b = new Date(sorted[i + 1].valid_at);
    if (b.getTime() - a.getTime() !== 3600_000) continue;
    const h = hourOf(a);
    if (h < 5 || h > 19) continue;
    const avg = (sorted[i].aqi_forecast + sorted[i + 1].aqi_forecast) / 2;
    if (!best || avg < best.aqi) best = { start: a, end: new Date(b.getTime() + 3600_000), aqi: avg };
  }
  return best;
}

// True when `when` falls on the calendar day after `now` in the given time zone. Used so a
// "cleanest window" that is tomorrow morning says so instead of showing bare clock times.
export function isNextLocalDay(when: Date, now: Date, timeZone: string): boolean {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return day(when) === day(new Date(now.getTime() + 86400_000)) && day(when) !== day(now);
}

// ---- PM2.5 <-> US AQI (EPA breakpoints, 2024 revision) ----
const BP: [number, number, number, number][] = [
  [0.0, 9.0, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500],
];

export function pm25ToAqi(c: number): number {
  if (!Number.isFinite(c) || c < 0) return 0;
  const t = Math.floor(c * 10) / 10;
  if (t > 325.4) return 500;
  for (const [cLo, cHi, iLo, iHi] of BP) if (t <= cHi) return Math.round(((iHi - iLo) / (cHi - cLo)) * (Math.max(t, cLo) - cLo) + iLo);
  return 500;
}

export function aqiToPm25(aqi: number): number {
  for (const [cLo, cHi, iLo, iHi] of BP) if (aqi <= iHi) return cLo + ((Math.max(aqi, iLo) - iLo) * (cHi - cLo)) / (iHi - iLo);
  return 325.4;
}

// The forecast comes from a regional model (CAMS via Open-Meteo), which often over- or
// under-estimates street-level PM2.5. We keep its SHAPE (when air gets better or worse) but
// scale it so the current hour matches what the ground sensors measure right now.
export type RawForecast = { valid_at: string; pm25_forecast: number | null; aqi_forecast: number };

export function calibrateForecast(points: RawForecast[], live: { pm25: number | null; aqi: number } | null): ForecastPoint[] {
  const sorted = [...points].sort((a, b) => a.valid_at.localeCompare(b.valid_at));
  const first = sorted.find((p) => p.pm25_forecast != null && p.pm25_forecast > 0);
  if (!live || !first) return sorted.map((p) => ({ valid_at: p.valid_at, aqi_forecast: p.aqi_forecast }));
  // Anchor to the AQI shown on the card (the median across all stations), so the first bar always matches it.
  const livePm = aqiToPm25(live.aqi);
  const ratio = Math.min(3, Math.max(0.33, livePm / first.pm25_forecast!));
  return sorted.map((p) => ({
    valid_at: p.valid_at,
    aqi_forecast: p.pm25_forecast == null ? p.aqi_forecast : pm25ToAqi(p.pm25_forecast * ratio),
  }));
}
