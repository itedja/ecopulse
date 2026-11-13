'use client';
import { useEffect, useRef, useState } from 'react';

// A number that counts up the first time it scrolls into view, and glides to the new value when
// the live data refreshes. Respects "reduce motion". The final text is always the real number.
export default function CountUp({ value, format, duration = 1400 }: {
  value: number | null | undefined;
  format: (n: number) => string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const from = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (value == null || !seen) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduce || start === value) { setShown(value); from.current = value; return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, seen, duration]);

  return (
    <span ref={ref} className="countup" aria-label={value == null ? undefined : format(value)}>
      <span aria-hidden="true">{value == null ? '–' : format(shown ?? 0)}</span>
    </span>
  );
}
