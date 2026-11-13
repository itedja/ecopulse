'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigured, type City, type CityAq, type Hotspot, type Forecast, type Wind, type Alert, type Quake, type NewsItem, type ForestAlert, type HelpAction, type Report, type Leader, type Station, type RepeatPoint, type RepeatCell, type RepeatProvince, type RepeatMeta, parseRepeatPoints } from '@/lib/supabase';
import { T, type Lang, cityTimeZone, hhmm } from '@/lib/i18n';
import LegalNote from '@/components/LegalNote';
import { CLEAN_AIR, JAKARTA_CASE, JAKARTA_AREA } from '@/lib/legal';
import { category, advice, cleanestWindow, calibrateForecast, pm25ToAqi, type Category } from '@/lib/aqi';
import { upwindFires, distanceKm, compass } from '@/lib/smoke';
import type { LayerKey } from '@/components/MapView';
import Rankings, { type RankingRow } from '@/components/Rankings';
import ForestAlertCard from '@/components/ForestAlertCard';
import RepeatFireCard from '@/components/RepeatFireCard';
import EmitterCard from '@/components/EmitterCard';
import { nearby, kindLabel, tonnes, EMIT_POINT_COLS, type Emitter, type EmitterPoint } from '@/lib/emitters';
import ReportCard from '@/components/ReportCard';
import Community from '@/components/Community';
import { useAuth } from '@/lib/useAuth';
import { drawCityCard, shareCanvas } from '@/lib/shareCard';
import { isInstalledApp } from '@/lib/handoff';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false, loading: () => <div className="map map-loading" /> });

const REFRESH_MS = 2 * 60_000;   // fetch fresh data every 2 minutes
const TICK_MS = 30_000;          // update "x min ago" labels every 30 seconds
type Tab = 'map' | 'rank' | 'reports' | 'news';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

type Data = {
  cities: City[]; aq: CityAq[]; fires: Hotspot[]; forecast: Forecast[];
  wind: Wind[]; alerts: Alert[]; quakes: Quake[]; news: NewsItem[]; rankings: RankingRow[]; forests: ForestAlert[]; help: HelpAction[]; reports: Report[]; leaders: Leader[]; stations: Station[];
  repeatProv: RepeatProvince[]; repeatMeta: RepeatMeta | null;
};
const EMPTY: Data = { cities: [], aq: [], fires: [], forecast: [], wind: [], alerts: [], quakes: [], news: [], rankings: [], forests: [], help: [], reports: [], leaders: [], stations: [], repeatProv: [], repeatMeta: null };

type RRow = { station_id: number; measured_at: string; pm25_ugm3: number | null; aqi_us: number | null;
  aq_stations: { name: string | null; source: string; attribution: string | null; latitude: number; longitude: number } | null };

// Newest reading per station. Readings of 0 or below are broken sensors, so they're skipped.
function latestStations(rows: RRow[]): Station[] {
  const seen = new Set<number>();
  const out: Station[] = [];
  for (const r of rows) {
    if (seen.has(r.station_id) || !r.aq_stations) continue;
    const aqi = r.aqi_us ?? (r.pm25_ugm3 != null ? pm25ToAqi(Number(r.pm25_ugm3)) : null);
    if (aqi == null || aqi < 1 || aqi > 999) continue;
    seen.add(r.station_id);
    out.push({ id: r.station_id, name: r.aq_stations.name ?? '', source: r.aq_stations.source, attribution: r.aq_stations.attribution,
      latitude: r.aq_stations.latitude, longitude: r.aq_stations.longitude, aqi: Math.round(aqi),
      pm25: r.pm25_ugm3 != null ? Number(r.pm25_ugm3) : null, measured_at: r.measured_at });
  }
  return out;
}

async function loadAll(): Promise<Data> {
  const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
  const now = new Date().toISOString();
  const [cities, aq, fires, forecast, wind, alerts, quakes, news, rankings, forests, help, reports, leaders, readings, repeatProv, repeatMeta] = await Promise.all([
    supabase.from('cities').select('id, slug, name_en, name_id, latitude, longitude, province_id').eq('is_featured', true).order('name_en'),
    supabase.from('city_aq_latest').select('*'),
    supabase.from('hotspots_recent').select('id, latitude, longitude, acquired_at, confidence, frp_mw, province_id').limit(5000),
    supabase.from('city_aq_forecast').select('city_id, slug, valid_at, aqi_forecast, pm25_forecast').order('valid_at'),
    supabase.from('weather_forecasts').select('wind_speed_kmh, wind_direction_deg, weather_points(latitude, longitude, city_id)').eq('valid_at', hour.toISOString()),
    supabase.from('weather_alerts').select('id, kind, severity, headline_en, headline_id, province_ids, expires_at, area').gt('expires_at', now).limit(200),
    supabase.from('earthquakes').select('id, occurred_at, magnitude, depth_km, latitude, longitude, region_text')
      .gt('occurred_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('occurred_at', { ascending: false }).limit(50),
    supabase.from('news_feed').select('*').order('published_at', { ascending: false }).limit(30),
    supabase.from('province_rankings_7d').select('*'),
    supabase.from('deforestation_alerts_public').select('*').order('alert_count', { ascending: false }).limit(1500),
    supabase.from('help_actions').select('*').eq('is_active', true).order('priority'),
    supabase.from('reports_public').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('leaderboard_users').select('nickname, points, rank_key, overall_rank').order('overall_rank').limit(20),
    // Individual monitoring stations (latest reading in the last 3 hours), shown when zoomed in.
    supabase.from('aq_readings').select('station_id, measured_at, pm25_ugm3, aqi_us, aq_stations(name, source, attribution, latitude, longitude)')
      .gt('measured_at', new Date(Date.now() - 3 * 3600_000).toISOString()).order('measured_at', { ascending: false }).limit(5000),
    supabase.from('repeat_fire_provinces').select('*'),
    supabase.from('repeat_fire_meta').select('*').maybeSingle(),
  ]);
  type WRow = { wind_speed_kmh: number | null; wind_direction_deg: number | null; weather_points: { latitude: number; longitude: number; city_id: number | null } | null };
  return {
    cities: (cities.data ?? []) as City[],
    aq: (aq.data ?? []) as CityAq[],
    // Only fires matched to an Indonesian province (land, or within 15 km of the coast). Drops gas flares at sea
    // and heat sources in Singapore/Malaysia.
    fires: ((fires.data ?? []) as Hotspot[]).filter((f) => f.province_id != null),
    forecast: (forecast.data ?? []) as Forecast[],
    wind: ((wind.data ?? []) as unknown as WRow[]).filter((w) => w.weather_points).map((w) => ({
      latitude: w.weather_points!.latitude, longitude: w.weather_points!.longitude, city_id: w.weather_points!.city_id,
      wind_speed_kmh: w.wind_speed_kmh, wind_direction_deg: w.wind_direction_deg,
    })),
    alerts: (alerts.data ?? []) as Alert[],
    quakes: (quakes.data ?? []) as Quake[],
    news: (news.data ?? []) as NewsItem[],
    rankings: (rankings.data ?? []) as RankingRow[],
    forests: (forests.data ?? []) as ForestAlert[],
    help: (help.data ?? []) as HelpAction[],
    reports: (reports.data ?? []) as Report[],
    leaders: (leaders.data ?? []) as Leader[],
    stations: latestStations((readings.data ?? []) as unknown as RRow[]),
    repeatProv: (repeatProv.data ?? []) as RepeatProvince[],
    repeatMeta: (repeatMeta.data ?? null) as RepeatMeta | null,
  };
}

export default function Home() {
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<Lang>('id');   // Indonesian by default; a saved choice wins
  const [slug, setSlug] = useState('jakarta');
  const [tab, setTab] = useState<Tab>('map');
  const [sharing, setSharing] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ air: true, fire: true, repeat: false, forest: true, emit: false, reports: true, wind: true, alerts: true });
  const [forestId, setForestId] = useState<number | null>(null);
  // Repeat-fire layer: the point list is loaded only when the layer is first switched on.
  const [repeatPts, setRepeatPts] = useState<RepeatPoint[]>([]);
  const [repeatSel, setRepeatSel] = useState<{ cx: number; cy: number } | null>(null);
  const [repeatCell, setRepeatCell] = useState<RepeatCell | null>(null);
  const repeatLoaded = useRef(false);
  useEffect(() => {
    if (!layers.repeat || repeatLoaded.current) return;
    repeatLoaded.current = true;
    supabase.rpc('repeat_fire_points').then(({ data: txt }) => setRepeatPts(parseRepeatPoints(String(txt ?? ''))));
  }, [layers.repeat]);
  const openRepeat = (cx: number, cy: number) => {
    setRepeatSel({ cx, cy }); setForestId(null); setReportId(null); setEmitSel(null); setEmitRow(null); setTab('map');
    supabase.from('repeat_fire_cells').select('*').eq('cx', cx).eq('cy', cy).maybeSingle()
      .then(({ data: row }) => setRepeatCell((row as RepeatCell | null) ?? null));
  };
  const closeRepeat = () => { setRepeatSel(null); setRepeatCell(null); };
  // Big emitters (Climate TRACE, updated monthly): the light point list is loaded once, for the map
  // layer and the "near this city" list; a facility's full row is loaded when it is opened.
  const [emitPts, setEmitPts] = useState<EmitterPoint[]>([]);
  const [emitSel, setEmitSel] = useState<number | null>(null);
  const [emitRow, setEmitRow] = useState<Emitter | null>(null);
  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.from('emission_sources').select(EMIT_POINT_COLS).limit(2000)
      .then(({ data: rows }) => setEmitPts((rows ?? []) as EmitterPoint[]));
  }, []);
  const openEmitter = (id: number) => {
    setEmitSel(id); setForestId(null); setReportId(null); setRepeatSel(null); setRepeatCell(null); setTab('map');
    setLayers((l) => (l.emit ? l : { ...l, emit: true }));
    supabase.from('emission_sources').select('*').eq('id', id).maybeSingle()
      .then(({ data: row }) => setEmitRow((row as Emitter | null) ?? null));
  };
  const closeEmitter = () => { setEmitSel(null); setEmitRow(null); };
  const [reportId, setReportId] = useState<string | null>(null);
  const auth = useAuth();
  const [installed, setInstalled] = useState(false);   // home-screen app: no way back to the website
  useEffect(() => { setInstalled(isInstalledApp()); }, []);
  const [now, setNow] = useState(() => Date.now());
  const t = T[lang];

  useEffect(() => {
    const l = store.get('ep.lang'); if (l === 'en' || l === 'id') setLang(l);
    const c = store.get('ep.city'); if (c) setSlug(c);
    // Coming back from Google sign-in lands on the Report tab.
    const q = new URLSearchParams(window.location.search);
    if (q.get('tab') === 'reports') setTab('reports');
    // A shared repeat-fire link (/app?cell=5225,-175) opens that area's card.
    const cell = /^(-?\d+),(-?\d+)$/.exec(q.get('cell') ?? '');
    if (cell) { setLayers((l) => ({ ...l, repeat: true })); openRepeat(Number(cell[1]), Number(cell[2])); }
    // A shared emitter link (/app?emitter=448927) opens that facility's card.
    const em = /^\d+$/.exec(q.get('emitter') ?? '');
    if (em) openEmitter(Number(em[0]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Tidy the address bar once the sign-in code has been used.
    if (auth.ready && window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, [auth.ready, auth.session]);

  const refresh = useCallback(async () => {
    if (!supabaseConfigured) { setLoaded(true); return; }
    try { setData(await loadAll()); } finally { setLoaded(true); setNow(Date.now()); }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    // Phones pause timers in background tabs: catch up the moment the page is visible again.
    const onShow = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(id); clearInterval(tick); document.removeEventListener('visibilitychange', onShow); };
  }, [refresh]);

  const city = data.cities.find((c) => c.slug === slug) ?? data.cities[0] ?? null;
  const reading = data.aq.find((a) => a.slug === city?.slug) ?? null;
  const cat = category(reading?.aqi_us);
  const tz = city ? cityTimeZone(city.slug) : { tz: 'Asia/Jakarta', label: 'WIB' };

  const forecast = useMemo(() => calibrateForecast(
    data.forecast.filter((f) => f.slug === city?.slug),
    reading ? { pm25: reading.pm25_ugm3, aqi: reading.aqi_us } : null,
  ), [data.forecast, city?.slug, reading]);
  const best = useMemo(() => cleanestWindow(forecast, tz.tz), [forecast, tz.tz]);
  const cityWind = data.wind.find((w) => w.city_id === city?.id) ?? null;
  const smoke = useMemo(() => city ? upwindFires(city, cityWind?.wind_direction_deg ?? null, cityWind?.wind_speed_kmh ?? null, data.fires) : null,
    [city, cityWind, data.fires]);
  const nearbyFires = useMemo(() => city ? data.fires.filter((f) => distanceKm(city.latitude, city.longitude, f.latitude, f.longitude) <= 100).length : 0,
    [city, data.fires]);
  const provinceAlerts = data.alerts.filter((a) => city && a.province_ids?.includes(city.province_id));
  const minutesOld = reading ? Math.max(0, Math.round((now - new Date(reading.computed_at).getTime()) / 60_000)) : 0;

  const nearEmitters = useMemo(() => (city ? nearby(emitPts, city.latitude, city.longitude) : []), [city, emitPts]);
  // For an opened facility: the nearest city with a live air reading (within 150 km).
  const emitNearAir = useMemo(() => {
    if (!emitRow) return null;
    let best: { city: string; km: number; aqi: number } | null = null;
    for (const a of data.aq) {
      const c = data.cities.find((x) => x.slug === a.slug);
      if (!c) continue;
      const km = Math.round(distanceKm(emitRow.lat, emitRow.lon, c.latitude, c.longitude));
      if (km <= 150 && (!best || km < best.km)) best = { city: lang === 'en' ? c.name_en : c.name_id, km, aqi: a.aqi_us };
    }
    return best;
  }, [emitRow, data.aq, data.cities, lang]);
  const openReport = (id: string) => { setReportId(id); setForestId(null); closeRepeat(); closeEmitter(); setTab('map'); };
  const afterChange = () => { refresh(); auth.reloadProfile(); };
  const chooseCity = (s: string) => { setSlug(s); store.set('ep.city', s); setTab('map'); };
  const chooseLang = (l: Lang) => { setLang(l); store.set('ep.lang', l); };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const name = (c: City) => (lang === 'en' ? c.name_en : c.name_id);
  const site = typeof window === 'undefined' ? 'ecopulse' : window.location.host;

  async function shareCity() {
    if (!city || !reading || !cat) return;
    setSharing(true);
    try {
      const a = advice(cat.key, lang);
      const when = new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'id-ID', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz.tz }) + ` ${tz.label}`;
      await shareCanvas((ctx) => drawCityCard(ctx, {
        city: name(city), aqi: reading.aqi_us, catLabel: t.cats[cat.key], verdict: t.verdict[cat.key as Category], when,
        lines: [[t.exercise, a.exercise], [t.mask, a.mask], ...(reading.pm25_ugm3 != null ? [['PM2.5', `${reading.pm25_ugm3} µg/m³`] as [string, string]] : [])],
        source: 'Data: WAQI & originating EPAs · OpenAQ', site,
      }), `ecopulse-${city.slug}-${new Date().toISOString().slice(0, 10)}.png`, `${name(city)}: AQI ${reading.aqi_us} · ${site}`);
    } finally { setSharing(false); }
  }

  return (
    <div className="app" data-tab={tab}>
      <header className="topbar">
        {installed ? (
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">EcoPulse</span>
            <span className="brand-sub">Indonesia</span>
          </div>
        ) : (
          <a className="brand brand-home" href="/" title={lang === 'en' ? 'Back to home' : 'Kembali ke beranda'}>
            <svg className="home-arrow" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            <span className="sr-only">{lang === 'en' ? 'Back to home' : 'Kembali ke beranda'}</span>
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">EcoPulse</span>
            <span className="brand-sub">Indonesia</span>
          </a>
        )}
        <label className="city-select">
          <span className="sr-only">{t.city}</span>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          <select value={city?.slug ?? slug} onChange={(e) => chooseCity(e.target.value)}>
            {data.cities.map((c) => <option key={c.slug} value={c.slug}>{name(c)}</option>)}
          </select>
        </label>
        <div className="lang" role="group" aria-label="Language">
          <button aria-pressed={lang === 'en'} onClick={() => chooseLang('en')}>EN</button>
          <button aria-pressed={lang === 'id'} onClick={() => chooseLang('id')}>ID</button>
        </div>
      </header>

      <main className="layout">
        <section className="map-pane">
          <MapView aq={data.aq} stations={data.stations} fires={data.fires} repeat={repeatPts} selectedRepeat={repeatSel} onSelectRepeat={openRepeat}
            emitters={emitPts} selectedEmitterId={emitSel} onSelectEmitter={openEmitter} wind={data.wind} alerts={data.alerts} quakes={data.quakes}
            forests={data.forests} selectedForestId={forestId} onSelectForest={(id) => { setForestId(id); setReportId(null); closeRepeat(); closeEmitter(); setTab('map'); }}
            reports={data.reports} selectedReportId={reportId} onSelectReport={openReport}
            layers={layers} selected={city} onSelectCity={chooseCity} lang={lang} />
          <div className="chips" role="group" aria-label="Map layers">
            {(Object.keys(layers) as LayerKey[]).map((k) => (
              <button key={k} className="chip" aria-pressed={layers[k]} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}>
                <span className={`chip-dot dot-${k}`} aria-hidden="true" />{t.layers[k]}
              </button>
            ))}
          </div>
        </section>

        <aside className="panel">
          <div className="seg panel-tabs" role="group" aria-label="Sections">
            <button aria-pressed={tab === 'map'} onClick={() => setTab('map')}>{t.tabs.map}</button>
            <button aria-pressed={tab === 'rank'} onClick={() => setTab('rank')}>{t.tabs.rank}</button>
            <button aria-pressed={tab === 'reports'} onClick={() => setTab('reports')}>{t.tabs.reports}</button>
            <button aria-pressed={tab === 'news'} onClick={() => setTab('news')}>{t.tabs.news}</button>
          </div>
          {emitRow && emitSel === emitRow.id && (() => {
            const pr = data.rankings.find((r) => r.id === emitRow.province_id);
            return <EmitterCard e={emitRow} provinceName={pr ? (lang === 'en' ? pr.name_en : pr.name_id) : null} nearAir={emitNearAir} lang={lang} onClose={closeEmitter} />;
          })()}
          {repeatCell && repeatSel && repeatCell.cx === repeatSel.cx && repeatCell.cy === repeatSel.cy && (() => {
            const pr = data.rankings.find((r) => r.id === repeatCell.province_id);
            return <RepeatFireCard cell={repeatCell} provinceName={pr ? (lang === 'en' ? pr.name_en : pr.name_id) : null} lang={lang} onClose={closeRepeat} />;
          })()}
          {(() => {
            const fa = forestId != null ? data.forests.find((f) => f.id === forestId) : undefined;
            return fa ? <ForestAlertCard alert={fa} help={data.help} lang={lang} site={site} onClose={() => setForestId(null)} /> : null;
          })()}
          {(() => {
            const r = reportId ? data.reports.find((x) => x.id === reportId) : undefined;
            return r ? <ReportCard key={r.id} report={r} help={data.help} lang={lang} userId={auth.userId} now={now}
              onSignIn={auth.signIn} onClose={() => setReportId(null)} onVoted={afterChange} /> : null;
          })()}
          {!supabaseConfigured && <div className="notice">Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.</div>}

          <section className="card verdict panel-map" aria-live="polite">
            {!loaded ? <p className="muted">{t.loading}</p> : !reading || !cat ? (
              <p className="muted">{t.noData}</p>
            ) : (
              <>
                <div className="reading">
                  <div>
                    <div className="label">{t.aqiLabel}</div>
                    <div className="big-row">
                      <span className="big">{reading.aqi_us}</span>
                      <span className="badge" style={{ background: cat.color, color: cat.ink }}>{t.cats[cat.key]}</span>
                    </div>
                  </div>
                  {reading.pm25_ugm3 != null && <div className="pm"><span className="label">PM2.5</span><b>{reading.pm25_ugm3}</b> <span className="unit">µg/m³</span></div>}
                </div>
                <p className="verdict-text">
                  {t.verdict[cat.key as Category]}
                  {best && cat.key !== 'good' && <> {t.cleanest(hhmm(best.start, tz.tz), hhmm(best.end, tz.tz))}</>}
                </p>

                {forecast.length > 0 && (
                  <div className="strip" aria-label={t.forecast}>
                    <div className="bars">
                      {forecast.slice(0, 24).map((f) => {
                        const c = category(f.aqi_forecast)!;
                        return <div key={f.valid_at} className="bar" title={`${hhmm(new Date(f.valid_at), tz.tz)} · AQI ${f.aqi_forecast}`}
                          style={{ height: `${Math.min(100, 15 + (f.aqi_forecast / 200) * 85)}%`, background: c.color }} />;
                      })}
                    </div>
                    <div className="bar-axis mono">
                      <span>{t.now}</span>
                      <span>{forecast[8] && hhmm(new Date(forecast[8].valid_at), tz.tz)}</span>
                      <span>{forecast[16] && hhmm(new Date(forecast[16].valid_at), tz.tz)}</span>
                      <span>{forecast[23] && hhmm(new Date(forecast[23].valid_at), tz.tz)} {tz.label}</span>
                    </div>
                  </div>
                )}

                <div className="tiles">
                  <div className="tile"><span className="label">{t.exercise}</span><b>{advice(cat.key, lang).exercise}</b></div>
                  <div className="tile"><span className="label">{t.mask}</span><b>{advice(cat.key, lang).mask}</b></div>
                  <div className="tile">
                    <span className="label">{t.smoke}</span>
                    <b className={smoke && smoke.count > 0 ? 'warn' : ''}>
                      {!cityWind || (cityWind.wind_speed_kmh ?? 0) < 3 ? t.smokeCalm
                        : smoke && smoke.count > 0 ? t.smokeYes(smoke.count) : t.smokeNone}
                    </b>
                    {cityWind?.wind_direction_deg != null && (
                      <span className="mono small">{compass(cityWind.wind_direction_deg, lang)} {Math.round(cityWind.wind_speed_kmh ?? 0)} {lang === 'id' ? 'km/jam' : 'km/h'}{smoke && smoke.count > 0 && smoke.nearestKm != null ? ` · ${t.nearest(smoke.nearestKm)}` : ''}</span>
                    )}
                  </div>
                </div>

                <div className="source mono">
                  <span>{t.updated(minutesOld)} · {t.stations(reading.station_count)}</span>
                  <span>OpenAQ · WAQI</span>
                </div>
                {emitPts.length > 0 && (
                  <div className="emit-near">
                    <span className="label">{t.emitCard.nearTitle}</span>
                    {nearEmitters.length === 0 ? <p className="muted small">{t.emitCard.nearNone}</p> : (
                      <ul className="list">
                        {nearEmitters.map((x) => (
                          <li key={x.id}>
                            <button className="emit-row" onClick={() => openEmitter(x.id)}>
                              <span className="emit-dot" aria-hidden="true" />
                              <span className="emit-row-main"><b>{x.name}</b>
                                <span className="mono small muted">{kindLabel(x, lang)} · {t.emitCard.nearMeta(x.km, x.pm25_t ? tonnes(x.pm25_t, lang) : null)}</span></span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {cat.key !== 'good' && cat.key !== 'moderate' && (
                  <div className="legal-stack">
                    <LegalNote note={CLEAN_AIR} lang={lang} />
                    {city && JAKARTA_AREA.has(city.slug) && <LegalNote note={JAKARTA_CASE} lang={lang} />}
                  </div>
                )}
                <button className="btn-outline" onClick={shareCity} disabled={sharing}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></svg>
                  {sharing ? t.sharing : `${t.share} ${name(city!)}`}
                </button>
              </>
            )}
          </section>

          {loaded && city && (
            <section className="card panel-map">
              <h2 className="h2">{t.alerts}</h2>
              {provinceAlerts.length === 0 ? <p className="muted">{t.alertsNone}</p> : (
                <ul className="list">
                  {provinceAlerts.slice(0, 4).map((a) => (
                    <li key={a.id} className="alert-row"><span className="dot-alerts chip-dot" aria-hidden="true" />
                      <span>{(lang === 'id' ? a.headline_id : a.headline_en) ?? a.headline_en}</span></li>
                  ))}
                </ul>
              )}
              <p className="mono small muted">{t.fires24(nearbyFires)} · BMKG · NASA FIRMS</p>
            </section>
          )}

          {tab === 'reports' && (
            <Community lang={lang} now={now} reports={data.reports} leaders={data.leaders} userId={auth.userId} profile={auth.profile}
              authReady={auth.ready} near={city ? { lat: city.latitude, lon: city.longitude } : null}
              onSignIn={auth.signIn} onSignOut={auth.signOut} waiting={auth.waiting} onCancelWaiting={auth.cancelWaiting} onChanged={afterChange} onOpenReport={openReport} />
          )}

          {loaded && <Rankings rows={data.rankings} repeat={data.repeatProv} repeatMeta={data.repeatMeta} onShowRepeat={() => { setLayers((l) => ({ ...l, repeat: true })); setTab('map'); }} lang={lang} myProvinceId={city?.province_id ?? null} site={site} />}

          <section className="card panel-news">
            <h2 className="h2">{t.news}</h2>
            {data.news.length === 0 ? <p className="muted">{loaded ? t.newsEmpty : t.loading}</p> : (
              <ul className="news">
                {data.news.map((n) => (
                  <li key={n.id}>
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="news-item">
                      <span className="news-body">
                        <span className="news-title">{n.title}</span>
                        <span className="news-sum">{(lang === 'id' ? n.summary_id : n.summary_en) ?? n.summary_en}</span>
                        <span className="mono small muted">{n.source_name} · {new Date(n.published_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short' })}</span>
                      </span>
                      {n.image_url && <img src={n.image_url} alt="" className="thumb" loading="lazy" />}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className="credits">
            <p>{t.disclaimer} <a href="/privacy">{lang === 'en' ? 'Privacy' : 'Privasi'}</a></p>
            <p>Data: <a href="https://waqi.info" target="_blank" rel="noopener noreferrer">World Air Quality Index Project</a> &amp; originating EPAs · <a href="https://openaq.org" target="_blank" rel="noopener noreferrer">OpenAQ</a> · NASA FIRMS · <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">Open-Meteo</a> (CC BY 4.0) · BMKG · {lang === 'id' ? 'Batas provinsi' : 'Province borders'} CC BY 4.0 (denyherianto). Map © OpenStreetMap contributors · OpenFreeMap.</p>
          </footer>
        </aside>
      </main>

      <nav className="tabbar" aria-label="Sections">
        <button aria-pressed={tab === 'map'} onClick={() => setTab('map')}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.1 6.1 9.9 3.9a2 2 0 0 0-1.8 0L3.6 6.2A1 1 0 0 0 3 7v13l6-3 6 3 5.4-2.7A1 1 0 0 0 21 16.4V4l-6 3" /><path d="M9 3.9V17" /><path d="M15 7v13" /></svg>
          {t.tabs.map}
        </button>
        <button aria-pressed={tab === 'rank'} onClick={() => setTab('rank')}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 16v-4" /><path d="M12 16V8" /><path d="M17 16v-7" /></svg>
          {t.tabs.rank}
        </button>
        <button aria-pressed={tab === 'reports'} onClick={() => setTab('reports')}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><path d="M12 7v6" /><path d="M9 10h6" /></svg>
          {t.tabs.reports}
        </button>
        <button aria-pressed={tab === 'news'} onClick={() => setTab('news')}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" /></svg>
          {t.tabs.news}
        </button>
      </nav>
    </div>
  );
}
