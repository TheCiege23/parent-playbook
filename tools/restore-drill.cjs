#!/usr/bin/env node
'use strict';

/**
 * Check a restored database against the database it was restored from.
 *
 * tests/db/restore-deletion.cjs rehearses a logical dump and restore on a disposable cluster. It cannot
 * look at a restore made by the hosting provider: a backup restored into a new project, or a point-in-time
 * recovery. That is the restore a real incident would use, and none has been checked. This is the check
 * to run when one is made. OPERATIONS.md describes the whole drill.
 *
 *   PP_RESTORE_SOURCE=<postgres URL of the database the backup came from>
 *   PP_RESTORE_TARGET=<postgres URL of the restored copy>
 *   node tools/restore-drill.cjs [--psql <path>] [--allow-row-drift] [--json]
 *
 * Both are ordinary postgresql:// connection URLs, including the user and password. Keep them in the
 * environment or a secret store; never commit one.
 *
 * Connection strings are read from the environment and handed to psql as PG* environment variables, never
 * as command-line arguments, which other processes on the machine can read. Every query is read-only and
 * reads no row content: object inventories, flags, privileges, job names and counts. Connect as a role that
 * can see every row (the project's owner role); a role subject to row-level security undercounts.
 *
 *   schema      tables, columns, constraints, indexes, policies, triggers, functions, grants and event
 *               triggers in public and private are identical (tests/db/inventory.sql, the query behind the
 *               schema-parity evidence)
 *   rls         the same public tables have row-level security enabled, and there is at least one
 *   privileges  the restored copy grants anon and authenticated no TRUNCATE, TRIGGER or REFERENCES
 *   retention   every retention job registered on the source is registered, and active, on the copy
 *   rows        every public table holds the same number of rows
 *   auth_users  auth.users holds the same number of rows
 *
 * A restore to an earlier moment legitimately differs in row counts. Pass --allow-row-drift and those
 * differences are reported without failing.
 *
 * Not established here, and listed in OPERATIONS.md: that the backup is recent, that storage objects
 * (photos, reports) came back (they are not in the database), that edge functions, secrets and auth
 * settings match, or that scheduled jobs fire on the restored copy.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEMA = 'PP_RESTORE_DRILL_V1';
const INVENTORY_SQL = path.join(__dirname, '..', 'tests', 'db', 'inventory.sql');

const QUERIES = Object.freeze({
  rls: `select coalesce(string_agg(c.relname, ',' order by c.relname), '')
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity;`,
  excessGrants: `select coalesce(string_agg(grantee || ':' || table_name || ':' || privilege_type, ',' order by grantee, table_name, privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public' and grantee in ('anon', 'authenticated')
           and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');`,
  retention: `select coalesce(jsonb_object_agg(jobname, active), '{}'::jsonb)::text from cron.job where jobname like '%retention%';`,
  // One statement, no row content: count(*) per table through query_to_xml.
  rows: `select coalesce(jsonb_object_agg(t.relname, t.n), '{}'::jsonb)::text from (
           select c.relname,
                  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint as n
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r') t;`,
  authUsers: `select count(*)::text from auth.users;`,
});

// A postgres URL becomes PG* environment variables, so no secret reaches a process's argument list.
function connectionEnv(url, label = 'connection') {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(label + ' is not a postgresql:// URL'); }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error(label + ' must be a postgresql:// URL');
  const env = {
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: parsed.port || '5432',
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres',
  };
  if (!env.PGHOST) throw new Error(label + ' has no host');
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

function runPsql(psql, connection, sql) {
  const file = path.join(os.tmpdir(), 'pp-restore-drill-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.sql');
  fs.writeFileSync(file, sql, 'utf8');
  try {
    // PGDATABASE etc. from the parent are replaced, never merged, so a stray variable cannot redirect a query.
    const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG[A-Z]+$/.test(k)));
    return execFileSync(psql, ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file],
      { env: { ...base, ...connection }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (error) {
    const text = ((error.stderr || '') + (error.stdout || '')).trim();
    throw new Error((text.split('\n').find(line => /ERROR|FATAL|could not/.test(line)) || text.split('\n')[0] || error.message).trim());
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}

function snapshot(psql, connection) {
  const attempt = fn => { try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, error: error.message }; } };
  const q = sql => runPsql(psql, connection, sql);
  return {
    inventory: attempt(() => JSON.parse(q(fs.readFileSync(INVENTORY_SQL, 'utf8')))),
    rls: attempt(() => q(QUERIES.rls)),
    excessGrants: attempt(() => q(QUERIES.excessGrants)),
    retention: attempt(() => JSON.parse(q(QUERIES.retention))),
    rows: attempt(() => JSON.parse(q(QUERIES.rows))),
    authUsers: attempt(() => Number(q(QUERIES.authUsers))),
  };
}

// A logical dump prints a CHECK such as `x between 1 and 180 and x = btrim(x)` with its ANDs flattened, and the
// restored server keeps them flat, so the same constraint deparses as ((a AND b) AND c) on one side and
// (a AND b AND c) on the other. Found on the disposable cluster's own dump and restore: 15 constraints, every
// one of them this. An AND chain means the same however it is grouped, so that is formatting, not schema.
// It is reported, never hidden, and anything containing OR, NOT or CASE is never treated this way, because
// there grouping changes meaning. String literals must match exactly.
function formattingOnly(a, b) {
  const LITERAL = /'(?:[^']|'')*'/g;
  const outside = s => s.replace(LITERAL, "''");
  if (/\b(OR|NOT|CASE)\b/.test(outside(a)) || /\b(OR|NOT|CASE)\b/.test(outside(b))) return false;
  const literals = s => (s.match(LITERAL) || []).join('\u0000');
  const bare = s => outside(s).replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  return literals(a) === literals(b) && bare(a) === bare(b);
}

function diffInventories(source, target) {
  const onlyInSource = [];
  const onlyInTarget = [];
  const different = [];
  const formatting = [];
  for (const [key, value] of Object.entries(source.objects || {})) {
    if (!(key in (target.objects || {}))) onlyInSource.push(key);
    else if (target.objects[key] !== value) {
      if (formattingOnly(value, target.objects[key])) formatting.push(key);
      else different.push({ key, source: value, target: target.objects[key] });
    }
  }
  for (const key of Object.keys(target.objects || {})) if (!(key in (source.objects || {}))) onlyInTarget.push(key);
  return { onlyInSource, onlyInTarget, different, formatting, total: onlyInSource.length + onlyInTarget.length + different.length };
}

function compareCounts(source, target) {
  const tables = [...new Set([...Object.keys(source), ...Object.keys(target)])].sort();
  return tables
    .filter(table => source[table] !== target[table])
    .map(table => ({ table, source: table in source ? source[table] : null, target: table in target ? target[table] : null }));
}

// Pure: two snapshots in, the verdict out. Kept separate so it is tested without a database.
function evaluate(source, target, { allowRowDrift = false } = {}) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  const both = key => {
    if (!source[key].ok) return 'source: ' + source[key].error;
    if (!target[key].ok) return 'target: ' + target[key].error;
    return null;
  };

  let problem = both('inventory');
  if (problem) add('schema', false, problem);
  else {
    const diff = diffInventories(source.inventory.value, target.inventory.value);
    add('schema', diff.total === 0, diff.total === 0
      ? { objects: source.inventory.value.total, formattingOnly: diff.formatting }
      : { differences: diff.total, onlyInSource: diff.onlyInSource.slice(0, 20), onlyInTarget: diff.onlyInTarget.slice(0, 20), different: diff.different.slice(0, 20), formattingOnly: diff.formatting });
  }

  problem = both('rls');
  if (problem) add('rls', false, problem);
  else {
    const same = source.rls.value === target.rls.value;
    add('rls', same && target.rls.value !== '', same
      ? (target.rls.value === '' ? 'no table has row-level security enabled on either side' : target.rls.value.split(',').length + ' tables with row-level security on both')
      : { lostOnTarget: source.rls.value.split(',').filter(t => t && !target.rls.value.split(',').includes(t)), onlyOnTarget: target.rls.value.split(',').filter(t => t && !source.rls.value.split(',').includes(t)) });
  }

  if (!target.excessGrants.ok) add('privileges', false, 'target: ' + target.excessGrants.error);
  else add('privileges', target.excessGrants.value === '', target.excessGrants.value === '' ? 'no TRUNCATE, TRIGGER or REFERENCES for anon or authenticated' : target.excessGrants.value.split(','));

  problem = both('retention');
  if (problem) add('retention', false, problem);
  else {
    const sourceJobs = Object.keys(source.retention.value);
    const missing = sourceJobs.filter(job => !(job in target.retention.value));
    const inactive = sourceJobs.filter(job => job in target.retention.value && target.retention.value[job] !== true);
    add('retention', sourceJobs.length > 0 && missing.length === 0 && inactive.length === 0,
      sourceJobs.length === 0 ? 'the source has no retention jobs to compare' : missing.length || inactive.length ? { missing, inactive } : sourceJobs.length + ' retention jobs registered and active');
  }

  problem = both('rows');
  if (problem) add('rows', false, problem);
  else {
    const drift = compareCounts(source.rows.value, target.rows.value);
    const tables = Object.keys(source.rows.value).length;
    add('rows', tables > 0 && (drift.length === 0 || allowRowDrift),
      drift.length === 0 ? tables + ' tables with identical row counts' : { tablesCompared: tables, drift, allowed: allowRowDrift });
  }

  problem = both('authUsers');
  if (problem) add('auth_users', false, problem);
  else {
    const same = source.authUsers.value === target.authUsers.value;
    add('auth_users', same || allowRowDrift, same ? source.authUsers.value + ' on both' : { source: source.authUsers.value, target: target.authUsers.value, allowed: allowRowDrift });
  }

  return { schema: SCHEMA, ok: checks.every(check => check.ok), allowRowDrift, checks };
}

function main(argv, env) {
  const at = argv.indexOf('--psql');
  const psql = at === -1 ? 'psql' : argv[at + 1];
  const json = argv.includes('--json');
  const allowRowDrift = argv.includes('--allow-row-drift');
  if (!env.PP_RESTORE_SOURCE || !env.PP_RESTORE_TARGET) {
    console.error('Set PP_RESTORE_SOURCE and PP_RESTORE_TARGET to postgresql:// URLs, then run node tools/restore-drill.cjs [--psql <path>] [--allow-row-drift] [--json]');
    return 2;
  }
  let source, target;
  try {
    source = connectionEnv(env.PP_RESTORE_SOURCE, 'PP_RESTORE_SOURCE');
    target = connectionEnv(env.PP_RESTORE_TARGET, 'PP_RESTORE_TARGET');
  } catch (error) { console.error(error.message); return 2; }
  if (source.PGHOST === target.PGHOST && source.PGPORT === target.PGPORT && source.PGDATABASE === target.PGDATABASE) {
    console.error('PP_RESTORE_SOURCE and PP_RESTORE_TARGET name the same database; a drill compares a restore with its source.');
    return 2;
  }
  const result = evaluate(snapshot(psql, source), snapshot(psql, target), { allowRowDrift });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('RESTORE DRILL');
    for (const check of result.checks) {
      console.log('  ' + (check.ok ? 'PASS ' : 'FAIL ') + check.id.padEnd(11) + (typeof check.detail === 'string' ? check.detail : JSON.stringify(check.detail)));
    }
    console.log(result.ok ? '\nThe restored copy matches its source on every check above.' : '\nThe restored copy does NOT match its source.');
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);

module.exports = { SCHEMA, QUERIES, connectionEnv, formattingOnly, diffInventories, compareCounts, evaluate, main };
