-- Backfill migration: public.app_admins was created out-of-band (SQL editor) on
-- production and was never tracked in supabase_migrations.schema_migrations.
-- That broke branch creation, which replays tracked migration statements from
-- scratch and fails as soon as trainer_marketplace_enums_tables tries to
-- insert into an app_admins table that was never created by a migration.
--
-- Table only, no policy here: trainer_marketplace_rls_policies (20260806160517)
-- already creates app_admins_read using private.is_admin(), and is_admin()
-- itself isn't defined until trainer_marketplace_helpers (20260806160447) --
-- both run after this migration, so this must not try to create that policy.
--
-- On production this is a no-op (the table already exists in this exact
-- shape); it only registers the table's creation in migration history,
-- positioned before trainer_marketplace_enums_tables, so fresh branches
-- build it in the right order.

create table if not exists public.app_admins (
  guardian_id uuid primary key references public.guardians(id) on delete cascade,
  created_at timestamptz default now()
);

alter table public.app_admins enable row level security;
