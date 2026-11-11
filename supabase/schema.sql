-- =====================================================================
-- EcoPulse Indonesia (PantauAlam) — Supabase / PostgreSQL schema  v0.2
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent where possible).
--
-- Design rules
--   * Data tables are written ONLY by the cron jobs and the app server (service_role key).
--   * The public website reads with the anon key → RLS = read-only for public data.
--   * Point geometry is GENERATED from latitude/longitude, so ingestion scripts
--     just send plain numbers (no PostGIS encoding needed in TypeScript).
--   * Retention limits keep the DB under Supabase's 500 MB free tier.
-- =====================================================================

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------
-- 0. Enum types
-- ---------------------------------------------------------------------
do $$ begin
  create type aq_source        as enum ('openaq', 'aqicn');
  create type hotspot_conf     as enum ('low', 'nominal', 'high');
  create type alert_kind       as enum ('heavy_rain', 'flood', 'strong_wind', 'high_wave',
                                        'extreme_heat', 'earthquake', 'tsunami', 'other');
  create type news_topic       as enum ('wildfires', 'air_pollution', 'forestry_carbon',
                                        'floods', 'climate', 'biodiversity', 'mining',
                                        'marine', 'policy', 'other');
  create type job_status       as enum ('running', 'success', 'partial', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 1. Reference geography
-- ---------------------------------------------------------------------
create table if not exists provinces (
  id               smallint primary key,
  slug             text unique not null,              -- 'east-kalimantan'
  name_en          text not null,
  name_id          text not null,
  island_group     text not null,                     -- Sumatra, Java, Kalimantan...
  is_carbon_focus  boolean not null default false,    -- ESG persona focus provinces
  is_haze_prone    boolean not null default false,    -- historic peat-fire provinces
  geom             geometry(MultiPolygon, 4326),      -- loaded later from boundary GeoJSON
  centroid         geometry(Point, 4326)
);
create index if not exists provinces_geom_idx on provinces using gist (geom);

create table if not exists cities (
  id           smallint generated always as identity primary key,
  slug         text unique not null,                  -- 'jakarta'
  name_en      text not null,
  name_id      text not null,
  province_id  smallint not null references provinces(id),
  latitude     double precision not null,
  longitude    double precision not null,
  geom         geometry(Point, 4326)
               generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)) stored,
  is_featured  boolean not null default true          -- shown in the city selector
);
create index if not exists cities_geom_idx on cities using gist (geom);

-- ---------------------------------------------------------------------
-- 2. Air quality
-- ---------------------------------------------------------------------
create table if not exists aq_stations (
  id                 integer generated always as identity primary key,
  source             aq_source not null,
  source_station_id  text not null,
  name               text,
  city_id            smallint references cities(id),  -- nearest featured city (≤ 30 km)
  latitude           double precision not null,
  longitude          double precision not null,
  geom               geometry(Point, 4326)
                     generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)) stored,
  attribution        text,                            -- originating agency (required by AQICN)
  last_seen_at       timestamptz,
  unique (source, source_station_id)
);
create index if not exists aq_stations_geom_idx on aq_stations using gist (geom);
create index if not exists aq_stations_city_idx on aq_stations (city_id);

-- Hourly readings. OpenAQ rows are kept as history (90 days).
-- AQICN rows: see licensing note in README — keep only the latest per station.
create table if not exists aq_readings (
  id           bigint generated always as identity primary key,
  station_id   integer not null references aq_stations(id) on delete cascade,
  measured_at  timestamptz not null,
  pm25_ugm3    numeric(6,1),                          -- concentration, µg/m³ (OpenAQ)
  aqi_us       smallint,                              -- US AQI (AQICN gives this directly)
  pm10_ugm3    numeric(6,1),
  fetched_at   timestamptz not null default now(),
  unique (station_id, measured_at)
);
create index if not exists aq_readings_time_idx on aq_readings (measured_at desc);

-- City-level averages computed by the cron job every 30 min.
create table if not exists city_aq_snapshots (
  id             bigint generated always as identity primary key,
  city_id        smallint not null references cities(id) on delete cascade,
  computed_at    timestamptz not null,
  pm25_ugm3      numeric(6,1),
  aqi_us         smallint not null,
  station_count  smallint not null,
  unique (city_id, computed_at)
);
create index if not exists city_aq_city_time_idx on city_aq_snapshots (city_id, computed_at desc);

-- ---------------------------------------------------------------------
-- 3. Fire hotspots (NASA FIRMS)
-- ---------------------------------------------------------------------
create table if not exists fire_hotspots (
  id            bigint generated always as identity primary key,
  source        text not null,                        -- 'VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT'...
  latitude      numeric(8,5) not null,
  longitude     numeric(8,5) not null,
  geom          geometry(Point, 4326)
                generated always as (st_setsrid(st_makepoint(longitude::float8, latitude::float8), 4326)) stored,
  acquired_at   timestamptz not null,                 -- acq_date + acq_time (UTC)
  brightness_k  numeric(6,2),                         -- bright_ti4
  frp_mw        numeric(8,2),                         -- fire radiative power
  confidence    hotspot_conf not null,
  daynight      char(1),
  province_id   smallint references provinces(id),    -- filled by trigger below
  created_at    timestamptz not null default now(),
  unique (source, latitude, longitude, acquired_at)   -- dedupe key for upserts
);
create index if not exists fire_geom_idx      on fire_hotspots using gist (geom);
create index if not exists fire_geog_idx      on fire_hotspots using gist ((geom::geography));
create index if not exists fire_time_idx      on fire_hotspots (acquired_at desc);
create index if not exists fire_province_idx  on fire_hotspots (province_id, acquired_at desc);

-- ---------------------------------------------------------------------
-- 4. Weather, wind, alerts, earthquakes
-- ---------------------------------------------------------------------
-- Grid points we ask Open-Meteo about: every featured city + a coarse grid over fire zones.
create table if not exists weather_points (
  id         integer generated always as identity primary key,
  kind       text not null check (kind in ('city', 'fire_zone')),
  city_id    smallint references cities(id) on delete cascade,
  latitude   double precision not null,
  longitude  double precision not null,
  geom       geometry(Point, 4326)
             generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)) stored,
  unique (latitude, longitude)
);

-- Hourly forecast, next 48 h. Overwritten each run (upsert on point + hour).
create table if not exists weather_forecasts (
  point_id            integer not null references weather_points(id) on delete cascade,
  valid_at            timestamptz not null,
  temperature_c       numeric(4,1),
  precipitation_mm    numeric(5,1),
  wind_speed_kmh      numeric(5,1),
  wind_direction_deg  smallint,                       -- direction wind comes FROM (meteorological)
  wind_gusts_kmh      numeric(5,1),
  fetched_at          timestamptz not null default now(),
  primary key (point_id, valid_at)
);

create table if not exists weather_alerts (
  id               bigint generated always as identity primary key,
  source           text not null default 'bmkg',
  source_alert_id  text not null,
  kind             alert_kind not null,
  severity         text,                              -- as given by the source
  headline_id      text,                              -- Bahasa Indonesia (BMKG native)
  headline_en      text,
  description      text,
  area             geometry(MultiPolygon, 4326),
  province_ids     smallint[] not null default '{}',
  effective_at     timestamptz,
  expires_at       timestamptz,
  raw              jsonb,
  created_at       timestamptz not null default now(),
  unique (source, source_alert_id)
);
create index if not exists weather_alerts_area_idx on weather_alerts using gist (area);
create index if not exists weather_alerts_exp_idx  on weather_alerts (expires_at desc);

create table if not exists earthquakes (
  id            bigint generated always as identity primary key,
  source        text not null default 'bmkg',
  source_id     text not null,                        -- BMKG uses DateTime as the id
  occurred_at   timestamptz not null,
  magnitude     numeric(3,1) not null,
  depth_km      numeric(5,1),
  latitude      double precision not null,
  longitude     double precision not null,
  geom          geometry(Point, 4326)
                generated always as (st_setsrid(st_makepoint(longitude, latitude), 4326)) stored,
  region_text   text,
  felt_text     text,
  tsunami_risk  boolean,
  unique (source, source_id)
);
create index if not exists earthquakes_time_idx on earthquakes (occurred_at desc);

-- ---------------------------------------------------------------------
-- 5. Deforestation (GFW) and weekly province stats
-- ---------------------------------------------------------------------
create table if not exists deforestation_weekly (
  province_id   smallint not null references provinces(id),
  week_start    date not null,                        -- Monday
  alert_system  text not null,                        -- 'integrated', 'RADD', 'GLAD-S2'
  alert_count   integer not null,
  area_ha       numeric(10,2),
  primary key (province_id, week_start, alert_system)
);

create table if not exists province_weekly_stats (
  province_id               smallint not null references provinces(id),
  week_start                date not null,
  avg_pm25_ugm3             numeric(6,1),             -- OpenAQ-derived only (see README)
  pm25_station_count        smallint,
  hotspot_count             integer not null default 0,
  high_conf_hotspot_count   integer not null default 0,
  deforestation_alerts      integer,
  computed_at               timestamptz not null default now(),
  primary key (province_id, week_start)
);

-- ---------------------------------------------------------------------
-- 6. News
-- ---------------------------------------------------------------------
create table if not exists news_sources (
  id               smallint generated always as identity primary key,
  name             text not null,
  feed_url         text unique not null,
  homepage_url     text,
  language         char(2) not null check (language in ('en', 'id')),
  is_active        boolean not null default true,
  last_fetched_at  timestamptz
);

-- We store title + link + OUR OWN summary, never the article body (copyright).
create table if not exists news_articles (
  id             bigint generated always as identity primary key,
  source_id      smallint not null references news_sources(id),
  url            text unique not null,
  title          text not null,
  published_at   timestamptz not null,
  language       char(2) not null,
  image_url      text,
  is_relevant    boolean,                             -- null = not yet classified
  summary_en     text,
  summary_id     text,
  topics         news_topic[] not null default '{}',
  province_ids   smallint[] not null default '{}',
  llm_model      text,
  created_at     timestamptz not null default now()
);
create index if not exists news_pub_idx       on news_articles (published_at desc) where is_relevant;
create index if not exists news_provinces_idx on news_articles using gin (province_ids);
create index if not exists news_topics_idx    on news_articles using gin (topics);

-- ---------------------------------------------------------------------
-- 7. Ops: one row per cron run, so you can see failures without logging in to GitHub
-- ---------------------------------------------------------------------
create table if not exists ingestion_runs (
  id             bigint generated always as identity primary key,
  job            text not null,                       -- 'firms', 'air_quality', 'weather', 'news'...
  status         job_status not null default 'running',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_upserted  integer,
  error          text
);
create index if not exists ingestion_runs_job_idx on ingestion_runs (job, started_at desc);

-- =====================================================================
-- FUNCTIONS
-- =====================================================================

-- PM2.5 µg/m³ → US AQI, using the EPA breakpoints revised in 2024.
create or replace function pm25_to_aqi(c numeric)
returns smallint language sql immutable as $$
  with t(c_lo, c_hi, i_lo, i_hi) as (values
    (0.0,    9.0,    0,  50),
    (9.1,   35.4,   51, 100),
    (35.5,  55.4,  101, 150),
    (55.5, 125.4,  151, 200),
    (125.5, 225.4, 201, 300),
    (225.5, 325.4, 301, 500))
  select case
    when c is null or c < 0 then null
    when c > 325.4 then 500
    else (select round(((i_hi - i_lo) / (c_hi - c_lo)) * (trunc(c, 1) - c_lo) + i_lo)::smallint
          from t where trunc(c, 1) between c_lo and c_hi)
  end
$$;

-- AQI → category key used by the "Can I Go Outside?" card (UI translates the key).
create or replace function aqi_category(aqi integer)
returns text language sql immutable as $$
  select case
    when aqi is null  then null
    when aqi <= 50    then 'good'
    when aqi <= 100   then 'moderate'
    when aqi <= 150   then 'sensitive'
    when aqi <= 200   then 'unhealthy'
    when aqi <= 300   then 'very_unhealthy'
    else 'hazardous'
  end
$$;

-- Assign a province to each new hotspot (no-op until province boundaries are loaded).
create or replace function set_hotspot_province()
returns trigger language plpgsql
set search_path = public, extensions as $$
begin
  if new.province_id is null then
    select p.id into new.province_id
    from provinces p
    where p.geom is not null and st_intersects(p.geom, new.geom)
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_hotspot_province on fire_hotspots;
create trigger trg_hotspot_province
  before insert on fire_hotspots
  for each row execute function set_hotspot_province();

-- RPC for the app and alert bot: hotspots within X km of a point.
-- Call from JS: supabase.rpc('fires_near', { lat, lon, radius_km: 25, since_hours: 24 })
create or replace function fires_near(
  lat double precision, lon double precision,
  radius_km double precision default 25, since_hours integer default 24
)
returns table (id bigint, latitude numeric, longitude numeric, acquired_at timestamptz,
               confidence hotspot_conf, frp_mw numeric, distance_km double precision)
language sql stable
set search_path = public, extensions as $$
  select f.id, f.latitude, f.longitude, f.acquired_at, f.confidence, f.frp_mw,
         st_distance(f.geom::geography, st_makepoint(lon, lat)::geography) / 1000
  from fire_hotspots f
  where f.acquired_at > now() - make_interval(hours => since_hours)
    and st_dwithin(f.geom::geography, st_makepoint(lon, lat)::geography, radius_km * 1000)
  order by 7
$$;

-- Weekly rollup, called by the weekly cron (and safe to re-run for any week).
create or replace function refresh_province_weekly_stats(p_week_start date)
returns void language sql
set search_path = public, extensions as $$
  insert into province_weekly_stats as s
    (province_id, week_start, avg_pm25_ugm3, pm25_station_count,
     hotspot_count, high_conf_hotspot_count, deforestation_alerts, computed_at)
  select p.id, p_week_start,
         aq.avg_pm25, aq.n_stations,
         coalesce(fh.n, 0), coalesce(fh.n_high, 0),
         df.n, now()
  from provinces p
  left join lateral (
    select round(avg(r.pm25_ugm3), 1) avg_pm25, count(distinct r.station_id)::smallint n_stations
    from aq_readings r
    join aq_stations st on st.id = r.station_id and st.source = 'openaq'
    join cities c on c.id = st.city_id and c.province_id = p.id
    where r.measured_at >= p_week_start and r.measured_at < p_week_start + 7
      and r.pm25_ugm3 is not null
  ) aq on true
  left join lateral (
    select count(*) n, count(*) filter (where confidence = 'high') n_high
    from fire_hotspots
    where province_id = p.id
      and acquired_at >= p_week_start and acquired_at < p_week_start + 7
  ) fh on true
  left join lateral (
    select sum(alert_count)::int n from deforestation_weekly
    where province_id = p.id and week_start = p_week_start and alert_system = 'integrated'
  ) df on true
  on conflict (province_id, week_start) do update set
    avg_pm25_ugm3 = excluded.avg_pm25_ugm3,
    pm25_station_count = excluded.pm25_station_count,
    hotspot_count = excluded.hotspot_count,
    high_conf_hotspot_count = excluded.high_conf_hotspot_count,
    deforestation_alerts = excluded.deforestation_alerts,
    computed_at = now();
$$;

-- Retention: keeps the free-tier DB small. Called by a daily cron.
create or replace function purge_old_data()
returns void language sql as $$
  delete from aq_readings        where measured_at < now() - interval '90 days';
  delete from city_aq_snapshots  where computed_at < now() - interval '30 days';
  delete from weather_forecasts  where valid_at    < now() - interval '1 day';
  delete from fire_hotspots      where acquired_at < now() - interval '400 days';
  delete from weather_alerts     where expires_at  < now() - interval '30 days';
  delete from earthquakes        where occurred_at < now() - interval '180 days';
  delete from ingestion_runs     where started_at  < now() - interval '30 days';
  delete from news_articles      where published_at < now() - interval '365 days';
$$;

-- =====================================================================
-- VIEWS the frontend reads (security_invoker = respects RLS)
-- =====================================================================

-- Latest AQ for each featured city → "Can I Go Outside?" card + map markers.
create or replace view city_aq_latest with (security_invoker = true) as
select distinct on (c.id)
  c.id as city_id, c.slug, c.name_en, c.name_id, c.latitude, c.longitude,
  s.pm25_ugm3, s.aqi_us, aqi_category(s.aqi_us) as category,
  s.station_count, s.computed_at
from cities c
join city_aq_snapshots s on s.city_id = c.id
where c.is_featured and s.computed_at > now() - interval '6 hours'
order by c.id, s.computed_at desc;

-- Hotspots from the last 48 h for the map layer.
create or replace view hotspots_recent with (security_invoker = true) as
select id, latitude, longitude, acquired_at, confidence, brightness_k, frp_mw, province_id
from fire_hotspots
where acquired_at > now() - interval '48 hours';

-- Ranked leaderboard for the most recent completed week.
create or replace view province_leaderboard with (security_invoker = true) as
with wk as (select max(week_start) as w from province_weekly_stats)
select p.id, p.slug, p.name_en, p.name_id, p.island_group, s.week_start,
       s.avg_pm25_ugm3, s.pm25_station_count, s.hotspot_count,
       s.high_conf_hotspot_count, s.deforestation_alerts,
       rank() over (order by s.avg_pm25_ugm3 desc nulls last)        as rank_pm25_worst,
       rank() over (order by s.hotspot_count desc)                   as rank_hotspots,
       rank() over (order by s.deforestation_alerts desc nulls last) as rank_deforestation
from province_weekly_stats s
join provinces p on p.id = s.province_id
join wk on s.week_start = wk.w;

-- Relevant news only.
create or replace view news_feed with (security_invoker = true) as
select a.id, a.url, a.title, a.published_at, a.language, a.image_url,
       a.summary_en, a.summary_id, a.topics, a.province_ids,
       s.name as source_name
from news_articles a
join news_sources s on s.id = a.source_id
where a.is_relevant is true;

-- =====================================================================
-- ROW LEVEL SECURITY: public read, no public writes
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'provinces','cities','aq_stations','aq_readings','city_aq_snapshots',
    'fire_hotspots','weather_points','weather_forecasts','weather_alerts',
    'earthquakes','deforestation_weekly','province_weekly_stats',
    'news_sources','news_articles'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

-- Ops table: RLS on, no policy → only the service_role (cron jobs) can see it.
alter table ingestion_runs enable row level security;

grant select on city_aq_latest, hotspots_recent, province_leaderboard, news_feed
  to anon, authenticated;
grant execute on function fires_near(double precision, double precision, double precision, integer)
  to anon, authenticated;

-- =====================================================================
-- SEED DATA
-- =====================================================================

-- All 38 provinces (incl. the four Papua provinces created in 2022).
insert into provinces (id, slug, name_en, name_id, island_group, is_carbon_focus, is_haze_prone) values
  ( 1,'aceh','Aceh','Aceh','Sumatra', true, false),
  ( 2,'north-sumatra','North Sumatra','Sumatera Utara','Sumatra', false, false),
  ( 3,'west-sumatra','West Sumatra','Sumatera Barat','Sumatra', false, false),
  ( 4,'riau','Riau','Riau','Sumatra', true, true),
  ( 5,'jambi','Jambi','Jambi','Sumatra', false, true),
  ( 6,'south-sumatra','South Sumatra','Sumatera Selatan','Sumatra', false, true),
  ( 7,'bengkulu','Bengkulu','Bengkulu','Sumatra', false, false),
  ( 8,'lampung','Lampung','Lampung','Sumatra', false, false),
  ( 9,'bangka-belitung','Bangka Belitung Islands','Kepulauan Bangka Belitung','Sumatra', false, false),
  (10,'riau-islands','Riau Islands','Kepulauan Riau','Sumatra', false, false),
  (11,'jakarta','Jakarta','Daerah Khusus Jakarta','Java', false, false),
  (12,'west-java','West Java','Jawa Barat','Java', false, false),
  (13,'central-java','Central Java','Jawa Tengah','Java', false, false),
  (14,'yogyakarta','Yogyakarta Special Region','Daerah Istimewa Yogyakarta','Java', false, false),
  (15,'east-java','East Java','Jawa Timur','Java', false, false),
  (16,'banten','Banten','Banten','Java', false, false),
  (17,'bali','Bali','Bali','Bali & Nusa Tenggara', false, false),
  (18,'west-nusa-tenggara','West Nusa Tenggara','Nusa Tenggara Barat','Bali & Nusa Tenggara', false, false),
  (19,'east-nusa-tenggara','East Nusa Tenggara','Nusa Tenggara Timur','Bali & Nusa Tenggara', false, false),
  (20,'west-kalimantan','West Kalimantan','Kalimantan Barat','Kalimantan', false, true),
  (21,'central-kalimantan','Central Kalimantan','Kalimantan Tengah','Kalimantan', true, true),
  (22,'south-kalimantan','South Kalimantan','Kalimantan Selatan','Kalimantan', false, true),
  (23,'east-kalimantan','East Kalimantan','Kalimantan Timur','Kalimantan', true, true),
  (24,'north-kalimantan','North Kalimantan','Kalimantan Utara','Kalimantan', false, false),
  (25,'north-sulawesi','North Sulawesi','Sulawesi Utara','Sulawesi', false, false),
  (26,'central-sulawesi','Central Sulawesi','Sulawesi Tengah','Sulawesi', false, false),
  (27,'south-sulawesi','South Sulawesi','Sulawesi Selatan','Sulawesi', false, false),
  (28,'southeast-sulawesi','Southeast Sulawesi','Sulawesi Tenggara','Sulawesi', false, false),
  (29,'gorontalo','Gorontalo','Gorontalo','Sulawesi', false, false),
  (30,'west-sulawesi','West Sulawesi','Sulawesi Barat','Sulawesi', false, false),
  (31,'maluku','Maluku','Maluku','Maluku', false, false),
  (32,'north-maluku','North Maluku','Maluku Utara','Maluku', false, false),
  (33,'papua','Papua','Papua','Papua', false, false),
  (34,'west-papua','West Papua','Papua Barat','Papua', false, false),
  (35,'south-papua','South Papua','Papua Selatan','Papua', false, false),
  (36,'central-papua','Central Papua','Papua Tengah','Papua', false, false),
  (37,'highland-papua','Highland Papua','Papua Pegunungan','Papua', false, false),
  (38,'southwest-papua','Southwest Papua','Papua Barat Daya','Papua', false, false)
on conflict (id) do nothing;

-- Featured cities for the city selector (approximate city-centre coordinates).
insert into cities (slug, name_en, name_id, province_id, latitude, longitude) values
  ('jakarta',       'Jakarta',       'Jakarta',       11, -6.2088, 106.8456),
  ('surabaya',      'Surabaya',      'Surabaya',      15, -7.2575, 112.7521),
  ('bandung',       'Bandung',       'Bandung',       12, -6.9175, 107.6191),
  ('semarang',      'Semarang',      'Semarang',      13, -6.9667, 110.4167),
  ('yogyakarta',    'Yogyakarta',    'Yogyakarta',    14, -7.7956, 110.3695),
  ('tangerang',     'Tangerang',     'Tangerang',     16, -6.1783, 106.6319),
  ('medan',         'Medan',         'Medan',          2,  3.5952,  98.6722),
  ('pekanbaru',     'Pekanbaru',     'Pekanbaru',      4,  0.5071, 101.4478),
  ('jambi',         'Jambi',         'Jambi',          5, -1.6101, 103.6131),
  ('palembang',     'Palembang',     'Palembang',      6, -2.9761, 104.7754),
  ('pontianak',     'Pontianak',     'Pontianak',     20, -0.0263, 109.3425),
  ('palangka-raya', 'Palangka Raya', 'Palangka Raya', 21, -2.2161, 113.9135),
  ('banjarmasin',   'Banjarmasin',   'Banjarmasin',   22, -3.3186, 114.5944),
  ('samarinda',     'Samarinda',     'Samarinda',     23, -0.5022, 117.1536),
  ('balikpapan',    'Balikpapan',    'Balikpapan',    23, -1.2379, 116.8529),
  ('denpasar',      'Denpasar (Bali)','Denpasar (Bali)',17, -8.6705, 115.2126),
  ('makassar',      'Makassar',      'Makassar',      27, -5.1477, 119.4327),
  ('jayapura',      'Jayapura',      'Jayapura',      33, -2.5337, 140.7181)
on conflict (slug) do nothing;

-- One weather point per featured city (fire-zone grid points are added by the weather job).
insert into weather_points (kind, city_id, latitude, longitude)
select 'city', id, latitude, longitude from cities
on conflict (latitude, longitude) do nothing;

-- Starter RSS sources (feed URLs get verified in Step 2 before the news job goes live).
insert into news_sources (name, feed_url, homepage_url, language) values
  ('Mongabay Indonesia', 'https://www.mongabay.co.id/feed/', 'https://www.mongabay.co.id', 'id'),
  ('Mongabay (Indonesia, EN)', 'https://news.mongabay.com/list/indonesia/feed/', 'https://news.mongabay.com', 'en'),
  ('Antara News (EN)', 'https://en.antaranews.com/rss/news.xml', 'https://en.antaranews.com', 'en')
on conflict (feed_url) do nothing;

-- =====================================================================
-- PART 2 — DEFORESTATION CLUSTERS, "HOW TO HELP", COMMUNITY REPORTS
-- Users can only READ public data, edit their own nickname and follows.
-- Creating reports and votes goes through the app's server code
-- (service_role), which checks GPS, rate limits and screening first.
-- =====================================================================

do $$ begin
  create type issue_kind      as enum ('deforestation', 'fire_smoke', 'air_pollution', 'flooding',
                                       'river_pollution', 'trash_dumping', 'illegal_logging',
                                       'wildlife', 'other');
  create type help_type       as enum ('report_official', 'donate', 'volunteer', 'share', 'learn');
  create type report_status   as enum ('pending', 'unverified', 'confirmed', 'possibly_resolved',
                                       'resolved', 'expired', 'rejected');
  create type vote_kind       as enum ('still_here', 'gone', 'not_real');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 8. Deforestation clusters (map points + "what's happening" card)
--    Grouped on a ~1 km grid; locations are never more precise than that.
-- ---------------------------------------------------------------------
create table if not exists deforestation_clusters (
  id                 bigint generated always as identity primary key,
  grid_lat           numeric(6,2) not null,             -- rounded to 0.01° (~1.1 km)
  grid_lon           numeric(6,2) not null,
  geom               geometry(Point, 4326)
                     generated always as (st_setsrid(st_makepoint(grid_lon::float8, grid_lat::float8), 4326)) stored,
  province_id        smallint references provinces(id),
  first_detected     date not null,
  last_detected      date not null,
  alert_count        integer not null default 0,
  area_ha            numeric(10,2),
  on_peatland        boolean,
  in_protected_area  boolean,
  fires_within_10km  integer,
  summary_en         text,                               -- written by the weekly job
  summary_id         text,
  llm_model          text,
  updated_at         timestamptz not null default now(),
  unique (grid_lat, grid_lon)
);
create index if not exists defo_clusters_geom_idx on deforestation_clusters using gist (geom);
create index if not exists defo_clusters_recent_idx on deforestation_clusters (last_detected desc);

-- ---------------------------------------------------------------------
-- 9. "How you can help" — filled in ONCE, matched to alerts automatically
--    empty province_ids = applies everywhere in Indonesia
-- ---------------------------------------------------------------------
create table if not exists help_actions (
  id              smallint generated always as identity primary key,
  action_type     help_type not null,
  issue_kinds     issue_kind[] not null,
  province_ids    smallint[] not null default '{}',
  org_name        text,
  title_en        text not null,
  title_id        text not null,
  description_en  text,
  description_id  text,
  url             text,
  whatsapp        text,
  priority        smallint not null default 50,           -- lower = shown first
  is_active       boolean not null default true,
  last_checked    date                                    -- a yearly job flags dead links
);
create index if not exists help_actions_issue_idx on help_actions using gin (issue_kinds);

-- ---------------------------------------------------------------------
-- 10. Community: profiles, trust, reports, votes, points, follows
-- ---------------------------------------------------------------------
create or replace function rank_for_points(p integer)
returns text language sql immutable as $$
  select case
    when p >= 2000 then 'pahlawan_hutan'   -- Forest Hero
    when p >= 500  then 'pelindung'        -- Protector
    when p >= 100  then 'penjaga'          -- Guardian
    else 'pengamat'                        -- Observer
  end
$$;

-- Public part of a user. Points are only changed by the server.
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nickname      text unique not null check (nickname ~ '^[A-Za-z0-9_.]{3,24}$'),
  points        integer not null default 0,
  rank_key      text generated always as (rank_for_points(points)) stored,
  home_city_id  smallint references cities(id),
  created_at    timestamptz not null default now()
);

-- Private part: never readable by anyone except the server.
create table if not exists user_trust (
  user_id             uuid primary key references profiles(id) on delete cascade,
  trust_score         numeric(4,2) not null default 1.00,   -- 0.00–5.00, new users start at 1
  phone_verified      boolean not null default false,
  reports_confirmed   integer not null default 0,
  reports_rejected    integer not null default 0,
  reports_today       smallint not null default 0,
  reports_today_date  date
);

-- Create both rows automatically when someone signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into profiles (id, nickname)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 8));
  insert into user_trust (user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Public report. Coordinates here are ALWAYS rounded to ~1 km.
create table if not exists reports (
  id                 uuid primary key default gen_random_uuid(),
  reporter_id        uuid references profiles(id) on delete set null,
  is_anonymous       boolean not null default false,
  kind               issue_kind not null,
  title              text not null check (char_length(title) <= 120),
  description        text check (char_length(description) <= 1000),
  photo_path         text,                                  -- Supabase Storage, location data stripped
  photo_taken_at     timestamptz,
  lat_public         numeric(6,2) not null,
  lon_public         numeric(6,2) not null,
  geom               geometry(Point, 4326)
                     generated always as (st_setsrid(st_makepoint(lon_public::float8, lat_public::float8), 4326)) stored,
  province_id        smallint references provinces(id),
  status             report_status not null default 'pending',
  verified_by        text check (verified_by in ('satellite', 'community', 'partner')),
  confirmations      smallint not null default 0,
  gone_votes         smallint not null default 0,
  confirmed_at       timestamptz,
  last_confirmed_at  timestamptz,
  expires_at         timestamptz not null,
  screening_note     text,                                  -- why the AI check rejected it
  created_at         timestamptz not null default now()
);
create index if not exists reports_geom_idx   on reports using gist (geom);
create index if not exists reports_status_idx on reports (status, expires_at);

-- Exact location + device evidence. Server-only; used for checks, never shown.
create table if not exists report_private (
  report_id           uuid primary key references reports(id) on delete cascade,
  exact_lat           double precision not null,
  exact_lon           double precision not null,
  device_lat          double precision not null,
  device_lon          double precision not null,
  device_accuracy_m   real,
  photo_hash          text                                  -- catches the same photo posted twice
);
create index if not exists report_private_hash_idx on report_private (photo_hash);

create table if not exists report_votes (
  id           bigint generated always as identity primary key,
  report_id    uuid not null references reports(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  vote         vote_kind not null,
  weight       numeric(4,2) not null default 1.00,          -- from voter's trust score
  distance_km  numeric(5,2),                                -- voter's distance at vote time
  vote_day     date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (report_id, user_id, vote_day)                     -- one vote per person per day
);

-- Every point change is recorded, so points can be reversed if a report turns out fake.
create table if not exists points_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  delta       integer not null,
  reason      text not null,          -- 'report_confirmed', 'vote', 'share', 'reversal'...
  report_id   uuid references reports(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists points_user_idx on points_ledger (user_id, created_at desc);

create or replace function apply_points()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  update profiles set points = greatest(0, points + new.delta) where id = new.user_id;
  return new;
end $$;

drop trigger if exists trg_apply_points on points_ledger;
create trigger trg_apply_points
  after insert on points_ledger
  for each row execute function apply_points();

create table if not exists follows (
  user_id      uuid not null references profiles(id) on delete cascade,
  target_type  text not null check (target_type in ('deforestation_cluster', 'report', 'city', 'province')),
  target_id    text not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

-- Daily job: reports fade out unless someone re-confirms them.
create or replace function expire_reports()
returns integer language sql as $$
  with x as (
    update reports set status = 'expired'
    where status in ('unverified', 'confirmed', 'possibly_resolved') and expires_at < now()
    returning 1
  ) select count(*)::int from x
$$;

-- How long each kind of report stays up without re-confirmation.
create or replace function report_lifetime(k issue_kind)
returns interval language sql immutable as $$
  select case k
    when 'fire_smoke'      then interval '1 day'
    when 'air_pollution'   then interval '1 day'
    when 'flooding'        then interval '3 days'
    when 'trash_dumping'   then interval '30 days'
    when 'river_pollution' then interval '30 days'
    when 'deforestation'   then interval '90 days'
    when 'illegal_logging' then interval '90 days'
    else interval '14 days'
  end
$$;

-- Public views ---------------------------------------------------------
create or replace view reports_public with (security_invoker = true) as
select r.id, r.kind, r.title, r.description, r.photo_path, r.photo_taken_at,
       r.lat_public, r.lon_public, r.province_id, r.status, r.verified_by,
       r.confirmations, r.confirmed_at, r.last_confirmed_at, r.expires_at, r.created_at,
       case when r.is_anonymous then null else p.nickname end as reporter_nickname,
       case when r.is_anonymous then null else p.rank_key end as reporter_rank
from reports r
left join profiles p on p.id = r.reporter_id
where r.status in ('unverified', 'confirmed', 'possibly_resolved');

create or replace view leaderboard_users with (security_invoker = true) as
select p.nickname, p.points, p.rank_key, c.province_id,
       rank() over (order by p.points desc) as overall_rank
from profiles p
left join cities c on c.id = p.home_city_id
where p.points > 0;

-- RLS for part 2 -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['deforestation_clusters', 'help_actions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

-- profiles: anyone can see nickname/points/rank; you can edit only your own nickname + home city.
alter table profiles enable row level security;
drop policy if exists "public read" on profiles;
create policy "public read" on profiles for select to anon, authenticated using (true);
drop policy if exists "edit own" on profiles;
create policy "edit own" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
grant select on profiles to anon, authenticated;
revoke update on profiles from anon, authenticated;
grant update (nickname, home_city_id) on profiles to authenticated;

-- reports: the public sees only reports_public (no reporter id when anonymous).
alter table reports enable row level security;
drop policy if exists "public read visible" on reports;
create policy "public read visible" on reports for select to anon, authenticated
  using (status in ('unverified', 'confirmed', 'possibly_resolved'));
revoke select on reports from anon, authenticated;
grant select (id, kind, title, description, photo_path, photo_taken_at, lat_public, lon_public,
              province_id, status, verified_by, confirmations, confirmed_at, last_confirmed_at,
              expires_at, created_at, reporter_id, is_anonymous)
  on reports to anon, authenticated;

-- follows: you see and manage only your own.
alter table follows enable row level security;
drop policy if exists "own follows" on follows;
create policy "own follows" on follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on follows to authenticated;

-- Server-only tables: RLS on, no policies → invisible to the public.
alter table user_trust     enable row level security;
alter table report_private enable row level security;
alter table report_votes   enable row level security;
alter table points_ledger  enable row level security;

grant select on reports_public, leaderboard_users to anon, authenticated;

-- =====================================================================
-- PART 3 — PERMISSIONS (works with "Automatically expose new tables" OFF)
-- =====================================================================
-- The server key (service_role) used by cron jobs and the app server can do everything.
grant usage on schema public, extensions to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Maintenance and internal functions: server only. Nobody else may call them.
revoke execute on function purge_old_data()                     from public, anon, authenticated;
revoke execute on function refresh_province_weekly_stats(date)  from public, anon, authenticated;
revoke execute on function expire_reports()                     from public, anon, authenticated;
revoke execute on function handle_new_user()                    from public, anon, authenticated;
revoke execute on function apply_points()                       from public, anon, authenticated;
revoke execute on function set_hotspot_province()               from public, anon, authenticated;

-- Small helper functions the public views use.
grant execute on function pm25_to_aqi(numeric), aqi_category(integer),
                          rank_for_points(integer), report_lifetime(issue_kind)
  to anon, authenticated;

-- =====================================================================
-- PART 4 — (migration 002) hourly PM2.5 forecast
-- =====================================================================
alter table weather_forecasts add column if not exists pm25_forecast numeric(6,1);
alter table weather_forecasts add column if not exists aqi_forecast  smallint;

-- Next 24 hours of AQI forecast per featured city, for the app.
create or replace view city_aq_forecast with (security_invoker = true) as
select c.id as city_id, c.slug, f.valid_at, f.pm25_forecast, f.aqi_forecast,
       aqi_category(f.aqi_forecast) as category
from weather_forecasts f
join weather_points p on p.id = f.point_id and p.kind = 'city'
join cities c on c.id = p.city_id
where f.valid_at >= date_trunc('hour', now())
  and f.valid_at <  date_trunc('hour', now()) + interval '24 hours'
  and f.aqi_forecast is not null;

grant select on city_aq_forecast to anon, authenticated;
grant all on city_aq_forecast to service_role;
