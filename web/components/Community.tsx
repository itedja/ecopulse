'use client';
import { useState } from 'react';
import { supabase, type Report, type Leader, type MyProfile } from '@/lib/supabase';
import { T, type Lang } from '@/lib/i18n';
import { errorCode, kmBetween, rankProgress, span } from '@/lib/community';
import ReportForm from './ReportForm';
import HelpGuide from './HelpGuide';
import { KINDS, type Kind } from '@/lib/community';

type Props = {
  lang: Lang; now: number; reports: Report[]; leaders: Leader[];
  userId: string | null; profile: MyProfile | null; authReady: boolean;
  near: { lat: number; lon: number } | null;
  onSignIn: () => void; onSignOut: () => void; onChanged: () => void; onOpenReport: (id: string) => void;
};

export default function Community({ lang, now, reports, leaders, userId, profile, authReady, near, onSignIn, onSignOut, onChanged, onOpenReport }: Props) {
  const t = T[lang].rep;
  const [writing, setWriting] = useState(false);
  const [startKind, setStartKind] = useState<Kind | null>(null);
  const [sent, setSent] = useState(false);
  const [nick, setNick] = useState<string | null>(null);
  const [nickMsg, setNickMsg] = useState<string | null>(null);
  const rankName = (k: string) => (t.ranks as Record<string, string>)[k] ?? k;
  const kindName = (k: string) => (t.kinds as Record<string, string>)[k] ?? k;
  const statusName = (s: string) => (t.status as Record<string, string>)[s] ?? s;

  const list = [...reports]
    .map((r) => ({ r, km: near ? Math.round(kmBetween(near.lat, near.lon, r.lat_public, r.lon_public)) : null }))
    .sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || b.r.created_at.localeCompare(a.r.created_at))
    .slice(0, 15);

  async function saveNick() {
    if (nick == null) return;
    setNickMsg(null);
    const { error } = await supabase.rpc('set_nickname', { p_nickname: nick });
    if (error) { setNickMsg(t.errors[errorCode(error)]); return; }
    setNick(null); onChanged();
  }

  const prog = profile ? rankProgress(profile.points) : null;

  return (
    <div className="panel-reports">
      {writing && userId ? (
        <ReportForm lang={lang} userId={userId} initialKind={startKind} onCancel={() => setWriting(false)}
          onDone={() => { setWriting(false); setSent(true); onChanged(); }} />
      ) : (
        <section className="card cta">
          <div>
            <h2 className="report-form-title">{t.ctaHead}</h2>
            <p className="rank-note">{t.ctaSub}</p>
          </div>
          {sent && <p className="form-ok" role="status">{t.sent}</p>}
          {userId ? (
            <button className="btn-ink full" onClick={() => { setSent(false); setStartKind(null); setWriting(true); }} disabled={profile?.reports_left_today === 0}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              {t.cta}
            </button>
          ) : (
            <>
              <button className="btn-ink full" onClick={onSignIn} disabled={!authReady}>
                {t.signIn}
              </button>
              <p className="small muted">{t.signInWhy}</p>
            </>
          )}
          {profile && <span className="mono small muted">{t.left(profile.reports_left_today)}</span>}
        </section>
      )}

      {!writing && (
        <HelpGuide lang={lang} onReport={(k) => {
          if (!userId) { onSignIn(); return; }
          setSent(false); setStartKind((KINDS as readonly string[]).includes(k) ? (k as Kind) : null); setWriting(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }} />
      )}

      {profile && prog && (
        <section className="card">
          <div className="rank-head">
            <h2 className="h2">{t.you}</h2>
            <button className="link-btn" onClick={onSignOut}>{t.signOut}</button>
          </div>
          <div className="me">
            <div className="me-top">
              {nick == null ? (
                <button className="me-name" onClick={() => setNick(profile.nickname)} title={t.nick}>
                  {profile.nickname}
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
              ) : (
                <div className="nick-edit">
                  <input className="input" value={nick} maxLength={24} aria-label={t.nick} onChange={(e) => setNick(e.target.value)} />
                  <button className="btn-ink" onClick={saveNick}>{t.nickSave}</button>
                </div>
              )}
              <span className="rank-chip">{rankName(prog.rank)}</span>
            </div>
            {nick != null && <span className={nickMsg ? 'form-error' : 'small muted'}>{nickMsg ?? t.nickRule}</span>}
            <div className="me-points"><b>{profile.points}</b> <span className="muted">{t.points}</span></div>
            <div className="rank-bar"><span style={{ width: `${prog.pct}%`, background: 'var(--ink)' }} /></div>
            <span className="small muted">{prog.next ? t.nextRank(prog.toNext, rankName(prog.next)) : t.topRank}</span>
          </div>

          <div className="sub">
            <span className="h2">{t.mine}</span>
            {profile.reports.length === 0 ? <p className="small muted">{t.mineEmpty}</p> : (
              <ul className="mine">
                {profile.reports.map((m) => (
                  <li key={m.id}>
                    <button className="mine-row" onClick={() => onOpenReport(m.id)} disabled={!reports.some((r) => r.id === m.id)}>
                      <span className="mine-title">{m.title}</span>
                      <span className={`status status-${m.status}`}>{statusName(m.status)}</span>
                    </button>
                    {m.status === 'rejected' && m.screening_note && <span className="small muted">{t.reason}: {m.screening_note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="h2">{t.nearby}</h2>
        {list.length === 0 ? <p className="small muted">{t.nearbyEmpty}</p> : (
          <ul className="mine">
            {list.map(({ r, km }) => (
              <li key={r.id}>
                <button className="mine-row" onClick={() => onOpenReport(r.id)}>
                  <span className="mine-body">
                    <span className="mine-title">{r.title}</span>
                    <span className="mono small muted">{kindName(r.kind)} · {t.ago(span(now - new Date(r.created_at).getTime(), lang))}{km != null ? ` · ${t.km(km)}` : ''}</span>
                  </span>
                  <span className={`status status-${r.status}`}>{statusName(r.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="h2">{t.people}</h2>
        {leaders.length === 0 ? <p className="small muted">{t.peopleEmpty}</p> : (
          <ol className="rank-list">
            {leaders.slice(0, 20).map((l) => (
              <li key={l.nickname} className={`rank-row${profile?.nickname === l.nickname ? ' mine' : ''}`}>
                <span className="rank-n mono">{l.overall_rank}</span>
                <span className="rank-body"><span className="rank-name">{l.nickname}</span><span className="small muted">{rankName(l.rank_key)}</span></span>
                <span className="rank-v"><b>{l.points}</b></span>
              </li>
            ))}
          </ol>
        )}
        <p className="small muted rank-foot">{t.howPoints}</p>
      </section>
    </div>
  );
}
