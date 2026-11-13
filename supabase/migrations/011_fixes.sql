-- 011: two fixes
-- 1. The repeat-fire province view must run with the reader's permissions (Supabase security check).
alter view public.repeat_fire_provinces set (security_invoker = true);

-- 2. Global Forest Watch does not give an area for single alerts, so the stored "0 ha" was never real.
--    Clear it, and clear the AI notes that repeated it, so they are rewritten without an area.
update public.deforestation_clusters set area_ha = null where area_ha = 0;
update public.deforestation_clusters set summary_en = null, summary_id = null, llm_model = null
  where summary_en is not null;

-- 3. Let the background jobs (service role) use the repeat-fire tables and functions.
grant all on public.fire_cell_years, public.repeat_fire_cells, public.repeat_fire_meta to service_role;
grant execute on function public.merge_fire_cell_years(jsonb) to service_role;
grant execute on function public.refresh_repeat_fire() to service_role;
