// PM2.5 µg/m³ → US AQI, EPA breakpoints revised in 2024.
// Same formula as pm25_to_aqi() in the database.
const BREAKPOINTS: [number, number, number, number][] = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

export function pm25ToAqi(c: number | null | undefined): number | null {
  if (c == null || !Number.isFinite(c) || c < 0) return null;
  const t = Math.floor(c * 10) / 10;
  if (t > 325.4) return 500;
  for (const [cLo, cHi, iLo, iHi] of BREAKPOINTS) {
    if (t >= cLo && t <= cHi) return Math.round(((iHi - iLo) / (cHi - cLo)) * (t - cLo) + iLo);
  }
  // Values between breakpoints (e.g. 9.05 after truncation can't happen, but be safe).
  return null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
