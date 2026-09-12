#!/usr/bin/env node
'use strict';

/**
 * Turn the candidate source list into verified facts, or into a list of things to go and check.
 *
 *   node tools/nhanes/acquire.cjs --check          ask the server what exists; download nothing
 *   node tools/nhanes/acquire.cjs --download <dir> fetch and hash into <dir>, write the lockfile
 *   node tools/nhanes/acquire.cjs --verify <dir>   rehash what is already there against the lockfile
 *
 * The reason this is a tool and not a README instruction: a study that cannot say which bytes it
 * read is not reproducible, and "I downloaded the NHANES files" is not a statement anyone can
 * check. The lockfile records a SHA-256 per file, so a later run either reads the same bytes or
 * says out loud that it did not.
 *
 * Nothing downloaded here is committed. NHANES public-use files are not secret, but they are large,
 * they belong to NCHS, and a research input that lives in an application repository ends up inside
 * a buyer package by accident. The download directory is required to be outside the repository and
 * the tool refuses if it is not.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const MANIFEST = path.join(__dirname, 'sources.json');
const LOCKFILE = path.join(__dirname, 'sources.lock.json');

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

function usage(message) {
  if (message) console.error(message + '\n');
  console.error(fs.readFileSync(__filename, 'utf8').split('/**')[1].split('*/')[0].replace(/^\s*\*ic?/gm, '').replace(/^\s*\*/gm, ''));
  process.exit(message ? 2 : 0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const allFiles = manifest.cycles.flatMap(cycle =>
  cycle.files.map(file => ({ ...file, cycle: cycle.cycle, role: cycle.role })));

/* A download directory has to be outside the repository.
 *
 * Not a style preference. tools/sdk-files.cjs is an allowlist, so a stray file would not reach the
 * buyer package by that route — but it would reach the Dockerfile's `COPY js/` and anything else
 * that copies a directory wholesale, and a hundred megabytes of survey data inside a web image is
 * a mistake nobody notices until it is deployed.
 */
function requireOutsideRepo(directory) {
  const resolved = path.resolve(directory);
  const relative = path.relative(REPO, resolved);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    usage('Choose a download directory outside this repository. NHANES files are large and belong '
      + 'to NCHS; a research input stored inside an application repository ends up in a deployed '
      + 'image or a buyer package by accident.\n  Refused: ' + resolved);
  }
  return resolved;
}

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const human = bytes => (bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB');

async function head(url) {
  try {
    // Some CDN configurations answer HEAD differently from GET, so a range request is used: it
    // proves the resource is really fetchable and reports its size, without pulling the file.
    const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const range = response.headers.get('content-range');
    const size = range && /\/(\d+)$/.test(range) ? Number(range.match(/\/(\d+)$/)[1])
      : Number(response.headers.get('content-length') || 0) || null;
    return { ok: response.ok || response.status === 206, status: response.status, size,
      lastModified: response.headers.get('last-modified') || null };
  } catch (error) {
    return { ok: false, status: 0, size: null, lastModified: null, error: error.message };
  }
}

async function check() {
  console.log('Checking ' + allFiles.length + ' candidate files against the server.');
  console.log('These URLs are claims written from memory. What follows is what actually exists.\n');
  const results = [];
  for (const file of allFiles) {
    const found = await head(file.url);
    results.push({ ...file, ...found });
    const mark = found.ok ? 'FOUND  ' : 'MISSING';
    console.log('  ' + mark + ' ' + file.cycle.padEnd(10) + ' ' + file.name.padEnd(9)
      + (found.ok ? (found.size ? human(found.size).padStart(9) : '        ?')
        : '  HTTP ' + (found.status || found.error)));
  }
  const missing = results.filter(r => !r.ok);
  console.log('\n' + (results.length - missing.length) + ' of ' + results.length + ' candidate files exist at the recorded URL.');
  if (missing.length) {
    console.log('\n' + missing.length + ' could not be fetched. Each is a filename to confirm against');
    console.log(manifest.listingPage);
    console.log('rather than a file to assume is absent — NHANES renames and re-releases components,');
    console.log('and a wrong guess here looks exactly like a discontinued survey item.\n');
    for (const file of missing) console.log('  ' + file.cycle + '  ' + file.name + '  ' + file.url);
  }
  console.log('\nNothing was downloaded. Use --download <dir> once the list above is right.');
  return missing.length === 0;
}

async function download(directory) {
  const target = requireOutsideRepo(directory);
  fs.mkdirSync(target, { recursive: true });
  const entries = [];
  for (const file of allFiles) {
    const destination = path.join(target, file.name + '.xpt');
    process.stdout.write('  ' + file.cycle.padEnd(10) + ' ' + file.name.padEnd(9) + ' ');
    let buffer;
    if (fs.existsSync(destination)) {
      buffer = fs.readFileSync(destination);
      process.stdout.write('already present  ');
    } else {
      const response = await fetch(file.url);
      if (!response.ok) { console.log('HTTP ' + response.status + ' — skipped'); continue; }
      buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destination, buffer);
      process.stdout.write('downloaded       ');
    }
    const digest = sha256(buffer);
    entries.push({ cycle: file.cycle, role: file.role, component: file.component, name: file.name,
      url: file.url, bytes: buffer.length, sha256: digest });
    console.log(human(buffer.length).padStart(9) + '  ' + digest.slice(0, 16));
  }
  fs.writeFileSync(LOCKFILE, JSON.stringify({
    schema: 'PP_NHANES_SOURCE_LOCK_V1',
    note: 'Sizes and SHA-256 of the files this study read. The files themselves are not committed; '
      + 'this is what lets a later run prove it read the same bytes.',
    recordedAt: new Date().toISOString(),
    directory: target,
    files: entries,
  }, null, 2) + '\n');
  console.log('\nWrote ' + path.relative(REPO, LOCKFILE) + ' with ' + entries.length + ' files.');
  console.log('The downloads stay in ' + target + ' and are not committed.');
  return entries.length === allFiles.length;
}

function verify(directory) {
  if (!fs.existsSync(LOCKFILE)) usage('No lockfile yet. Run --download first.');
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));
  const target = directory ? path.resolve(directory) : lock.directory;
  let bad = 0;
  for (const file of lock.files) {
    const at = path.join(target, file.name + '.xpt');
    if (!fs.existsSync(at)) { console.log('  MISSING  ' + file.name); bad++; continue; }
    const digest = sha256(fs.readFileSync(at));
    const ok = digest === file.sha256;
    if (!ok) bad++;
    console.log('  ' + (ok ? 'MATCH  ' : 'CHANGED') + '  ' + file.name.padEnd(9) + ' ' + digest.slice(0, 16));
  }
  console.log('\n' + (lock.files.length - bad) + '/' + lock.files.length + ' files match the lockfile.');
  if (bad) console.log('A changed file is not a detail. Re-download it, or record why the study now reads different bytes.');
  return bad === 0;
}

(async () => {
  if (flag('--help') || !args.length) usage();
  let ok = true;
  if (flag('--check')) ok = await check();
  else if (flag('--download')) ok = await download(valueFor('--download') || usage('--download needs a directory'));
  else if (flag('--verify')) ok = verify(valueFor('--verify'));
  else usage('Unknown option. Use --check, --download <dir> or --verify [dir].');
  process.exitCode = ok ? 0 : 1;
})();
