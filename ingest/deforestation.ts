// Global Forest Watch Integrated Deforestation Alerts → EcoPulse. Runs daily.
//   1. Logs in to the GFW Data API with the account email + password (GitHub Secrets).
//   2. Weekly totals per province: the newest 7 days of published "highest"-confidence alerts.
//   3. For each province outline: "highest"-confidence alert points (last 30 days), grouped on a
//      ~1 km grid into clusters (the map's forest-loss squares). Locations never get finer than ~1 km.
//   4. Asks Claude Haiku for a short neutral "what's happening" summary for the biggest new clusters.
import { isMain } from './lib/main.ts';
import { env, optionalEnv } from './lib/env.ts';
import { fetchRetry, sleep } from './lib/http.ts';
import { db, upsertChunked } from './lib/db.ts';
import { runJob } from './lib/run.ts';

const API = 'https://data-api.globalforestwatch.org';
const DATASET = 'gfw_integrated_alerts';
const CLUSTER_DAYS = 30;
const SUMMARY_MODEL = optionalEnv('NEWS_MODEL') ?? 'claude-haiku-5-5';
const MAX_SUMMARIES = 60;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86400_000));

async function gfwToken(): Promise<string> {
  const body = new URLSearchParams({ username: env('GFW_EMAIL'), password: env('GFW_PASSWORD') });
  const res = await fetchRetry(`${API}/auth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  }, { retries: 1 });
  const json = (await res.json()) as { data?: { access_token?: string } };
  const token = json.data?.access_token;
  if (!token) throw new Error('GFW login returned no token. Check GFW_EMAIL / GFW_PASSWORD.');
  return token;
}

// GFW data queries need an API key (a login token alone gets 403). Keys last one year, so we create
// one automatically, keep it in the private server_settings table, and renew it before it expires.
export function keyNeedsRenewal(saved: { api_key?: string; expires_on?: string } | null, now = Date.now()): boolean {
  if (!saved?.api_key) return true;
  if (!saved.expires_on) return false;
  return new Date(saved.expires_on).getTime() - now < 14 * 86400_000;
}

async function loadSavedKey() {
  const { data: row } = await db().from('server_settings').select('value').eq('key', 'gfw_api_key').maybeSingle();
  return (row?.value ?? null) as { api_key?: string; expires_on?: string } | null;
}

async function createKey(token: string): Promise<string> {
  // No "domains" field: a domain list restricts which websites may use the key; this key is server-only.
  const res = await fetchRetry(`${API}/auth/apikey`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ alias: `ecopulse-${new Date().toISOString().slice(0, 16)}`, email: env('GFW_EMAIL'), organization: 'EcoPulse Indonesia' }),
  }, { retries: 1 });
  const json = (await res.json()) as { data?: { api_key?: string; expires_on?: string } };
  const apiKey = json.data?.api_key;
  if (!apiKey) throw new Error('GFW did not return an API key.');
  const { error } = await db().from('server_settings').upsert({
    key: 'gfw_api_key', value: { api_key: apiKey, expires_on: json.data?.expires_on ?? null }, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not save GFW API key: ${error.message}. Did you run migration 006?`);
  console.log(`  created a new GFW API key${json.data?.expires_on ? ` (valid until ${json.data.expires_on.slice(0, 10)})` : ''}`);
  return apiKey;
}

// GFW's own validity check (no login needed). Returns true/false, or null if the check itself failed.
async function keyIsValid(apiKey: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${API}/auth/apikey/${apiKey}/validate`, { signal: AbortSignal.timeout(20_000) });
    const json = (await res.json()) as { data?: { is_valid?: boolean } };
    return typeof json.data?.is_valid === 'boolean' ? json.data.is_valid : null;
  } catch { return null; }
}

const isKeyRejection = (err: unknown) => /403|missing valid API key/i.test(err instanceof Error ? err.message : String(err));

// Returns a key that GFW actually accepts for a test query, creating/replacing it if needed.
async function workingApiKey(token: string, probe: (key: string) => Promise<unknown>): Promise<string> {
  const saved = await loadSavedKey();
  let key = keyNeedsRenewal(saved) ? await createKey(token) : saved!.api_key!;
  let replaced = key !== saved?.api_key;

  for (let attempt = 1; attempt <= 6; attempt++) {
    const valid = await keyIsValid(key);
    console.log(`  GFW key check ${attempt}: ${valid === null ? 'unknown' : valid ? 'valid' : 'not valid yet'}`);
    try {
      await probe(key);
      return key;
    } catch (err) {
      if (!isKeyRejection(err)) throw err;
      if (!replaced && attempt >= 2) {           // an old saved key that keeps failing: replace it once
        console.log('  saved GFW key rejected: creating a fresh one');
        key = await createKey(token); replaced = true;
      }
      await sleep(30_000);                        // new keys can take a moment to activate
    }
  }
  throw new Error('GFW keeps rejecting the API key after ~3 minutes. Check the GFW account is confirmed, then run again.');
}

async function gfwQuery<T>(apiKey: string, sql: string, geometry: unknown): Promise<T[]> {
  const res = await fetchRetry(`${API}/dataset/${DATASET}/latest/query/json`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ sql, geometry }),
  }, { timeoutMs: 90_000, retries: 1 });
  const json = (await res.json()) as { data?: T[]; status?: string; message?: string };
  if (!Array.isArray(json.data)) throw new Error(`GFW query failed: ${json.message ?? json.status ?? 'no data'}`);
  return json.data;
}

// ---- pure helpers (tested) ----
// The newest 7-day window that has data: [latest - 6 days, latest].
export function latestWeek(dates: string[]): { start: string; end: string } | null {
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!valid.length) return null;
  const end = valid.reduce((m, d) => (d > m ? d : m));
  const start = isoDate(new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86400_000));
  return { start, end };
}

export type AlertPoint = { latitude: number; longitude: number; gfw_integrated_alerts__date: string; area__ha?: number | null };

export function clusterPoints(points: AlertPoint[]) {
  const cells = new Map<string, { grid_lat: number; grid_lon: number; first: string; last: string; n: number; ha: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || !p.gfw_integrated_alerts__date) continue;
    const grid_lat = Math.round(p.latitude * 100) / 100;
    const grid_lon = Math.round(p.longitude * 100) / 100;
    const key = `${grid_lat},${grid_lon}`;
    const d = p.gfw_integrated_alerts__date.slice(0, 10);
    const c = cells.get(key) ?? { grid_lat, grid_lon, first: d, last: d, n: 0, ha: 0 };
    c.n++; c.ha += Number(p.area__ha ?? 0) || 0;
    if (d < c.first) c.first = d;
    if (d > c.last) c.last = d;
    cells.set(key, c);
  }
  return [...cells.values()].map((c) => ({
    grid_lat: c.grid_lat, grid_lon: c.grid_lon, first_detected: c.first, last_detected: c.last,
    alert_count: c.n, area_ha: c.ha > 0 ? Math.round(c.ha * 100) / 100 : null,   // GFW gives no area for point rows: null, never a fake 0
  }));
}

export function summaryPrompt(items: { i: number; province: string; alerts: number; first: string; last: string; fires: number; news: string[] }[]) {
  return `You write short, neutral notes for a public environmental map of Indonesia.
For each forest-loss cluster below, write exactly 2 factual sentences in English and the same in Bahasa Indonesia.
Use ONLY the facts given. Do not state an area or hectares (none is given). Say "satellite alerts" (not "illegal" or "deforestation by X"). Never name or accuse any person or company.
If there are nearby fires, you may note that cleared land can burn easily in the dry season. Mention related news only as "local news has reported…" when relevant.

Reply with ONLY a JSON array: [{"i":0,"summary_en":"","summary_id":""}]

${items.map((x) => `[${x.i}] Province: ${x.province}. ${x.alerts} satellite alerts between ${x.first} and ${x.last}. Fire hotspots within 10 km in the last 30 days: ${x.fires}.${x.news.length ? ` Recent local news headlines: ${x.news.map((n) => `"${n}"`).join('; ')}.` : ''}`).join('\n')}`;
}

async function summarise(warnings: string[]) {
  const key = optionalEnv('ANTHROPIC_API_KEY');
  if (!key) { warnings.push('ANTHROPIC_API_KEY missing: skipped summaries'); return 0; }
  const { data: todo } = await db().from('deforestation_alerts_public')
    .select('id, province_id, province_en, alert_count, first_detected, last_detected, fires_within_10km')
    .is('summary_en', null).order('alert_count', { ascending: false }).limit(MAX_SUMMARIES);
  if (!todo?.length) return 0;

  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  let done = 0;
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const items = await Promise.all(batch.map(async (c, j) => {
      const { data: news } = c.province_id
        ? await db().from('news_feed').select('title').contains('province_ids', [c.province_id]).gt('published_at', since).limit(3)
        : { data: [] as { title: string }[] };
      return { i: j, province: c.province_en ?? 'Indonesia', alerts: c.alert_count,
        first: c.first_detected, last: c.last_detected, fires: c.fires_within_10km ?? 0, news: (news ?? []).map((n) => n.title) };
    }));
    try {
      const res = await fetchRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: SUMMARY_MODEL, max_tokens: 3000, messages: [{ role: 'user', content: summaryPrompt(items) }] }),
      }, { timeoutMs: 90_000 });
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (body.content ?? []).map((c) => c.text ?? '').join('');
      const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as { i: number; summary_en: string; summary_id: string }[];
      for (const s of arr) {
        const c = batch[s.i];
        if (!c || !s.summary_en) continue;
        await db().from('deforestation_clusters').update({
          summary_en: s.summary_en.slice(0, 600), summary_id: (s.summary_id ?? '').slice(0, 600), llm_model: SUMMARY_MODEL,
        }).eq('id', c.id);
        done++;
      }
    } catch (err) {
      warnings.push(`summaries: ${err instanceof Error ? err.message : err}`);
    }
  }
  return done;
}

async function main() {
  await runJob('deforestation', async () => {
    const warnings: string[] = [];
    const token = await gfwToken();
    const { data: outlines, error } = await db().rpc('province_outlines', { tolerance: 0.02 });
    if (error) throw new Error(`province_outlines: ${error.message}`);
    const first = (outlines as { geojson: unknown }[])[0];
    // Probe with a tiny 1-day count on the first province so a bad key is caught before the main loop.
    const apiKey = await workingApiKey(token, (key) => gfwQuery(key,
      `SELECT COUNT(*) AS n FROM results WHERE gfw_integrated_alerts__date >= '${daysAgo(1)}'`, first.geojson));

    const startC = daysAgo(CLUSTER_DAYS);
    let clusters = 0, provincesOk = 0;

    // GFW's query engine is picky and its errors aren't always clear, so the map-square question has a
    // "ladder": try the richest form first, step down to simpler ones, and keep the first that works.
    // (Run on 2026-11-12: area__ha is NOT supported for point rows; "highest points" works.)
    const dC = `gfw_integrated_alerts__date >= '${startC}'`;
    const pointLadder: { name: string; run: (g: unknown) => Promise<AlertPoint[]> }[] = [
      { name: 'highest points', run: (g) => gfwQuery<AlertPoint>(apiKey,
        `SELECT latitude, longitude, gfw_integrated_alerts__date FROM results WHERE ${dC} AND gfw_integrated_alerts__confidence = 'highest'`, g) },
      { name: 'points filtered here', run: async (g) => (await gfwQuery<AlertPoint & { gfw_integrated_alerts__confidence?: string }>(apiKey,
        `SELECT latitude, longitude, gfw_integrated_alerts__date, gfw_integrated_alerts__confidence FROM results WHERE ${dC}`, g))
        .filter((r) => r.gfw_integrated_alerts__confidence === 'highest') },
    ];
    let pointRung = 0, pointsWorked = false;
    const short = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/https?:\/\/\S+/g, '').slice(0, 160);
    const datesByProvince = new Map<number, string[]>();

    for (const p of outlines as { id: number; slug: string; name_en: string; geojson: unknown }[]) {
      while (pointRung < pointLadder.length) {
        try {
          const pts = await pointLadder[pointRung].run(p.geojson);
          pointsWorked = true;
          const rows = clusterPoints(pts).map((c) => ({ ...c, province_id: p.id, updated_at: new Date().toISOString() }));
          clusters += await upsertChunked('deforestation_clusters', rows, 'grid_lat,grid_lon');
          datesByProvince.set(p.id, pts.map((x) => String(x.gfw_integrated_alerts__date).slice(0, 10)));
          provincesOk++;
          console.log(`  ${p.slug}: ${pts.length} alerts in ${CLUSTER_DAYS} days, ${rows.length} map squares`);
          break;
        } catch (err) {
          if (pointsWorked) { warnings.push(`${p.slug}: ${short(err)}`); console.log(`  ${p.slug}: skipped (${short(err)})`); break; }
          console.log(`  form "${pointLadder[pointRung].name}" failed (${short(err)}); trying a simpler one`);
          pointRung++;
        }
      }
      if (pointRung >= pointLadder.length) throw new Error(`GFW rejected every form of the question. Last province tried: ${p.slug}`);
      await sleep(500);
    }

    // Weekly totals = the newest 7 days GFW has published. Alerts appear 1–3 weeks after detection,
    // so "the last 7 calendar days" is almost always empty; the site shows the real dates instead.
    const week = latestWeek([...datesByProvince.values()].flat());
    if (week) {
      const totals = [...datesByProvince].map(([province_id, dates]) => ({
        province_id, alerts_7d: dates.filter((d) => d >= week.start && d <= week.end).length, area_ha_7d: null,
        window_start: week.start, window_end: week.end, computed_at: new Date().toISOString(),
      }));
      await upsertChunked('deforestation_province_7d', totals, 'province_id');
      console.log(`  weekly totals for ${week.start} to ${week.end} (newest published data)`);
    }
    if (provincesOk === 0) throw new Error(`All provinces failed. First error: ${warnings[0]}`);

    const { error: ctxErr } = await db().rpc('refresh_cluster_context');
    if (ctxErr) warnings.push(`refresh_cluster_context: ${ctxErr.message}`);
    const summaries = await summarise(warnings);

    console.log(`  ${provincesOk}/${(outlines as unknown[]).length} provinces, ${clusters} clusters upserted, ${summaries} summaries written`);
    return { rows: clusters, partial: warnings.length ? warnings.slice(0, 10).join(' | ') : undefined };
  });
}

if (isMain(import.meta.url)) main();
