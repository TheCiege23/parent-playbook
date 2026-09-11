// Account showed a household, and offered to rename it, without ever saying which one.
//
// family_members has `primary key (family_id, guardian_id)` — nothing stops one guardian
// from belonging to several households, and two ordinary paths get you there: a parent who
// created their own family and later accepted an invite into a co-parent's, and a blended
// household where both parents already had one. The screen ran
//
//   sb.from('families').select('id,name').limit(1)
//
// with no order, so Postgres chose. The name printed next to "Delete <child>'s profile"
// could be a household that child is not in, and the Rename button wrote to whichever row
// came back — the same button renaming a different household between two page loads.
//
// The query is now keyed on the active athlete's family_id, which is what the screen was
// always asking about. athletes.family_id is `not null` and families.id is the primary key,
// so at most one row can come back and limit(1) finally means something.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');

test('the schema really does allow one guardian in several households', () => {
  // If this stops being true the bug stops being reachable, and this file should be
  // reconsidered rather than left asserting something the schema no longer permits.
  const sql = read('supabase/migrations/20260730143035_identity_and_access.sql');
  assert.match(sql, /create table public\.family_members[\s\S]*?primary key \(family_id, guardian_id\)/,
    'family_members is keyed on the pair, so a guardian may hold rows in many families');
  assert.ok(!/create table public\.family_members[\s\S]*?unique \(guardian_id\)/.test(sql),
    'nothing restricts a guardian to one household');
  assert.match(sql, /family_id uuid not null references public\.families\(id\)/,
    'every athlete belongs to exactly one family, which is the one this screen means');
});

test('an unordered pick over several households is a coin flip', () => {
  // The selection the old line performed, against the two arrival orders one query can
  // legitimately produce for the same rows.
  const rows = [
    { id: 'fam-created-by-me', name: 'The Alvarez Family' },
    { id: 'fam-i-was-invited-to', name: "Dana's House" },
  ];
  const unordered = list => list[0];
  assert.notEqual(unordered(rows).id, unordered(rows.slice().reverse()).id,
    'the same data returns a different household, which is what Rename then wrote to');

  // Keyed on the athlete's family, both orders agree, because only one row can match.
  const keyed = (list, familyId) => list.filter(f => f.id === familyId)[0] || null;
  const active = { family_id: 'fam-i-was-invited-to' };
  assert.equal(keyed(rows, active.family_id).id, keyed(rows.slice().reverse(), active.family_id).id);
  assert.equal(keyed(rows, active.family_id).name, "Dana's House");
});

test('the screen asks for the active athlete\'s household', () => {
  const src = read('js/account.js');
  assert.match(src, /sb\.from\('families'\)\.select\('id,name'\)\.eq\('id', a\.family_id\)\.limit\(1\)/,
    'the household query must be keyed on the athlete whose screen this is');
  assert.ok(!/sb\.from\('families'\)\.select\('id,name'\)\.limit\(1\)/.test(src),
    'the unkeyed pick must be gone, not merely supplemented');
  // `a` is state.active, and loadAthletes has to be selecting the column for it to exist.
  assert.match(src, /const a=state\.active;/);
  assert.match(read('js/auth.js'), /\.select\('id,first_name,nickname,birthdate,dominant_hand,family_id,created_at'\)/,
    'family_id has to be loaded onto state.athletes or a.family_id is undefined');
});

test('a viewer with no membership gets no household rather than their own', () => {
  // families_select is `using (public.is_family_member(id))`. A grandparent holding
  // athlete_access to a grandchild, with no family_members row in that household, now gets
  // an empty result — where before the unkeyed query handed back THEIR household's name and
  // put a Rename button beside another family's child.
  const sql = read('supabase/migrations/20260730143035_identity_and_access.sql');
  assert.match(sql, /create policy families_select on public\.families for select to authenticated using \(public\.is_family_member\(id\)\)/,
    'membership, not athlete access, is what returns a families row');
  assert.match(read('js/account.js'), /\$\{household\?'<button class="btn sm ghost" id="renameFam">Rename<\/button>':''\}/,
    'and with no row there is no Rename button to press');
  assert.match(read('js/account.js'), /esc\(household\?\.name\|\|'My Family'\)/,
    'the fallback name stands in when there is no readable household');
});

test('there is one definition of what calendar day it is here', () => {
  // js/program.js carried its own isoDay(), byte-for-byte what localDay() does, and eleven
  // call sites used it. The sweeps guard localDay; a second private copy is precisely what
  // they cannot see, so a correction could land on one and not the other.
  const program = read('js/program.js');
  assert.match(program, /function isoDay\(d\)\{ return localDay\(d\); \}/,
    'isoDay should delegate rather than repeat the computation');
  assert.ok(!/function isoDay\(d\)\{ return d\.getFullYear\(\)/.test(program),
    'the duplicate implementation must be gone');

  const html = read('index.html');
  assert.ok(html.indexOf('/js/dates.js') < html.indexOf('/js/program.js'),
    'js/dates.js must load before js/program.js or isoDay is a ReferenceError');

  // The two suites that run program.js outside a browser have to load dates.js too, or they
  // are testing a context the app never has. This caught itself: five cases failed the
  // moment isoDay started delegating.
  for (const t of ['tests/week-streak.test.cjs', 'tests/rest-floor.test.cjs']) {
    const text = read(t);
    const dates = text.indexOf("'dates.js'");
    const program2 = text.indexOf("'program.js'");
    assert.ok(dates > 0, t + ' must load js/dates.js into its context');
    assert.ok(dates < program2, t + ' must load js/dates.js before js/program.js');
  }
});
