-- Bring the auto-RLS guardrail into the migration history.
--
-- public.rls_auto_enable() and the `ensure_rls` event trigger exist in the live project but were
-- never created by a migration. Found on 2026-09-10 by tools/schema-parity.cjs, which builds a
-- cluster from supabase/migrations/ alone and diffs it against production: this function was the
-- single object present in production and absent from the restore.
--
-- That gap is material rather than cosmetic. The trigger fires on ddl_command_end and enables row
-- level security on every new table in public, which is why all 53 public tables have RLS on. An
-- acquirer restoring from this repository would get a database without that guardrail, and the
-- next table added there would silently be created without RLS. Reproducing production means
-- reproducing its defences, not only its tables.
--
-- The body below is production's byte for byte, including its original casing and indentation.
-- Schema parity compares md5(prosrc), so reformatting it — as a first draft of this migration did
-- — makes the restore differ from production even though the behaviour is identical. Capturing an
-- existing object means capturing its bytes, not a tidied version of them.
-- Verified: md5(prosrc) = 99be20677b456ea8d3be47bdd44fb369, length 953.
--
-- Applying this to the live project is a no-op for the function and the trigger; the only change
-- it makes there is the privilege tightening at the end.

create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- `create event trigger` has no IF NOT EXISTS, and this migration must be safe to apply to the
-- live project where the trigger already exists.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
    raise notice 'created event trigger ensure_rls';
  else
    raise notice 'event trigger ensure_rls already present';
  end if;
end $$;

-- An event-trigger function cannot be invoked directly — PostgreSQL refuses to call it outside
-- event-trigger context — so the EXECUTE grant PUBLIC holds here is not exploitable. It is still
-- reported by Supabase's anon_security_definer_function_executable advisor, and nothing needs it:
-- the event trigger mechanism invokes the function as its owner without consulting EXECUTE.
-- tests/db case K05 proves the guardrail still fires after this revoke.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
