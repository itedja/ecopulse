// Global Forest Watch Integrated Deforestation Alerts → EcoPulse. Runs daily.
//   1. Logs in to the GFW Data API with the account email + password (GitHub Secrets).
//   2. For each province outline: total high/highest-confidence alerts in the last 7 days.
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
const MAX_SUMMARIES = 30;

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
    alert_count: c.n, area_ha: Math.round(c.ha * 100) / 100,
  }));
}

export function summaryPrompt(items: { i: number; province: string; area_ha: number; alerts: number; first: string; last: string; fires: number; news: string[] }[]) {
  return `You write short, neutral notes for a public environmental map of Indonesia.
For each forest-loss cluster below, write exactly 2 factual sentences in English and the same in Bahasa Indonesia.
Use ONLY the facts given. Say "satellite alerts" (not "illegal" or "deforestation by X"). Never name or accuse any person or company.
If there are nearby fires, you may note that cleared land can burn easily in the dry season. Mention related news only as "local news has reported…" when relevant.

Reply with ONLY a JSON array: [{"i":0,"summary_en":"","summary_id":""}]

${items.map((x) => `[${x.i}] Province: ${x.province}. Area flagged: ~${x.area_ha} ha from ${x.alerts} satellite alerts between ${x.first} and ${x.last}. Fire hotspots within 10 km in the last 30 days: ${x.fires}.${x.news.length ? ` Recent local news headlines: ${x.news.map((n) => `"${n}"`).join('; ')}.` : ''}`).join('\n')}`;
}

async function summarise(warnings: string[]) {
  const key = optionalEnv('ANTHROPIC_API_KEY');
  if (!key) { warnings.push('ANTHROPIC_API_KEY missing: skipped summaries'); return 0; }
  const { data: todo } = await db().from('deforestation_alerts_public')
    .select('id, province_id, province_en, area_ha, alert_count, first_detected, last_detected, fires_within_10km')
    .is('summary_en', null).order('area_ha', { ascending: false }).limit(MAX_SUMMARIES);
  if (!todo?.length) return 0;

  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  let done = 0;
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const items = await Promise.all(batch.map(async (c, j) => {
      const { data: news } = c.province_id
        ? await db().from('news_feed').select('title').contains('province_ids', [c.province_id]).gt('published_at', since).limit(3)
        : { data: [] as { title: string }[] };
      return { i: j, province: c.province_en ?? 'Indonesia', area_ha: Number(c.area_ha ?? 0), alerts: c.alert_count,
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

    const end = daysAgo(0), start7 = daysAgo(7), startC = daysAgo(CLUSTER_DAYS);
    let clusters = 0, provincesOk = 0;

    // GFW's query engine is picky and its errors aren't always clear (422 for some things, 500 for others).
    // So each question has a "ladder": try the richest form first, step down to simpler forms, and remember
    // the first one that works for the rest of the run. The last rung is the exact query that already passed
    // the key check, so the totals always have something that works.
    type Totals = { alerts: number; area: number | null };
    const d7 = `gfw_integrated_alerts__date >= '${start7}'`;
    const totalLadder: { name: string; run: (g: unknown) => Promise<Totals> }[] = [
      { name: 'count+area per confidence', run: async (g) => {
        let alerts = 0, area = 0;
        for (const level of ['high', 'highest']) {
          const [r] = await gfwQuery<{ alert_count?: number; area_ha?: number }>(apiKey,
            `SELECT COUNT(*) AS alert_count, SUM(area__ha) AS area_ha FROM results WHERE ${d7} AND gfw_integrated_alerts__confidence = '${level}'`, g);
          alerts += Number(r?.alert_count ?? 0); area += Number(r?.area_ha ?? 0);
        }
        return { alerts, area };
      } },
      { name: 'count per confidence', run: async (g) => {
        let alerts = 0;
        for (const level of ['high', 'highest']) {
          const [r] = await gfwQuery<{ alert_count?: number }>(apiKey,
            `SELECT COUNT(*) AS alert_count FROM results WHERE ${d7} AND gfw_integrated_alerts__confidence = '${level}'`, g);
          alerts += Number(r?.alert_count ?? 0);
        }
        return { alerts, area: null };
      } },
      { name: 'count grouped by confidence', run: async (g) => {
        const rows = await gfwQuery<{ gfw_integrated_alerts__confidence?: string; alert_count?: number }>(apiKey,
          `SELECT gfw_integrated_alerts__confidence, COUNT(*) AS alert_count FROM results WHERE ${d7} GROUP BY gfw_integrated_alerts__confidence`, g);
        const alerts = rows.filter((r) => r.gfw_integrated_alerts__confidence === 'high' || r.gfw_integrated_alerts__confidence === 'highest')
          .reduce((n, r) => n + Number(r.alert_count ?? 0), 0);
        return { alerts, area: null };
      } },
      { name: 'count, all confidence levels', run: async (g) => {
        const [r] = await gfwQuery<{ n?: number }>(apiKey, `SELECT COUNT(*) AS n FROM results WHERE ${d7}`, g);
        return { alerts: Number(r?.n ?? 0), area: null };
      } },
    ];
    const dC = `gfw_integrated_alerts__date >= '${startC}'`;
    const pointLadder: { name: string; run: (g: unknown) => Promise<AlertPoint[]> }[] = [
      { name: 'highest points + area', run: (g) => gfwQuery<AlertPoint>(apiKey,
        `SELECT latitude, longitude, gfw_integrated_alerts__date, area__ha FROM results WHERE ${dC} AND gfw_integrated_alerts__confidence = 'highest'`, g) },
      { name: 'highest points', run: (g) => gfwQuery<AlertPoint>(apiKey,
        `SELECT latitude, longitude, gfw_integrated_alerts__date FROM results WHERE ${dC} AND gfw_integrated_alerts__confidence = 'highest'`, g) },
      { name: 'points filtered here', run: async (g) => (await gfwQuery<AlertPoint & { gfw_integrated_alerts__confidence?: string }>(apiKey,
        `SELECT latitude, longitude, gfw_integrated_alerts__date, gfw_integrated_alerts__confidence FROM results WHERE ${dC}`, g))
        .filter((r) => r.gfw_integrated_alerts__confidence === 'highest') },
    ];
    let totalRung = 0, pointRung = 0, pointsBroken = false, pointsWorked = false;
    const short = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/https?:\/\/\S+/g, '').slice(0, 160);

    for (const p of outlines as { id: number; slug: string; name_en: string; geojson: unknown }[]) {
      // (a) 7-day totals
      let totals: Totals | null = null;
      while (totalRung < totalLadder.length) {
        try { totals = await totalLadder[totalRung].run(p.geojson); break; }
        catch (err) {
          if (provincesOk > 0) { warnings.push(`${p.slug} totals: ${short(err)}`); break; }   // the form worked before: just this province
          console.log(`  totals form "${totalLadder[totalRung].name}" failed (${short(err)}); trying a simpler one`);
          totalRung++;
        }
      }
      if (totalRung >= totalLadder.length) throw new Error(`GFW rejected every form of the totals question. Last province tried: ${p.slug}`);
      if (!totals) { console.log(`  ${p.slug}: skipped`); continue; }
      await upsertChunked('deforestation_province_7d', [{
        province_id: p.id, alerts_7d: totals.alerts, area_ha_7d: totals.area ? Math.round(totals.area * 100) / 100 : null,
        window_start: start7, window_end: end, computed_at: new Date().toISOString(),
      }], 'province_id');
      provincesOk++;

      // (b) points → ~1 km squares on the map. If GFW can't do this, the rankings still work without it.
      let squares = 0;
      while (!pointsBroken) {
        try {
          const pts = await pointLadder[pointRung].run(p.geojson);
          const rows = clusterPoints(pts).map((c) => ({ ...c, province_id: p.id, updated_at: new Date().toISOString() }));
          squares = rows.length; pointsWorked = true;
          clusters += await upsertChunked('deforestation_clusters', rows, 'grid_lat,grid_lon');
          break;
        } catch (err) {
          if (pointsWorked) { warnings.push(`${p.slug} squares: ${short(err)}`); break; }
          console.log(`  squares form "${pointLadder[pointRung].name}" failed (${short(err)})`);
          if (++pointRung >= pointLadder.length) { pointsBroken = true; warnings.push('map squares unavailable this run'); }
        }
      }
      console.log(`  ${p.slug}: ${totals.alerts} alerts this week${pointsBroken ? '' : `, ${squares} map squares`}`);
      await sleep(500);
    }
    console.log(`  used: totals = "${totalLadder[totalRung].name}", squares = ${pointsBroken ? 'none' : `"${pointLadder[pointRung].name}"`}`);
    if (provincesOk === 0) throw new Error(`All provinces failed. First error: ${warnings[0]}`);

    const { error: ctxErr } = await db().rpc('refresh_cluster_context');
    if (ctxErr) warnings.push(`refresh_cluster_context: ${ctxErr.message}`);
    const summaries = await summarise(warnings);

    console.log(`  ${provincesOk}/${(outlines as unknown[]).length} provinces, ${clusters} clusters upserted, ${summaries} summaries written`);
    return { rows: clusters, partial: warnings.length ? warnings.slice(0, 10).join(' | ') : undefined };
  });
}

if (isMain(import.meta.url)) main();
