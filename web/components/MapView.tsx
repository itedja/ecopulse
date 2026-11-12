'use client';
// Interactive map. MapLibre GL + free OpenFreeMap vector tiles (no API key).
import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { category } from '@/lib/aqi';
import type { CityAq, Hotspot, Wind, Alert, Quake, City, ForestAlert, Report, Station } from '@/lib/supabase';

export type LayerKey = 'air' | 'fire' | 'forest' | 'reports' | 'wind' | 'alerts';

type Props = {
  aq: CityAq[];
  stations: Station[];
  fires: Hotspot[];
  wind: Wind[];
  alerts: Alert[];
  quakes: Quake[];
  forests: ForestAlert[];
  reports: Report[];
  selectedReportId: string | null;
  onSelectReport: (id: string) => void;
  onSelectForest: (id: number) => void;
  selectedForestId: number | null;
  layers: Record<LayerKey, boolean>;
  selected: City | null;
  onSelectCity: (slug: string) => void;
  lang: 'en' | 'id';
};

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const pt = (lon: number, lat: number, properties: Record<string, unknown>): GeoJSON.Feature =>
  ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

// Forest-loss square (brown = forest, per the visual rules).
function squareImage(selected: boolean): ImageData {
  const s = 28, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = selected ? '#0E1116' : '#FFFFFF'; g.fillRect(2, 2, 24, 24);
  g.fillStyle = '#8B5E34'; g.fillRect(5, 5, 18, 18);
  return g.getImageData(0, 0, s, s);
}

// Air disc (colour = AQI category). Selected city gets a thick ink ring.
function discImage(color: string, selected: boolean): ImageData {
  const s = 72, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(36, 36, selected ? 35 : 30, 0, Math.PI * 2); g.fillStyle = selected ? '#0E1116' : '#FFFFFF'; g.fill();
  g.beginPath(); g.arc(36, 36, selected ? 29 : 26, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  return g.getImageData(0, 0, s, s);
}

// Community report pin (teal = people's reports). Filled = confirmed, hollow = not confirmed yet,
// grey = may be resolved. Selected pins get an ink ring.
const REPORT = '#0F766E';
function pinImage(style: 'filled' | 'hollow' | 'grey', selected: boolean): ImageData {
  const s = 56, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.scale(1.4, 1.4);
  const color = style === 'grey' ? '#94A3B8' : REPORT;
  g.beginPath(); g.moveTo(20, 37); g.bezierCurveTo(12, 27, 7, 21, 7, 15); g.arc(20, 15, 13, Math.PI, 0); g.bezierCurveTo(33, 21, 28, 27, 20, 37); g.closePath();
  g.fillStyle = selected ? '#0E1116' : '#FFFFFF'; g.fill();
  g.beginPath(); g.moveTo(20, 33); g.bezierCurveTo(13.5, 25, 10, 20, 10, 15); g.arc(20, 15, 10, Math.PI, 0); g.bezierCurveTo(30, 20, 26.5, 25, 20, 33); g.closePath();
  g.fillStyle = color; g.fill();
  g.beginPath(); g.arc(20, 15, 4, 0, Math.PI * 2);
  g.fillStyle = '#FFFFFF'; g.fill();
  if (style === 'hollow') {           // big white centre = "not confirmed yet"
    g.beginPath(); g.arc(20, 15, 7, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(20, 15, 3, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  }
  return g.getImageData(0, 0, s, s);
}

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
  air: ['aq-circle', 'aq-selected', 'st-circle'],
  fire: ['fire-dot'],
  forest: ['forest-sq'],
  reports: ['report-pin'],
  wind: ['wind-arrow'],
  alerts: ['alert-fill', 'alert-line', 'quake-ring'],
};

export default function MapView({ aq, stations, fires, wind, alerts, quakes, forests, reports, selectedReportId, onSelectReport, onSelectForest, selectedForestId, layers, selected, onSelectCity, lang }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const selectRef = useRef(onSelectCity);
  selectRef.current = onSelectCity;
  const reportRef = useRef(onSelectReport);
  reportRef.current = onSelectReport;
  const forestRef = useRef(onSelectForest);
  forestRef.current = onSelectForest;
  const langRef = useRef(lang);
  langRef.current = lang;
  // The open map popup, so its text can switch language without closing it.
  const openPopup = useRef<{ popup: maplibregl.Popup; render: () => void } | null>(null);
  useEffect(() => { openPopup.current?.render(); }, [lang]);

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
      m.addImage('sq', squareImage(false), { pixelRatio: 2 });
      m.addImage('sq-sel', squareImage(true), { pixelRatio: 2 });
      for (const st of ['filled', 'hollow', 'grey'] as const) {
        m.addImage(`pin-${st}`, pinImage(st, false), { pixelRatio: 2 });
        m.addImage(`pin-${st}-sel`, pinImage(st, true), { pixelRatio: 2 });
      }
      for (const id of ['aq', 'stations', 'fires', 'wind', 'alerts', 'quakes', 'forest', 'reports']) m.addSource(id, { type: 'geojson', data: fc([]) });

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
        id: 'forest-sq', type: 'symbol', source: 'forest',
        layout: {
          'icon-image': ['case', ['get', 'selected'], 'sq-sel', 'sq'], 'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['get', 'ha'], 0, 0.6, 5, 0.9, 50, 1.4],
          'symbol-sort-key': ['get', 'ha'],
        },
      });
      m.addLayer({
        id: 'quake-ring', type: 'circle', source: 'quakes',
        paint: {
          'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#334155', 'circle-stroke-width': 2,
          'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 4, 4, 7, 12],
        },
      });
      // Air readings: one symbol (coloured disc + number) so overlapping cities hide each other
      // instead of printing numbers on top of each other. The selected city always wins.
      const aqLayout: maplibregl.SymbolLayerSpecification['layout'] = {
        'icon-image': ['concat', 'aq-', ['get', 'color'], ['case', ['get', 'selected'], '-sel', '']],
        'icon-padding': 1, 'text-field': ['to-string', ['get', 'aqi']], 'text-size': ['case', ['get', 'selected'], 12, 11],
        'text-font': ['Noto Sans Bold'],
      };
      m.addLayer({
        id: 'aq-circle', type: 'symbol', source: 'aq', filter: ['!', ['get', 'selected']], maxzoom: 9,
        layout: { ...aqLayout, 'icon-allow-overlap': false, 'text-allow-overlap': false, 'symbol-sort-key': ['-', 1000, ['get', 'aqi']] },
        paint: { 'text-color': ['get', 'ink'] },
      });
      // The selected city sits above and always shows; nearby cities that would cover it hide.
      m.addLayer({
        id: 'aq-selected', type: 'symbol', source: 'aq', filter: ['get', 'selected'], maxzoom: 9,
        layout: { ...aqLayout, 'icon-allow-overlap': true, 'text-allow-overlap': true },
        paint: { 'text-color': ['get', 'ink'] },
      });
      // Zoomed in: every monitoring station, like WAQI's map. Zoomed out: one disc per city.
      // Zoomed in: every monitoring station, like WAQI's map. Stations too close together hide behind the
      // worse reading until you zoom in further, so numbers never print on top of each other.
      m.addLayer({
        id: 'st-circle', type: 'symbol', source: 'stations', minzoom: 9,
        layout: {
          'icon-image': ['concat', 'aq-', ['get', 'color']], 'icon-size': 0.85, 'icon-padding': 0,
          'text-field': ['to-string', ['get', 'aqi']], 'text-size': 10, 'text-font': ['Noto Sans Bold'],
          'icon-allow-overlap': false, 'text-allow-overlap': false, 'symbol-sort-key': ['-', 1000, ['get', 'aqi']],
        },
        paint: { 'text-color': ['get', 'ink'] },
      });
      m.addLayer({
        id: 'report-pin', type: 'symbol', source: 'reports',
        layout: {
          'icon-image': ['concat', 'pin-', ['get', 'style'], ['case', ['get', 'selected'], '-sel', '']],
          'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 1, 'symbol-sort-key': ['get', 'order'],
        },
      });

      m.on('click', 'forest-sq', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) forestRef.current(Number(id));
      });
      m.on('click', 'report-pin', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) reportRef.current(String(id));
      });
      m.on('mouseenter', 'report-pin', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'report-pin', () => (m.getCanvas().style.cursor = ''));
      m.on('mouseenter', 'forest-sq', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'forest-sq', () => (m.getCanvas().style.cursor = ''));
      m.on('click', 'aq-circle', (e) => {
        const slug = e.features?.[0]?.properties?.slug;
        if (slug) selectRef.current(String(slug));
      });
      const popup = (layer: string, html: (p: Record<string, unknown>) => string) => {
        m.on('click', layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const props = f.properties as Record<string, unknown>;
          openPopup.current?.popup.remove();
          const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '240px' }).setLngLat(e.lngLat).setHTML(html(props)).addTo(m);
          openPopup.current = { popup, render: () => popup.setHTML(html(props)) };
          popup.on('close', () => { if (openPopup.current?.popup === popup) openPopup.current = null; });
        });
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
      };
      const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
      popup('st-circle', (p) => `<b>${esc(p.name) || (langRef.current === 'en' ? 'Monitoring station' : 'Stasiun pemantau')}</b><br>AQI ${esc(p.aqi)}${p.pm25 != null && p.pm25 !== '' ? ` · PM2.5 ${esc(p.pm25)} µg/m³` : ''}<br>${esc(p.when)}<br><span class="pop-src">${esc(p.src)}</span>`);
      popup('fire-dot', (p) => `<b>${langRef.current === 'en' ? 'Fire hotspot' : 'Titik api'}</b><br>${esc(p.when)}<br>${langRef.current === 'en' ? 'Confidence' : 'Keyakinan'}: ${esc(langRef.current === 'en' ? p.confidence : ({ high: 'tinggi', nominal: 'sedang', low: 'rendah' } as Record<string, string>)[String(p.confidence)] ?? p.confidence)}<br><span class="pop-src">NASA FIRMS</span>`);
      popup('quake-ring', (p) => `<b>M${esc(p.mag)}</b> · ${esc(p.depth)} km<br>${esc(p.region)}<br>${esc(p.when)}<br><span class="pop-src">BMKG</span>`);
      popup('alert-fill', (p) => `<b>${esc(p.headline)}</b><br><span class="pop-src">BMKG</span>`);
      m.on('mouseenter', 'aq-circle', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'aq-circle', () => (m.getCanvas().style.cursor = ''));

      // Make each AQI colour's disc the first time it is needed.
      m.on('styleimagemissing', (e) => {
        const mt = /^aq-(#[0-9A-Fa-f]{6})(-sel)?$/.exec(e.id);
        if (mt && !m.hasImage(e.id)) m.addImage(e.id, discImage(mt[1], Boolean(mt[2])), { pixelRatio: 2 });
      });

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
      (m.getSource('stations') as GeoJSONSource)?.setData(fc(stations.map((st) => {
        const cat = category(st.aqi)!;
        return pt(st.longitude, st.latitude, { name: st.name, aqi: st.aqi, pm25: st.pm25 ?? '', color: cat.color, ink: cat.ink, when: when(st.measured_at),
          src: [st.source === 'aqicn' ? 'WAQI' : st.source === 'openaq' ? 'OpenAQ' : st.source, st.attribution].filter(Boolean).join(' · ') });
      })));
      (m.getSource('fires') as GeoJSONSource)?.setData(fc(fires.map((f) =>
        pt(f.longitude, f.latitude, { confidence: f.confidence, when: when(f.acquired_at) }))));
      (m.getSource('wind') as GeoJSONSource)?.setData(fc(wind.filter((w) => w.wind_direction_deg != null).map((w) =>
        pt(w.longitude, w.latitude, { to: ((w.wind_direction_deg ?? 0) + 180) % 360, speed: w.wind_speed_kmh ?? 0 }))));
      (m.getSource('alerts') as GeoJSONSource)?.setData(fc(alerts.filter((a) => a.area).map((a) =>
        ({ type: 'Feature', geometry: a.area as GeoJSON.Geometry, properties: { headline: (lang === 'id' ? a.headline_id : a.headline_en) ?? a.headline_en ?? '' } }))));
      (m.getSource('forest') as GeoJSONSource)?.setData(fc(forests.map((f) =>
        pt(f.grid_lon, f.grid_lat, { id: f.id, ha: Number(f.area_ha ?? 0), selected: f.id === selectedForestId }))));
      (m.getSource('reports') as GeoJSONSource)?.setData(fc(reports.map((r) =>
        pt(r.lon_public, r.lat_public, {
          id: r.id, selected: r.id === selectedReportId,
          style: r.status === 'confirmed' ? 'filled' : r.status === 'possibly_resolved' ? 'grey' : 'hollow',
          order: r.status === 'confirmed' ? 2 : 1,
        }))));
      (m.getSource('quakes') as GeoJSONSource)?.setData(fc(quakes.map((q) =>
        pt(q.longitude, q.latitude, { mag: q.magnitude, depth: q.depth_km ?? '?', region: q.region_text ?? '', when: when(q.occurred_at) }))));
    };
    if (ready.current) apply(); else m.once('ecopulse:ready', apply);
  }, [aq, stations, fires, wind, alerts, quakes, forests, reports, selectedReportId, selectedForestId, selected, lang]);

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

  // Fly to a report picked from the list.
  useEffect(() => {
    const m = map.current;
    const r = selectedReportId ? reports.find((x) => x.id === selectedReportId) : null;
    if (!m || !r) return;
    m.flyTo({ center: [r.lon_public, r.lat_public], zoom: Math.max(m.getZoom(), 10), duration: 1000 });
  }, [selectedReportId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to the selected city.
  useEffect(() => {
    const m = map.current;
    if (!m || !selected) return;
    m.flyTo({ center: [selected.longitude, selected.latitude], zoom: 8, duration: 1200 });
  }, [selected?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="map" role="region" aria-label={lang === 'en' ? 'Map of Indonesia' : 'Peta Indonesia'} />;
}
