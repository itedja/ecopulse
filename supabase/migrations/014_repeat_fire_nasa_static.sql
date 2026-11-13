-- 014: Leave out volcanoes, smelters, refineries and gas flares using NASA's own labels.
-- NASA's quality-checked VIIRS archive gives every detection a "type": 0 = presumed vegetation
-- fire, 1 = active volcano, 2 = other fixed land heat source, 3 = offshore. The archive load
-- (ingest/fire-history.ts) now records, per ~2 km cell, how many detections NASA put in types 1-3.
-- Those places are then excluded in every year, including recent months that only have
-- near-real-time data (which carries no type).
-- Also: the map is rebuilt automatically, within 10 minutes, after new history is loaded.

create table if not exists fire_static_cells (
  cx         integer not null,
  cy         integer not null,
  volcano    integer not null default 0,   -- detections NASA labelled "active volcano"
  other      integer not null default 0,   -- detections NASA labelled "other static source" or "offshore"
  updated_at timestamptz not null default now(),
  primary key (cx, cy)
);
alter table fire_static_cells enable row level security;   -- no public policy: internal only
grant all on fire_static_cells to service_role;

alter table repeat_fire_meta add column if not exists nasa_flagged_cells integer;
alter table repeat_fire_meta add column if not exists dirty_at timestamptz;

-- Called by the archive load. Counts come from one full pass over the archive, so a re-run keeps
-- the larger count rather than adding them up twice.
create or replace function merge_fire_static_cells(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into fire_static_cells (cx, cy, volcano, other)
  select (r->>'cx')::int, (r->>'cy')::int, (r->>'volcano')::int, (r->>'other')::int
  from jsonb_array_elements(p_rows) r
  on conflict (cx, cy) do update
    set volcano = greatest(fire_static_cells.volcano, excluded.volcano),
        other   = greatest(fire_static_cells.other, excluded.other),
        updated_at = now();
  get diagnostics n = row_count;
  update repeat_fire_meta set dirty_at = now() where id = 1;
  return n;
end $$;
revoke execute on function merge_fire_static_cells(jsonb) from public, anon, authenticated;
grant execute on function merge_fire_static_cells(jsonb) to service_role;

-- History loads also mark the map as needing a rebuild.
create or replace function mark_repeat_fire_dirty()
returns void language sql security definer set search_path = public as $$
  update repeat_fire_meta set dirty_at = now() where id = 1;
$$;
revoke execute on function mark_repeat_fire_dirty() from public, anon, authenticated;
grant execute on function mark_repeat_fire_dirty() to service_role;

create or replace function refresh_repeat_fire()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  y1 int := extract(year from (now() at time zone 'Asia/Jakarta'))::int;
  y0 int := y1 - 4;
  n_static int;
  n int;
begin
  -- 1. Latest live detections (S-NPP + NOAA-20, not low confidence) into the yearly bit sets.
  insert into fire_cell_years (cx, cy, yr, days, months, frp_max)
  select cx, cy, yr,
         bit_or(('1' || repeat('0', 365))::bit(366) >> (doy - 1)),
         bit_or(1 << (mon - 1)),
         max(frp)
  from (
    select floor(longitude * 50)::int as cx, floor(latitude * 50)::int as cy,
           extract(year  from (acquired_at at time zone 'Asia/Jakarta'))::smallint as yr,
           extract(doy   from (acquired_at at time zone 'Asia/Jakarta'))::int      as doy,
           extract(month from (acquired_at at time zone 'Asia/Jakarta'))::int      as mon,
           frp_mw::real as frp
    from fire_hotspots
    where acquired_at > now() - interval '5 days'
      and confidence <> 'low'
      and source in ('VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT')
  ) h
  group by cx, cy, yr
  on conflict (cx, cy, yr) do update
    set days    = fire_cell_years.days | excluded.days,
        months  = fire_cell_years.months | excluded.months,
        frp_max = greatest(fire_cell_years.frp_max, excluded.frp_max);

  -- Keep six years (one spare so the window can roll over on 1 January).
  delete from fire_cell_years where yr < y0 - 1;

  -- 2. Places that are hot for reasons other than burning land, excluded in every year:
  --    a) NASA's own label: in its quality-checked archive NASA marks detections at volcanoes and at
  --       other fixed heat sources (smelters, refineries, gas flares). Any cell NASA labelled twice or
  --       more is excluded, together with the 8 cells around it, because the satellite pixel
  --       (375 m) at a cell edge often spills into the neighbouring cell.
  --    b) All-year heat: hot on 60+ days, or in 7+ different months, in 3+ separate years.
  drop table if exists _static;
  create temporary table _static on commit drop as
  select distinct s.cx + dx as cx, s.cy + dy as cy
  from fire_static_cells s, generate_series(-1, 1) dx, generate_series(-1, 1) dy
  where s.volcano + s.other >= 2
  union
  select cx, cy
  from fire_cell_years
  where yr between y0 and y1
  group by cx, cy
  having count(*) filter (where bit_count(days) >= 60 or bit_count(months::bit(12)) >= 7) >= 3;
  -- Reported number: places with fire in 2+ years that were left out for these reasons.
  select count(*) into n_static from (
    select f.cx, f.cy from fire_cell_years f join _static s using (cx, cy)
    where f.yr between y0 and y1 group by f.cx, f.cy having count(*) >= 2) x;

  -- 3. Rebuild the public table.
  truncate repeat_fire_cells;
  insert into repeat_fire_cells (cx, cy, lon, lat, province_id, window_start, window_end, years, days_by_year,
                                 n_years, month_years, this_year_days, last_seen)
  select a.cx, a.cy, a.lon, a.lat, p.id, y0, y1, a.years, a.days_by_year, a.n_years, a.month_years,
         a.this_year_days, a.last_seen
  from (
    select f.cx, f.cy,
           ((f.cx + 0.5) / 50.0)::real as lon,
           ((f.cy + 0.5) / 50.0)::real as lat,
           array_agg(f.yr order by f.yr) as years,
           array_agg(bit_count(f.days)::smallint order by f.yr) as days_by_year,
           count(*)::smallint as n_years,
           array[
             count(*) filter (where f.months & 1 <> 0)::smallint,
             count(*) filter (where f.months & 2 <> 0)::smallint,
             count(*) filter (where f.months & 4 <> 0)::smallint,
             count(*) filter (where f.months & 8 <> 0)::smallint,
             count(*) filter (where f.months & 16 <> 0)::smallint,
             count(*) filter (where f.months & 32 <> 0)::smallint,
             count(*) filter (where f.months & 64 <> 0)::smallint,
             count(*) filter (where f.months & 128 <> 0)::smallint,
             count(*) filter (where f.months & 256 <> 0)::smallint,
             count(*) filter (where f.months & 512 <> 0)::smallint,
             count(*) filter (where f.months & 1024 <> 0)::smallint,
             count(*) filter (where f.months & 2048 <> 0)::smallint
           ] as month_years,
           coalesce(max(bit_count(f.days)) filter (where f.yr = y1), 0)::smallint as this_year_days,
           max(make_date(f.yr, 1, 1) + length(rtrim(f.days::text, '0')) - 1) as last_seen
    from fire_cell_years f
    where f.yr between y0 and y1
      and not exists (select 1 from _static s where s.cx = f.cx and s.cy = f.cy)
    group by f.cx, f.cy
    having count(*) >= 2
  ) a
  join provinces p on p.geom is not null
                  and st_intersects(p.geom, st_setsrid(st_makepoint(a.lon::float8, a.lat::float8), 4326));
  get diagnostics n = row_count;

  insert into repeat_fire_meta (id, refreshed_at, window_start, window_end, static_cells, history_from)
  values (1, now(), y0, y1, n_static, (select make_date(min(yr), 1, 1) from fire_cell_years))
  on conflict (id) do update set refreshed_at = excluded.refreshed_at, window_start = excluded.window_start,
    window_end = excluded.window_end, static_cells = excluded.static_cells, history_from = excluded.history_from,
    nasa_flagged_cells = (select count(*) from fire_static_cells where volcano + other >= 2);
  return n;
end $$;
grant execute on function public.refresh_repeat_fire() to service_role;

-- Rebuild only when something new arrived since the last rebuild.
create or replace function refresh_repeat_fire_if_dirty()
returns integer language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from repeat_fire_meta where id = 1 and dirty_at is not null
             and (refreshed_at is null or dirty_at > refreshed_at)) then
    return refresh_repeat_fire();
  end if;
  return null;
end $$;
revoke execute on function refresh_repeat_fire_if_dirty() from public, anon, authenticated;

select cron.schedule('ecopulse-repeat-fire-after-load', '*/10 * * * *', $$select public.refresh_repeat_fire_if_dirty()$$);
