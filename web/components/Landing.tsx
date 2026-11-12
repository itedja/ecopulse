'use client';
import { useCallback, useEffect, useState } from 'react';
import { L, loadLive, liveConfigured, type Live, type Place } from '@/lib/landing';
import { T, type Lang } from '@/lib/i18n';
import { category } from '@/lib/aqi';
import { drawTodayCard, shareCanvas } from '@/lib/shareCard';
import HelpGuide from '@/components/HelpGuide';
import MiniMap from '@/components/MiniMap';

const REFRESH_MS = 2 * 60_000;
const CONTACT = 'ecopulseindonesia@gmail.com';

type BeforeInstall = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type Device = { os: 'ios' | 'android' | 'other'; inApp: string | null; standalone: boolean };

function detect(): Device {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other';
  const inApp = /Instagram/i.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'Facebook'
    : /TikTok|musical_ly|BytedanceWebview/i.test(ua) ? 'TikTok' : /\bLine\//i.test(ua) ? 'LINE' : null;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { os, inApp, standalone };
}

// Android in-app browsers can hand the page to Chrome with an intent link.
const chromeIntent = () => `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;

export default function Landing() {
  const [lang, setLang] = useState<Lang>('id');
  const [live, setLive] = useState<Live | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dev, setDev] = useState<Device>({ os: 'other', inApp: null, standalone: false });
  const [installEvt, setInstallEvt] = useState<BeforeInstall | null>(null);
  const [installed, setInstalled] = useState(false);
  const [sharing, setSharing] = useState(false);
  const t = L[lang];

  useEffect(() => {
    try { const l = localStorage.getItem('ep.lang'); if (l === 'en' || l === 'id') setLang(l); } catch { /* private mode */ }
    setDev(detect());
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstall); };
    const onInstalled = () => { setInstalled(true); setInstallEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const chooseLang = (l: Lang) => { setLang(l); try { localStorage.setItem('ep.lang', l); } catch { /* private mode */ } };

  const refresh = useCallback(async () => {
    if (!liveConfigured) return;
    try { setLive(await loadLive()); } catch { /* keep the last numbers */ } finally { setNow(Date.now()); }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onShow = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(id); clearInterval(tick); document.removeEventListener('visibilitychange', onShow); };
  }, [refresh]);

  const fmt = (n: number) => n.toLocaleString(lang === 'id' ? 'id-ID' : 'en-US');
  const place = (p: Place | null | undefined) => (p ? p[lang] : '–');
  const mins = live?.updatedAt ? Math.max(0, Math.round((now - new Date(live.updatedAt).getTime()) / 60_000)) : null;
  const airCat = category(live?.worstAir?.aqi);
  const num = (v: number | undefined) => (live ? fmt(v ?? 0) : '–');

  async function install() {
    if (!installEvt) return;
    await installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setInstallEvt(null);
  }

  async function shareToday() {
    if (!live) return;
    setSharing(true);
    try {
      const site = location.host;
      const when = new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'id-ID', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
      const rows = [
        live.worstAir && { label: t.worstAir, place: live.worstAir[lang], value: `AQI ${live.worstAir.aqi} · ${airCat ? T[lang].cats[airCat.key] : ''}`, color: airCat?.color === '#E8B10A' ? '#A16207' : '#D93A2B' },
        live.mostFires && { label: t.mostFires, place: live.mostFires[lang], value: t.nFires(fmt(live.mostFires.n)), color: '#C2410C' },
        live.mostForest && { label: t.mostForest, place: live.mostForest[lang], value: t.nAlerts(fmt(live.mostForest.n)), color: '#8B5E34' },
      ].filter(Boolean) as { label: string; place: string; value: string; color: string }[];
      await shareCanvas((ctx) => drawTodayCard(ctx, { title: t.worstTitle, when, rows, source: t.sources, site }),
        `ecopulse-${new Date().toISOString().slice(0, 10)}.png`, `${t.worstTitle} · ${site}`);
    } finally { setSharing(false); }
  }

  const ios = dev.os === 'ios';
  const steps = dev.inApp && ios ? t.iosStepsInApp : t.iosSteps;

  return (
    <div className="lp">
      {dev.inApp && !dev.standalone && (
        <div className="lp-banner" role="note">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
          <div>
            <b>{t.banner(dev.inApp)}</b>
            <span>{dev.os === 'android' ? t.bannerAndroid : t.bannerIos}</span>
            {dev.os === 'android' && <a className="lp-banner-btn" href={chromeIntent()}>{t.bannerBtn}</a>}
          </div>
        </div>
      )}

      <header className="lp-top">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true" /><span className="brand-name">EcoPulse</span><span className="brand-sub">Indonesia</span></a>
        <nav className="lp-nav"><a href="/app">{t.nav.map}</a></nav>
        <div className="lang" role="group" aria-label="Language">
          <button aria-pressed={lang === 'en'} onClick={() => chooseLang('en')}>EN</button>
          <button aria-pressed={lang === 'id'} onClick={() => chooseLang('id')}>ID</button>
        </div>
        <a className="lp-btn lp-btn-dark lp-top-cta" href="#get">{t.nav.get}</a>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-text">
          <span className="lp-live mono"><span className="lp-pulse" aria-hidden="true" />{t.live}{mins != null && ` · ${t.updated(mins)}`}</span>
          <h1>{t.h1}</h1>
          <p className="lp-lede">{t.lede}</p>
          <div className="lp-ctas">
            <a className="lp-btn lp-btn-dark" href="#get">{t.ctaApp}</a>
            <a className="lp-btn lp-btn-line" href="/app">{t.ctaMap}</a>
          </div>
        </div>
        <a className="lp-map-link" href="/app" aria-label={t.ctaMap}>
          <MiniMap fires={live?.firePoints ?? []} cities={live?.cityPoints ?? []} label={t.mapHint} />
          <span className="lp-map-hint">{t.mapHint}</span>
          <span className="lp-legend mono"><i className="lg-fire" />{t.legendFire}<i className="lg-air" />{t.legendAir}</span>
        </a>
      </section>

      <section className="lp-wrap">
        <h2 className="lp-eyebrow">{t.nowTitle}</h2>
        <div className="lp-stats">
          <div className="lp-stat"><b style={{ color: '#C2410C' }}>{num(live?.fires7d)}</b><span>{t.fires}</span></div>
          <div className="lp-stat"><b>{live?.worstAir ? live.worstAir.aqi : '–'}</b>
            <span>{t.air(place(live?.worstAir))}{airCat && <> · <em style={{ color: airCat.key === 'good' ? '#1E7A45' : airCat.key === 'moderate' ? '#8A6A00' : '#B42318' }}>{T[lang].cats[airCat.key]}</em></>}</span></div>
          <div className="lp-stat"><b style={{ color: '#8B5E34' }}>{num(live?.forestAlerts)}</b><span>{t.forest}</span></div>
          <div className="lp-stat"><b style={{ color: '#0F766E' }}>{num(live?.reports)}</b><span>{t.reports}</span></div>
        </div>
        <p className="lp-src mono">{t.sources}</p>
      </section>

      <section className="lp-wrap">
        <div className="lp-worst">
          <h2>{t.worstTitle}</h2>
          <div className="lp-worst-rows">
            <div style={{ borderColor: '#D93A2B' }}><span>{t.worstAir}</span><b>{place(live?.worstAir)}{live?.worstAir && ` · ${live.worstAir.aqi}`}</b></div>
            <div style={{ borderColor: '#C2410C' }}><span>{t.mostFires}</span><b>{place(live?.mostFires)}</b>{live?.mostFires && <small>{t.nFires(fmt(live.mostFires.n))}</small>}</div>
            <div style={{ borderColor: '#8B5E34' }}><span>{t.mostForest}</span><b>{place(live?.mostForest)}</b>{live?.mostForest && <small>{t.nAlerts(fmt(live.mostForest.n))}</small>}</div>
          </div>
          <button className="lp-btn lp-btn-line" onClick={shareToday} disabled={!live || sharing}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></svg>
            {sharing ? t.sharing : t.share}
          </button>
        </div>
      </section>

      <section className="lp-band">
        <div className="lp-wrap">
          <h2 className="lp-eyebrow">{t.featTitle}</h2>
          <div className="lp-feats">
            {t.feats.map(([h, p], i) => (
              <div key={h} className="lp-feat"><span className={`lp-ico lp-ico-${i}`} aria-hidden="true" /><b>{h}</b><p>{p}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-wrap">
        <h2 className="lp-h2">{t.ranksTitle}</h2>
        <p className="lp-sub">{t.ranksSub}</p>
        <ol className="lp-ranks">
          {t.ranks.map(([name, pts], i) => <li key={name}><span className="mono">{i + 1}</span><b>{name}</b><small>{t.pts(fmt(pts))}</small></li>)}
        </ol>
      </section>

      <section className="lp-wrap lp-help">
        <HelpGuide lang={lang} onReport={() => { location.href = '/app?tab=reports'; }} />
      </section>

      <section id="get" className="lp-wrap">
        <div className="lp-get">
          <h2>{t.getTitle}</h2>
          <p>{t.getSub}</p>
          <div className="lp-get-cols">
            {(dev.os !== 'ios') && (
              <div className="lp-get-col">
                <span className="lp-get-label">{t.android}</span>
                {dev.standalone || installed ? <a className="lp-btn lp-btn-light" href="/app">{t.installed}</a>
                  : installEvt ? <button className="lp-btn lp-btn-light" onClick={install}>{t.install}</button>
                  : dev.os === 'android' && dev.inApp ? <a className="lp-btn lp-btn-light" href={chromeIntent()}>{t.openChrome}</a>
                  : <p className="lp-get-note">{t.androidManual}</p>}
                <span className="lp-get-soon mono">{t.playSoon}</span>
              </div>
            )}
            {(dev.os !== 'android') && (
              <div className="lp-get-col">
                <span className="lp-get-label">{t.iphone}</span>
                <ol className="lp-steps">{steps.map((s, i) => <li key={i}><span>{i + 1}</span>{s}</li>)}</ol>
              </div>
            )}
          </div>
          {dev.os === 'other' && <p className="lp-get-note">{t.desktopNote}</p>}
        </div>
      </section>

      <footer className="lp-foot">
        <p>{t.footer} · <a href="/privacy">{t.privacy}</a> · <a href={`mailto:${CONTACT}`}>{t.contact}</a></p>
        <p>{t.disclaimer}</p>
        <p>Data: <a href="https://waqi.info" target="_blank" rel="noopener noreferrer">World Air Quality Index Project</a> &amp; originating EPAs · <a href="https://openaq.org" target="_blank" rel="noopener noreferrer">OpenAQ</a> · NASA FIRMS · Global Forest Watch · <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">Open-Meteo</a> (CC BY 4.0) · BMKG. Map © OpenStreetMap contributors · OpenFreeMap.</p>
      </footer>
    </div>
  );
}
