-- 009: Sign-in hand-off for the installed app (home-screen icon).
--
-- Why: on iPhone, an app added to the home screen has its own storage, separate from Safari.
-- "Sign in with Google" opens in a browser sheet, so the sign-in lands in that browser, not the app.
--
-- How: the app makes a long random one-time code and keeps it. The browser sheet signs in with
-- Google, then stores the new sign-in under a fingerprint (SHA-256) of that code. The app, which
-- is the only one that knows the code, collects it once. Entries are deleted when collected and
-- expire after 10 minutes. Nobody can read the table directly. Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

create table if not exists auth_handoffs (
  code_hash     text primary key,
  refresh_token text not null,
  created_at    timestamptz not null default now()
);
alter table auth_handoffs enable row level security;   -- no policies: only the functions below
revoke all on auth_handoffs from public, anon, authenticated;

-- Called by the browser sheet right after Google sign-in (so the caller is signed in).
create or replace function put_handoff(p_code text, p_refresh_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_code is null or length(p_code) < 32 or length(p_code) > 128 then raise exception 'bad_code'; end if;
  if p_refresh_token is null or length(p_refresh_token) < 8 or length(p_refresh_token) > 512 then raise exception 'bad_token'; end if;
  delete from auth_handoffs where created_at < now() - interval '10 minutes';
  insert into auth_handoffs (code_hash, refresh_token)
  values (encode(digest(p_code, 'sha256'), 'hex'), p_refresh_token)
  on conflict (code_hash) do nothing;   -- a code can only ever be filled once
end $$;

-- Called by the installed app (not signed in yet). Returns the sign-in once, then it's gone.
create or replace function claim_handoff(p_code text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if p_code is null or length(p_code) < 32 or length(p_code) > 128 then return null; end if;
  delete from auth_handoffs
   where code_hash = encode(digest(p_code, 'sha256'), 'hex') and created_at > now() - interval '10 minutes'
  returning refresh_token into t;
  return t;
end $$;

revoke execute on function put_handoff(text, text) from public, anon;
revoke execute on function claim_handoff(text) from public;
grant execute on function put_handoff(text, text) to authenticated;
grant execute on function claim_handoff(text) to anon, authenticated;
