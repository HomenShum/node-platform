-- Optional NodeKit Supabase worker modules.
--
-- Apply only when the application capability plan requires durable background
-- jobs or schedules. The queue stays server-only: this migration does not
-- create or expose pgmq_public and grants no queue access to browser roles.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pgmq') then
    raise exception 'NodeKit Supabase workers require the pgmq extension';
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise exception 'NodeKit Supabase workers require the pg_cron extension';
  end if;
end $$;

create extension if not exists pgmq;
create extension if not exists pg_cron;

do $$
begin
  if to_regclass('pgmq.q_nodekit_jobs') is null then
    perform pgmq.create('nodekit_jobs');
  end if;
end $$;

-- Queue access is reserved for trusted workers using a direct database
-- connection. End-user JWT roles cannot enqueue, dequeue, archive, or delete.
revoke all on schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;
revoke all on all sequences in schema pgmq from public, anon, authenticated;
revoke all on all functions in schema pgmq from public, anon, authenticated;
grant usage on schema pgmq to service_role;
grant select, insert, update, delete on all tables in schema pgmq to service_role;
grant usage, select, update on all sequences in schema pgmq to service_role;
grant execute on all functions in schema pgmq to service_role;

-- Installing pg_cron proves module availability only. NodeKit does not create
-- a meaningless global schedule: each application must name the bounded worker
-- function and schedule in its own capability plan. Cron remains provisioning
-- authority and is not granted to anon/authenticated roles.
revoke all on schema cron from public, anon, authenticated;
revoke all on all tables in schema cron from public, anon, authenticated;
revoke all on all sequences in schema cron from public, anon, authenticated;
revoke all on all functions in schema cron from public, anon, authenticated;
