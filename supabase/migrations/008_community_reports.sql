-- 008: Community reports — submit, screen, vote, verify, points.
--
-- How it works
--   1. A signed-in person submits a report (kind, title, optional text and photo, phone GPS).
--      It starts as 'pending' and is NOT public yet. Public location is rounded to ~1 km.
--   2. The screening job (every 15 min) asks Claude Haiku to check the text and photo.
--      Approved → 'unverified' (public, marked "not confirmed yet"). Rejected → hidden, with a reason
--      the reporter can see.
--   3. Satellites can confirm it: a fire report with a NASA hotspot within 5 km, or a forest report
--      next to a GFW deforestation alert. Otherwise people nearby (≤ 30 km, by GPS) confirm it.
--   4. Votes: "still here" / "gone" / "not real". Each person's latest vote counts, weighted by trust.
--      2 "still here" → confirmed. "gone" wins → possibly resolved → resolved. 3 "not real" → removed.
--   5. Points: +20 when your report is confirmed (not when you post, so spam earns nothing),
--      +2 per vote (max 10 voting rewards a day). A report later found fake takes its 20 back and
--      lowers the reporter's trust. Reports fade out unless someone says "still here".
--
-- Users never write to tables directly: everything goes through the functions below, which run
-- the checks. Safe to run more than once.

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------
alter table reports        add column if not exists points_awarded boolean not null default false;
alter table reports        add column if not exists not_real_votes smallint not null default 0;
alter table report_private add column if not exists upload_path text;

-- New sign-ups get a random nickname (they can change it). The old version could collide and
-- block a sign-up; this one retries until it finds a free name.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare n text; tries int := 0;
begin
  loop
    n := 'pengamat_' || substr(md5(new.id::text || clock_timestamp()::text || tries::text), 1, 6);
    exit when not exists (select 1 from profiles where nickname = n);
    tries := tries + 1;
    if tries > 20 then n := 'user_' || replace(new.id::text, '-', ''); n := left(n, 24); exit; end if;
  end loop;
  insert into profiles (id, nickname) values (new.id, n) on conflict (id) do nothing;
  insert into user_trust (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
revoke execute on function handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Photo storage: people upload to a PRIVATE bucket (only into their own folder).
-- The screening job copies approved photos to the PUBLIC bucket and deletes the upload.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-uploads', 'report-uploads', false, 5242880, array['image/jpeg']),
       ('report-photos',  'report-photos',  true,  5242880, array['image/jpeg'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ecopulse upload own folder" on storage.objects;
create policy "ecopulse upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Internal helpers (server only)
-- ---------------------------------------------------------------------
create or replace function add_points(p_user uuid, p_delta integer, p_reason text, p_report uuid)
returns void language sql security definer set search_path = public as $$
  insert into points_ledger (user_id, delta, reason, report_id) values (p_user, p_delta, p_reason, p_report);
$$;

-- Marks a report confirmed (once) and rewards the reporter.
create or replace function confirm_report(p_report uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare r reports%rowtype;
begin
  select * into r from reports where id = p_report for update;
  if not found or r.status not in ('unverified', 'confirmed', 'possibly_resolved') then return; end if;
  update reports set status = 'confirmed',
         verified_by = coalesce(verified_by, p_by),
         confirmed_at = coalesce(confirmed_at, now()),
         points_awarded = true
   where id = p_report;
  if not r.points_awarded and r.reporter_id is not null then
    perform add_points(r.reporter_id, 20, 'report_confirmed', p_report);
    update user_trust set trust_score = least(5, trust_score + 0.10), reports_confirmed = reports_confirmed + 1
     where user_id = r.reporter_id;
  end if;
end $$;

-- Satellite check: NASA fire within 5 km (48 h) for fire/smoke, or a GFW forest-loss square within
-- 3 km (last 60 days) for deforestation/logging. Returns true if it confirmed the report.
create or replace function verify_report_by_satellite(p_report uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare r reports%rowtype; hit boolean := false;
begin
  select * into r from reports where id = p_report;
  if not found or r.status <> 'unverified' then return false; end if;
  if r.kind in ('fire_smoke') then
    select exists (select 1 from fire_hotspots h
                    where h.acquired_at between r.created_at - interval '48 hours' and r.created_at + interval '24 hours'
                      and st_dwithin(h.geom::geography, r.geom::geography, 5000)) into hit;
  elsif r.kind in ('deforestation', 'illegal_logging') then
    select exists (select 1 from deforestation_clusters c
                    where c.last_detected >= (r.created_at - interval '60 days')::date
                      and st_dwithin(c.geom::geography, r.geom::geography, 3000)) into hit;
  end if;
  if hit then perform confirm_report(p_report, 'satellite'); end if;
  return hit;
end $$;

-- Called by the screening job.
create or replace function approve_report(p_report uuid, p_photo_path text)
returns text language plpgsql security definer set search_path = public as $$
begin
  update reports set status = 'unverified', photo_path = p_photo_path, screening_note = null
   where id = p_report and status = 'pending';
  if not found then return 'not_pending'; end if;
  perform verify_report_by_satellite(p_report);
  return (select status::text from reports where id = p_report);
end $$;

create or replace function reject_report(p_report uuid, p_note text)
returns void language sql security definer set search_path = public as $$
  update reports set status = 'rejected', screening_note = left(p_note, 300) where id = p_report and status = 'pending';
$$;

-- Re-tallies votes and moves the report between states.
create or replace function recompute_report(p_report uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  r reports%rowtype;
  win interval;
  still numeric; gone numeric; fake numeric; still_n int;
begin
  select * into r from reports where id = p_report for update;
  if not found then return null; end if;
  win := greatest(report_lifetime(r.kind), interval '1 day');

  with latest as (
    select distinct on (user_id) user_id, vote, weight
      from report_votes where report_id = p_report and created_at > now() - win
     order by user_id, created_at desc
  )
  select coalesce(sum(weight) filter (where vote = 'still_here'), 0),
         coalesce(sum(weight) filter (where vote = 'gone'), 0),
         coalesce(sum(weight) filter (where vote = 'not_real'), 0),
         count(*) filter (where vote = 'still_here')
    into still, gone, fake, still_n from latest;

  update reports set confirmations = still_n,
         gone_votes = (select count(*) from report_votes v where v.report_id = p_report and v.vote = 'gone' and v.created_at > now() - win),
         not_real_votes = (select count(*) from report_votes v where v.report_id = p_report and v.vote = 'not_real' and v.created_at > now() - win)
   where id = p_report;

  if r.status not in ('unverified', 'confirmed', 'possibly_resolved') then return r.status::text; end if;

  -- A satellite-confirmed report needs more people to call it fake.
  if fake >= (case when r.verified_by = 'satellite' then 5 else 3 end) and fake > still then
    update reports set status = 'rejected', screening_note = 'Marked not real by people nearby' where id = p_report;
    if r.reporter_id is not null then
      if r.points_awarded then
        perform add_points(r.reporter_id, -20, 'reversal', p_report);
        update reports set points_awarded = false where id = p_report;
      end if;
      update user_trust set trust_score = greatest(0, trust_score - 0.50), reports_rejected = reports_rejected + 1
       where user_id = r.reporter_id;
    end if;
  elsif gone >= 3 and gone > still then
    update reports set status = 'resolved' where id = p_report;
  elsif gone >= 2 and gone >= still then
    update reports set status = 'possibly_resolved' where id = p_report;
  elsif still >= 2 then
    if r.status = 'possibly_resolved' then update reports set status = 'unverified' where id = p_report; end if;
    perform confirm_report(p_report, 'community');
  elsif r.status = 'possibly_resolved' then
    update reports set status = case when r.confirmed_at is null then 'unverified' else 'confirmed' end where id = p_report;
  end if;
  return (select status::text from reports where id = p_report);
end $$;

-- ---------------------------------------------------------------------
-- Functions people call from the website
-- ---------------------------------------------------------------------
create or replace function submit_report(
  p_kind issue_kind, p_title text, p_description text,
  p_lat double precision, p_lon double precision, p_accuracy_m real,
  p_upload_path text, p_photo_hash text, p_anonymous boolean)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  t user_trust%rowtype;
  prov smallint;
  lim int;
  new_id uuid;
  title text := btrim(coalesce(p_title, ''));
  descr text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if p_lat is null or p_lon is null or p_lat not between -12 and 7 or p_lon not between 94 and 142 then
    raise exception 'outside_indonesia';
  end if;
  if p_accuracy_m is not null and p_accuracy_m > 2000 then raise exception 'location_too_rough'; end if;
  if char_length(title) < 3 or char_length(title) > 120 then raise exception 'bad_title'; end if;
  if descr is not null and char_length(descr) > 1000 then raise exception 'description_too_long'; end if;

  prov := province_for_point(st_setsrid(st_makepoint(p_lon, p_lat), 4326));
  if prov is null then raise exception 'outside_indonesia'; end if;

  if p_upload_path is not null and p_upload_path !~ ('^' || uid::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'bad_photo_path';
  end if;
  if p_photo_hash is not null and exists (select 1 from report_private where photo_hash = p_photo_hash) then
    raise exception 'duplicate_photo';
  end if;

  insert into user_trust (user_id) values (uid) on conflict (user_id) do nothing;
  select * into t from user_trust where user_id = uid for update;
  if t.reports_today_date is distinct from current_date then t.reports_today := 0; end if;
  lim := 3 + floor(t.trust_score)::int;
  if t.reports_today >= lim then raise exception 'daily_limit'; end if;

  insert into reports (reporter_id, is_anonymous, kind, title, description, lat_public, lon_public,
                       province_id, status, expires_at)
  values (uid, coalesce(p_anonymous, false), p_kind, title, descr, round(p_lat::numeric, 2), round(p_lon::numeric, 2),
          prov, 'pending', now() + report_lifetime(p_kind))
  returning id into new_id;

  insert into report_private (report_id, exact_lat, exact_lon, device_lat, device_lon, device_accuracy_m, photo_hash, upload_path)
  values (new_id, p_lat, p_lon, p_lat, p_lon, p_accuracy_m, p_photo_hash, p_upload_path);

  update user_trust set reports_today = t.reports_today + 1, reports_today_date = current_date where user_id = uid;
  return new_id;
end $$;

create or replace function vote_report(p_report uuid, p_vote vote_kind, p_lat double precision, p_lon double precision)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  r reports%rowtype;
  dist numeric;
  w numeric;
  rewards_today int;
  new_status text;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  select * into r from reports where id = p_report;
  if not found or r.status not in ('unverified', 'confirmed', 'possibly_resolved') then raise exception 'report_not_open'; end if;
  if r.reporter_id = uid then raise exception 'own_report'; end if;
  if p_lat is null or p_lon is null then raise exception 'location_required'; end if;
  dist := st_distance(st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography, r.geom::geography) / 1000;
  if dist > 30 then raise exception 'too_far'; end if;

  insert into user_trust (user_id) values (uid) on conflict (user_id) do nothing;
  select least(3, greatest(0.25, trust_score)) into w from user_trust where user_id = uid;

  insert into report_votes (report_id, user_id, vote, weight, distance_km)
  values (p_report, uid, p_vote, w, round(dist, 2))
  on conflict (report_id, user_id, vote_day)
  do update set vote = excluded.vote, weight = excluded.weight, distance_km = excluded.distance_km, created_at = now();

  if p_vote = 'still_here' then
    update reports set last_confirmed_at = now(),
           expires_at = greatest(expires_at, now() + report_lifetime(kind))
     where id = p_report;
  end if;

  -- +2 for helping, once per report per day, at most 10 times a day.
  select count(*) into rewards_today from points_ledger
   where user_id = uid and reason = 'vote' and created_at >= date_trunc('day', now());
  if rewards_today < 10 and not exists (
       select 1 from points_ledger where user_id = uid and reason = 'vote' and report_id = p_report
         and created_at >= date_trunc('day', now())) then
    perform add_points(uid, 2, 'vote', p_report);
  end if;

  new_status := recompute_report(p_report);
  return jsonb_build_object('status', new_status,
    'confirmations', (select confirmations from reports where id = p_report),
    'gone_votes', (select gone_votes from reports where id = p_report));
end $$;

create or replace function set_nickname(p_nickname text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n text := btrim(coalesce(p_nickname, ''));
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if n !~ '^[A-Za-z0-9_.]{3,24}$' then raise exception 'bad_nickname'; end if;
  if exists (select 1 from profiles where lower(nickname) = lower(n) and id <> uid) then raise exception 'nickname_taken'; end if;
  update profiles set nickname = n where id = uid;
  return n;
end $$;

-- Your own profile: points, rank, today's report allowance, and your recent reports
-- (including ones still being checked or rejected, with the reason).
create or replace function my_profile()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p profiles%rowtype; t user_trust%rowtype;
begin
  if uid is null then return null; end if;
  select * into p from profiles where id = uid;
  if not found then return null; end if;
  select * into t from user_trust where user_id = uid;
  return jsonb_build_object(
    'nickname', p.nickname, 'points', p.points, 'rank_key', p.rank_key,
    'reports_left_today', greatest(0, (3 + floor(coalesce(t.trust_score, 1))::int)
        - case when t.reports_today_date = current_date then t.reports_today else 0 end),
    'reports', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select id, kind, title, status, screening_note, confirmations, created_at
          from reports where reporter_id = uid order by created_at desc limit 20) x), '[]'::jsonb),
    'recent_points', coalesce((select jsonb_agg(y order by y.created_at desc) from (
        select delta, reason, created_at from points_ledger where user_id = uid order by created_at desc limit 10) y), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Public view: hide reports whose time ran out even before the nightly clean-up.
-- ---------------------------------------------------------------------
create or replace view reports_public with (security_invoker = true) as
select r.id, r.kind, r.title, r.description, r.photo_path, r.photo_taken_at,
       r.lat_public, r.lon_public, r.province_id, r.status, r.verified_by,
       r.confirmations, r.confirmed_at, r.last_confirmed_at, r.expires_at, r.created_at,
       case when r.is_anonymous then null else p.nickname end as reporter_nickname,
       case when r.is_anonymous then null else p.rank_key end as reporter_rank,
       r.gone_votes
from reports r
left join profiles p on p.id = r.reporter_id
where r.status in ('unverified', 'confirmed', 'possibly_resolved') and r.expires_at > now();

grant select (gone_votes) on reports to anon, authenticated;
grant select on reports_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
revoke execute on function add_points(uuid, integer, text, uuid)  from public, anon, authenticated;
revoke execute on function confirm_report(uuid, text)             from public, anon, authenticated;
revoke execute on function verify_report_by_satellite(uuid)      from public, anon, authenticated;
revoke execute on function approve_report(uuid, text)            from public, anon, authenticated;
revoke execute on function reject_report(uuid, text)             from public, anon, authenticated;
revoke execute on function recompute_report(uuid)                from public, anon, authenticated;
grant  execute on function add_points(uuid, integer, text, uuid), confirm_report(uuid, text),
                           verify_report_by_satellite(uuid), approve_report(uuid, text),
                           reject_report(uuid, text), recompute_report(uuid) to service_role;

revoke execute on function submit_report(issue_kind, text, text, double precision, double precision, real, text, text, boolean) from public, anon;
revoke execute on function vote_report(uuid, vote_kind, double precision, double precision) from public, anon;
revoke execute on function set_nickname(text) from public, anon;
revoke execute on function my_profile() from public, anon;
grant  execute on function submit_report(issue_kind, text, text, double precision, double precision, real, text, text, boolean),
                           vote_report(uuid, vote_kind, double precision, double precision),
                           set_nickname(text), my_profile() to authenticated, service_role;

-- The screening job: start it every 15 minutes (uses the scheduler from 007).
select cron.schedule('ecopulse-reports', '*/15 * * * *', $$select public.start_github_job('reports.yml')$$);
