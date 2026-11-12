'use client';
import { useState } from 'react';
import { supabase, photoUrl, type Report, type HelpAction } from '@/lib/supabase';
import { T, type Lang } from '@/lib/i18n';
import { errorCode, getPosition, span } from '@/lib/community';
import HelpGuide from './HelpGuide';

type Props = {
  report: Report; help: HelpAction[]; lang: Lang; userId: string | null; now: number;
  onSignIn: () => void; onClose: () => void; onVoted: () => void;
};

export default function ReportCard({ report: r, lang, userId, now, onSignIn, onClose, onVoted }: Props) {
  const t = T[lang].rep;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const kind = (t.kinds as Record<string, string>)[r.kind] ?? r.kind;
  const statusText = r.status === 'confirmed'
    ? (r.verified_by === 'satellite' ? t.bySatellite : t.byPeople(r.confirmations))
    : (t.status as Record<string, string>)[r.status] ?? r.status;

  async function vote(v: 'still_here' | 'gone' | 'not_real') {
    if (!userId) { onSignIn(); return; }
    setBusy(v); setMsg(null);
    try {
      const pos = await getPosition();
      const { error } = await supabase.rpc('vote_report', { p_report: r.id, p_vote: v, p_lat: pos.lat, p_lon: pos.lon });
      if (error) throw error;
      setMsg({ ok: true, text: t.voted });
      onVoted();
    } catch (e) {
      setMsg({ ok: false, text: t.errors[errorCode(e)] });
    } finally { setBusy(null); }
  }

  return (
    <section className="card report panel-map" aria-label={r.title}>
      <div className="forest-head">
        <div>
          <div className="report-kicker"><span className="report-pin" aria-hidden="true" />{t.kicker} · {kind.toUpperCase()}</div>
          <h2 className="forest-title">{r.title}</h2>
          <span className={`status status-${r.status}`}>{statusText}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={T[lang].forest.close}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>

      {r.photo_path && <img src={photoUrl(r.photo_path)} alt="" className="report-photo" loading="lazy" />}
      {r.description && <p className="body">{r.description}</p>}

      <div className="mono small muted">
        {t.by} {r.reporter_nickname ? `${r.reporter_nickname} · ${(t.ranks as Record<string, string>)[r.reporter_rank ?? ''] ?? ''}` : t.anonymous}
        {' · '}{t.ago(span(now - new Date(r.created_at).getTime(), lang))}
        <br />{t.fades(span(new Date(r.expires_at).getTime() - now, lang))}
      </div>

      <div className="sub">
        <span className="h2">{t.voteTitle}</span>
        <div className="vote-row">
          <button className="btn-ink" disabled={!!busy} onClick={() => vote('still_here')}>{busy === 'still_here' ? '…' : t.still}</button>
          <button className="btn-outline" disabled={!!busy} onClick={() => vote('gone')}>{busy === 'gone' ? '…' : t.gone}</button>
          <button className="btn-outline" disabled={!!busy} onClick={() => vote('not_real')}>{busy === 'not_real' ? '…' : t.notReal}</button>
        </div>
        {msg ? <p className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</p> : <span className="small muted">{userId ? t.voteHint : t.signInWhy}</span>}
      </div>

      <HelpGuide lang={lang} only={r.kind} />
      <p className="mono small muted safety">{t.safety}</p>
    </section>
  );
}
