#!/usr/bin/env node
/* Detached Ed25519 signature over a built SDK package.
 *
 *   node tools/sdk-sign.cjs --generate-key --out <dir outside this repo>
 *   node tools/sdk-sign.cjs --sign <bundleDir> --key <private.pem>
 *   node tools/sdk-sign.cjs --verify <bundleDir> --public-key <public.pem>
 *
 * WHAT THIS CHANGES. The checksum manifest detects accidental change: a buyer can tell that
 * a file does not match its recorded hash. It cannot detect substitution, because anyone who
 * replaces a file can recompute the hash and rewrite the manifest. A signature over the
 * manifest closes that: rewriting it now requires the private key.
 *
 * WHAT IT DOES NOT CHANGE. A public key that arrives inside the package proves nothing —
 * whoever replaced the package could replace the key beside it. The signature is only worth
 * something when checked against a public key obtained some other way, and this tool says so
 * out loud when it is pointed at a key inside the bundle it is checking.
 *
 * It signs the manifest's CONTENT, not its bytes: the SDK version and the path/sha256 pairs,
 * in bundle order. createdAt is deliberately outside the signature, for the same reason
 * bundleDigest() excludes it — it changes on every build and describes when the package was
 * made, not what is in it. So a rebuild of unchanged sources produces a signature that still
 * verifies, and a changed file does not.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const SCHEMA = 'PP_BODY_SDK_SIGNATURE_V1';

// The exact bytes that get signed. Any change to a path, a hash, their order, or the SDK
// version changes this string and invalidates the signature.
function canonicalBytes(manifest) {
  if (!manifest || manifest.schema !== 'PP_BODY_SDK_BUNDLE_V1') throw Error('Not a Parent Playbook bundle manifest.');
  if (typeof manifest.sdkVersion !== 'string' || !manifest.sdkVersion) throw Error('Manifest has no sdkVersion.');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw Error('Manifest lists no files.');
  const lines = manifest.files.map(f => {
    if (typeof f.path !== 'string' || !/^[0-9a-f]{64}$/.test(String(f.sha256))) {
      throw Error('Manifest entry is malformed: ' + JSON.stringify(f).slice(0, 120));
    }
    return f.path + ' ' + f.sha256;
  });
  return Buffer.from(SCHEMA + '\n' + manifest.sdkVersion + '\n' + lines.join('\n'), 'utf8');
}

const readManifest = dir => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
// Line endings are normalised before hashing. Without that the SAME key produces two
// different fingerprints depending on how it reached the reader: a Windows checkout under
// core.autocrlf, or an editor that saved it with CRLF, rewrites every line and therefore
// the hash. A buyer would compute a fingerprint that did not match the published one and
// reasonably conclude the key had been swapped — a false tamper alarm caused entirely by
// text encoding. This repository has been bitten by exactly that in its archive checksums,
// and a key fingerprint is a worse place for it: the alarm it raises is "this is not us".
const fingerprint = publicKeyPem =>
  crypto.createHash('sha256').update(publicKeyPem.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 32);

function generateKey(outDir) {
  const resolved = path.resolve(outDir);
  // A private key inside the working tree is one `git add -A` away from being published,
  // and this repository has had exactly that accident with unrelated files.
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    throw Error('Refusing to write a private key inside the repository (' + resolved + '). Choose a directory outside it.');
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.mkdirSync(resolved, { recursive: true });
  const privPath = path.join(resolved, 'pp-sdk-signing-key.pem');
  const pubPath = path.join(resolved, 'pp-sdk-signing-key.pub.pem');
  fs.writeFileSync(privPath, priv, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(pubPath, pub, { flag: 'wx' });
  return { privPath, pubPath, fingerprint: fingerprint(pub), publicKeyPem: pub };
}

function signBundle(bundleDir, privateKeyPath) {
  const manifest = readManifest(bundleDir);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath, 'utf8'));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw Error('Signing key must be ed25519, got ' + privateKey.asymmetricKeyType + '.');
  const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const signature = crypto.sign(null, canonicalBytes(manifest), privateKey);
  const record = {
    schema: SCHEMA,
    algorithm: 'ed25519',
    sdkVersion: manifest.sdkVersion,
    fileCount: manifest.files.length,
    signedAt: new Date().toISOString(),
    publicKeyFingerprint: fingerprint(publicKeyPem),
    signature: signature.toString('base64'),
    covers: 'The SDK version and every path/sha256 pair in manifest.json, in bundle order. Not createdAt, which changes on every build.',
    limitations: 'A public key found inside this package proves nothing on its own. Verify against a public key obtained independently of the package.',
  };
  const out = path.join(bundleDir, 'signature.json');
  fs.writeFileSync(out, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return { path: out, ...record };
}

// Returns findings rather than a bare boolean: "the files match the manifest" and "the
// manifest was signed by this key" are different questions and a reader needs both answers.
function verifySignature(bundleDir, publicKeyPath) {
  const problems = [];
  let record = null, manifest = null, trustAnchorInsideBundle = false;
  try { manifest = readManifest(bundleDir); } catch (e) { return { ok: false, problems: ['manifest.json could not be read: ' + e.message] }; }
  const sigPath = path.join(bundleDir, 'signature.json');
  if (!fs.existsSync(sigPath)) return { ok: false, signed: false, problems: ['This package carries no signature.json, so it is an unsigned package.'] };
  try { record = JSON.parse(fs.readFileSync(sigPath, 'utf8')); } catch (e) { return { ok: false, problems: ['signature.json is not readable JSON: ' + e.message] }; }

  if (record.schema !== SCHEMA) problems.push('Signature schema is ' + record.schema + ', expected ' + SCHEMA + '.');
  if (record.algorithm !== 'ed25519') problems.push('Unsupported algorithm ' + record.algorithm + '.');
  if (record.sdkVersion !== manifest.sdkVersion) problems.push('Signature names SDK ' + record.sdkVersion + ' but the manifest says ' + manifest.sdkVersion + '.');
  if (record.fileCount !== manifest.files.length) problems.push('Signature covers ' + record.fileCount + ' files but the manifest lists ' + manifest.files.length + '.');

  let publicKeyPem;
  try { publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8'); }
  catch (e) { return { ok: false, problems: ['The public key could not be read: ' + e.message] }; }

  const resolvedKey = path.resolve(publicKeyPath), resolvedBundle = path.resolve(bundleDir);
  if (resolvedKey.startsWith(resolvedBundle + path.sep)) trustAnchorInsideBundle = true;

  const got = fingerprint(publicKeyPem);
  if (record.publicKeyFingerprint && record.publicKeyFingerprint !== got) {
    problems.push('This package was signed by key ' + record.publicKeyFingerprint + ', but the supplied key is ' + got + '.');
  }

  let valid = false;
  try {
    valid = crypto.verify(null, canonicalBytes(manifest), crypto.createPublicKey(publicKeyPem), Buffer.from(record.signature || '', 'base64'));
  } catch (e) { problems.push('Signature could not be checked: ' + e.message); }
  if (!valid) problems.push('The signature does not match this manifest.');

  return { ok: problems.length === 0, signed: true, valid, problems, keyFingerprint: got, trustAnchorInsideBundle };
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage:');
  console.error('  node tools/sdk-sign.cjs --generate-key --out <dir outside this repo>');
  console.error('  node tools/sdk-sign.cjs --sign <bundleDir> --key <private.pem>');
  console.error('  node tools/sdk-sign.cjs --verify <bundleDir> --public-key <public.pem>');
  return 2;
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--generate-key') a.generate = true;
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--sign') a.sign = argv[++i];
    else if (argv[i] === '--key') a.key = argv[++i];
    else if (argv[i] === '--verify') a.verify = argv[++i];
    else if (argv[i] === '--public-key') a.publicKey = argv[++i];
    else return usage('Unrecognised argument: ' + argv[i]);
  }

  try {
    if (a.generate) {
      if (!a.out) return usage('--generate-key needs --out <dir>.');
      const k = generateKey(a.out);
      console.log('Key pair written.');
      console.log('  private  ' + k.privPath);
      // 0o600 is requested, but only POSIX honours it. On Windows the file inherits the
      // user profile's ACL instead, so claiming 'mode 600' there would be describing a
      // protection that was not applied.
      console.log('           never commit this and never send it. Back it up somewhere you control:');
      console.log('           losing it means you cannot sign a future release with this identity.');
      console.log('  public   ' + k.pubPath);
      console.log('  fingerprint ' + k.fingerprint);
      console.log('');
      console.log('Publish the PUBLIC key somewhere a buyer can reach independently of the package.');
      console.log('A key that only ever arrives inside the archive is not a trust anchor.');
      return 0;
    }
    if (a.sign) {
      if (!a.key) return usage('--sign needs --key <private.pem>.');
      const r = signBundle(a.sign, a.key);
      console.log('Signed ' + r.fileCount + ' manifest entries for SDK ' + r.sdkVersion + '.');
      console.log('  ' + r.path);
      console.log('  key fingerprint ' + r.publicKeyFingerprint);
      return 0;
    }
    if (a.verify) {
      if (!a.publicKey) return usage('--verify needs --public-key <public.pem>.');
      const r = verifySignature(a.verify, a.publicKey);
      console.log('Signature check — ' + path.basename(path.resolve(a.verify)));
      console.log('');
      console.log('  key fingerprint  ' + (r.keyFingerprint || '(unreadable)'));
      console.log('  signature valid  ' + (r.valid ? 'yes' : 'no'));
      console.log('');
      if (r.ok) console.log('  OK — the manifest was signed by this key and has not been altered since.');
      else { console.log('  NOT CLEAN:'); for (const p of r.problems) console.log('    - ' + p); }
      console.log('');
      if (r.trustAnchorInsideBundle) {
        console.log('  WARNING: the public key you supplied is inside the package being checked.');
        console.log('  That establishes internal consistency only. Anyone who replaced the package');
        console.log('  could have replaced this key beside it. Re-check against a key obtained');
        console.log('  independently before treating this as proof of origin.');
        console.log('');
      }
      console.log('This does NOT establish that the files on disk match the manifest — run');
      console.log('node tools/sdk-verify.cjs for that. Together they mean: the bytes match the');
      console.log('manifest, and the manifest was signed by the holder of this key.');
      return r.ok ? 0 : 1;
    }
    return usage('Nothing to do.');
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { SCHEMA, canonicalBytes, generateKey, signBundle, verifySignature, fingerprint, main };
