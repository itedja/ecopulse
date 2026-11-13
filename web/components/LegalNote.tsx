import type { Lang } from '@/lib/i18n';
import { NOT_ADVICE, type LegalNoteData } from '@/lib/legal';

// A short legal note: title and one-line lead always visible, details and sources on tap.
export default function LegalNote({ note, lang, open = false }: { note: LegalNoteData; lang: Lang; open?: boolean }) {
  const points = note.points[lang];
  return (
    <details className="legal" open={open}>
      <summary>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M5 21h14" /><path d="M3 7h18" /><path d="m6 7-3 7a3 3 0 0 0 6 0Z" /><path d="m18 7-3 7a3 3 0 0 0 6 0Z" /></svg>
        <span className="legal-title">{note.title[lang]}</span>
      </summary>
      <p className="legal-lead">{note.lead[lang]}</p>
      {points.length > 0 && (
        <ul className="legal-points">
          {points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <p className="legal-src small">
        {NOT_ADVICE[lang]}{' '}
        {note.sources.map((s, i) => (
          <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a></span>
        ))}
      </p>
    </details>
  );
}
