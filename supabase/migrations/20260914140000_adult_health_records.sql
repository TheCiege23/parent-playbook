-- Adult Training: one source-tracked record for a parent's own body and activity readings.
--
-- Until now a parent's weight and tape measurements lived in adult_body_entries, typed in and nothing else. Readings
-- will arrive from more places: a file exported from a scale or fitness app now, Apple Health, Health Connect and
-- Bluetooth equipment later. Keeping one table per source would let the same morning's weight be counted twice and
-- would lose where each number came from. This makes a single record:
--
--   - public.adult_health_records holds every reading, with the kind of source (typed in, or a file import), the
--     source's name, and how the number was obtained: entered by the parent, measured by a device, or estimated by
--     one. private.adult_health_metric_ok() fixes, per reading, the units, the methods a source may claim and a
--     sane range. A tape measurement is only ever entered; steps are only ever an estimate; nothing here accepts a
--     body-composition value, which waits for its own import with its own rules;
--   - public.adult_health_import_batches records each import, so a parent can see what arrived and undo it:
--     deleting a batch deletes exactly the readings it added;
--   - duplicates are refused by the database, not just the browser. A reading carrying the source's own id is unique
--     per source and id; one without is unique per source, day, value and unit. Re-importing the same file adds
--     nothing;
--   - public.save_adult_health_import() writes a batch and its readings in one transaction as the signed-in guardian,
--     skips duplicates, and is safe to retry;
--   - existing adult_body_entries rows move across as typed-in readings, and that table is dropped.
--
-- Same access as the rest of the parent's own record (20260914120000): theirs alone, writes need the allowlist,
-- reading and deleting do not. A reading cannot be edited; a correction is a delete and a new reading.

-- ---------------------------------------------------------------------------------------------
-- What a reading may say. Mirrored by ADULT_HEALTH_METRICS in js/adult-health-record.js, and a test holds the two
-- together. Runs as whoever writes the row (it is a CHECK), so it stays executable; it reads only its arguments.
create or replace function private.adult_health_metric_ok(metric text, unit text, value numeric, method text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(case
    when metric = 'weight' then unit in ('lb', 'kg') and method in ('entered', 'device_measured') and value > 0 and value < 2000
    when metric = 'waist' then unit in ('in', 'cm') and method in ('entered') and value > 0 and value < 2000
    when metric = 'hips' then unit in ('in', 'cm') and method in ('entered') and value > 0 and value < 2000
    when metric = 'chest' then unit in ('in', 'cm') and method in ('entered') and value > 0 and value < 2000
    when metric = 'arm' then unit in ('in', 'cm') and method in ('entered') and value > 0 and value < 2000
    when metric = 'thigh' then unit in ('in', 'cm') and method in ('entered') and value > 0 and value < 2000
    when metric = 'steps' then unit in ('steps') and method in ('entered', 'device_estimated') and value >= 0 and value <= 200000 and value = trunc(value)
    when metric = 'active_minutes' then unit in ('min') and method in ('entered', 'device_estimated') and value >= 0 and value <= 1440 and value = trunc(value)
    when metric = 'workout_minutes' then unit in ('min') and method in ('entered', 'device_measured') and value >= 0 and value <= 1440 and value = trunc(value)
    when metric = 'distance' then unit in ('mi', 'km') and method in ('entered', 'device_estimated') and value >= 0 and value < 1000
    when metric = 'resting_heart_rate' then unit in ('bpm') and method in ('entered', 'device_measured') and value >= 20 and value <= 250 and value = trunc(value)
    else false
  end, false);
$$;

-- ---------------------------------------------------------------------------------------------
-- Imports.
create table if not exists public.adult_health_import_batches (
  -- Chosen by the browser, so a retried save is recognised as the same import.
  id uuid primary key,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null,
  source_name text not null,
  -- Whether the file came from a device or app ('device') or from the parent's own records ('own_records').
  origin text not null,
  received_at timestamptz not null default now(),
  rows_received integer not null,
  rows_saved integer not null default 0,
  rows_duplicate integer not null default 0,
  rows_rejected integer not null default 0,
  constraint adult_health_import_batches_id_guardian_key unique (id, guardian_id),
  constraint adult_health_import_batches_kind_check check (source_kind = 'file_import'),
  constraint adult_health_import_batches_name_check check (length(source_name) between 1 and 80),
  constraint adult_health_import_batches_origin_check check (origin in ('device', 'own_records')),
  constraint adult_health_import_batches_counts_check
    check (rows_received between 0 and 5000 and rows_saved >= 0 and rows_duplicate >= 0 and rows_rejected >= 0)
);
create index if not exists adult_health_import_batches_guardian_idx on public.adult_health_import_batches (guardian_id, received_at desc);

-- ---------------------------------------------------------------------------------------------
-- Readings.
create table if not exists public.adult_health_records (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references auth.users(id) on delete cascade,
  metric_key text not null,
  value numeric not null,
  unit text not null,
  -- The family's calendar day the reading belongs to.
  measured_on date not null,
  source_kind text not null,
  source_name text,
  method text not null,
  -- The source's own identifier for this reading, when the file carries one.
  external_id text,
  batch_id uuid,
  created_at timestamptz not null default now(),
  constraint adult_health_records_metric_check check (private.adult_health_metric_ok(metric_key, unit, value, method)),
  constraint adult_health_records_source_check check (
    (source_kind = 'manual' and batch_id is null and source_name is null and external_id is null and method = 'entered')
    or (source_kind = 'file_import' and batch_id is not null and source_name is not null)),
  constraint adult_health_records_name_check check (source_name is null or length(source_name) between 1 and 80),
  constraint adult_health_records_external_id_check check (external_id is null or length(external_id) between 1 and 120),
  constraint adult_health_records_date_check check (measured_on >= date '1900-01-01'),
  -- A reading can only belong to an import of the same guardian, and goes when that import is undone.
  constraint adult_health_records_batch_fkey foreign key (batch_id, guardian_id)
    references public.adult_health_import_batches (id, guardian_id) on delete cascade
);
create index if not exists adult_health_records_guardian_idx on public.adult_health_records (guardian_id, metric_key, measured_on desc);
create index if not exists adult_health_records_batch_idx on public.adult_health_records (batch_id, guardian_id);

-- Duplicate prevention. js/adult-health-record.js builds the same keys (adultHealthKey) to show a parent what an
-- import would add before it is saved; these make it true whichever client writes.
create unique index if not exists adult_health_records_external_key
  on public.adult_health_records (guardian_id, source_kind, lower(source_name), metric_key, external_id)
  where external_id is not null;
create unique index if not exists adult_health_records_reading_key
  on public.adult_health_records (guardian_id, source_kind, coalesce(lower(source_name), ''), metric_key, measured_on, value, unit)
  where external_id is null;

-- ---------------------------------------------------------------------------------------------
-- The milestone 1 entries move across as typed-in readings.
insert into public.adult_health_records (guardian_id, metric_key, value, unit, measured_on, source_kind, method, created_at)
select e.guardian_id, e.metric_key, e.value, e.unit, e.measured_on, 'manual', 'entered', e.created_at
  from public.adult_body_entries e
on conflict do nothing;
drop table public.adult_body_entries;

-- ---------------------------------------------------------------------------------------------
-- Access: the guardian, and only the guardian. Creating also needs the allowlist; a reading dated more than a day ahead
-- is refused (a day, because the family's date and the server's can differ). Readings have no UPDATE. An import's
-- counts are updated by the save below, so batches do.
alter table public.adult_health_import_batches enable row level security;
alter table public.adult_health_records enable row level security;

create policy adult_health_import_batches_select on public.adult_health_import_batches for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_health_import_batches_delete on public.adult_health_import_batches for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_health_import_batches_insert on public.adult_health_import_batches for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());
create policy adult_health_import_batches_update on public.adult_health_import_batches for update to authenticated
  using (guardian_id = (select auth.uid())) with check (guardian_id = (select auth.uid()) and private.adult_training_allowed());

create policy adult_health_records_select on public.adult_health_records for select to authenticated using (guardian_id = (select auth.uid()));
create policy adult_health_records_delete on public.adult_health_records for delete to authenticated using (guardian_id = (select auth.uid()));
create policy adult_health_records_insert on public.adult_health_records for insert to authenticated
  with check (guardian_id = (select auth.uid()) and private.adult_training_allowed() and measured_on <= current_date + 1);

revoke all on public.adult_health_import_batches, public.adult_health_records from anon, authenticated;
grant select, insert, update, delete on public.adult_health_import_batches to authenticated;
grant select, insert, delete on public.adult_health_records to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The save. Security invoker, so row-level security applies exactly as it would to the caller writing the rows. A
-- duplicate is skipped rather than failing the import; any other invalid reading fails the whole import, so a file is
-- never half-saved. Calling it again with the same batch id adds nothing and leaves the counts true.
create or replace function public.save_adult_health_import(p_batch jsonb, p_records jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_count integer;
  v_received integer;
  v_rejected integer;
  v_saved integer;
begin
  if v_actor is null then
    raise exception 'Sign in to import readings.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_batch) is distinct from 'object' or jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'An import needs its details and its readings.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_records);
  if v_count < 1 or v_count > 2000 then
    raise exception 'An import saves between 1 and 2000 readings.' using errcode = '22023';
  end if;
  v_id := (p_batch->>'id')::uuid;
  v_rejected := coalesce((p_batch->>'rows_rejected')::integer, 0);
  v_received := coalesce((p_batch->>'rows_received')::integer, v_count + v_rejected);
  if v_id is null or v_rejected < 0 or v_received < v_count + v_rejected then
    raise exception 'That import''s counts do not add up.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_records) r where jsonb_typeof(r) is distinct from 'object') then
    raise exception 'Every reading must be an object.' using errcode = '22023';
  end if;

  insert into public.adult_health_import_batches (id, guardian_id, source_kind, source_name, origin, rows_received, rows_rejected)
  values (v_id, v_actor, 'file_import', p_batch->>'source_name', p_batch->>'origin', v_received, v_rejected)
  on conflict (id) do nothing;

  insert into public.adult_health_records (guardian_id, metric_key, value, unit, measured_on, source_kind, source_name, method, external_id, batch_id)
  select v_actor, r->>'metric_key', (r->>'value')::numeric, r->>'unit', (r->>'measured_on')::date, 'file_import',
         b.source_name, r->>'method', nullif(r->>'external_id', ''), v_id
    from jsonb_array_elements(p_records) r
    cross join (select source_name from public.adult_health_import_batches where id = v_id and guardian_id = v_actor) b
  on conflict do nothing;

  select count(*) into v_saved from public.adult_health_records where batch_id = v_id and guardian_id = v_actor;
  update public.adult_health_import_batches
     set rows_saved = v_saved, rows_duplicate = greatest(rows_received - rows_rejected - v_saved, 0)
   where id = v_id and guardian_id = v_actor;
  if not found then
    raise exception 'That import belongs to another account.' using errcode = '42501';
  end if;

  return jsonb_build_object('batch', v_id, 'saved', v_saved, 'duplicates', greatest(v_received - v_rejected - v_saved, 0));
end;
$$;
revoke all on function public.save_adult_health_import(jsonb, jsonb) from public, anon;
grant execute on function public.save_adult_health_import(jsonb, jsonb) to authenticated;
