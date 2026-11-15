-- 017: say how many stations a city's PM2.5 figure comes from.
--
-- A city's AQI is the median over every station near it. Its PM2.5 concentration can only come from
-- the stations that publish a concentration (some publish an index only), so the two figures can
-- cover different stations. This column records how many stations the PM2.5 figure is based on, so
-- the card can say "PM2.5 · 3 of 8 stations".
--
-- Safe to run more than once. It adds one nullable column and re-creates one view; no data changes.

alter table city_aq_snapshots add column if not exists pm25_station_count smallint;

create or replace view city_aq_latest with (security_invoker = true) as
select distinct on (c.id)
  c.id as city_id, c.slug, c.name_en, c.name_id, c.latitude, c.longitude,
  s.pm25_ugm3, s.aqi_us, aqi_category(s.aqi_us) as category,
  s.station_count, s.computed_at,
  s.pm25_station_count
from cities c
join city_aq_snapshots s on s.city_id = c.id
where c.is_featured and s.computed_at > now() - interval '6 hours'
order by c.id, s.computed_at desc;

grant select on city_aq_latest to anon, authenticated;

-- Expected result: one row, has_column = true, and view_has_column = true.
select
  exists (select 1 from information_schema.columns
          where table_name = 'city_aq_snapshots' and column_name = 'pm25_station_count') as has_column,
  exists (select 1 from information_schema.columns
          where table_name = 'city_aq_latest' and column_name = 'pm25_station_count') as view_has_column;
