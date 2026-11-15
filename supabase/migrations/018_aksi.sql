-- 018: Aksi — the members-only feed of small environmental actions (#SatuAksiSehari).
--
-- How it works
--   1. A signed-in person joins once: they confirm they are 18 or older and agree to the community
--      rules, and pick a language. Only members can see the feed. No date of birth is stored.
--   2. A member posts a photo (camera or gallery) with a short caption. It starts as 'pending' and
--      is NOT visible to others. The photo sits in a private upload bucket.
--   3. The screening job asks Claude to check the photo and caption (real photo of an action, no
--      identifiable children, nothing unsafe). Approved → visible to members. Rejected → hidden,
--      and the author sees the reason and can appeal once.
--   4. Members react with fixed quick comments, or write a short comment, which is also screened
--      before anyone else sees it.
--   5. Three different members flagging a post hides it ('held') until a person looks at it.
--   6. Streak: days in a row with at least one approved post, counted in Jakarta time. One missed
--      day in any 7 days is forgiven. Points: +5 for the first approved post of a day.
--
-- Nobody reads or writes these tables directly: everything goes through the functions below.
-- Safe to run more than once.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists aksi_members (
  user_id          uuid primary key references profiles(id) on delete cascade,
  adult_confirmed  boolean not null default false,          -- "I am 18 or older" (self-declared)
  rules_version    smallint not null default 1,
  agreed_at        timestamptz not null default now(),
  lang             text not null default 'id' check (lang in ('id', 'en')),
  posts_today      smallint not null default 0,
  posts_today_date date,
  comments_today   smallint not null default 0,
  suspended_until  timestamptz
);

create table if not exists aksi_posts (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references profiles(id) on delete cascade,
  caption         text check (char_length(caption) <= 300),
  source          text not null check (source in ('camera', 'gallery')),
  upload_path     text,                                     -- private upload, removed after screening
  photo_path      text,                                     -- members-only bucket, set on approval
  photo_hash      text,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'held', 'removed')),
  screening_note  text,                                     -- why it was rejected (shown to the author only)
  action_day      date not null default ((now() at time zone 'Asia/Jakarta')::date),
  points_awarded  boolean not null default false,
  created_at      timestamptz not null default now(),
  approved_at     timestamptz
);
create index if not exists aksi_posts_feed_idx   on aksi_posts (status, approved_at desc);
create index if not exists aksi_posts_author_idx on aksi_posts (author_id, action_day desc);
create index if not exists aksi_posts_hash_idx   on aksi_posts (photo_hash);

create table if not exists aksi_reactions (
  post_id     uuid not null references aksi_posts(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null check (kind in ('good_job', 'proud', 'congrats', 'thanks')),
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id, kind)
);

create table if not exists aksi_comments (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references aksi_posts(id) on delete cascade,
  author_id       uuid not null references profiles(id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 200),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  screening_note  text,
  created_at      timestamptz not null default now()
);
create index if not exists aksi_comments_post_idx on aksi_comments (post_id, status, created_at);

create table if not exists aksi_flags (
  id          bigint generated always as identity primary key,
  post_id     uuid references aksi_posts(id) on delete cascade,
  comment_id  uuid references aksi_comments(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  reason      text not null check (reason in ('not_real', 'child_visible', 'unsafe', 'hateful', 'spam', 'other')),
  created_at  timestamptz not null default now(),
  check ((post_id is not null) <> (comment_id is not null))
);
create unique index if not exists aksi_flags_post_once    on aksi_flags (post_id, user_id) where post_id is not null;
create unique index if not exists aksi_flags_comment_once on aksi_flags (comment_id, user_id) where comment_id is not null;

create table if not exists aksi_appeals (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null unique references aksi_posts(id) on delete cascade,   -- one appeal per post
  user_id     uuid not null references profiles(id) on delete cascade,
  message     text check (char_length(message) <= 500),
  status      text not null default 'open' check (status in ('open', 'upheld', 'denied')),
  created_at  timestamptz not null default now(),
  emailed_at  timestamptz,                                  -- when the team inbox was notified
  decided_at  timestamptz
);

alter table aksi_members   enable row level security;
alter table aksi_posts     enable row level security;
alter table aksi_reactions enable row level security;
alter table aksi_comments  enable row level security;
alter table aksi_flags     enable row level security;
alter table aksi_appeals   enable row level security;
-- No policies on purpose: only the functions below (and the server) can touch these tables.
revoke all on aksi_members, aksi_posts, aksi_reactions, aksi_comments, aksi_flags, aksi_appeals from anon, authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function aksi_is_member(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from aksi_members m
                  where m.user_id = p_user and m.adult_confirmed
                    and (m.suspended_until is null or m.suspended_until < now()));
$$;

-- The same check for the signed-in person, for the storage rules below.
create or replace function aksi_am_member()
returns boolean language sql stable security definer set search_path = public as $$
  select aksi_is_member(auth.uid());
$$;

-- Days in a row with an approved post, in Jakarta time. Today not having a post yet does not
-- break the streak. One missed day is forgiven if the previous forgiven day was 7 or more days later.
create or replace function aksi_streak(p_user uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Jakarta')::date;
  d date;
  last_rest date;
  n integer := 0;
  has boolean;
begin
  d := today;
  if not exists (select 1 from aksi_posts where author_id = p_user and status = 'approved' and action_day = d) then
    d := d - 1;
  end if;
  for i in 1..400 loop
    select exists (select 1 from aksi_posts where author_id = p_user and status = 'approved' and action_day = d) into has;
    if has then
      n := n + 1;
    elsif (last_rest is null or last_rest - d >= 7)
          and exists (select 1 from aksi_posts where author_id = p_user and status = 'approved' and action_day = d - 1) then
      last_rest := d;                                       -- a forgiven rest day, between two active days
    else
      exit;
    end if;
    d := d - 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Photo storage: both buckets are private. People upload into their own folder; approved photos
-- move to 'aksi-photos', which only members can read.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aksi-uploads', 'aksi-uploads', false, 5242880, array['image/jpeg']),
       ('aksi-photos',  'aksi-photos',  false, 5242880, array['image/jpeg'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "aksi upload own folder" on storage.objects;
create policy "aksi upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'aksi-uploads' and (storage.foldername(name))[1] = auth.uid()::text
              and aksi_am_member());

drop policy if exists "aksi members read photos" on storage.objects;
create policy "aksi members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'aksi-photos' and aksi_am_member());

-- ---------------------------------------------------------------------
-- Functions people call from the website
-- ---------------------------------------------------------------------
create or replace function aksi_join(p_adult boolean, p_rules boolean, p_lang text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not coalesce(p_adult, false) then raise exception 'adults_only'; end if;
  if not coalesce(p_rules, false) then raise exception 'rules_required'; end if;
  if p_lang not in ('id', 'en') then raise exception 'bad_lang'; end if;
  insert into aksi_members (user_id, adult_confirmed, lang) values (uid, true, p_lang)
  on conflict (user_id) do update set adult_confirmed = true, lang = excluded.lang, agreed_at = now();
  return jsonb_build_object('member', true, 'lang', p_lang);
end $$;

create or replace function aksi_set_lang(p_lang text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if p_lang not in ('id', 'en') then raise exception 'bad_lang'; end if;
  update aksi_members set lang = p_lang where user_id = uid;
  if not found then raise exception 'not_a_member'; end if;
  return p_lang;
end $$;

-- Your own Aksi state: membership, language, streak, and your posts (including ones still being
-- checked or rejected, with the reason and any appeal).
create or replace function aksi_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m aksi_members%rowtype; p profiles%rowtype;
begin
  if uid is null then return null; end if;
  select * into m from aksi_members where user_id = uid;
  if not found then return jsonb_build_object('member', false); end if;
  select * into p from profiles where id = uid;
  return jsonb_build_object(
    'member', aksi_is_member(uid), 'lang', m.lang, 'suspended_until', m.suspended_until,
    'nickname', p.nickname, 'points', p.points, 'rank_key', p.rank_key,
    'streak', aksi_streak(uid),
    'posted_today', exists (select 1 from aksi_posts where author_id = uid and status = 'approved'
                             and action_day = (now() at time zone 'Asia/Jakarta')::date),
    'approved_total', (select count(*) from aksi_posts where author_id = uid and status = 'approved'),
    'posts', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select a.id, a.caption, a.status, a.screening_note, a.photo_path, a.action_day, a.created_at,
               (select ap.status from aksi_appeals ap where ap.post_id = a.id) as appeal_status
          from aksi_posts a where a.author_id = uid and a.status <> 'removed'
         order by a.created_at desc limit 60) x), '[]'::jsonb)
  );
end $$;

create or replace function aksi_submit(p_caption text, p_upload_path text, p_photo_hash text, p_source text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  m aksi_members%rowtype;
  cap text := nullif(btrim(coalesce(p_caption, '')), '');
  today date := (now() at time zone 'Asia/Jakarta')::date;
  new_id uuid;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not aksi_is_member(uid) then raise exception 'not_a_member'; end if;
  if p_source not in ('camera', 'gallery') then raise exception 'bad_source'; end if;
  if cap is not null and char_length(cap) > 300 then raise exception 'caption_too_long'; end if;
  if p_upload_path is null or p_upload_path !~ ('^' || uid::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'bad_photo_path';
  end if;
  if p_photo_hash is not null and exists (select 1 from aksi_posts where photo_hash = p_photo_hash and status <> 'removed') then
    raise exception 'duplicate_photo';
  end if;

  select * into m from aksi_members where user_id = uid for update;
  if m.posts_today_date is distinct from today then m.posts_today := 0; end if;
  if m.posts_today >= 30 then raise exception 'daily_limit'; end if;

  insert into aksi_posts (author_id, caption, source, upload_path, photo_hash, action_day)
  values (uid, cap, p_source, p_upload_path, p_photo_hash, today)
  returning id into new_id;

  update aksi_members set posts_today = m.posts_today + 1, posts_today_date = today,
         comments_today = case when m.posts_today_date is distinct from today then 0 else comments_today end
   where user_id = uid;
  return new_id;
end $$;

-- The feed: approved posts, newest first. Members only.
create or replace function aksi_feed(p_before timestamptz, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); lim integer := least(greatest(coalesce(p_limit, 20), 1), 40);
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not aksi_is_member(uid) then raise exception 'not_a_member'; end if;
  return coalesce((select jsonb_agg(x order by x.approved_at desc) from (
    select a.id, a.caption, a.photo_path, a.action_day, a.approved_at,
           pr.nickname, pr.rank_key, aksi_streak(a.author_id) as streak, (a.author_id = uid) as mine,
           (select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb)
              from (select r.kind, count(*) as n from aksi_reactions r where r.post_id = a.id group by r.kind) k) as reactions,
           coalesce((select jsonb_agg(r.kind) from aksi_reactions r where r.post_id = a.id and r.user_id = uid), '[]'::jsonb) as my_reactions,
           (select count(*) from aksi_comments c where c.post_id = a.id and c.status = 'approved') as comments
      from aksi_posts a join profiles pr on pr.id = a.author_id
     where a.status = 'approved' and (p_before is null or a.approved_at < p_before)
     order by a.approved_at desc limit lim) x), '[]'::jsonb);
end $$;

-- One post with its approved comments (and your own comments still being checked).
create or replace function aksi_post(p_post uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); a aksi_posts%rowtype; pr profiles%rowtype;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not aksi_is_member(uid) then raise exception 'not_a_member'; end if;
  select * into a from aksi_posts where id = p_post and (status = 'approved' or author_id = uid);
  if not found then return null; end if;
  select * into pr from profiles where id = a.author_id;
  return jsonb_build_object(
    'id', a.id, 'caption', a.caption, 'photo_path', a.photo_path, 'status', a.status,
    'action_day', a.action_day, 'approved_at', a.approved_at,
    'nickname', pr.nickname, 'rank_key', pr.rank_key, 'streak', aksi_streak(a.author_id), 'mine', a.author_id = uid,
    'reactions', (select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb)
                    from (select r.kind, count(*) as n from aksi_reactions r where r.post_id = a.id group by r.kind) k),
    'my_reactions', coalesce((select jsonb_agg(r.kind) from aksi_reactions r where r.post_id = a.id and r.user_id = uid), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(y order by y.created_at) from (
        select c.id, c.body, c.status, c.created_at, cp.nickname, (c.author_id = uid) as mine
          from aksi_comments c join profiles cp on cp.id = c.author_id
         where c.post_id = a.id and (c.status = 'approved' or (c.author_id = uid and c.status = 'pending'))
         order by c.created_at limit 200) y), '[]'::jsonb)
  );
end $$;

create or replace function aksi_react(p_post uuid, p_kind text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not aksi_is_member(uid) then raise exception 'not_a_member'; end if;
  if p_kind not in ('good_job', 'proud', 'congrats', 'thanks') then raise exception 'bad_reaction'; end if;
  if not exists (select 1 from aksi_posts where id = p_post and status = 'approved') then raise exception 'post_not_found'; end if;
  if coalesce(p_on, true) then
    insert into aksi_reactions (post_id, user_id, kind) values (p_post, uid, p_kind) on conflict do nothing;
  else
    delete from aksi_reactions where post_id = p_post and user_id = uid and kind = p_kind;
  end if;
end $$;

create or replace function aksi_comment(p_post uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  m aksi_members%rowtype;
  txt text := btrim(coalesce(p_body, ''));
  today date := (now() at time zone 'Asia/Jakarta')::date;
  new_id uuid;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not aksi_is_member(uid) then raise exception 'not_a_member'; end if;
  if char_length(txt) < 1 or char_length(txt) > 200 then raise exception 'bad_comment'; end if;
  if not exists (select 1 from aksi_posts where id = p_post and status = 'approved') then raise exception 'post_not_found'; end if;

  select * into m from aksi_members where user_id = uid for update;
  if m.posts_today_date is distinct from today then m.posts_today := 0; m.comments_today := 0; end if;
  if m.comments_today >= 60 then raise exception 'daily_limit'; end if;

  insert into aksi_comments (post_id, author_id, body) values (p_post, uid, txt) returning id into new_id;
  update aksi_members set comments_today = m.comments_today + 1, posts_today = m.posts_today, posts_today_date = today
   where user_id = uid;
  return new_id;
end $$;

-- Flag a post or a comment. Three different members flagging a post hides it until a person checks.
create or replace function aksi_flag(p_post uuid, p_comment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if not aksi_is_member(uid) then raise exception 'not_a_member'; end if;
  if (p_post is null) = (p_comment is null) then raise exception 'bad_target'; end if;
  if p_reason not in ('not_real', 'child_visible', 'unsafe', 'hateful', 'spam', 'other') then raise exception 'bad_reason'; end if;
  insert into aksi_flags (post_id, comment_id, user_id, reason) values (p_post, p_comment, uid, p_reason)
  on conflict do nothing;
  if p_post is not null and (select count(*) from aksi_flags where post_id = p_post) >= 3 then
    update aksi_posts set status = 'held' where id = p_post and status = 'approved';
  end if;
  if p_comment is not null and (select count(*) from aksi_flags where comment_id = p_comment) >= 3 then
    update aksi_comments set status = 'removed' where id = p_comment and status = 'approved';
  end if;
end $$;

-- Appeal a rejected or held post of your own. One appeal per post.
create or replace function aksi_appeal(p_post uuid, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); msg text := nullif(btrim(coalesce(p_message, '')), ''); new_id uuid;
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  if msg is not null and char_length(msg) > 500 then raise exception 'message_too_long'; end if;
  if not exists (select 1 from aksi_posts where id = p_post and author_id = uid and status in ('rejected', 'held')) then
    raise exception 'cannot_appeal';
  end if;
  if exists (select 1 from aksi_appeals where post_id = p_post) then raise exception 'already_appealed'; end if;
  insert into aksi_appeals (post_id, user_id, message) values (p_post, uid, msg) returning id into new_id;
  return new_id;
end $$;

create or replace function aksi_delete_post(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign_in_required'; end if;
  update aksi_posts set status = 'removed' where id = p_post and author_id = uid;
  if not found then raise exception 'post_not_found'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Server-only functions (screening job and the team)
-- ---------------------------------------------------------------------
create or replace function aksi_approve_post(p_post uuid, p_photo_path text)
returns void language plpgsql security definer set search_path = public as $$
declare a aksi_posts%rowtype;
begin
  select * into a from aksi_posts where id = p_post for update;
  if not found or a.status not in ('pending', 'held', 'rejected') then return; end if;
  update aksi_posts set status = 'approved', photo_path = coalesce(p_photo_path, photo_path), upload_path = null,
         screening_note = null, approved_at = coalesce(approved_at, now()) where id = p_post;
  -- +5 for the first approved post of that day, once.
  if not a.points_awarded and not exists (
       select 1 from aksi_posts o where o.author_id = a.author_id and o.action_day = a.action_day
          and o.points_awarded and o.id <> a.id) then
    insert into points_ledger (user_id, delta, reason) values (a.author_id, 5, 'aksi_post');
    update aksi_posts set points_awarded = true where id = p_post;
  end if;
  update aksi_appeals set status = 'upheld', decided_at = now() where post_id = p_post and status = 'open';
end $$;

create or replace function aksi_reject_post(p_post uuid, p_note text)
returns void language sql security definer set search_path = public as $$
  update aksi_posts set status = 'rejected', screening_note = left(p_note, 300), upload_path = null
   where id = p_post and status in ('pending', 'held');
$$;

create or replace function aksi_screen_comment(p_comment uuid, p_ok boolean, p_note text)
returns void language sql security definer set search_path = public as $$
  update aksi_comments set status = case when p_ok then 'approved' else 'rejected' end,
         screening_note = case when p_ok then null else left(p_note, 200) end
   where id = p_comment and status = 'pending';
$$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
revoke execute on function aksi_is_member(uuid), aksi_streak(uuid),
                           aksi_approve_post(uuid, text), aksi_reject_post(uuid, text),
                           aksi_screen_comment(uuid, boolean, text) from public, anon;
revoke execute on function aksi_approve_post(uuid, text), aksi_reject_post(uuid, text),
                           aksi_screen_comment(uuid, boolean, text), aksi_streak(uuid), aksi_is_member(uuid) from authenticated;
revoke execute on function aksi_am_member() from public, anon;
grant  execute on function aksi_am_member() to authenticated, service_role;          -- used by the storage rules
grant  execute on function aksi_is_member(uuid), aksi_streak(uuid), aksi_approve_post(uuid, text), aksi_reject_post(uuid, text),
                           aksi_screen_comment(uuid, boolean, text) to service_role;

revoke execute on function aksi_join(boolean, boolean, text), aksi_set_lang(text), aksi_me(),
                           aksi_submit(text, text, text, text), aksi_feed(timestamptz, integer), aksi_post(uuid),
                           aksi_react(uuid, text, boolean), aksi_comment(uuid, text), aksi_flag(uuid, uuid, text),
                           aksi_appeal(uuid, text), aksi_delete_post(uuid) from public, anon;
grant  execute on function aksi_join(boolean, boolean, text), aksi_set_lang(text), aksi_me(),
                           aksi_submit(text, text, text, text), aksi_feed(timestamptz, integer), aksi_post(uuid),
                           aksi_react(uuid, text, boolean), aksi_comment(uuid, text), aksi_flag(uuid, uuid, text),
                           aksi_appeal(uuid, text), aksi_delete_post(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Check: run this last. Expected: tables = 6, functions = 17, buckets = 2, storage_policies = 2.
-- ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'aksi\_%') as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'aksi\_%') as functions,
  (select count(*) from storage.buckets where id in ('aksi-uploads', 'aksi-photos')) as buckets,
  (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'aksi %') as storage_policies;
