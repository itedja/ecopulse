import { distanceKm } from './smoke';

// The monitored city closest to a point, with its distance. The point is only ever used here, in the
// browser: it is not sent anywhere or saved.
export function nearestCity<T extends { latitude: number; longitude: number }>(
  cities: T[], lat: number, lon: number,
): { city: T; km: number } | null {
  let best: { city: T; km: number } | null = null;
  for (const c of cities) {
    const km = distanceKm(lat, lon, c.latitude, c.longitude);
    if (!best || km < best.km) best = { city: c, km };
  }
  return best ? { city: best.city, km: Math.round(best.km) } : null;
}
