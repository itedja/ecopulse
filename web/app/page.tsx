'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured, type City, type CityAq, type Hotspot, type Forecast, type Wind, type Alert, type Quake, type NewsItem, type ForestAlert, type HelpAction } from '@/lib/supabase';
import { T, type Lang, cityTimeZone, hhmm } from '@/lib/i18n';
import { category, advice, cleanestWindow, calibrateForecast, type Category } from '@/lib/aqi';
import { upwindFires, distanceKm, compass } from '@/lib/smoke';
import type { LayerKey } from '@/components/MapView';
import Rankings, { type RankingRow } from '@/components/Rankings';
import ForestAlertCard from '@/components/ForestAlertCard';
import { drawCityCard, shareCanvas } from '@/lib/shareCard';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false, loading: () => <div className="map map-loading" /> });

const REFRESH_MS = 5 * 60_000;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

type Data = {
  cities: City[]; aq: CityAq[]; fires: Hotspot[]; forecast: Forecast[];
  wind: Wind[]; alerts: Alert[]; quakes: Quake[]; news: NewsItem[]; rankings: RankingRow[]; forests: ForestAlert[]; help: HelpAction[];
};
const EMPTY: Data = { cities: [], aq: [], fires: [], forecast: [], wind: [], alerts: [], quakes: [], news: [], rankings: [], forests: [], help: [] };

async function loadAll(): Promise<Data> {
  const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
  const now = new Date().toISOString();
  const [cities, aq, fires, forecast, wind, alerts, quakes, news, rankings, forests, help] = await Promise.all([
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
    supabase.from('deforestation_alerts_public').select('*').order('area_ha', { ascending: false }).limit(1500),
    supabase.from('help_actions').select('*').eq('is_active', true).order('priority'),
  ]);
  type WRow = { wind_speed_kmh: number | null; wind_direction_deg: number | null; weather_points: { latitude: number; longitude: number; city_id: number | null } | null };
  return {
    cities: (cities.data ?? []) as City[],
    aq: (aq.data ?? []) as CityAq[],
    fires: (fires.data ?? []) as Hotspot[],
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
  };
}

export default function Home() {
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [slug, setSlug] = useState('jakarta');
  const [tab, setTab] = useState<'map' | 'rank' | 'news'>('map');
  const [sharing, setSharing] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ air: true, fire: true, forest: true, wind: true, alerts: true });
  const [forestId, setForestId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const t = T[lang];

  useEffect(() => {
    const l = store.get('ep.lang'); if (l === 'en' || l === 'id') setLang(l);
    const c = store.get('ep.city'); if (c) setSlug(c);
  }, []);

  const refresh = useCallback(async () => {
    if (!supabaseConfigured) { setLoaded(true); return; }
    try { setData(await loadAll()); } finally { setLoaded(true); setNow(Date.now()); }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
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

  const chooseCity = (s: string) => { setSlug(s); store.set('ep.city', s); setTab('map'); };
  const chooseLang = (l: Lang) => { setLang(l); store.set('ep.lang', l); };
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
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">EcoPulse</span>
          <span className="brand-sub">Indonesia</span>
        </div>
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
          <MapView aq={data.aq} fires={data.fires} wind={data.wind} alerts={data.alerts} quakes={data.quakes}
            forests={data.forests} selectedForestId={forestId} onSelectForest={(id) => { setForestId(id); setTab('map'); }}
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
            <button aria-pressed={tab === 'news'} onClick={() => setTab('news')}>{t.tabs.news}</button>
          </div>
          {(() => {
            const fa = forestId != null ? data.forests.find((f) => f.id === forestId) : undefined;
            return fa ? <ForestAlertCard alert={fa} help={data.help} lang={lang} site={site} onClose={() => setForestId(null)} /> : null;
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
                      <span className="mono small">{compass(cityWind.wind_direction_deg, lang)} {Math.round(cityWind.wind_speed_kmh ?? 0)} km/h{smoke && smoke.count > 0 && smoke.nearestKm != null ? ` · ${t.nearest(smoke.nearestKm)}` : ''}</span>
                    )}
                  </div>
                </div>

                <div className="source mono">
                  <span>{t.updated(minutesOld)} · {t.stations(reading.station_count)}</span>
                  <span>OpenAQ · WAQI</span>
                </div>
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

          {loaded && <Rankings rows={data.rankings} lang={lang} myProvinceId={city?.province_id ?? null} site={site} />}

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
            <p>{t.disclaimer}</p>
            <p>Data: <a href="https://waqi.info" target="_blank" rel="noopener noreferrer">World Air Quality Index Project</a> &amp; originating EPAs · <a href="https://openaq.org" target="_blank" rel="noopener noreferrer">OpenAQ</a> · NASA FIRMS · <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">Open-Meteo</a> (CC BY 4.0) · BMKG · Province borders CC BY 4.0 (denyherianto). Map © OpenStreetMap contributors · OpenFreeMap.</p>
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
        <button aria-pressed={tab === 'news'} onClick={() => setTab('news')}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8" /><path d="M15 18h-5" /><path d="M10 6h8v4h-8V6Z" /></svg>
          {t.tabs.news}
        </button>
      </nav>
    </div>
  );
}
