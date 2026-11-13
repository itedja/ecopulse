-- 016: Facilities on the coast or small islands (refineries, smelters, ports) can sit just outside the
-- simplified province outlines. Give those the nearest province within ~30 km.
update emission_sources e
set province_id = (
  select p.id from provinces p
  where p.geom is not null
    and extensions.st_dwithin(p.geom, extensions.st_setsrid(extensions.st_makepoint(e.lon, e.lat), 4326), 0.3)
  order by extensions.st_distance(p.geom, extensions.st_setsrid(extensions.st_makepoint(e.lon, e.lat), 4326))
  limit 1)
where e.province_id is null;

-- And do the same on every future monthly load.
create or replace function fill_emitter_provinces()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.province_id is null then
    select p.id into new.province_id from provinces p
    where p.geom is not null and st_dwithin(p.geom, st_setsrid(st_makepoint(new.lon, new.lat), 4326), 0.3)
    order by st_distance(p.geom, st_setsrid(st_makepoint(new.lon, new.lat), 4326))
    limit 1;
  end if;
  return new;
end $$;
drop trigger if exists emitter_province on emission_sources;
create trigger emitter_province before insert on emission_sources
  for each row execute function fill_emitter_provinces();

select count(*) as still_without_province from emission_sources where province_id is null;
