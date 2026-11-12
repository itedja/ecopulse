-- 007: Supabase becomes the clock for the data jobs.
-- GitHub's own schedule is "best effort" and skipped runs for hours. pg_cron (inside Supabase) is
-- reliable, so it asks GitHub to start each job at the right time. GitHub always runs jobs it is
-- directly asked to run. The GitHub schedules stay in the workflow files as a backup; the
-- concurrency groups stop runs from piling up, and the news job skips stories it already has.
--
-- BEFORE RUNNING: replace PASTE_TOKEN_HERE (line below) with your GitHub token.
-- The token is stored encrypted in Supabase Vault, and only this database can read it.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  tok text := 'PASTE_TOKEN_HERE';
  sid uuid;
begin
  if tok = 'PASTE_TOKEN_HERE' or length(tok) < 20 then
    raise exception 'Paste your GitHub token into the script first (replace PASTE_TOKEN_HERE).';
  end if;
  select id into sid from vault.secrets where name = 'github_dispatch_token';
  if sid is null then
    perform vault.create_secret(tok, 'github_dispatch_token', 'Starts EcoPulse GitHub Actions runs');
  else
    perform vault.update_secret(sid, tok);
  end if;
end $$;

-- Asks GitHub to start one workflow. Only the database itself may call this.
create or replace function public.start_github_job(workflow_file text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tok text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_dispatch_token';
  if tok is null then raise exception 'github_dispatch_token missing from Vault'; end if;
  return net.http_post(
    url     := 'https://api.github.com/repos/itedja/ecopulse/actions/workflows/' || workflow_file || '/dispatches',
    body    := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'ecopulse-scheduler',
      'Content-Type', 'application/json'
    )
  );
end $$;
revoke all on function public.start_github_job(text) from public, anon, authenticated;

-- Schedules (UTC, same times as the workflow files). Re-running this script just updates them.
select cron.schedule('ecopulse-air-weather',   '7,37 * * * *', $$select public.start_github_job('air-weather.yml')$$);
select cron.schedule('ecopulse-news',          '17 * * * *',   $$select public.start_github_job('news.yml')$$);
select cron.schedule('ecopulse-firms',         '23 */3 * * *', $$select public.start_github_job('firms.yml')$$);
select cron.schedule('ecopulse-maintenance',   '41 19 * * *',  $$select public.start_github_job('maintenance.yml')$$);
select cron.schedule('ecopulse-deforestation', '53 21 * * *',  $$select public.start_github_job('deforestation.yml')$$);

-- Start one air run right now as a test. In GitHub → Actions, a new
-- "Air quality + weather" run should appear within a minute.
select public.start_github_job('air-weather.yml');
