'use client';
// The four newest stories. Phones: one card at a time, swiped. Wide screens: all four side by side.
import { useEffect, useRef, useState } from 'react';
import { L } from '@/lib/landing';
import type { Lang } from '@/lib/i18n';
import { safeUrl, storyHref, timeAgo, topicTag, type Story } from '@/lib/news';

type Props = { stories: Story[] | null; lang: Lang; now: number };

export default function NewsCarousel({ stories, lang, now }: Props) {
  const t = L[lang];
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [fits, setFits] = useState(false);   // true when every card is visible, so no arrows are needed

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const card = el.firstElementChild as HTMLElement | null;
      if (!card) return;
      setFits(el.scrollWidth <= el.clientWidth + 2);
      setAt(Math.round(el.scrollLeft / (card.offsetWidth + 16)));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [stories?.length]);

  if (stories && stories.length === 0) return null;   // nothing to show: no empty box
  const n = stories?.length ?? 4;
  const go = (dir: 1 | -1) => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (el && card) el.scrollBy({ left: dir * (card.offsetWidth + 16), behavior: 'smooth' });
  };

  return (
    <section className="lp-wrap lp-news" aria-labelledby="lp-news-title">
      <div className="lp-news-head">
        <div>
          <span className="lp-eyebrow">{t.newsEyebrow}</span>
          <h2 id="lp-news-title" className="lp-h2">{t.newsTitle}</h2>
        </div>
        {!fits && (
          <div className="lp-news-nav">
            <span className="lp-news-count" aria-live="polite">{t.newsOf(Math.min(at + 1, n), n)}</span>
            <button type="button" className="lp-news-arrow" onClick={() => go(-1)} disabled={at <= 0} aria-label={t.newsPrev}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <button type="button" className="lp-news-arrow lp-news-arrow-on" onClick={() => go(1)} disabled={at >= n - 1} aria-label={t.newsNext}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
        )}
      </div>
      <div className="lp-news-track" ref={track}>
        {stories ? stories.map((s, i) => {
          const tag = topicTag(s.topics ?? [], lang);
          const img = safeUrl(s.image_url);
          return (
            <a key={s.id} className="lp-news-card" href={storyHref(s.id)}>
              <span className="lp-news-photo">{img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}</span>
              <span className="lp-news-body">
                <span className="lp-news-tag" style={{ color: tag.color }}>{tag.label.toUpperCase()}{i === 0 ? ` · ${t.newsNewest}` : ''}</span>
                <span className="lp-news-title">{s.title}</span>
                <span className="lp-news-meta">{s.source_name} · {timeAgo(s.published_at, now, lang)}</span>
              </span>
            </a>
          );
        }) : [0, 1, 2, 3].map((i) => (
          <span key={i} className="lp-news-card lp-news-skel" aria-hidden="true">
            <span className="lp-news-photo" /><span className="lp-news-body"><span className="sk sk-s" /><span className="sk sk-l" /><span className="sk sk-m" /></span>
          </span>
        ))}
      </div>
      {!fits && <div className="lp-news-dots" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className={i === at ? 'on' : ''} />)}</div>}
    </section>
  );
}
