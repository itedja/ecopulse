'use client';
import { useState } from 'react';
import type { Lang } from '@/lib/i18n';
import { HELP, ROLE_LABEL, href, helpFor, type HelpIssue } from '@/lib/help';

type Props = {
  lang: Lang;
  // Show one issue only (inside a report card) instead of the full guide with issue chips.
  only?: string;
  onReport?: (kind: string) => void;
};

const TXT = {
  en: { title: 'How you can help', sub: 'Pick a problem to see who to report it to and how to get involved.', danger: 'Someone in danger? Call', report: 'Put it on the EcoPulse map' },
  id: { title: 'Cara Anda bisa membantu', sub: 'Pilih masalahnya untuk melihat ke mana melapor dan cara ikut membantu.', danger: 'Ada orang dalam bahaya? Hubungi', report: 'Tandai di peta EcoPulse' },
};

export default function HelpGuide({ lang, only, onReport }: Props) {
  const t = TXT[lang];
  const [key, setKey] = useState(HELP[0].key);
  const issue: HelpIssue | undefined = only ? helpFor(only) : HELP.find((h) => h.key === key);

  const body = issue && (
    <ul className="guide">
      {issue.items.map((it, i) => (
        <li key={i} className="guide-item">
          <span className={`role role-${it.role}`}>{ROLE_LABEL[it.role][lang]}</span>
          <span className="guide-title">{it.title[lang]}</span>
          <span className="guide-body">{it.body[lang]}</span>
          {it.links && (
            <span className="guide-links">
              {it.links.map((l) => (
                <a key={l.value} className="guide-link" href={href(l)} target={l.kind === 'web' || l.kind === 'wa' ? '_blank' : undefined} rel="noopener noreferrer">
                  {l.label}
                </a>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  if (only) return issue ? <div className="sub"><span className="h2">{t.title}</span>{body}</div> : null;

  return (
    <section className="card guide-card" aria-label={t.title}>
      <h2 className="report-form-title">{t.title}</h2>
      <p className="rank-note">{t.sub}</p>
      <div className="danger">{t.danger} <a href="tel:112">112</a></div>
      <div className="issue-chips" role="group" aria-label={t.title}>
        {HELP.map((h) => (
          <button key={h.key} className="kind" aria-pressed={h.key === key} onClick={() => setKey(h.key)}>{h.label[lang]}</button>
        ))}
      </div>
      {body}
      {onReport && issue && (
        <button className="btn-outline" onClick={() => onReport(issue.key)}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><path d="M12 7v6" /><path d="M9 10h6" /></svg>
          {t.report}
        </button>
      )}
    </section>
  );
}
