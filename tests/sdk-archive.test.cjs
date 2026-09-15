// The buyer archive has to open on whatever an acquirer unpacks it with.
//
// Every archive up to v44 was zipped by hand with Compress-Archive, which on Windows PowerShell 5.1
// stores entry names with backslashes (`js\body-sdk.mjs`). The ZIP specification requires forward
// slashes. Windows extracts both, so acceptance passed here while the same archive, opened with
// Python's zipfile on macOS or Linux, became a flat pile of files with backslashes in their names.
// tools/sdk-zip.cjs now writes the archive; these hold it to the specification.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { build, readEntries, readFile } = require('../tools/sdk-zip.cjs');
const root = path.join(__dirname, '..');

// A small bundle shaped like the real one: nested directories, text that deflates, bytes that do not.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sdk-zip-'));
  const src = path.join(dir, 'bundle');
  const files = {
    'manifest.json': '{"schema":"synthetic"}\n',
    'js/body-sdk.mjs': "export const SDK_VERSION = '0.0.0';\n".repeat(40),
    'js/random.bin': crypto.randomBytes(4096),
    'supabase/functions/company-results-api/index.ts': 'Deno.serve(() => new Response(null));\n',
    'tools/acceptance.cjs': "console.log('synthetic');\n",
  };
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
    fs.writeFileSync(path.join(src, name), content);
  }
  return { dir, src, files, archive: path.join(dir, 'bundle.zip') };
}

test('entries are named with forward slashes, one per file, in byte order', () => {
  const f = fixture();
  try {
    const result = build(f.src, f.archive);
    const entries = readEntries(f.archive);
    const expected = Object.keys(f.files).sort();
    assert.deepEqual(entries.map(e => e.name), expected);
    assert.equal(result.entries, expected.length);
    assert.deepEqual(entries.filter(e => e.name.includes('\\')).map(e => e.name), [], 'no entry may use a backslash');
    assert.deepEqual(entries.filter(e => e.name.endsWith('/')).map(e => e.name), [],
      'directories are implied by the names; no directory entries are written');
    assert.equal(result.bytes, fs.statSync(f.archive).size);
    assert.equal(result.sha256, crypto.createHash('sha256').update(fs.readFileSync(f.archive)).digest('hex').toUpperCase());
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('every entry reads back byte for byte, deflated or stored', () => {
  const f = fixture();
  try {
    build(f.src, f.archive);
    for (const [name, content] of Object.entries(f.files)) {
      assert.ok(readFile(f.archive, name).equals(Buffer.from(content)), `${name} should round-trip`);
    }
    const entries = readEntries(f.archive);
    assert.equal(entries.find(e => e.name === 'js/body-sdk.mjs').method, 8, 'repetitive text should be deflated');
    assert.equal(entries.find(e => e.name === 'js/random.bin').method, 0, 'random bytes do not compress and are stored');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('an independent extractor unpacks it into a tree, without warnings', (t) => {
  // The reader above shares its author with the writer, so a mistake made twice could pass both.
  // Info-ZIP unzip is the check that does not: it ships with macOS and with GitHub's Ubuntu runners.
  const probe = spawnSync('unzip', ['-v'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) return t.skip('Info-ZIP unzip is not installed here');
  const f = fixture();
  try {
    build(f.src, f.archive);
    const out = path.join(f.dir, 'extracted');
    const run = spawnSync('unzip', ['-q', f.archive, '-d', out], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, 'unzip should succeed: ' + run.stderr);
    assert.equal((run.stdout + run.stderr).trim(), '', 'unzip should have nothing to warn about');
    for (const [name, content] of Object.entries(f.files)) {
      const target = path.join(out, ...name.split('/'));
      assert.ok(fs.existsSync(target), `${name} should extract to its own directory`);
      assert.ok(fs.readFileSync(target).equals(Buffer.from(content)), `${name} should extract byte for byte`);
    }
    assert.ok(fs.statSync(path.join(out, 'supabase', 'functions', 'company-results-api')).isDirectory());
    const verify = spawnSync('unzip', ['-t', f.archive], { encoding: 'utf8', windowsHide: true });
    assert.match(verify.stdout, /No errors detected/, 'unzip -t should verify every CRC');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('it refuses to overwrite an existing archive or to archive nothing', () => {
  const f = fixture();
  try {
    build(f.src, f.archive);
    const before = fs.readFileSync(f.archive);
    assert.throws(() => build(f.src, f.archive), /already exists/);
    assert.ok(fs.readFileSync(f.archive).equals(before), 'the existing archive is left exactly as it was');
    const empty = path.join(f.dir, 'empty');
    fs.mkdirSync(empty);
    assert.throws(() => build(empty, path.join(f.dir, 'empty.zip')), /empty archive/);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('the archive the SDK guide names as current has no backslash in any entry name', (t) => {
  // Archives are not committed, so on a fresh checkout or in CI this has nothing to open and says so.
  // Older archives on disk predate tools/sdk-zip.cjs and are deliberately not policed here: the one
  // that matters is the one the documents hand to a buyer.
  const guide = fs.readFileSync(path.join(root, 'BODY-SDK.md'), 'utf8');
  const named = (guide.match(/^The current buyer handoff snapshot is `([^`]+\.zip)`/m) || [])[1];
  assert.ok(named, 'BODY-SDK.md should name the current archive on its snapshot line');
  const archive = path.join(root, named);
  if (!fs.existsSync(archive)) return t.skip(`${named} is not on this machine`);
  const backslashed = readEntries(archive).filter(e => e.name.includes('\\')).map(e => e.name);
  assert.deepEqual(backslashed, [],
    `${named} stores ${backslashed.length} entry names with backslashes; rebuild it with tools/sdk-zip.cjs`);
});
