import { createClient } from '@supabase/supabase-js';

// Public, read-only client. The publishable/anon key is safe in the browser:
// row-level security only allows reading public data.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: false },
});

export type City = { id: number; slug: string; name_en: string; name_id: string; latitude: number; longitude: number; province_id: number };
export type CityAq = { city_id: number; slug: string; pm25_ugm3: number | null; aqi_us: number; category: string; station_count: number; computed_at: string; latitude: number; longitude: number; name_en: string };
export type Hotspot = { id: number; latitude: number; longitude: number; acquired_at: string; confidence: string; frp_mw: number | null; province_id: number | null };
export type Forecast = { city_id: number; slug: string; valid_at: string; aqi_forecast: number; pm25_forecast: number | null };
export type Wind = { latitude: number; longitude: number; wind_speed_kmh: number | null; wind_direction_deg: number | null; city_id: number | null };
export type Alert = { id: number; kind: string; severity: string | null; headline_en: string | null; headline_id: string | null; province_ids: number[]; expires_at: string | null; area: unknown };
export type Quake = { id: number; occurred_at: string; magnitude: number; depth_km: number | null; latitude: number; longitude: number; region_text: string | null };
export type NewsItem = { id: number; url: string; title: string; published_at: string; summary_en: string | null; summary_id: string | null; topics: string[]; province_ids: number[]; source_name: string; image_url: string | null };
