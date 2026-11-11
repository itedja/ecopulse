// Environmental news → news_articles. Runs every hour.
// 1. Reads every active RSS/Atom feed in news_sources.
// 2. Sends NEW stories (title + short excerpt) to Claude Haiku in batches, which
//    decides if each is an Indonesian environmental story, tags topics + provinces,
//    and writes a neutral 2-sentence summary in English and Bahasa Indonesia.
// 3. Stores title, link and OUR summary only — never the article text (copyright).
import { XMLParser } from 'fast-xml-parser';
import { isMain } from './lib/main.ts';
import { env, optionalEnv } from './lib/env.ts';
import { fetchRetry } from './lib/http.ts';
import { db } from './lib/db.ts';
import { runJob } from './lib/run.ts';

const MODEL = optionalEnv('NEWS_MODEL') ?? 'claude-haiku-5-5';
const MAX_NEW_PER_RUN = 40;
const BATCH = 10;
const MAX_AGE_DAYS = 7;

export const TOPICS = ['wildfires', 'air_pollution', 'forestry_carbon', 'floods', 'climate',
  'biodiversity', 'mining', 'marine', 'policy', 'other'] as const;

export type FeedStory = { title: string; url: string; published_at: string; excerpt: string; image_url: string | null };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', trimValues: true, processEntities: true });
const arr = <T,>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x: unknown): string =>
  (x == null ? '' : typeof x === 'object' ? String((x as Record<string, unknown>)['#text'] ?? '') : String(x)).trim();

export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Normalise links so the same story isn't stored twice (drop tracking parameters and #fragments).
export function cleanUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) url.searchParams.delete(k);
    return url.toString();
  } catch { return u.trim(); }
}

export function parseFeed(xml: string): FeedStory[] {
  const doc = parser.parse(xml);
  const rss = arr(doc?.rss?.channel?.item);
  const atom = arr(doc?.feed?.entry);
  const out: FeedStory[] = [];
  for (const it of [...rss, ...atom] as Record<string, unknown>[]) {
    const linkRaw = arr(it.link as unknown).map((l) => (typeof l === 'object' && l ? txt((l as Record<string, unknown>)['@href'] ?? l) : txt(l))).find(Boolean);
    const title = stripHtml(txt(it.title));
    if (!linkRaw || !title) continue;
    const date = new Date(txt(it.pubDate ?? it.published ?? it.updated ?? it['dc:date']));
    const excerpt = stripHtml(txt(it.description ?? it.summary ?? it['content:encoded'] ?? '')).slice(0, 600);
    const media = (it['media:content'] ?? it['media:thumbnail'] ?? it.enclosure) as Record<string, unknown> | undefined;
    const image = media && typeof media === 'object' ? txt(media['@url']) || null : null;
    out.push({
      title: title.slice(0, 300), url: cleanUrl(linkRaw),
      published_at: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      excerpt, image_url: image && /^https:\/\//.test(image) ? image : null,
    });
  }
  return out;
}

export type Province = { id: number; slug: string; name_en: string };
export type Verdict = { i: number; relevant: boolean; topics: string[]; provinces: string[]; summary_en: string; summary_id: string };

export function buildPrompt(stories: FeedStory[], provinces: Province[]): string {
  return `You curate an Indonesian environmental news feed.

For each story below decide:
- "relevant": true only if it is mainly about the environment IN INDONESIA (pollution, haze, fires, forests, deforestation, peat, floods, climate, biodiversity, mining impacts, oceans, environmental policy or law). False for anything else, including non-Indonesian stories.
- "topics": 1-3 of ${JSON.stringify(TOPICS)}.
- "provinces": slugs of Indonesian provinces the story is about, from this list only (empty if national or unclear): ${provinces.map((p) => p.slug).join(', ')}.
- "summary_en": exactly 2 neutral, factual sentences in English, in your own words. No quotes, no opinions, no names of private individuals.
- "summary_id": the same 2 sentences in natural Bahasa Indonesia.
For irrelevant stories use empty topics/provinces and empty summaries.

Reply with ONLY a JSON array, one object per story: [{"i":0,"relevant":true,"topics":[],"provinces":[],"summary_en":"","summary_id":""}]

Stories:
${stories.map((s, i) => `[${i}] ${s.title}\n${s.excerpt}`).join('\n\n')}`;
}

export function parseVerdicts(raw: string, n: number, provinces: Province[]): Map<number, Verdict> {
  const start = raw.indexOf('['), end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Model reply had no JSON array');
  const list = JSON.parse(raw.slice(start, end + 1)) as Partial<Verdict>[];
  const slugs = new Set(provinces.map((p) => p.slug));
  const out = new Map<number, Verdict>();
  for (const v of list) {
    if (typeof v.i !== 'number' || v.i < 0 || v.i >= n) continue;
    const relevant = v.relevant === true;
    out.set(v.i, {
      i: v.i, relevant,
      topics: relevant ? (v.topics ?? []).filter((t) => (TOPICS as readonly string[]).includes(t)).slice(0, 3) : [],
      provinces: relevant ? (v.provinces ?? []).filter((p) => slugs.has(p)) : [],
      summary_en: relevant ? String(v.summary_en ?? '').slice(0, 600) : '',
      summary_id: relevant ? String(v.summary_id ?? '').slice(0, 600) : '',
    });
  }
  return out;
}

async function classify(stories: FeedStory[], provinces: Province[]): Promise<Map<number, Verdict>> {
  const res = await fetchRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: buildPrompt(stories, provinces) }] }),
  }, { timeoutMs: 90_000 });
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (body.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return parseVerdicts(text, stories.length, provinces);
}

async function main() {
  await runJob('news', async () => {
    const warnings: string[] = [];
    const { data: sources, error } = await db().from('news_sources').select('id, name, feed_url, language').eq('is_active', true);
    if (error) throw error;
    const { data: provinces } = await db().from('provinces').select('id, slug, name_en');
    const provs = (provinces ?? []) as Province[];

    // 1. Read feeds.
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400_000;
    const fresh: (FeedStory & { source_id: number; language: string })[] = [];
    for (const s of sources ?? []) {
      try {
        const xml = await (await fetchRetry(s.feed_url, { headers: { 'user-agent': 'EcoPulseBot/1.0 (+https://github.com/itedja/ecopulse)' } })).text();
        const stories = parseFeed(xml).filter((x) => new Date(x.published_at).getTime() > cutoff);
        fresh.push(...stories.map((x) => ({ ...x, source_id: s.id as number, language: s.language as string })));
        await db().from('news_sources').update({ last_fetched_at: new Date().toISOString() }).eq('id', s.id);
      } catch (err) {
        warnings.push(`${s.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!fresh.length && warnings.length === (sources ?? []).length) throw new Error(warnings.join(' | '));

    // 2. Keep only stories we haven't stored yet.
    const urls = [...new Set(fresh.map((f) => f.url))];
    const known = new Set<string>();
    for (let i = 0; i < urls.length; i += 100) {
      const { data } = await db().from('news_articles').select('url').in('url', urls.slice(i, i + 100));
      (data ?? []).forEach((d) => known.add(d.url as string));
    }
    const seen = new Set<string>();
    const todo = fresh
      .filter((f) => !known.has(f.url) && !seen.has(f.url) && seen.add(f.url))
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
      .slice(0, MAX_NEW_PER_RUN);

    // 3. Classify + summarise in batches; store each batch as it completes.
    let stored = 0, relevant = 0;
    const idOf = new Map(provs.map((p) => [p.slug, p.id]));
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      let verdicts: Map<number, Verdict>;
      try {
        verdicts = await classify(batch, provs);
      } catch (err) {
        warnings.push(`classify: ${err instanceof Error ? err.message : err}`);
        continue;   // not stored → retried next hour
      }
      const rows = batch.flatMap((s, j) => {
        const v = verdicts.get(j);
        if (!v) return [];
        if (v.relevant) relevant++;
        return [{
          source_id: s.source_id, url: s.url, title: s.title, published_at: s.published_at,
          language: s.language, image_url: s.image_url, is_relevant: v.relevant,
          summary_en: v.summary_en || null, summary_id: v.summary_id || null,
          topics: v.topics, province_ids: v.provinces.map((p) => idOf.get(p)!).filter(Boolean),
          llm_model: MODEL,
        }];
      });
      const { error: insErr } = await db().from('news_articles').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
      if (insErr) warnings.push(`insert: ${insErr.message}`); else stored += rows.length;
    }

    console.log(`  ${fresh.length} stories in feeds, ${todo.length} new, ${stored} stored, ${relevant} relevant`);
    return { rows: stored, partial: warnings.length ? warnings.slice(0, 10).join(' | ') : undefined };
  });
}

if (isMain(import.meta.url)) main();
