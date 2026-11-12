'use client';
import { useMemo, useState } from 'react';
import { category } from '@/lib/aqi';
import { T, type Lang } from '@/lib/i18n';
import { drawRankingCard, shareCanvas } from '@/lib/shareCard';

export type RankingRow = {
  id: number; slug: string; name_en: string; name_id: string; island_group: string;
  fires_7d: number; fires_prev_7d: number; high_conf_7d: number;
  pm25_7d: number | null; aqi_7d: number | null; air_stations: number; air_limited: boolean;
  forest_alerts_7d: number | null; forest_ha_7d: number | null;
  fires_since: string | null; air_since: string | null; forest_since: string | null; data_since: string | null;
};
type Metric = 'fire' | 'air' | 'forest';

type Props = { rows: RankingRow[]; lang: Lang; myProvinceId: number | null; site: string };

export default function Rankings({ rows, lang, myProvinceId, site }: Props) {
  const t = T[lang];
  const [metric, setMetric] = useState<Metric>('fire');
  const [busy, setBusy] = useState(false);
  const name = (r: RankingRow) => (lang === 'en' ? r.name_en : r.name_id);

  // A full previous week exists only once data is 14+ days old; before that, no trend arrows.
  const hasTrend = useMemo(() => {
    const since = rows[0]?.fires_since ?? rows[0]?.data_since;
    return !!since && Date.now() - new Date(since).getTime() > 14 * 86400_000;
  }, [rows]);

  const fireRows = useMemo(() => rows.filter((r) => r.fires_7d > 0).sort((a, b) => b.fires_7d - a.fires_7d || a.name_en.localeCompare(b.name_en)), [rows]);
  const airRows = useMemo(() => rows.filter((r) => r.aqi_7d != null).sort((a, b) => (b.aqi_7d ?? 0) - (a.aqi_7d ?? 0)), [rows]);
  const noMonitor = rows.length - airRows.length;
  const forestRows = useMemo(() => rows.filter((r) => (r.forest_alerts_7d ?? 0) > 0).sort((a, b) => (b.forest_alerts_7d ?? 0) - (a.forest_alerts_7d ?? 0)), [rows]);
  const list = metric === 'fire' ? fireRows : metric === 'air' ? airRows : forestRows;
  const valueOf = (r: RankingRow) => (metric === 'fire' ? r.fires_7d : metric === 'air' ? r.aqi_7d ?? 0 : r.forest_alerts_7d ?? 0);
  const max = Math.max(1, ...list.map(valueOf));
  const fmtHa = (ha: number | null) => (ha == null ? '0' : ha >= 10 ? Math.round(ha).toLocaleString() : ha.toFixed(1));
  const subOf = (r: RankingRow) => metric === 'fire' ? t.rank.highConf(r.high_conf_7d)
    : metric === 'air' ? `${r.pm25_7d} µg/m³ · ${t.rank.monitors(r.air_stations)}`
    : r.forest_ha_7d != null ? t.rank.forestSub(fmtHa(r.forest_ha_7d)) : t.rank.forestCount;
  const totalFires = rows.reduce((s, r) => s + r.fires_7d, 0);

  const range = useMemo(() => {
    const f = (d: Date) => d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
    const sinceIso = metric === 'fire' ? rows[0]?.fires_since : metric === 'air' ? rows[0]?.air_since : rows[0]?.forest_since;
    const weekAgo = new Date(Date.now() - 6 * 86400_000);
    const since = sinceIso ? new Date(sinceIso) : null;
    // Forest alerts are published 1–3 weeks late, so show the real week they cover.
    if (metric === 'forest' && since) return `${f(since)} – ${f(new Date(since.getTime() + 6 * 86400_000))}`;
    if (since && since > weekAgo) return t.rank.since(f(since));
    return `${f(weekAgo)} – ${f(new Date())}`;
  }, [lang, metric, rows, t]);

  async function share() {
    setBusy(true);
    try {
      const top = list.slice(0, 5).map((r) => ({
        name: name(r), value: valueOf(r),
        sub: subOf(r) + (metric === 'air' && r.air_limited ? ` · ${t.rank.limited}` : ''),
      }));
      await shareCanvas((ctx) => drawRankingCard(ctx, {
        title: metric === 'fire' ? t.rank.cardFire : metric === 'air' ? t.rank.cardAir : t.rank.cardForest,
        subtitle: range,
        rows: top, kind: metric,
        unit: metric === 'fire' ? t.rank.unitFire : metric === 'air' ? t.rank.unitAir : t.rank.unitForest,
        source: metric === 'fire' ? 'NASA FIRMS' : metric === 'air' ? 'OpenAQ' : 'Global Forest Watch',
        site,
      }), `ecopulse-${metric}-${new Date().toISOString().slice(0, 10)}.png`,
      `${metric === 'fire' ? t.rank.cardFire : metric === 'air' ? t.rank.cardAir : t.rank.cardForest} · ${site}`);
    } finally { setBusy(false); }
  }

  return (
    <section className="card panel-rank">
      <div className="rank-head">
        <div>
          <h2 className="h2" style={{ marginBottom: 2 }}>{t.rank.title}</h2>
          <div className="mono small muted">{range.startsWith(t.rank.since('').trim().split(' ')[0]) ? range : `${range} · ${t.rank.rolling}`}</div>
        </div>
        <button className="btn-ink" onClick={share} disabled={busy || list.length === 0}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></svg>
          {busy ? '…' : t.rank.share}
        </button>
      </div>

      <div className="seg" role="group" aria-label={t.rank.title}>
        <button aria-pressed={metric === 'fire'} onClick={() => setMetric('fire')}>{t.rank.fires}</button>
        <button aria-pressed={metric === 'air'} onClick={() => setMetric('air')}>{t.rank.air}</button>
        <button aria-pressed={metric === 'forest'} onClick={() => setMetric('forest')}>{t.rank.forest}</button>
      </div>

      {metric === 'fire' && totalFires > 0 && <p className="rank-note">{t.rank.fireTotal(totalFires)}</p>}

      {list.length === 0 && <p className="muted">{metric === 'fire' ? t.rank.emptyFire : metric === 'air' ? t.rank.emptyAir : t.rank.emptyForest}</p>}

      <ol className="rank-list">
        {list.map((r, i) => {
          const v = valueOf(r);
          const color = metric === 'fire' ? 'var(--fire)' : metric === 'forest' ? 'var(--forest)' : category(v)?.color;
          const delta = r.fires_7d - r.fires_prev_7d;
          return (
            <li key={r.id} className={r.id === myProvinceId ? 'rank-row mine' : 'rank-row'}>
              <span className="rank-n mono">{i + 1}</span>
              <span className="rank-body">
                <span className="rank-name">{name(r)}{r.id === myProvinceId && <span className="you">{t.rank.yours}</span>}{metric === 'air' && r.air_limited && <span className="limited">{t.rank.limited}</span>}</span>
                <span className="rank-bar"><span style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: color }} /></span>
                <span className="mono small muted">{subOf(r)}</span>
              </span>
              <span className="rank-v">
                <b>{v}</b>
                {metric === 'fire' && hasTrend && delta !== 0 && (
                  <span className={delta > 0 ? 'up' : 'down'} aria-label={delta > 0 ? t.rank.up : t.rank.down}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mono small muted rank-foot">
        {metric === 'fire' ? t.rank.fireMethod : metric === 'air' ? t.rank.airMethod(noMonitor) : t.rank.forestMethod}
      </p>
    </section>
  );
}
