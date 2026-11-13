'use client';
import { useState } from 'react';
import type { ForestAlert, HelpAction } from '@/lib/supabase';
import { T, type Lang } from '@/lib/i18n';
import { drawForestCard, shareCanvas } from '@/lib/shareCard';

type Props = { alert: ForestAlert; help: HelpAction[]; lang: Lang; site: string; onClose: () => void };

export default function ForestAlertCard({ alert, help, lang, site, onClose }: Props) {
  const t = T[lang];
  const [busy, setBusy] = useState(false);
  const province = (lang === 'id' ? alert.province_id_name : alert.province_en) ?? 'Indonesia';
  const fmt = (d: string) => new Date(d).toLocaleDateString(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const summary = (lang === 'id' ? alert.summary_id : alert.summary_en) || alert.summary_en;
  // When there is no AI note yet, state the same facts plainly (no AI needed for these).
  const fires = alert.fires_within_10km ?? 0;
  const facts = lang === 'id'
    ? `Terdapat ${alert.alert_count.toLocaleString('id-ID')} peringatan satelit di ${province} pada ${alert.first_detected === alert.last_detected ? fmt(alert.first_detected) : `${fmt(alert.first_detected)} – ${fmt(alert.last_detected)}`}. ${fires ? `${fires} titik api terdeteksi dalam radius 10 km dalam 30 hari terakhir.` : 'Tidak ada titik api dalam radius 10 km dalam 30 hari terakhir.'}`
    : `There ${alert.alert_count === 1 ? 'was 1 satellite alert' : `were ${alert.alert_count.toLocaleString('en-US')} satellite alerts`} in ${province} ${alert.first_detected === alert.last_detected ? `on ${fmt(alert.first_detected)}` : `between ${fmt(alert.first_detected)} and ${fmt(alert.last_detected)}`}. ${fires ? `${fires} fire hotspot${fires === 1 ? ' was' : 's were'} detected within 10 km in the last 30 days.` : 'No fire hotspots were detected within 10 km in the last 30 days.'}`;
  const dates = alert.first_detected === alert.last_detected ? fmt(alert.first_detected) : `${fmt(alert.first_detected)} – ${fmt(alert.last_detected)}`;

  const actions = help
    .filter((h) => h.issue_kinds.includes('deforestation') && (h.province_ids.length === 0 || (alert.province_id != null && h.province_ids.includes(alert.province_id))))
    .sort((a, b) => a.priority - b.priority);

  async function share() {
    setBusy(true);
    try {
      await shareCanvas((ctx) => drawForestCard(ctx, {
        title: t.forest.title(province), alerts: alert.alert_count, fires: alert.fires_within_10km ?? 0,
        dates, summary: summary ?? facts,
        labels: { alerts: t.forest.alerts, fires: t.forest.fires }, site,
      }), `ecopulse-forest-${alert.grid_lat}_${alert.grid_lon}.png`, `${t.forest.title(province)} · ${site}`);
    } finally { setBusy(false); }
  }

  return (
    <section className="card forest panel-map" aria-label={t.forest.title(province)}>
      <div className="forest-head">
        <div>
          <div className="forest-kicker"><span className="forest-sq" aria-hidden="true" />{t.forest.kicker}</div>
          <h2 className="forest-title">{t.forest.title(province)}</h2>
          <div className="mono small muted">{dates} · Global Forest Watch</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t.forest.close}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>

      <div className="tiles">
        <div className="tile"><b className="stat">{alert.alert_count}</b><span className="label">{t.forest.alerts}</span></div>
        <div className="tile"><b className={`stat ${alert.fires_within_10km ? 'warn' : ''}`}>{alert.fires_within_10km ?? 0}</b><span className="label">{t.forest.fires}</span></div>
      </div>
      <span className="small muted">{t.forest.pixel}</span>

      <div className="sub">
        <span className="h2">{t.forest.what}</span>
        <p className="body">{summary ?? facts}</p>
        {summary && <span className="mono small muted">{t.forest.aiNote}</span>}
      </div>

      <div className="sub">
        <span className="h2">{t.forest.help}</span>
        <ul className="help">
          {actions.filter((a) => a.action_type !== 'share').map((a) => (
            <li key={a.id}>
              <a className="help-row" href={a.url ?? undefined} target="_blank" rel="noopener noreferrer">
                <span className="help-body">
                  <span className="help-title">{lang === 'id' ? a.title_id : a.title_en}</span>
                  <span className="small muted">{[a.org_name, lang === 'id' ? a.description_id : a.description_en].filter(Boolean).join(' · ')}</span>
                  {a.whatsapp && <span className="mono small">{t.forest.hotline}: {a.whatsapp}</span>}
                </span>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <button className="btn-ink full" onClick={share} disabled={busy}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></svg>
        {busy ? t.sharing : t.forest.share}
      </button>
      <p className="mono small muted safety">{t.forest.safety}</p>
    </section>
  );
}
