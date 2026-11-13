-- 010: Repeat-fire areas ("Terbakar berulang")
--
-- Indonesia is split into cells of 0.02° (about 2.2 km). For every cell and year we keep which
-- days had a satellite fire detection, as a 366-bit set (bit 1 = 1 January, local Jakarta date).
-- This is small (one row per cell-year with any fire) and can be merged safely: two sources for
-- the same day just OR their bits, so re-running the archive load never double counts.
--
-- What counts: NASA FIRMS VIIRS detections from S-NPP and NOAA-20 only (both fly for the whole
-- window, so years compare fairly), low-confidence detections excluded. The archive loader also
-- drops anything NASA marks as a volcano, a static land source or offshore, when NASA provides
-- that flag. On top of that, cells that are hot almost all year in several years (factories,
-- flares, smelters) are left out of the map, because vegetation fires in Indonesia are seasonal.

create table if not exists fire_cell_years (
  cx      integer  not null,        -- floor(longitude * 50), i.e. 0.02° steps
  cy      integer  not null,        -- floor(latitude * 50)
  yr      smallint not null,
  days    bit(366) not null,        -- bit i (from the left, 1-based) = day-of-year i had a detection
  months  integer  not null,        -- bit (m-1) set = month m had a detection
  frp_max real,                     -- strongest fire radiative power seen, MW
  primary key (cx, cy, yr)
);
alter table fire_cell_years enable row level security;   -- no policy: jobs only

-- Merge rows from the archive loader. days is a string of 366 '0'/'1' characters.
create or replace function merge_fire_cell_years(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into fire_cell_years (cx, cy, yr, days, months, frp_max)
  select (r->>'cx')::int, (r->>'cy')::int, (r->>'yr')::smallint, (r->>'days')::bit(366),
         (r->>'months')::int, nullif(r->>'frp', '')::real
  from jsonb_array_elements(p_rows) r
  on conflict (cx, cy, yr) do update
    set days    = fire_cell_years.days | excluded.days,
        months  = fire_cell_years.months | excluded.months,
        frp_max = greatest(fire_cell_years.frp_max, excluded.frp_max);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function merge_fire_cell_years(jsonb) from public, anon, authenticated;

-- The public result: one row per cell that burned in 2+ of the last 5 calendar years.
create table if not exists repeat_fire_cells (
  cx             integer  not null,
  cy             integer  not null,
  lon            real     not null,  -- cell centre
  lat            real     not null,
  province_id    smallint references provinces(id),
  window_start   smallint not null,
  window_end     smallint not null,
  years          smallint[] not null,  -- years with fire, ascending
  days_by_year   smallint[] not null,  -- detection days in each of those years (same order)
  n_years        smallint not null,
  month_years    smallint[] not null,  -- for Jan..Dec: in how many of the years that month burned
  this_year_days smallint not null,
  last_seen      date     not null,
  primary key (cx, cy)
);
create index if not exists repeat_fire_prov_idx on repeat_fire_cells (province_id, n_years);
alter table repeat_fire_cells enable row level security;
drop policy if exists "public read" on repeat_fire_cells;
create policy "public read" on repeat_fire_cells for select to anon, authenticated using (true);
grant select on repeat_fire_cells to anon, authenticated;

-- How many cells were left out as all-year heat sources, so the method can say so.
create table if not exists repeat_fire_meta (
  id             smallint primary key default 1 check (id = 1),
  refreshed_at   timestamptz not null,
  window_start   smallint not null,
  window_end     smallint not null,
  static_cells   integer not null,
  history_from   date
);
alter table repeat_fire_meta enable row level security;
drop policy if exists "public read" on repeat_fire_meta;
create policy "public read" on repeat_fire_meta for select to anon, authenticated using (true);
grant select on repeat_fire_meta to anon, authenticated;

-- Daily: add the latest live detections, then rebuild repeat_fire_cells.
create or replace function refresh_repeat_fire()
returns integer language plpgsql security definer set search_path = public as $$
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

  -- 2. All-year heat sources: hot on 60+ days, or in 7+ different months, in 3+ separate years.
  drop table if exists _static;
  create temporary table _static on commit drop as
  select cx, cy
  from fire_cell_years
  where yr between y0 and y1
  group by cx, cy
  having count(*) filter (where bit_count(days) >= 60 or bit_count(months::bit(12)) >= 7) >= 3;
  select count(*) into n_static from _static;

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
                  and st_intersects(p.geom, st_setsrid(st_makepoint(a.lon, a.lat), 4326));
  get diagnostics n = row_count;

  insert into repeat_fire_meta (id, refreshed_at, window_start, window_end, static_cells, history_from)
  values (1, now(), y0, y1, n_static, (select make_date(min(yr), 1, 1) from fire_cell_years))
  on conflict (id) do update set refreshed_at = excluded.refreshed_at, window_start = excluded.window_start,
    window_end = excluded.window_end, static_cells = excluded.static_cells, history_from = excluded.history_from;
  return n;
end $$;
revoke execute on function refresh_repeat_fire() from public, anon, authenticated;

-- Province ranking: repeat-burning cells (3+ of 5 years) per province, with approximate area.
create or replace view repeat_fire_provinces with (security_invoker = true) as
select p.id, p.slug, p.name_en, p.name_id,
       count(*) filter (where c.n_years >= 3)              as cells_3plus,
       count(*) filter (where c.n_years >= 4)              as cells_4plus,
       count(*) filter (where c.n_years = 5)               as cells_5,
       round(sum(case when c.n_years >= 3
             then 4.93 * cos(radians(c.lat)) else 0 end)::numeric, 0) as km2_3plus,
       max(c.window_start) as window_start, max(c.window_end) as window_end
from repeat_fire_cells c
join provinces p on p.id = c.province_id
group by p.id, p.slug, p.name_en, p.name_id;
grant select on repeat_fire_provinces to anon, authenticated;

-- Compact list for the map layer: "cx,cy,years;cx,cy,years;..." in one response
-- (the REST API returns at most 1000 rows per request, and there can be many thousands of cells).
create or replace function repeat_fire_points()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(cx || ',' || cy || ',' || n_years, ';'), '') from repeat_fire_cells;
$$;
grant execute on function repeat_fire_points() to anon, authenticated;

-- The background jobs (service role) need these; "revoke ... from public" above also removed theirs.
grant all on fire_cell_years, repeat_fire_cells, repeat_fire_meta to service_role;
grant execute on function merge_fire_cell_years(jsonb) to service_role;
grant execute on function refresh_repeat_fire() to service_role;
