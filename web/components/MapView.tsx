'use client';
// Interactive map. MapLibre GL + free OpenFreeMap vector tiles (no API key).
import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { category } from '@/lib/aqi';
import type { CityAq, Hotspot, Wind, Alert, Quake, City } from '@/lib/supabase';

export type LayerKey = 'air' | 'fire' | 'wind' | 'alerts';

type Props = {
  aq: CityAq[];
  fires: Hotspot[];
  wind: Wind[];
  alerts: Alert[];
  quakes: Quake[];
  layers: Record<LayerKey, boolean>;
  selected: City | null;
  onSelectCity: (slug: string) => void;
  lang: 'en' | 'id';
};

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const pt = (lon: number, lat: number, properties: Record<string, unknown>): GeoJSON.Feature =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

// Arrow icon drawn on a canvas (points "up"; rotated to where the wind blows TO).
function arrowImage(): ImageData {
  const s = 32, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#475569'; g.fillStyle = '#475569'; g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(16, 27); g.lineTo(16, 8); g.stroke();
  g.beginPath(); g.moveTo(16, 4); g.lineTo(10, 12); g.lineTo(22, 12); g.closePath(); g.fill();
  return g.getImageData(0, 0, s, s);
}

const LAYER_IDS: Record<LayerKey, string[]> = {
  air: ['aq-circle', 'aq-label'],
  fire: ['fire-dot'],
  wind: ['wind-arrow'],
  alerts: ['alert-fill', 'alert-line', 'quake-ring'],
};

export default function MapView({ aq, fires, wind, alerts, quakes, layers, selected, onSelectCity, lang }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const selectRef = useRef(onSelectCity);
  selectRef.current = onSelectCity;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current, style: STYLE, center: [113, -2.5], zoom: 3.6,
      attributionControl: { compact: true }, maxBounds: [[85, -16], [150, 12]],
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.current = m;

    m.on('load', () => {
      m.addImage('arrow', arrowImage(), { pixelRatio: 2 });
      for (const id of ['aq', 'fires', 'wind', 'alerts', 'quakes']) m.addSource(id, { type: 'geojson', data: fc([]) });

      m.addLayer({ id: 'alert-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.12 } });
      m.addLayer({ id: 'alert-line', type: 'line', source: 'alerts', paint: { 'line-color': '#2563EB', 'line-width': 1, 'line-opacity': 0.6 } });
      m.addLayer({
        id: 'wind-arrow', type: 'symbol', source: 'wind',
        layout: {
          'icon-image': 'arrow', 'icon-rotate': ['get', 'to'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['get', 'speed'], 0, 0.6, 30, 1.2],
        },
        paint: { 'icon-opacity': 0.75 },
      });
      m.addLayer({
        id: 'fire-dot', type: 'circle', source: 'fires',
        paint: {
          'circle-color': '#C2410C',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 8, 5],
          'circle-opacity': ['match', ['get', 'confidence'], 'high', 0.9, 'nominal', 0.6, 0.3],
          'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 0.5,
        },
      });
      m.addLayer({
        id: 'quake-ring', type: 'circle', source: 'quakes',
        paint: {
          'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#334155', 'circle-stroke-width': 2,
          'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 4, 4, 7, 12],
        },
      });
      m.addLayer({
        id: 'aq-circle', type: 'circle', source: 'aq',
        paint: {
          'circle-color': ['get', 'color'], 'circle-radius': ['case', ['get', 'selected'], 17, 14],
          'circle-stroke-color': ['case', ['get', 'selected'], '#0E1116', '#FFFFFF'], 'circle-stroke-width': ['case', ['get', 'selected'], 3, 2],
        },
      });
      m.addLayer({
        id: 'aq-label', type: 'symbol', source: 'aq',
        layout: { 'text-field': ['to-string', ['get', 'aqi']], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': ['get', 'ink'] },
      });

      m.on('click', 'aq-circle', (e) => {
        const slug = e.features?.[0]?.properties?.slug;
        if (slug) selectRef.current(String(slug));
      });
      const popup = (layer: string, html: (p: Record<string, unknown>) => string) => {
        m.on('click', layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          new maplibregl.Popup({ closeButton: false, maxWidth: '240px' }).setLngLat(e.lngLat).setHTML(html(f.properties as Record<string, unknown>)).addTo(m);
        });
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
      };
      const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
      popup('fire-dot', (p) => `<b>${langRef.current === 'en' ? 'Fire hotspot' : 'Titik api'}</b><br>${esc(p.when)}<br>${langRef.current === 'en' ? 'Confidence' : 'Keyakinan'}: ${esc(p.confidence)}<br><span class="pop-src">NASA FIRMS</span>`);
      popup('quake-ring', (p) => `<b>M${esc(p.mag)}</b> · ${esc(p.depth)} km<br>${esc(p.region)}<br>${esc(p.when)}<br><span class="pop-src">BMKG</span>`);
      popup('alert-fill', (p) => `<b>${esc(p.headline)}</b><br><span class="pop-src">BMKG</span>`);
      m.on('mouseenter', 'aq-circle', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'aq-circle', () => (m.getCanvas().style.cursor = ''));

      ready.current = true;
      m.fire('ecopulse:ready');
    });
    return () => { m.remove(); map.current = null; ready.current = false; };
  }, []);

  // Push data into the sources whenever it changes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const when = (iso: string) => new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      (m.getSource('aq') as GeoJSONSource)?.setData(fc(aq.map((c) => {
        const cat = category(c.aqi_us)!;
        return pt(c.longitude, c.latitude, { slug: c.slug, aqi: c.aqi_us, color: cat.color, ink: cat.ink, selected: c.slug === selected?.slug });
      })));
      (m.getSource('fires') as GeoJSONSource)?.setData(fc(fires.map((f) =>
        pt(f.longitude, f.latitude, { confidence: f.confidence, when: when(f.acquired_at) }))));
      (m.getSource('wind') as GeoJSONSource)?.setData(fc(wind.filter((w) => w.wind_direction_deg != null).map((w) =>
        pt(w.longitude, w.latitude, { to: ((w.wind_direction_deg ?? 0) + 180) % 360, speed: w.wind_speed_kmh ?? 0 }))));
      (m.getSource('alerts') as GeoJSONSource)?.setData(fc(alerts.filter((a) => a.area).map((a) =>
        ({ type: 'Feature', geometry: a.area as GeoJSON.Geometry, properties: { headline: (lang === 'id' ? a.headline_id : a.headline_en) ?? a.headline_en ?? '' } }))));
      (m.getSource('quakes') as GeoJSONSource)?.setData(fc(quakes.map((q) =>
        pt(q.longitude, q.latitude, { mag: q.magnitude, depth: q.depth_km ?? '?', region: q.region_text ?? '', when: when(q.occurred_at) }))));
    };
    if (ready.current) apply(); else m.once('ecopulse:ready', apply);
  }, [aq, fires, wind, alerts, quakes, selected, lang]);

  // Layer toggles.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      (Object.keys(LAYER_IDS) as LayerKey[]).forEach((k) =>
        LAYER_IDS[k].forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', layers[k] ? 'visible' : 'none')));
    };
    if (ready.current) apply(); else m.once('ecopulse:ready', apply);
  }, [layers]);

  // Fly to the selected city.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    m.flyTo({ center: [selected.longitude, selected.latitude], zoom: 8, duration: 1200 });
  }, [selected?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="map" role="region" aria-label={lang === 'en' ? 'Map of Indonesia' : 'Peta Indonesia'} />;
}
