-- EcoPulse migration 002: hourly PM2.5 forecast for the home-screen strip.
-- Run once in Supabase → SQL Editor. Safe to re-run.
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
