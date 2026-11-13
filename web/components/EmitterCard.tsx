'use client';
import { T, type Lang } from '@/lib/i18n';
import { category } from '@/lib/aqi';
import { kindLabel, millions, tonnes, type Emitter } from '@/lib/emitters';
import { EMISSION_LAW } from '@/lib/legal';
import LegalNote from './LegalNote';

type NearAir = { city: string; km: number; aqi: number } | null;
type Props = { e: Emitter; provinceName: string | null; nearAir: NearAir; lang: Lang; onClose: () => void };

export default function EmitterCard({ e, provinceName, nearAir, lang, onClose }: Props) {
  const t = T[lang].emitCard;
  const cat = nearAir ? category(nearAir.aqi) : null;
  const tiles: { label: string; value: string; rank?: number | null }[] = [];
  if (e.pm25_t) tiles.push({ label: t.pm25, value: t.tonnes(tonnes(e.pm25_t, lang)), rank: e.rank_pm25 });
  if (e.so2_t) tiles.push({ label: t.so2, value: t.tonnes(tonnes(e.so2_t, lang)) });
  if (e.nox_t) tiles.push({ label: t.nox, value: t.tonnes(tonnes(e.nox_t, lang)) });
  if (e.co2e_t) tiles.push({ label: t.co2e, value: t.mt(millions(e.co2e_t, lang)), rank: e.rank_co2e });
  const conf = e.confidence ? t.conf[e.confidence.toLowerCase()] ?? e.confidence : null;
  const cap = e.sector === 'power' && e.capacity && e.capacity_unit === 'MW' ? `${Math.round(e.capacity).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US')} ${e.capacity_unit}` : null;

  return (
    <section className="card emit panel-map" aria-label={e.name}>
      <div className="forest-head">
        <div>
          <div className="emit-kicker"><span className="emit-dot" aria-hidden="true" />{t.kicker} · {kindLabel(e, lang)}</div>
          <h2 className="forest-title">{e.name}</h2>
          <div className="mono small muted">{[provinceName, `${e.lat.toFixed(2)}, ${e.lon.toFixed(2)}`, cap && `${t.capacity} ${cap}`].filter(Boolean).join(' · ')}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t.close}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>

      {e.owners && e.owners.length > 0 && (
        <div className="emit-owners"><span className="label">{t.owners}</span><span>{e.owners.join(' · ')}</span></div>
      )}

      <div>
        <span className="label">{t.perYear(e.year)}</span>
        <div className="tiles emit-tiles">
          {tiles.map((x) => (
            <div key={x.label} className="tile">
              <span className="label">{x.label}</span>
              <b>{x.value}</b>
              {x.rank != null && x.rank <= 50 && <span className="mono small muted">{t.rank(x.rank)}</span>}
            </div>
          ))}
        </div>
      </div>

      {nearAir && cat && (
        <div className="emit-air">
          <span className="label">{t.nearAir}</span>
          <span><span className="emit-aqi" style={{ background: cat.color, color: cat.ink }}>{nearAir.aqi}</span> {t.nearAirLine(nearAir.city, nearAir.km, T[lang].cats[cat.key])}</span>
        </div>
      )}

      <div className="sub">
        <span className="h2">{t.what}</span>
        <p className="body">{t.body(e.year)}</p>
        {conf && <p className="mono small muted">{t.confidence(conf)}</p>}
      </div>

      <LegalNote note={EMISSION_LAW} lang={lang} />
      <span className="mono small muted">
        Climate TRACE (CC BY 4.0) · <a href="https://climatetrace.org/map" target="_blank" rel="noopener noreferrer">{t.view}</a>
      </span>
    </section>
  );
}
