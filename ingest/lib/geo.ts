// Indonesia bounding box from the spec: 95°E–141°E, 11°S–6°N.
export const INDONESIA_BBOX = { west: 95, south: -11, east: 141, north: 6 } as const;

export function inIndonesiaBox(lat: number, lon: number): boolean {
  const b = INDONESIA_BBOX;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

// Great-circle distance in km.
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type City = { id: number; slug: string; latitude: number; longitude: number };

// Nearest featured city within maxKm, or null.
export function nearestCity(lat: number, lon: number, cities: City[], maxKm = 30): City | null {
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of cities) {
    const d = distanceKm(lat, lon, c.latitude, c.longitude);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= maxKm ? best : null;
}
