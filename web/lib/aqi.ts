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
