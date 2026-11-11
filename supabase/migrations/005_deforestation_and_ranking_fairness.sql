-- EcoPulse migration 005: deforestation alerts, "how you can help", fairer rankings.
-- Run once in Supabase → SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------
-- 1. Province-level forest-loss totals (rolling 7 days, refreshed daily)
-- ---------------------------------------------------------------------
create table if not exists deforestation_province_7d (
  province_id   smallint primary key references provinces(id),
  alerts_7d     integer not null default 0,     -- high + highest confidence alert pixels
  area_ha_7d    numeric(12,2),
  window_start  date not null,
  window_end    date not null,
  computed_at   timestamptz not null default now()
);
alter table deforestation_province_7d enable row level security;
drop policy if exists "public read" on deforestation_province_7d;
create policy "public read" on deforestation_province_7d for select to anon, authenticated using (true);
grant select on deforestation_province_7d to anon, authenticated;
grant all on deforestation_province_7d to service_role;

-- Simplified province outlines for querying Global Forest Watch (server only).
create or replace function province_outlines(tolerance double precision default 0.02)
returns table (id smallint, slug text, name_en text, geojson jsonb)
language sql stable
set search_path = public, extensions as $$
  select p.id, p.slug, p.name_en,
         st_asgeojson(st_multi(st_collectionextract(st_makevalid(st_simplifypreservetopology(p.geom, tolerance)), 3)), 5)::jsonb
  from provinces p where p.geom is not null order by p.id
$$;
revoke execute on function province_outlines(double precision) from public, anon, authenticated;
grant execute on function province_outlines(double precision) to service_role;

-- Cluster context: province + fires within 10 km in the last 30 days (called after each ingest).
create or replace function refresh_cluster_context()
returns integer language sql
set search_path = public, extensions as $$
  with upd as (
    update deforestation_clusters c set
      province_id = coalesce(c.province_id, province_for_point(c.geom)),
      fires_within_10km = (
        select count(*) from fire_hotspots f
        where f.acquired_at > now() - interval '30 days' and f.confidence <> 'low'
          and st_dwithin(f.geom::geography, c.geom::geography, 10000)
      )
    where c.last_detected > current_date - 90
    returning 1
  ) select count(*)::int from upd
$$;
revoke execute on function refresh_cluster_context() from public, anon, authenticated;
grant execute on function refresh_cluster_context() to service_role;

-- What the website shows: recent clusters only, biggest first.
create or replace view deforestation_alerts_public with (security_invoker = true) as
select c.id, c.grid_lat, c.grid_lon, c.province_id, p.name_en as province_en, p.name_id as province_id_name,
       c.first_detected, c.last_detected, c.alert_count, c.area_ha, c.fires_within_10km,
       c.summary_en, c.summary_id
from deforestation_clusters c
left join provinces p on p.id = c.province_id
where c.last_detected > current_date - 90;
grant select on deforestation_alerts_public to anon, authenticated;
grant all on deforestation_alerts_public to service_role;

-- ---------------------------------------------------------------------
-- 2. Fairer rankings (replaces the view from migration 004)
--    * air: MEDIAN across monitors (one faulty sensor can't dominate) + limited-data flag (< 3 monitors)
--    * each metric reports when its data starts, so the UI never claims a full week it doesn't have
--    * adds forest loss
-- ---------------------------------------------------------------------
drop view if exists province_rankings_7d;
create view province_rankings_7d with (security_invoker = true) as
with
fire_since as (select min(acquired_at) as t from fire_hotspots),
air_since  as (select min(r.measured_at) as t from aq_readings r join aq_stations s on s.id = r.station_id and s.source = 'openaq'),
fires as (
  select province_id,
         count(distinct (round(latitude, 2), round(longitude, 2), (acquired_at at time zone 'Asia/Jakarta')::date))
           filter (where acquired_at > now() - interval '7 days') as fires_7d,
         count(distinct (round(latitude, 2), round(longitude, 2), (acquired_at at time zone 'Asia/Jakarta')::date))
           filter (where acquired_at <= now() - interval '7 days') as fires_prev_7d,
         count(*) filter (where confidence = 'high' and acquired_at > now() - interval '7 days') as high_conf_7d
  from fire_hotspots
  where confidence <> 'low' and province_id is not null and acquired_at > now() - interval '14 days'
  group by province_id
),
station_avg as (
  select s.id, province_for_point(s.geom) as province_id, avg(r.pm25_ugm3) as pm25
  from aq_stations s
  join aq_readings r on r.station_id = s.id
  where s.source = 'openaq' and r.measured_at > now() - interval '7 days' and r.pm25_ugm3 is not null
  group by s.id
),
air as (
  select province_id,
         round((percentile_cont(0.5) within group (order by pm25))::numeric, 1) as pm25_7d,
         count(*)::int as stations
  from station_avg where province_id is not null
  group by province_id
)
select p.id, p.slug, p.name_en, p.name_id, p.island_group,
       coalesce(f.fires_7d, 0)::int       as fires_7d,
       coalesce(f.fires_prev_7d, 0)::int  as fires_prev_7d,
       coalesce(f.high_conf_7d, 0)::int   as high_conf_7d,
       a.pm25_7d,
       pm25_to_aqi(a.pm25_7d)             as aqi_7d,
       coalesce(a.stations, 0)            as air_stations,
       coalesce(a.stations, 0) between 1 and 2 as air_limited,
       d.alerts_7d                        as forest_alerts_7d,
       d.area_ha_7d                       as forest_ha_7d,
       (select t from fire_since)         as fires_since,
       (select t from air_since)          as air_since,
       d.window_start                     as forest_since,
       (select t from fire_since)         as data_since      -- kept for older clients
from provinces p
left join fires f on f.province_id = p.id
left join air a   on a.province_id = p.id
left join deforestation_province_7d d on d.province_id = p.id;
grant select on province_rankings_7d to anon, authenticated;
grant all on province_rankings_7d to service_role;

-- ---------------------------------------------------------------------
-- 3. "How you can help" — verified starter list (checked 12 Nov 2026).
--    Add more rows any time in Table Editor; empty province_ids = whole country.
-- ---------------------------------------------------------------------
insert into help_actions (action_type, issue_kinds, province_ids, org_name, title_en, title_id, description_en, description_id, url, whatsapp, priority, last_checked)
select * from (values
  ('report_official'::help_type, array['deforestation','illegal_logging','fire_smoke']::issue_kind[], '{}'::smallint[],
   'Kementerian Kehutanan · Gakkum',
   'Report it to the Ministry of Forestry',
   'Laporkan ke Kementerian Kehutanan',
   'Official forest-crime complaint portal (illegal logging, encroachment, illegal mining). You can track your report.',
   'Portal resmi pengaduan kejahatan kehutanan (pembalakan liar, perambahan, tambang ilegal). Laporan bisa dipantau.',
   'https://pengaduan.gakkum.kehutanan.go.id/', '+6285270149194', 10, date '2026-11-12'),
  ('volunteer'::help_type, array['deforestation','fire_smoke']::issue_kind[], array[21]::smallint[],
   'Borneo Nature Foundation',
   'Support community peat-fire fighters in Sebangau',
   'Dukung regu pemadam gambut masyarakat di Sebangau',
   'Supports village firefighting and patrol teams protecting Sebangau peat forest, Central Kalimantan.',
   'Mendukung regu pemadam dan patroli desa yang menjaga hutan gambut Sebangau, Kalimantan Tengah.',
   'https://www.borneonaturefoundation.org/', null, 20, date '2026-11-12'),
  ('donate'::help_type, array['deforestation','fire_smoke']::issue_kind[], array[21,23]::smallint[],
   'BOS Foundation',
   'Back fire patrols in orangutan forests',
   'Dukung patroli api di hutan orangutan',
   'Fire detection and response teams across conservation areas in Central and East Kalimantan.',
   'Tim deteksi dan penanganan api di kawasan konservasi Kalimantan Tengah dan Timur.',
   'https://www.orangutan.or.id/fightfires', null, 30, date '2026-11-12'),
  ('share'::help_type, array['deforestation','fire_smoke','illegal_logging']::issue_kind[], '{}'::smallint[],
   null,
   'Share this alert',
   'Bagikan peringatan ini',
   'Public attention helps. Share the satellite evidence, not accusations.',
   'Perhatian publik membantu. Bagikan bukti satelit, bukan tuduhan.',
   null, null, 90, date '2026-11-12')
) as v(action_type, issue_kinds, province_ids, org_name, title_en, title_id, description_en, description_id, url, whatsapp, priority, last_checked)
where not exists (select 1 from help_actions h where h.title_en = v.title_en);
