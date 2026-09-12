-- Canonical schema inventory.
--
-- The same query runs against a cluster restored from supabase/migrations/ and against the live
-- Supabase project. If the two fingerprints match, the committed migrations reproduce production
-- exactly, which is the acquisition constraint in FITMATCH-PARITY-PLAN.md: an acquirer must be
-- able to stand this database up from the repository alone.
--
-- Every row is (kind, identity, fingerprint). Identity is stable across clusters; fingerprint is
-- the content that must match. Deliberately excluded: row data, object OIDs, sizes, statistics and
-- anything else that legitimately differs between a fresh restore and a live database.
--
-- Only `public` and `private` are compared. Supabase manages auth, storage, realtime, graphql and
-- extensions itself; those are platform surface, not this repository's to reproduce.

with schemas as (select unnest(array['public','private']) as nspname),

tables as (
  select 'table' as kind,
         n.nspname||'.'||c.relname as identity,
         c.relkind::text||'|rls='||c.relrowsecurity::text||'|force='||c.relforcerowsecurity::text as fingerprint
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (select nspname from schemas) and c.relkind in ('r','p','v','m')
),

columns as (
  select 'column' as kind,
         n.nspname||'.'||c.relname||'.'||a.attname as identity,
         format_type(a.atttypid,a.atttypmod)
           ||'|notnull='||a.attnotnull::text
           ||'|default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'-') as fingerprint
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname in (select nspname from schemas)
    and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
),

constraints as (
  select 'constraint' as kind,
         n.nspname||'.'||c.relname||'.'||con.conname as identity,
         pg_get_constraintdef(con.oid) as fingerprint
  from pg_constraint con
  join pg_class c on c.oid=con.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (select nspname from schemas)
    and con.contype <> 'n'
),

indexes as (
  select 'index' as kind,
         schemaname||'.'||tablename||'.'||indexname as identity,
         indexdef as fingerprint
  from pg_indexes
  where schemaname in (select nspname from schemas)
),

policies as (
  select 'policy' as kind,
         n.nspname||'.'||c.relname||'.'||p.polname as identity,
         p.polcmd::text
           ||'|permissive='||p.polpermissive::text
           ||'|roles='||coalesce((select string_agg(pg_get_userbyid(r), ',' order by pg_get_userbyid(r))
                                  from unnest(p.polroles) r),'-')
           ||'|using='||coalesce(pg_get_expr(p.polqual,p.polrelid),'-')
           ||'|check='||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'-') as fingerprint
  from pg_policy p
  join pg_class c on c.oid=p.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (select nspname from schemas)
),

triggers as (
  select 'trigger' as kind,
         n.nspname||'.'||c.relname||'.'||t.tgname as identity,
         pg_get_triggerdef(t.oid) as fingerprint
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in (select nspname from schemas) and not t.tgisinternal
),

-- Function bodies are compared by md5 of prosrc: exact, and independent of how a given server
-- version chooses to pretty-print pg_get_functiondef().
functions as (
  select 'function' as kind,
         n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as identity,
         'body='||md5(p.prosrc)
           ||'|lang='||l.lanname
           ||'|volatile='||p.provolatile::text
           ||'|secdef='||p.prosecdef::text
           ||'|config='||coalesce(array_to_string(p.proconfig,','),'-')
           ||'|returns='||pg_get_function_result(p.oid) as fingerprint
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  join pg_language l on l.oid=p.prolang
  where n.nspname in (select nspname from schemas)
    and not exists (select 1 from pg_depend dep where dep.objid=p.oid and dep.classid='pg_proc'::regclass and dep.deptype='e')
),

-- Table privileges for the roles a tenant can actually be. This is what the 2026-09-10 TRUNCATE
-- sweep changed, so schema parity has to cover it or the fix could silently regress.
table_grants as (
  select 'grant' as kind,
         n.nspname||'.'||c.relname||'.'||g.role as identity,
         coalesce((select string_agg(pr.priv,',' order by pr.priv)
                   from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as pr(priv)
                   where has_table_privilege(g.role, c.oid, pr.priv)),'(none)') as fingerprint
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join unnest(array['anon','authenticated']) as g(role)
  where n.nspname in (select nspname from schemas) and c.relkind in ('r','p')
),

-- Event triggers are cluster-scoped, not schema-scoped, so a schema-only inventory misses them
-- entirely. That is exactly how the ensure_rls guardrail stayed out of the migration history
-- unnoticed. Only those whose function lives in public or private are compared; the rest belong
-- to Supabase (pgrst_ddl_watch, issue_pg_cron_access and friends live in extensions).
event_triggers as (
  select 'event_trigger' as kind,
         et.evtname as identity,
         et.evtevent||'|enabled='||et.evtenabled::text
           ||'|function='||n.nspname||'.'||p.proname as fingerprint
  from pg_event_trigger et
  join pg_proc p on p.oid = et.evtfoid
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (select nspname from schemas)
),

everything as (
  select * from tables      union all select * from columns
  union all select * from constraints union all select * from indexes
  union all select * from policies   union all select * from triggers
  union all select * from functions  union all select * from table_grants
  union all select * from event_triggers
)

-- Ordered by bytes, not by the database's collation. A plain `order by kind, identity` sorts
-- through lc_collate, and en_US.UTF-8 orders "public.athletes" against "public.athlete_access" the
-- opposite way from C -- so two clusters holding byte-for-byte identical objects produced two
-- different fingerprints, and the parity claim failed for a reason that had nothing to do with the
-- schema. Per-object comparison was never affected; only this one summary number was, which is
-- exactly the number a reader looks at first.
-- The separators below are the bytes 0x01 and 0x02, written as escapes rather than typed in
-- literally. They are the right choice -- no identity or fingerprint can contain them, so the
-- concatenation is unambiguous -- but as raw bytes they made this file binary to git and grep, and
-- they render as nothing, so the expression reads as `kind||''||identity` and invites the reader
-- to reimplement it with empty separators. That misreading cost real time: a hand-typed copy of
-- this aggregate produced a different hash from the same schema, which looks exactly like drift.
select jsonb_build_object(
  'schema_fingerprint', md5(string_agg(kind||E'\x01'||identity||E'\x01'||fingerprint, E'\x02' order by (kind||''||identity) collate "C")),
  'counts', (select jsonb_object_agg(kind, n) from (select kind, count(*) as n from everything group by kind) c),
  'total', count(*),
  'objects', jsonb_object_agg(kind||' '||identity, fingerprint)
) as inventory
from everything;
