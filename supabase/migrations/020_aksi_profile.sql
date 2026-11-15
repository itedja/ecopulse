-- 020: a member's Aksi profile, as other members see it: nickname, rank, points, streak, how many
-- actions, which of the last 14 days had an action, and their approved photos. Members only.
-- Nothing private is returned: no email, no rejected or pending posts. Safe to run more than once.
create or replace function aksi_profile(p_nickname text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); pr profiles%rowtype;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not aksi_is_member(uid) then raise exception 'not_a_member'; end if;
  select * into pr from profiles where lower(nickname) = lower(btrim(coalesce(p_nickname, '')));
  if not found or not exists (select 1 from aksi_members m where m.user_id = pr.id) then return null; end if;
  return jsonb_build_object(
    'nickname', pr.nickname, 'rank_key', pr.rank_key, 'points', pr.points, 'mine', pr.id = uid,
    'streak', aksi_streak(pr.id),
    'approved_total', (select count(*) from aksi_posts where author_id = pr.id and status = 'approved'),
    'days', coalesce((select jsonb_agg(distinct a.action_day) from aksi_posts a
                       where a.author_id = pr.id and a.status = 'approved'
                         and a.action_day > (now() at time zone 'Asia/Jakarta')::date - 14), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(x order by x.approved_at desc) from (
        select a.id, a.photo_path, a.caption, a.action_day, a.approved_at
          from aksi_posts a where a.author_id = pr.id and a.status = 'approved'
         order by a.approved_at desc limit 60) x), '[]'::jsonb)
  );
end $$;

revoke execute on function aksi_profile(text) from public, anon;
grant  execute on function aksi_profile(text) to authenticated, service_role;

-- Check. Expected: 1
select count(*) as profile_function
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'aksi_profile';
