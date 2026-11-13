import { createClient } from '@supabase/supabase-js';

// Browser client. The publishable/anon key is safe in the browser: row-level security only allows
// reading public data, and signed-in people can only act through checked database functions.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export type City = { id: number; slug: string; name_en: string; name_id: string; latitude: number; longitude: number; province_id: number };
export type CityAq = { city_id: number; slug: string; pm25_ugm3: number | null; aqi_us: number; category: string; station_count: number; computed_at: string; latitude: number; longitude: number; name_en: string };
// Repeat-fire areas: cells of 0.02° (about 2.2 km) that burned in 2+ of the last 5 calendar years.
export type RepeatPoint = { cx: number; cy: number; n: number };
export type RepeatCell = { cx: number; cy: number; lon: number; lat: number; province_id: number | null; window_start: number; window_end: number;
  years: number[]; days_by_year: number[]; n_years: number; month_years: number[]; this_year_days: number; last_seen: string };
export type RepeatProvince = { id: number; slug: string; name_en: string; name_id: string; cells_3plus: number; cells_4plus: number; cells_5: number;
  km2_3plus: number; window_start: number; window_end: number };
export type RepeatMeta = { refreshed_at: string; window_start: number; window_end: number; static_cells: number; history_from: string | null };
export const parseRepeatPoints = (s: string): RepeatPoint[] => (s ? s.split(';').map((r) => { const [cx, cy, n] = r.split(',').map(Number); return { cx, cy, n }; }) : []);
export const cellCentre = (cx: number, cy: number) => ({ lon: (cx + 0.5) / 50, lat: (cy + 0.5) / 50 });

export type Hotspot = { id: number; latitude: number; longitude: number; acquired_at: string; confidence: string; frp_mw: number | null; province_id: number | null };
export type Forecast = { city_id: number; slug: string; valid_at: string; aqi_forecast: number; pm25_forecast: number | null };
export type Wind = { latitude: number; longitude: number; wind_speed_kmh: number | null; wind_direction_deg: number | null; city_id: number | null };
export type Alert = { id: number; kind: string; severity: string | null; headline_en: string | null; headline_id: string | null; province_ids: number[]; expires_at: string | null; area: unknown };
export type Quake = { id: number; occurred_at: string; magnitude: number; depth_km: number | null; latitude: number; longitude: number; region_text: string | null };
export type NewsItem = { id: number; url: string; title: string; published_at: string; summary_en: string | null; summary_id: string | null; topics: string[]; province_ids: number[]; source_name: string; image_url: string | null };
export type ForestAlert = { id: number; grid_lat: number; grid_lon: number; province_id: number | null; province_en: string | null; province_id_name: string | null;
  first_detected: string; last_detected: string; alert_count: number; area_ha: number | null; fires_within_10km: number | null; summary_en: string | null; summary_id: string | null };
export type HelpAction = { id: number; action_type: string; issue_kinds: string[]; province_ids: number[]; org_name: string | null; title_en: string; title_id: string;
  description_en: string | null; description_id: string | null; url: string | null; whatsapp: string | null; priority: number };
export type Report = { id: string; kind: string; title: string; description: string | null; photo_path: string | null;
  lat_public: number; lon_public: number; province_id: number | null; status: string; verified_by: string | null; confirmations: number;
  gone_votes: number; confirmed_at: string | null; last_confirmed_at: string | null; expires_at: string; created_at: string;
  reporter_nickname: string | null; reporter_rank: string | null };
export type MyReport = { id: string; kind: string; title: string; status: string; screening_note: string | null; confirmations: number; created_at: string };
export type MyProfile = { nickname: string; points: number; rank_key: string; reports_left_today: number; reports: MyReport[];
  recent_points: { delta: number; reason: string; created_at: string }[] };
export type Leader = { nickname: string; points: number; rank_key: string; overall_rank: number };

export const photoUrl = (path: string) => `${url}/storage/v1/object/public/report-photos/${path}`;
export type Station = { id: number; name: string; source: string; attribution: string | null; latitude: number; longitude: number;
  aqi: number; pm25: number | null; measured_at: string };
