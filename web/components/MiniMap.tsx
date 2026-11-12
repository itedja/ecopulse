'use client';
// Small, non-interactive map for the landing page: today's fire hotspots and city air quality.
// The map library only loads once the map scrolls into view, to save data for phone visitors.
import { useEffect, useRef, useState } from 'react';
import { category } from '@/lib/aqi';

type Props = { fires: [number, number][]; cities: { lon: number; lat: number; aqi: number }[]; label: string };

const STYLE = 'https://tiles.openfreemap.org/styles/positron';

export default function MiniMap({ fires, cities, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<import('maplibre-gl').Map | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !box.current || map.current) return;
    let cancelled = false;
    (async () => {
      const ml = (await import('maplibre-gl')).default;
      await import('maplibre-gl/dist/maplibre-gl.css');
      if (cancelled || !box.current) return;
      const m = new ml.Map({
        container: box.current, style: STYLE, interactive: false, attributionControl: { compact: true },
        bounds: [[95, -11], [141, 6]], fitBoundsOptions: { padding: 8 },
      });
      map.current = m;
      m.on('load', () => {
        m.addSource('fires', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addSource('cities', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'fires', type: 'circle', source: 'fires',
          paint: { 'circle-radius': 2.5, 'circle-color': '#C2410C', 'circle-opacity': 0.75 } });
        m.addLayer({ id: 'cities', type: 'circle', source: 'cities',
          paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0E1116', 'circle-stroke-width': 1.5 } });
        draw();
      });
    })();
    return () => { cancelled = true; };
    // draw() reads the latest props; the map itself is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function draw() {
    const m = map.current;
    if (!m || !m.isStyleLoaded() || !m.getSource('fires')) return;
    (m.getSource('fires') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection',
      features: fires.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })) });
    (m.getSource('cities') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection',
      features: cities.map((c) => ({ type: 'Feature', properties: { color: category(c.aqi)?.color ?? '#94A3B8' }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })) });
  }
  useEffect(draw);   // redraw whenever new numbers arrive

  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);

  return <div ref={box} className="lp-minimap" role="img" aria-label={label} />;
}
