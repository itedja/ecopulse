// Latest-news helpers for the home-page carousel and the story page.
// We only ever hold a story's headline, link, photo link and our own short summary; the article
// itself stays with its publisher.
import type { Lang } from './i18n';

export type Story = {
  id: number; url: string; title: string; published_at: string;
  summary_en: string | null; summary_id: string | null;
  topics: string[]; source_name: string; image_url: string | null;
};

// Newest first, one card per article (the same link or headline never appears twice).
export function latestStories<T extends { url: string; title: string; published_at: string }>(rows: T[], n = 4): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of [...rows].sort((a, b) => b.published_at.localeCompare(a.published_at))) {
    const key = r.title.trim().toLowerCase();
    if (seen.has(r.url) || seen.has(key)) continue;
    seen.add(r.url); seen.add(key);
    out.push(r);
    if (out.length === n) break;
  }
  return out;
}

export function timeAgo(iso: string, nowMs: number, lang: Lang): string {
  const mins = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return lang === 'id' ? 'baru saja' : 'just now';
  if (mins < 60) return lang === 'id' ? `${mins} menit lalu` : `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return lang === 'id' ? `${h} jam lalu` : `${h} h ago`;
  const d = Math.floor(h / 24);
  return lang === 'id' ? `${d} hari lalu` : `${d} d ago`;
}

export const storyHref = (id: number) => `/news?id=${id}`;

// The story id from a page address such as "?id=123". Anything that is not a plain number is rejected.
export function parseStoryId(search: string): number | null {
  const v = new URLSearchParams(search).get('id') ?? '';
  return /^\d{1,12}$/.test(v) ? Number(v) : null;
}

// Topic tags use the same colours as the map: orange = fire, red = air, brown = forest, blue = water.
const TOPIC: Record<string, { en: string; id: string; color: string }> = {
  wildfires: { en: 'Fire', id: 'Api', color: '#B8400E' },
  air_pollution: { en: 'Air', id: 'Udara', color: '#B42318' },
  forestry_carbon: { en: 'Forest', id: 'Hutan', color: '#7A4F28' },
  floods: { en: 'Flood', id: 'Banjir', color: '#1D5F9E' },
};
const OTHER = { en: 'Environment', id: 'Lingkungan', color: '#46506A' };

export function topicTag(topics: string[], lang: Lang): { label: string; color: string } {
  const t = topics.map((k) => TOPIC[k]).find(Boolean) ?? OTHER;
  return { label: t[lang], color: t.color };
}

export const summaryOf = (s: Pick<Story, 'summary_en' | 'summary_id'>, lang: Lang) =>
  (lang === 'id' ? s.summary_id : s.summary_en) ?? s.summary_en ?? s.summary_id ?? '';

// Only http(s) links are ever used as a link target or photo address.
export const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);
