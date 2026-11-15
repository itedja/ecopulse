-- 019: let the server (the screening job) read and update the Aksi tables.
-- Migration 018 closed these tables to everyone; the screening job runs as the server role and
-- needs its own explicit permission, like the other server-only tables. Safe to run more than once.
grant all on aksi_members, aksi_posts, aksi_reactions, aksi_comments, aksi_flags, aksi_appeals to service_role;

-- Check. Expected: 6
select count(*) as server_can_use
from information_schema.tables t
where t.table_schema = 'public' and t.table_name like 'aksi\_%'
  and has_table_privilege('service_role', format('public.%I', t.table_name), 'select, insert, update, delete');
