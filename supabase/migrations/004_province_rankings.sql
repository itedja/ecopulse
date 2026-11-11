-- EcoPulse migration 004: live province rankings (rolling 7 days).
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Fairness rules:
--   * Fires: high + nominal confidence only, and each fire counted ONCE per day even when
--     several satellites detect it (grouped on a ~1 km grid).
--   * Air: OpenAQ stations only (AQICN's terms don't allow its data in rankings).
--     Provinces without an OpenAQ monitor get NULL, never a fake "clean" score.

grant execute on function province_for_point(geometry) to anon, authenticated;

create or replace view province_rankings_7d with (security_invoker = true) as
with
since as (select min(acquired_at) as first_fire from fire_hotspots),
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
  select province_id, round(avg(pm25), 1) as pm25_7d, count(*)::int as stations
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
       (select first_fire from since)     as data_since
from provinces p
left join fires f on f.province_id = p.id
left join air a   on a.province_id = p.id;

grant select on province_rankings_7d to anon, authenticated;
grant all on province_rankings_7d to service_role;
