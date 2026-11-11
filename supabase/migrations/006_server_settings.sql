-- EcoPulse migration 006: private key–value store for the server (e.g. the auto-renewed GFW API key).
-- Run once in Supabase → SQL Editor. Safe to re-run. Nobody but the server can read this table.
create table if not exists server_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table server_settings enable row level security;   -- no policies = invisible to the public
revoke all on server_settings from anon, authenticated;
grant all on server_settings to service_role;
