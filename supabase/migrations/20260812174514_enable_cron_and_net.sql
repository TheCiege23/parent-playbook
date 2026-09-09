-- Scheduling primitives for the weekly push. The job itself is created separately, once
-- the service role key exists in Vault — a cron job that fires and fails every Sunday is
-- worse than no cron job, because the failure is silent and weekly.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;;
