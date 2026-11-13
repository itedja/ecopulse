-- 013: Rebuild repeat-fire areas inside the database every day.
-- The rebuild takes longer than the API's time limit for background jobs, but pg_cron runs
-- inside Postgres with no such limit. 20:15 UTC = 03:15 WIB, after the nightly maintenance.
create index if not exists provinces_geom_gix on public.provinces using gist (geom);

select cron.unschedule('ecopulse-repeat-fire') where exists (select 1 from cron.job where jobname = 'ecopulse-repeat-fire');
select cron.schedule('ecopulse-repeat-fire', '15 20 * * *', $$select public.refresh_repeat_fire()$$);

-- Build it once now (takes up to a minute).
select public.refresh_repeat_fire() as repeat_fire_cells;
