// Helpers for community reports: ranks, error messages, photos, location.
import type { Lang } from './i18n';

export const KINDS = ['fire_smoke', 'deforestation', 'illegal_logging', 'trash_dumping', 'river_pollution', 'flooding', 'air_pollution', 'wildlife', 'other'] as const;
export type Kind = (typeof KINDS)[number];

// Same thresholds as rank_for_points() in the database.
const RANKS: [number, string][] = [[0, 'pengamat'], [100, 'penjaga'], [500, 'pelindung'], [2000, 'pahlawan_hutan']];

export function rankProgress(points: number): { rank: string; next: string | null; toNext: number; pct: number } {
  let i = 0;
  while (i + 1 < RANKS.length && points >= RANKS[i + 1][0]) i++;
  const [floor, rank] = RANKS[i];
  const nxt = RANKS[i + 1];
  if (!nxt) return { rank, next: null, toNext: 0, pct: 100 };
  return { rank, next: nxt[1], toNext: nxt[0] - points, pct: Math.round(((points - floor) / (nxt[0] - floor)) * 100) };
}

// Database errors are raised as short codes (e.g. 'too_far'); find the code in any error message.
const CODES = ['sign_in_required', 'outside_indonesia', 'location_too_rough', 'bad_title', 'description_too_long', 'bad_photo_path',
  'duplicate_photo', 'daily_limit', 'report_not_open', 'own_report', 'location_required', 'too_far', 'bad_nickname', 'nickname_taken', 'no_location'] as const;
export type ErrorCode = (typeof CODES)[number] | 'generic';
export function errorCode(err: unknown): ErrorCode {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  return CODES.find((c) => msg.includes(c)) ?? 'generic';
}

export function span(ms: number, lang: Lang): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  const en = lang === 'en';
  if (m < 60) return en ? `${m} min` : `${m} menit`;
  const h = Math.round(m / 60);
  if (h < 48) return en ? `${h} h` : `${h} jam`;
  const d = Math.round(h / 24);
  return en ? `${d} days` : `${d} hari`;
}

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function getPosition(): Promise<{ lat: number; lon: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no_location'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => reject(new Error('no_location')),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  });
}

// Re-draws the photo on a canvas: this drops ALL hidden data (GPS, camera, time) and shrinks it.
export async function preparePhoto(file: File): Promise<{ blob: Blob; hash: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('photo'))), 'image/jpeg', 0.82));
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { blob, hash };
}
