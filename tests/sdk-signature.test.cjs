// A detached signature over the package manifest.
//
// The checksum manifest detects accidental change: a buyer can tell that a file no longer
// matches its recorded hash. It cannot detect SUBSTITUTION, because anyone who replaces a
// file can recompute the hash and rewrite the manifest entry to agree. Every acceptance run
// has said so in as many words — "the checksum manifest is unsigned: it detects accidental
// change, not substitution".
//
// The headline test here is that exact attack: alter the reconstruction core, rewrite its
// manifest hash and byte count to match, and watch tools/sdk-verify.cjs report a clean
// package. The signature is the only thing that catches it.
//
// What a signature still does not give you: a public key that arrives inside the package
// proves nothing, since whoever replaced the package could replace the key beside it. That
// is a property of where the key came from, not of the cryptography, so the tool reports it
// rather than pretending otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const SIGN = require(path.join(root, 'tools', 'sdk-sign.cjs'));
const { verifyBundle } = require(path.join(root, 'tools', 'sdk-verify.cjs'));
const { buildBundle } = require(path.join(root, 'tools', 'sdk-bundle.cjs'));

// Built once; each test copies it so mutations cannot leak between cases.
let MASTER = null, KEYS = null, TMP = null;
function setup() {
  if (MASTER) return;
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sign-test-'));
  MASTER = path.join(TMP, 'master');
  buildBundle(MASTER);
  KEYS = SIGN.generateKey(path.join(TMP, 'keys'));
  // A second, unrelated key, for the "signed by someone else" case.
  KEYS.other = SIGN.generateKey(path.join(TMP, 'other-keys'));
}
function freshBundle(name) {
  setup();
  const dir = path.join(TMP, name + '-' + Math.random().toString(36).slice(2, 8));
  fs.cpSync(MASTER, dir, { recursive: true });
  return dir;
}
const sign = dir => SIGN.signBundle(dir, KEYS.privPath);

test.after(() => { if (TMP) fs.rmSync(TMP, { recursive: true, force: true }); });

test('a signed package verifies against the key that signed it', () => {
  const dir = freshBundle('happy');
  const record = sign(dir);
  assert.equal(record.schema, 'PP_BODY_SDK_SIGNATURE_V1');
  assert.equal(record.algorithm, 'ed25519');
  assert.equal(record.fileCount, JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).files.length);

  const result = SIGN.verifySignature(dir, KEYS.pubPath);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
});

test('THE CASE: a coherent substitution passes the checksums and fails the signature', () => {
  const dir = freshBundle('substitute');
  sign(dir);
  assert.equal(verifyBundle(dir).ok, true, 'the package should start clean');

  // Replace a shipped file and rewrite its manifest entry so the hashes agree — exactly what
  // someone redistributing a modified package would do.
  const target = path.join(dir, 'js', 'visual-hull.js');
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('const VIEWS=', 'const VIEWS=/*tampered*/'));
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = manifest.files.find(f => f.path === 'js/visual-hull.js');
  entry.sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  entry.bytes = fs.statSync(target).size;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  assert.equal(verifyBundle(dir).ok, true,
    'checksums alone cannot detect this — if they ever could, this test is describing the wrong threat');

  const result = SIGN.verifySignature(dir, KEYS.pubPath);
  assert.equal(result.ok, false, 'the signature must catch it');
  assert.equal(result.valid, false);
  assert.ok(result.problems.some(p => /signature does not match this manifest/.test(p)), result.problems.join('; '));
});

test('altering a file without touching the manifest is caught by the checksums', () => {
  // The two checks answer different questions and both are needed; this is the half that
  // already worked.
  const dir = freshBundle('naive');
  sign(dir);
  const target = path.join(dir, 'js', 'visual-hull.js');
  fs.appendFileSync(target, '\n// injected\n');
  const check = verifyBundle(dir);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some(e => /Checksum mismatch: js\/visual-hull\.js/.test(e)), JSON.stringify(check.errors));
  // And the signature still verifies, because the manifest itself is untouched — which is
  // precisely why a reader needs both answers rather than one verdict.
  assert.equal(SIGN.verifySignature(dir, KEYS.pubPath).valid, true);
});

test('a package signed by a different key is refused by fingerprint and by maths', () => {
  const dir = freshBundle('otherkey');
  SIGN.signBundle(dir, KEYS.other.privPath);
  const result = SIGN.verifySignature(dir, KEYS.pubPath);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /signed by key .* but the supplied key is/.test(p)), result.problems.join('; '));
  assert.equal(result.valid, false, 'and the signature itself must not verify');
});

test('an unsigned package reports as unsigned rather than as invalid', () => {
  // "No signature" and "bad signature" are different facts and must not be collapsed.
  const dir = freshBundle('unsigned');
  const result = SIGN.verifySignature(dir, KEYS.pubPath);
  assert.equal(result.ok, false);
  assert.equal(result.signed, false);
  assert.ok(result.problems.some(p => /carries no signature\.json/.test(p)));
});

test('a public key from inside the package is reported as no trust anchor', () => {
  const dir = freshBundle('insidekey');
  sign(dir);
  const planted = path.join(dir, 'public-key.pem');
  fs.copyFileSync(KEYS.pubPath, planted);
  const result = SIGN.verifySignature(dir, planted);
  assert.equal(result.valid, true, 'the maths does check out, which is the trap');
  assert.equal(result.trustAnchorInsideBundle, true,
    'and that is exactly why it has to be reported: the key travelled with the thing it vouches for');
  const outside = SIGN.verifySignature(dir, KEYS.pubPath);
  assert.equal(outside.trustAnchorInsideBundle, false);
});

test('the signature survives a rebuild, because createdAt is outside it', () => {
  // Two builds of unchanged sources differ only in createdAt. If that were signed, every
  // rebuild would invalidate a published signature for no reason.
  const dir = freshBundle('rebuild');
  sign(dir);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.createdAt = new Date(Date.now() + 86400000).toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  assert.equal(SIGN.verifySignature(dir, KEYS.pubPath).valid, true,
    'a different build timestamp must not invalidate the signature');
});

test('reordering the file list DOES invalidate it', () => {
  // Order is part of what is signed, so a manifest that lists the same files differently is
  // a different manifest.
  const dir = freshBundle('reorder');
  sign(dir);
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files.reverse();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  assert.equal(SIGN.verifySignature(dir, KEYS.pubPath).valid, false);
});

test('signing a package does not break its own verification', () => {
  // The regression this fix exists for: signature.json is not a manifest entry, and
  // verifyBundle rejected every file it did not expect — so signing a bundle made
  // sdk-verify report "Unexpected file: signature.json" on an otherwise perfect package.
  const dir = freshBundle('coexist');
  assert.equal(verifyBundle(dir).signed, false, 'an unsigned bundle should say so');
  sign(dir);
  const check = verifyBundle(dir);
  assert.equal(check.ok, true, 'signing must leave the package verifiable: ' + JSON.stringify(check.errors));
  assert.equal(check.signed, true, 'and the presence of a signature should be reported');
});

test('a private key cannot be generated inside the repository', () => {
  // One `git add -A` away from being published, and this repository has had exactly that
  // accident with unrelated files.
  assert.throws(() => SIGN.generateKey(path.join(root, 'keys')), /Refusing to write a private key inside the repository/);
  assert.throws(() => SIGN.generateKey(root), /Refusing to write a private key inside the repository/);
});

test('the signed bytes are the version and the path/hash pairs, and nothing else', () => {
  setup();
  const manifest = JSON.parse(fs.readFileSync(path.join(MASTER, 'manifest.json'), 'utf8'));
  const bytes = SIGN.canonicalBytes(manifest).toString('utf8');
  const lines = bytes.split('\n');
  assert.equal(lines[0], 'PP_BODY_SDK_SIGNATURE_V1', 'the scheme is named inside the signed text');
  assert.equal(lines[1], manifest.sdkVersion);
  assert.equal(lines.length, manifest.files.length + 2);
  assert.ok(!bytes.includes(manifest.createdAt), 'createdAt must not be inside the signature');
  assert.ok(!bytes.includes('limitations'), 'prose that can be reworded must not be inside it either');
  for (const f of manifest.files) assert.ok(bytes.includes(f.path + ' ' + f.sha256), 'missing ' + f.path);
});

test('a malformed manifest is refused rather than signed', () => {
  assert.throws(() => SIGN.canonicalBytes({ schema: 'something-else' }), /Not a Parent Playbook bundle manifest/);
  assert.throws(() => SIGN.canonicalBytes({ schema: 'PP_BODY_SDK_BUNDLE_V1', files: [] }), /no sdkVersion/);
  assert.throws(() => SIGN.canonicalBytes({ schema: 'PP_BODY_SDK_BUNDLE_V1', sdkVersion: '1.0.0', files: [] }), /lists no files/);
  assert.throws(() => SIGN.canonicalBytes({ schema: 'PP_BODY_SDK_BUNDLE_V1', sdkVersion: '1.0.0', files: [{ path: 'a', sha256: 'nope' }] }), /malformed/);
});
