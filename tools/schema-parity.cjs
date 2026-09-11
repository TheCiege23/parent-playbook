#!/usr/bin/env node
'use strict';

/**
 * Prove that the committed migrations reproduce the production schema.
 *
 * The acquisition constraint in FITMATCH-PARITY-PLAN.md is that an acquirer must be able to
 * operate this independently. For the database that means one falsifiable claim: a cluster built
 * from supabase/migrations/ alone is object-for-object identical to the live project.
 *
 *   node tools/schema-parity.cjs --capture <out.json>
 *       Build a throwaway cluster from the migrations and write its inventory. Disposes the
 *       cluster afterwards. Requires a local PostgreSQL; see tests/db/README.md.
 *
 *   node tools/schema-parity.cjs --compare <production.json> <restored.json>
 *       Diff two inventories and report every object that differs. Exit 1 on any difference.
 *
 * The production inventory is captured separately by running tests/db/inventory.sql against the
 * live project; this script never connects to it. Nothing here reads or writes row data.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..');
const DB_DIR = path.join(REPO, 'tests', 'db');

function fail(message) { console.error(message); process.exit(1); }

// ---------------------------------------------------------------- capture
function capture(outPath) {
  if (!outPath) fail('Usage: node tools/schema-parity.cjs --capture <out.json>');
  // Reuse the disposable-cluster harness rather than reimplementing it. --inventory tells run.cjs
  // to emit the inventory instead of running the security suite.
  const result = spawnSync(process.execPath, [path.join(DB_DIR, 'run.cjs'), '--inventory', outPath],
    { encoding: 'utf8', stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) fail('Building the restored cluster failed.');
  if (!fs.existsSync(outPath)) fail('The harness did not write ' + outPath);
  const inv = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  console.log('\nrestored inventory: ' + inv.total + ' objects, fingerprint ' + inv.schema_fingerprint);
}

// ---------------------------------------------------------------- compare
function loadInventory(file, label) {
  if (!fs.existsSync(file)) fail('Missing ' + label + ' inventory: ' + file);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail('Could not parse ' + label + ' inventory: ' + error.message); }
  // psql -A -t of a jsonb column gives the object directly; a wrapped {inventory:{...}} is also fine.
  const inv = parsed.inventory || parsed;
  if (!inv || typeof inv.objects !== 'object') fail(label + ' inventory has no objects map.');
  return inv;
}

function compare(productionFile, restoredFile) {
  if (!productionFile || !restoredFile) {
    fail('Usage: node tools/schema-parity.cjs --compare <production.json> <restored.json>');
  }
  const production = loadInventory(productionFile, 'production');
  const restored = loadInventory(restoredFile, 'restored');

  const onlyInProduction = [];
  const onlyInRestored = [];
  const different = [];

  for (const [key, value] of Object.entries(production.objects)) {
    if (!(key in restored.objects)) onlyInProduction.push(key);
    else if (restored.objects[key] !== value) different.push({ key, production: value, restored: restored.objects[key] });
  }
  for (const key of Object.keys(restored.objects)) {
    if (!(key in production.objects)) onlyInRestored.push(key);
  }

  const identical = production.schema_fingerprint === restored.schema_fingerprint;
  console.log('SCHEMA PARITY — migrations vs live project');
  console.log('  production : ' + production.total + ' objects, fingerprint ' + production.schema_fingerprint);
  console.log('  restored   : ' + restored.total + ' objects, fingerprint ' + restored.schema_fingerprint);
  console.log('  identical  : ' + identical);
  console.log('');
  console.log('  counts by kind');
  const kinds = [...new Set([...Object.keys(production.counts || {}), ...Object.keys(restored.counts || {})])].sort();
  for (const kind of kinds) {
    const p = (production.counts || {})[kind] ?? 0;
    const r = (restored.counts || {})[kind] ?? 0;
    console.log('    ' + kind.padEnd(11) + String(p).padStart(5) + ' prod  ' + String(r).padStart(5) + ' restored' + (p === r ? '' : '   <-- differs'));
  }

  const section = (title, rows, render) => {
    if (!rows.length) return;
    console.log('\n  ' + title + ' (' + rows.length + ')');
    for (const row of rows.slice(0, 60)) console.log('    ' + render(row));
    if (rows.length > 60) console.log('    … ' + (rows.length - 60) + ' more');
  };
  section('IN PRODUCTION ONLY — the migrations do not create these', onlyInProduction, k => k);
  section('IN RESTORE ONLY — the migrations create these but production lacks them', onlyInRestored, k => k);
  section('DIFFERENT', different, d =>
    d.key + '\n        prod     : ' + String(d.production).slice(0, 300) +
    '\n        restored : ' + String(d.restored).slice(0, 300));

  const total = onlyInProduction.length + onlyInRestored.length + different.length;
  console.log('\n  differences: ' + total);
  if (total === 0) {
    console.log('\nThe committed migrations reproduce the production schema exactly.');
  } else {
    console.log('\nThe committed migrations do NOT reproduce production. Each difference above is either');
    console.log('a change made to production outside a migration, or a migration that does not match');
    console.log('what was actually applied. Both are reasons an acquirer could not stand this up.');
  }
  process.exitCode = total === 0 ? 0 : 1;
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === '--capture') capture(rest[0]);
else if (mode === '--compare') compare(rest[0], rest[1]);
else fail('Usage:\n  node tools/schema-parity.cjs --capture <out.json>\n  node tools/schema-parity.cjs --compare <production.json> <restored.json>');
