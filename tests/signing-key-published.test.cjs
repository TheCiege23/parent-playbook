// The published half of the signing key.
//
// A signature is only worth something against a public key the reader obtained independently
// of the thing it vouches for. So the public key is committed HERE, in the repository, and is
// deliberately NOT in BUNDLE_FILES — a buyer gets it from this repo or the website, never
// from the archive it is being used to check. If it ever ships inside the package, the
// archive starts supplying its own trust anchor and the signature stops meaning what the
// documentation says it means.
//
// The other thing these guard is the obvious catastrophe: .gitignore refuses *.pem precisely
// so a signing key cannot be committed, and this file adds a named exception to that rule.
// An exception to a rule that exists to prevent disaster deserves a test that it still only
// covers the harmless half.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const KEY_FILE = 'SIGNING-KEY.pub.pem';
const keyPath = path.join(root, KEY_FILE);
const SIGN = require(path.join(root, 'tools', 'sdk-sign.cjs'));

test('the public key is committed and is a usable ed25519 public key', () => {
  assert.ok(fs.existsSync(keyPath), KEY_FILE + ' should be committed so a buyer can obtain it from here');
  const pem = fs.readFileSync(keyPath, 'utf8');
  assert.match(pem, /^-----BEGIN PUBLIC KEY-----/, 'expected an SPKI public key');
  const key = crypto.createPublicKey(pem);
  assert.equal(key.asymmetricKeyType, 'ed25519');
  assert.equal(key.type, 'public');
});

test('it is the PUBLIC half, and nothing here is a private key', () => {
  // The failure this exists to catch is copying the wrong file.
  const pem = fs.readFileSync(keyPath, 'utf8');
  assert.ok(!/PRIVATE KEY/.test(pem), 'that is a private key — remove it, rotate the key, and start again');
  assert.throws(() => crypto.createPrivateKey(pem), 'a public key must not load as a private one');

  // And nowhere else in the tree either.
  const suspects = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'sdk-releases') continue;
      const p = path.join(dir, name);
      const stat = fs.lstatSync(p);
      if (stat.isDirectory()) { walk(p); continue; }
      if (!/\.(pem|key)$/i.test(name)) continue;
      if (/PRIVATE KEY/.test(fs.readFileSync(p, 'utf8'))) suspects.push(path.relative(root, p));
    }
  })(root);
  assert.deepEqual(suspects, [], 'private key material is present in the working tree');
});

test('the key does NOT ship inside the package', () => {
  // If it did, the archive would carry the key that verifies it, and a reader checking one
  // against the other would be checking the package against itself.
  const { BUNDLE_FILES } = require(path.join(root, 'tools', 'sdk-files.cjs'));
  assert.ok(!BUNDLE_FILES.includes(KEY_FILE),
    KEY_FILE + ' must stay out of the bundle so the trust anchor arrives by a different route');
  assert.ok(!BUNDLE_FILES.some(f => /signing-key/i.test(f)), 'no signing key material may be bundled');
});

test('.gitignore still refuses private keys while allowing this one file', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /(^|\r?\n)\*\.pem/, 'the blanket refusal must stay');
  assert.match(ignore, /(^|\r?\n)\*\.key/, 'so must the .key refusal');
  assert.match(ignore, /(^|\r?\n)!SIGNING-KEY\.pub\.pem/,
    'the exception must name exactly one file, not a pattern that could match a private key');
  // A wildcard exception would be the dangerous version of this.
  const exceptions = (ignore.match(/^!.*$/gm) || []).map(s => s.trim());
  for (const line of exceptions) {
    assert.ok(!/\*/.test(line), 'an exception with a wildcard could re-admit key material: ' + line);
  }
});

// The documented fingerprint is what a buyer compares against. There is deliberately no
// second implementation of the hash here: an earlier version of this file computed it
// independently, which is exactly the drift the check was meant to prevent — and it drifted
// the moment tools/sdk-sign.cjs started normalising line endings. The tool is the only
// implementation; these pin its OUTPUT and its stability.
const DOCUMENTED_FINGERPRINT = '0cc2d189c342212d23d250264f8ab71d';

test('the documented fingerprint is the one the tool computes for the committed key', () => {
  const pem = fs.readFileSync(keyPath, 'utf8');
  assert.equal(SIGN.fingerprint(pem), DOCUMENTED_FINGERPRINT,
    'the committed key does not fingerprint to the documented value');
  const guide = fs.readFileSync(path.join(root, 'BODY-SDK.md'), 'utf8');
  assert.ok(guide.includes(DOCUMENTED_FINGERPRINT),
    'BODY-SDK.md should record ' + DOCUMENTED_FINGERPRINT + ' so a buyer has something to compare');
});

test('the fingerprint does not depend on how the key file was encoded', () => {
  // The same key reaching a reader through a Windows checkout, or saved by an editor that
  // writes CRLF, must fingerprint identically. Otherwise the published value reads as a
  // mismatch and the alarm it raises is "this key is not theirs" — a false tamper report
  // caused entirely by text encoding. Measured before this was fixed: the CRLF form of the
  // committed key hashed to c522cb17fe3f2dff794616638e23fb99 instead.
  const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  const pem = fs.readFileSync(keyPath, 'utf8');
  const asLf = pem.split(CR + LF).join(LF);
  const asCrlf = asLf.split(LF).join(CR + LF);
  assert.notEqual(asCrlf, asLf, 'the two encodings must actually differ, or this proves nothing');
  assert.equal(SIGN.fingerprint(asLf), DOCUMENTED_FINGERPRINT, 'LF form');
  assert.equal(SIGN.fingerprint(asCrlf), DOCUMENTED_FINGERPRINT, 'CRLF form');
  // Surrounding whitespace must not matter either, since files get reflowed.
  assert.equal(SIGN.fingerprint(LF + pem + LF + LF), DOCUMENTED_FINGERPRINT, 'padded');
});
