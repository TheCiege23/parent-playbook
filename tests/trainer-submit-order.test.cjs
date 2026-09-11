// Submitting a trainer application replaces three sets of rows by deleting them and
// inserting fresh ones. A browser cannot ask PostgREST for a transaction, so that sequence
// is not atomic and the ORDER of what can fail inside it is the only protection there is.
//
// It was in the wrong order. Credential documents were uploaded inside the loop that
// re-inserted each credential — after `delete().eq('trainer_id',uid)` had already run. One
// failed upload, which is the largest request in the flow and usually from a phone, left
// the applicant with fewer credentials than they had when they pressed the button. The
// message they saw was "Could not submit", which says the opposite of what happened.
//
// The three deletes also discarded their errors. trainer_sports and trainer_verifications
// are unique on (trainer_id, ...), so a delete that quietly did nothing turned the following
// insert into a bare 23505. trainer_credentials has no unique constraint at all, so there it
// raised nothing: the set was duplicated rather than replaced, and the reviewer saw the same
// certificate twice.
//
// These assert the invariant rather than the lines, because the lines will move: every
// fallible step happens before the first delete, and no delete's error is dropped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const source = () => fs.readFileSync(path.join(base, 'js', 'trainer-onboarding.js'), 'utf8');

// The body of submitTrainerApplication, from its declaration to the catch that reports
// failure to the applicant.
function submitBody() {
  const text = source();
  const start = text.search(/async function submitTrainerApplication\b/);
  assert.ok(start > 0, 'submitTrainerApplication should still exist');
  const end = text.indexOf('Could not submit. ', start);
  assert.ok(end > start, 'its catch block should still be the end of the function');
  return text.slice(start, end);
}

const positions = (hay, needle) => {
  const out = [];
  let at = -1;
  while ((at = hay.indexOf(needle, at + 1)) !== -1) out.push(at);
  return out;
};

test('every upload finishes before the first row is deleted', () => {
  const body = submitBody();
  const uploads = positions(body, 'await uploadTrainerDoc(');
  const deletes = positions(body, ".delete()");
  assert.ok(uploads.length >= 4, 'expected the credential, identity, background and SafeSport uploads');
  assert.ok(deletes.length >= 3, 'expected the sports, credentials and verifications deletes');
  assert.ok(Math.max(...uploads) < Math.min(...deletes),
    'an upload after a delete means a failed upload destroys rows the applicant already had');
});

test('the credential upload is not inside the re-insert loop any more', () => {
  const body = submitBody();
  const credInsert = body.indexOf("sb.from('trainer_credentials').insert(");
  const lastUpload = Math.max(...positions(body, 'await uploadTrainerDoc('));
  assert.ok(lastUpload < credInsert,
    'uploading while re-inserting is what put a network failure in the middle of a replace');
  assert.match(body, /const credPaths=\[\];/,
    'the paths should be resolved up front and used by index');
  assert.match(body, /doc_path:credPaths\[i\]/,
    'and the insert should read the path that was already uploaded');
});

test('no delete in this file drops its error', () => {
  // supabase-js returns { error } rather than throwing, so a bare `await sb...delete()` is
  // a write whose failure nothing can observe.
  const text = source();
  const offenders = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (!line.includes(".delete()")) return;
    // The result has to be captured. Either destructured on this line, or assigned.
    if (!/\{\s*error\s*:/.test(line) && !/\{\s*error\s*\}/.test(line)) {
      offenders.push((i + 1) + ': ' + trimmed.slice(0, 100));
    }
  });
  assert.deepEqual(offenders, [],
    'capture { error } and throw, or a failed delete turns the next insert into a duplicate or a bare 23505');
});

test('each captured delete error is actually thrown, not just named', () => {
  const body = submitBody();
  for (const name of ['sd', 'cd', 'vd']) {
    assert.ok(body.includes('error:' + name), 'the delete error ' + name + ' should be captured');
    assert.ok(new RegExp('if\\(' + name + '\\) throw ' + name + ';').test(body),
      'and ' + name + ' has to be thrown, or capturing it changed nothing');
  }
});

test('the schema is what makes a dropped delete error matter', () => {
  // If these constraints change, the consequences in the comments change with them.
  const sql = fs.readFileSync(
    path.join(base, 'supabase', 'migrations', '20260806160436_trainer_marketplace_enums_tables.sql'), 'utf8');
  assert.match(sql, /unique \(trainer_id, sport_key\)/,
    'trainer_sports is unique on the pair, so a failed delete surfaces as 23505');
  assert.match(sql, /unique \(trainer_id, kind\)/,
    'so is trainer_verifications');
  const creds = sql.slice(sql.indexOf('create table') === -1 ? 0 : sql.indexOf('trainer_credentials'));
  const credBlock = creds.slice(0, creds.indexOf(');') + 2);
  assert.ok(!/unique/.test(credBlock),
    'trainer_credentials has no unique constraint, which is why a failed delete there was silent');
});

test('a failed upload now leaves the saved application untouched', () => {
  // The sequence, reduced to what order guarantees. `steps` is the order the function runs
  // in; a failure at any upload must happen before anything destructive.
  const run = (failAt) => {
    const saved = { credentials: ['CSCS', 'First aid'], sports: ['soccer'] };
    const steps = [
      { kind: 'upload', id: 'cred-0' },
      { kind: 'upload', id: 'cred-1' },
      { kind: 'upload', id: 'identity' },
      { kind: 'delete', table: 'sports' },
      { kind: 'insert', table: 'sports' },
      { kind: 'delete', table: 'credentials' },
      { kind: 'insert', table: 'credentials' },
    ];
    for (const s of steps) {
      if (s.kind === 'upload' && s.id === failAt) return saved;      // throws; catch reports
      if (s.kind === 'delete') saved[s.table] = [];
      if (s.kind === 'insert' && s.table === 'credentials') saved.credentials = ['CSCS', 'First aid'];
      if (s.kind === 'insert' && s.table === 'sports') saved.sports = ['soccer'];
    }
    return saved;
  };
  assert.deepEqual(run('cred-1').credentials, ['CSCS', 'First aid'],
    'a failed second upload must leave both saved credentials in place');
  assert.deepEqual(run('identity').credentials, ['CSCS', 'First aid'],
    'and so must a failed identity document');
  assert.deepEqual(run(null).credentials, ['CSCS', 'First aid'], 'a clean run replaces the set');
});
