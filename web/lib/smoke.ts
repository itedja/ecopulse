// "Is smoke heading my way?" — a simple, honest heuristic, not a dispersion model:
// counts recent high/nominal-confidence fires within RANGE_KM that lie UPWIND of the city
// (within ±SECTOR° of the direction the wind is blowing FROM).
export const RANGE_KM = 400;
export const SECTOR = 45;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Compass bearing from A to B, 0–360 (0 = north).
export function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export type Fire = { latitude: number; longitude: number; confidence: string };

export function upwindFires(
  city: { latitude: number; longitude: number },
  windFromDeg: number | null,
  windKmh: number | null,
  fires: Fire[],
): { count: number; nearestKm: number | null } {
  if (windFromDeg == null || windKmh == null || windKmh < 3) return { count: 0, nearestKm: null };
  let count = 0, nearest: number | null = null;
  for (const f of fires) {
    if (f.confidence === 'low') continue;
    const d = distanceKm(city.latitude, city.longitude, f.latitude, f.longitude);
    if (d > RANGE_KM || d < 1) continue;
    // Fire is upwind if the bearing from the city TO the fire matches where the wind comes FROM.
    if (angleDiff(bearing(city.latitude, city.longitude, f.latitude, f.longitude), windFromDeg) <= SECTOR) {
      count++;
      if (nearest == null || d < nearest) nearest = d;
    }
  }
  return { count, nearestKm: nearest == null ? null : Math.round(nearest) };
}

export function compass(deg: number, lang: 'en' | 'id'): string {
  const en = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const id = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'];
  return (lang === 'en' ? en : id)[Math.round(deg / 45) % 8];
}
