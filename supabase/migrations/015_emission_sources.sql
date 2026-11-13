-- 015: Big emitters (power plants, smelters, steel and cement works, refineries, mines, dumps).
-- Source: Climate TRACE (CC BY 4.0), an independent inventory that estimates each facility's yearly
-- emissions from satellite images, production data and models. These are estimates, not stack
-- measurements. Loaded monthly by ingest/emitters.ts; each load replaces the whole set.

create table if not exists emission_sources (
  id            bigint primary key,           -- Climate TRACE source id
  name          text not null,
  sector        text not null,                -- power, manufacturing, fossil-fuel-operations, mineral-extraction, waste
  subsector     text not null,                -- e.g. electricity-generation, iron-and-steel, cement
  asset_type    text,                         -- e.g. "coal", "BF/BOF", "Dumpsite"
  lon           double precision not null,
  lat           double precision not null,
  province_id   smallint references provinces(id),
  year          smallint not null,            -- the estimates' year (latest full year)
  co2e_t        double precision,             -- tonnes CO2-equivalent (100-year) per year
  pm25_t        double precision,             -- tonnes PM2.5 per year
  so2_t         double precision,             -- tonnes SO2 per year
  nox_t         double precision,             -- tonnes NOx per year
  capacity      double precision,
  capacity_unit text,
  owners        text[],                       -- as listed by Climate TRACE
  confidence    text,                         -- Climate TRACE's own confidence in the CO2e estimate
  rank_co2e     integer,                      -- rank among the Indonesian sources stored here
  rank_pm25     integer,
  updated_at    timestamptz not null default now()
);
create index if not exists emission_sources_province on emission_sources (province_id);
alter table emission_sources enable row level security;
drop policy if exists "public read" on emission_sources;
create policy "public read" on emission_sources for select using (true);
grant select on emission_sources to anon, authenticated;
grant all on emission_sources to service_role;

-- Replaces the whole set in one transaction. Province from the facility's location; ranks computed here.
create or replace function replace_emission_sources(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if jsonb_array_length(p_rows) < 50 then
    raise exception 'refusing to replace emission_sources with only % rows', jsonb_array_length(p_rows);
  end if;
  delete from emission_sources where true;
  insert into emission_sources (id, name, sector, subsector, asset_type, lon, lat, province_id, year,
                                co2e_t, pm25_t, so2_t, nox_t, capacity, capacity_unit, owners, confidence)
  select (r->>'id')::bigint, r->>'name', r->>'sector', r->>'subsector', nullif(r->>'asset_type', ''),
         (r->>'lon')::float8, (r->>'lat')::float8,
         (select p.id from provinces p where p.geom is not null
            and st_intersects(p.geom, st_setsrid(st_makepoint((r->>'lon')::float8, (r->>'lat')::float8), 4326)) limit 1),
         (r->>'year')::smallint,
         nullif(r->>'co2e_t', '')::float8, nullif(r->>'pm25_t', '')::float8,
         nullif(r->>'so2_t', '')::float8, nullif(r->>'nox_t', '')::float8,
         nullif(r->>'capacity', '')::float8, nullif(r->>'capacity_unit', ''),
         case when jsonb_typeof(r->'owners') = 'array' then array(select jsonb_array_elements_text(r->'owners')) end,
         nullif(r->>'confidence', '')
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  update emission_sources e set rank_co2e = k.rc, rank_pm25 = k.rp
  from (select id,
               rank() over (order by co2e_t desc nulls last) as rc,
               case when pm25_t > 0 then rank() over (order by pm25_t desc nulls last) end as rp
        from emission_sources) k
  where k.id = e.id;
  return n;
end $$;
revoke execute on function replace_emission_sources(jsonb) from public, anon, authenticated;
grant execute on function replace_emission_sources(jsonb) to service_role;
