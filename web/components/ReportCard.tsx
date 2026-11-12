'use client';
import { useState } from 'react';
import { supabase, photoUrl, type Report, type HelpAction } from '@/lib/supabase';
import { T, type Lang } from '@/lib/i18n';
import { errorCode, getPosition, span } from '@/lib/community';

type Props = {
  report: Report; help: HelpAction[]; lang: Lang; userId: string | null; now: number;
  onSignIn: () => void; onClose: () => void; onVoted: () => void;
};

export default function ReportCard({ report: r, help, lang, userId, now, onSignIn, onClose, onVoted }: Props) {
  const t = T[lang].rep;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const kind = (t.kinds as Record<string, string>)[r.kind] ?? r.kind;
  const statusText = r.status === 'confirmed'
    ? (r.verified_by === 'satellite' ? t.bySatellite : t.byPeople(r.confirmations))
    : (t.status as Record<string, string>)[r.status] ?? r.status;
  const actions = help.filter((h) => h.issue_kinds.includes(r.kind) && (h.province_ids.length === 0 || (r.province_id != null && h.province_ids.includes(r.province_id))))
    .filter((h) => h.action_type !== 'share').sort((a, b) => a.priority - b.priority);

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

      {actions.length > 0 && (
        <div className="sub">
          <span className="h2">{T[lang].forest.help}</span>
          <ul className="help">
            {actions.map((a) => (
              <li key={a.id}>
                <a className="help-row" href={a.url ?? undefined} target="_blank" rel="noopener noreferrer">
                  <span className="help-body">
                    <span className="help-title">{lang === 'id' ? a.title_id : a.title_en}</span>
                    <span className="small muted">{[a.org_name, lang === 'id' ? a.description_id : a.description_en].filter(Boolean).join(' · ')}</span>
                    {a.whatsapp && <span className="mono small">{T[lang].forest.hotline}: {a.whatsapp}</span>}
                  </span>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mono small muted safety">{t.safety}</p>
    </section>
  );
}
