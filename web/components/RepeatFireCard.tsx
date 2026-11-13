'use client';
import { T, type Lang } from '@/lib/i18n';
import type { RepeatCell } from '@/lib/supabase';
import { FIRE_LAW } from '@/lib/legal';
import LegalNote from './LegalNote';

type Props = { cell: RepeatCell; provinceName: string | null; lang: Lang; onClose: () => void };

const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
};

// Months that burned in the most years, in calendar order (at most 3).
export function usualMonths(monthYears: number[]): number[] {
  const top = Math.max(0, ...monthYears);
  if (top === 0) return [];
  return monthYears.map((n, i) => ({ n, i })).filter((m) => m.n === top).slice(0, 3).map((m) => m.i);
}

export default function RepeatFireCard({ cell, provinceName, lang, onClose }: Props) {
  const t = T[lang].repeatCard;
  const of = cell.window_end - cell.window_start + 1;
  const all = Array.from({ length: of }, (_, i) => cell.window_start + i);
  const daysOf = (y: number) => { const i = cell.years.indexOf(y); return i >= 0 ? cell.days_by_year[i] : 0; };
  const maxDays = Math.max(1, ...cell.days_by_year);
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const usual = usualMonths(cell.month_years).map((m) => MONTHS[lang][m]).join(', ');
  const thisYear = cell.years.includes(cell.window_end);

  return (
    <section className="card repeat panel-map" aria-label={t.title(cell.n_years, of)}>
      <div className="forest-head">
        <div>
          <div className="repeat-kicker"><span className="repeat-dot" aria-hidden="true" />{t.kicker}</div>
          <h2 className="forest-title">{t.title(cell.n_years, of)}</h2>
          <div className="mono small muted">{[provinceName, t.cell(cell.lat.toFixed(2), cell.lon.toFixed(2))].filter(Boolean).join(' · ')}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t.close}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>

      <ol className="years" aria-label={t.title(cell.n_years, of)}>
        {all.map((y) => {
          const d = daysOf(y);
          return (
            <li key={y} className={d ? 'yr on' : 'yr'}>
              <span className="yr-bar"><span style={{ height: d ? `${Math.max(14, (d / maxDays) * 100)}%` : '0%' }} /></span>
              <span className="yr-y mono">{y}</span>
              <span className="yr-d mono">{d ? t.days(d) : '–'}</span>
            </li>
          );
        })}
      </ol>

      <div className="tiles">
        {usual && <div className="tile"><span className="label">{t.usual}</span><b>{usual}</b></div>}
        <div className="tile">
          <span className="label">{t.thisYearLabel(cell.window_end)}</span>
          <b className={thisYear ? 'warn' : ''}>{thisYear ? t.thisYear(cell.this_year_days, new Date(`${cell.last_seen}T00:00:00`).toLocaleDateString(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short' })) : t.none}</b>
        </div>
      </div>
      {!thisYear && <span className="mono small muted">{t.lastSeen(fmt(cell.last_seen))}</span>}

      <div className="sub">
        <span className="h2">{t.what}</span>
        <p className="body">{t.body}</p>
      </div>

      <LegalNote note={FIRE_LAW} lang={lang} />
      <span className="mono small muted">NASA FIRMS · VIIRS S-NPP + NOAA-20</span>
    </section>
  );
}
