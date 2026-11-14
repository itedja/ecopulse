'use client';
// One news story: the publisher's headline, our own short summary, and a link to the full article.
import { useEffect, useState } from 'react';
import { L, loadStory, liveConfigured } from '@/lib/landing';
import type { Lang } from '@/lib/i18n';
import { parseStoryId, safeUrl, storyHref, summaryOf, timeAgo, topicTag, type Story } from '@/lib/news';

export default function StoryPage() {
  const [lang, setLang] = useState<Lang>('id');
  const [state, setState] = useState<{ story: Story | null; more: Story[] } | 'loading'>('loading');
  const [now] = useState(() => Date.now());
  const t = L[lang];

  useEffect(() => {
    try { const l = localStorage.getItem('ep.lang'); if (l === 'en' || l === 'id') setLang(l); } catch { /* private mode */ }
    const id = parseStoryId(window.location.search);
    if (id == null || !liveConfigured) { setState({ story: null, more: [] }); return; }
    loadStory(id).then(setState).catch(() => setState({ story: null, more: [] }));
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const story = state === 'loading' ? null : state.story;
  const more = state === 'loading' ? [] : state.more;
  const tag = story ? topicTag(story.topics ?? [], lang) : null;
  const img = safeUrl(story?.image_url);
  const link = safeUrl(story?.url);
  const when = story ? new Date(story.published_at).toLocaleString(lang === 'en' ? 'en-GB' : 'id-ID',
    { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB' : '';

  return (
    <div className="st">
      <header className="st-top">
        <a className="st-home" href="/">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          {t.storyHome}
        </a>
        <a className="st-mark" href="/">ecopulse</a>
        <span className="st-spacer" aria-hidden="true" />
      </header>
      <main className="st-main">
        {state === 'loading' ? (
          <div className="st-skel" aria-busy="true" aria-label={t.storyLoading}><span className="sk sk-s" /><span className="sk sk-xl" /><span className="sk sk-xl" /><span className="sk sk-m" /><span className="sk sk-photo" /></div>
        ) : !story ? (
          <p className="st-missing">{t.storyMissing}</p>
        ) : (
          <article>
            <span className="st-tag" style={{ color: tag!.color }}>{tag!.label.toUpperCase()}</span>
            <h1>{story.title}</h1>
            <p className="st-meta">{story.source_name} · {when}</p>
            {img && <img className="st-photo" src={img} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
            {summaryOf(story, lang) && (
              <section className="st-card">
                <span className="lp-eyebrow">{t.storyOurs}</span>
                <p>{summaryOf(story, lang)}</p>
                <span className="st-note">{t.storyNote}</span>
              </section>
            )}
            {link && <a className="lp-btn lp-btn-dark st-read" href={link} target="_blank" rel="noopener noreferrer">{t.storyRead(story.source_name)}</a>}
          </article>
        )}
        {more.length > 0 && (
          <nav className="st-more" aria-label={t.storyNext}>
            <span className="lp-eyebrow">{t.storyNext}</span>
            {more.map((s) => (
              <a key={s.id} href={storyHref(s.id)}>
                <span><b>{s.title}</b><small>{s.source_name} · {timeAgo(s.published_at, now, lang)}</small></span>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </a>
            ))}
          </nav>
        )}
      </main>
    </div>
  );
}
