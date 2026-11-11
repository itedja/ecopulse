// BMKG extreme-weather warnings (nowcast), published as CAP (Common Alerting Protocol).
// Feeds are registered with the WMO alerting-authority register:
//   https://cuaca.bmkg.go.id/data/public/cap/feed/en/rss.xml   (English)
//   https://cuaca.bmkg.go.id/data/public/cap/feed/id/rss.xml   (Bahasa Indonesia)
// Each RSS item links to a CAP XML document with the area polygon and validity times.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', trimValues: true });
const asArray = <T,>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: unknown): string => (x == null ? '' : typeof x === 'object' ? String((x as Record<string, unknown>)['#text'] ?? '') : String(x)).trim();

export type FeedItem = { title: string; link: string; code: string };

// The CAP code is the last path segment of the link without ".xml", e.g. "20261111120000_BMKG001".
export function capCode(link: string): string {
  return (link.split('?')[0].split('/').pop() ?? '').replace(/\.xml$/i, '');
}

export function parseCapFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const items = asArray(doc?.rss?.channel?.item ?? doc?.feed?.entry);
  return items.flatMap((it: Record<string, unknown>) => {
    const link = typeof it.link === 'object' && it.link ? text((it.link as Record<string, unknown>)['@href'] ?? it.link) : text(it.link);
    return link ? [{ title: text(it.title), link, code: capCode(link) }] : [];
  });
}

export type CapAlert = {
  identifier: string;
  event: string;
  severity: string | null;
  headline: string | null;
  description: string | null;
  areaDesc: string;
  effective: string | null;
  expires: string | null;
  wkt: string | null;      // EWKT MultiPolygon, or null when the CAP has no polygon
};

const iso = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

// CAP polygons are "lat,lon lat,lon ..." (note: latitude first). Convert to EWKT (lon lat).
export function capPolygonToRing(poly: string): string | null {
  const pts = poly.trim().split(/\s+/).map((p) => p.split(',').map(Number));
  if (pts.length < 4 || pts.some((p) => p.length < 2 || !p.every(Number.isFinite))) return null;
  const ring = pts.map(([lat, lon]) => `${lon} ${lat}`);
  if (ring[0] !== ring[ring.length - 1]) ring.push(ring[0]);
  return `((${ring.join(', ')}))`;
}

export function parseCap(xml: string): CapAlert | null {
  const alert = parser.parse(xml)?.alert;
  if (!alert) return null;
  const info = asArray(alert.info)[0];
  if (!info) return null;
  const areas = asArray(info.area);
  const rings = areas.flatMap((a: Record<string, unknown>) => asArray(a.polygon).map((p) => capPolygonToRing(text(p)))).filter((r): r is string => !!r);
  return {
    identifier: text(alert.identifier),
    event: text(info.event),
    severity: text(info.severity) || null,
    headline: text(info.headline) || null,
    description: text(info.description) || null,
    areaDesc: areas.map((a: Record<string, unknown>) => text(a.areaDesc)).filter(Boolean).join('; '),
    effective: info.effective ? iso(text(info.effective)) : null,
    expires: info.expires ? iso(text(info.expires)) : null,
    wkt: rings.length ? `SRID=4326;MULTIPOLYGON(${rings.join(', ')})` : null,
  };
}

export function alertKind(event: string, headline = ''): string {
  const s = `${event} ${headline}`.toLowerCase();
  if (/banjir|flood/.test(s)) return 'flood';
  if (/gelombang|wave/.test(s)) return 'high_wave';
  if (/angin|wind|puting beliung/.test(s)) return 'strong_wind';
  if (/panas|heat/.test(s)) return 'extreme_heat';
  if (/hujan|rain|petir|thunder|storm/.test(s)) return 'heavy_rain';
  return 'other';
}

// Match province names (Indonesian) mentioned in a title/area description.
export function provincesMentioned(textToSearch: string, provinces: { id: number; name_id: string; name_en: string }[]): number[] {
  const t = textToSearch.toLowerCase();
  const alias: Record<string, string[]> = {
    'daerah khusus jakarta': ['dki jakarta', 'jakarta'],
    'daerah istimewa yogyakarta': ['di yogyakarta', 'yogyakarta'],
    'kepulauan bangka belitung': ['bangka belitung', 'babel'],
  };
  // Longest names first so "Papua Barat Daya" wins over "Papua Barat" and "Papua".
  const sorted = [...provinces].sort((a, b) => b.name_id.length - a.name_id.length);
  const found = new Set<number>();
  let rest = t;
  for (const p of sorted) {
    const names = [p.name_id.toLowerCase(), p.name_en.toLowerCase(), ...(alias[p.name_id.toLowerCase()] ?? [])];
    for (const n of names) {
      if (rest.includes(n)) { found.add(p.id); rest = rest.split(n).join(' '); }
    }
  }
  return [...found];
}
