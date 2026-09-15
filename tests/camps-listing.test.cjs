// Camps & programs listed every approved camp with no date filter, ordered by start_date
// ASCENDING — so the oldest listings sat at the top of the screen. campWhen() printed no
// year, so "Jun 3 – Jun 8" from fifteen months ago read exactly like an upcoming camp, and a
// parent could follow a dead sign-up link believing it was current.
//
// Dates here are plain YYYY-MM-DD with no timezone, which is why the comparison is done on
// strings: constructing a Date and comparing instants shifts the day across midnight for
// anyone west of UTC, and would hide a camp on its own opening day.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON });
  vm.runInContext("function esc(v){return String(v??'');}", ctx);
  const source = fs.readFileSync(path.join(base, 'js', 'camps.js'), 'utf8');
  // Load the pure helpers, stopping before the screen that needs the DOM and Supabase.
  const cut = source.indexOf('async function openCamps');
  assert.ok(cut > 0, 'camps.js should still define openCamps');
  vm.runInContext(source.slice(0, cut), ctx);
  return ctx;
}

test("today is computed in local time, not shifted through a Date's instant", () => {
  const ctx = context();
  // A local date near midnight must render as that local day. Constructing this as a local
  // Date and reading local getters is the only way that holds in every timezone.
  const d = new Date(2026, 5, 3, 23, 30);       // 3 June, half an hour before midnight
  assert.equal(ctx.campTodayISO(d), '2026-06-03');
  const early = new Date(2026, 0, 1, 0, 15);    // New Year's Day, just after midnight
  assert.equal(ctx.campTodayISO(early), '2026-01-01');
});

test('a camp is over only after its last day has passed', () => {
  const ctx = context();
  const today = '2026-06-10';
  // Ended yesterday.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-01', end_date: '2026-06-09' }, today), true);
  // Running right now, and on its final day — still current.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-01', end_date: '2026-06-15' }, today), false);
  assert.equal(ctx.campIsOver({ start_date: '2026-06-01', end_date: '2026-06-10' }, today), false);
  // A one-day camp happening today is not over.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-10', end_date: null }, today), false);
  // Single-day camp that has passed.
  assert.equal(ctx.campIsOver({ start_date: '2026-06-09', end_date: null }, today), true);
  // Still to come.
  assert.equal(ctx.campIsOver({ start_date: '2026-08-01', end_date: '2026-08-05' }, today), false);
});

test('a listing with no dates is "Dates TBD", never expired', () => {
  const ctx = context();
  assert.equal(ctx.campIsOver({ start_date: null, end_date: null }, '2026-06-10'), false);
  assert.equal(ctx.campWhen({ start_date: null }), 'Dates TBD');
  assert.equal(ctx.campIsOver(null, '2026-06-10'), false);
});

test('the year is shown when the camp is not in the current year', () => {
  const ctx = context();
  const thisYear = new Date().getFullYear();
  const nextYear = thisYear + 1;
  const sameYear = ctx.campWhen({ start_date: `${thisYear}-06-03`, end_date: `${thisYear}-06-08` });
  const otherYear = ctx.campWhen({ start_date: `${nextYear}-01-05`, end_date: `${nextYear}-01-09` });
  assert.ok(!sameYear.includes(String(thisYear)),
    `a camp this year needs no year: got "${sameYear}"`);
  assert.ok(otherYear.includes(String(nextYear)),
    `a camp in another year must show it, or it reads as weeks away: got "${otherYear}"`);
});

test('the age range reads correctly at every boundary', () => {
  const ctx = context();
  assert.equal(ctx.campAges({ age_min: null, age_max: null }), 'All ages');
  assert.equal(ctx.campAges({ age_min: 8, age_max: 12 }), 'Ages 8–12');
  assert.equal(ctx.campAges({ age_min: 8, age_max: null }), 'Ages 8+');
  assert.equal(ctx.campAges({ age_min: null, age_max: 12 }), 'Up to age 12');
  // Zero is a real bound, not a missing one — `age_min: 0` must not read as "All ages".
  assert.equal(ctx.campAges({ age_min: 0, age_max: 5 }), 'Ages 0–5');
});

test('the screen filters finished camps out of the list it renders', () => {
  // openCamps needs the DOM and Supabase, so this asserts the filter is wired into the
  // rendered set rather than computed and discarded.
  const source = fs.readFileSync(path.join(base, 'js', 'camps.js'), 'utf8');
  assert.match(source, /const current = camps\.filter\(c => !campIsOver\(c, today\)\)/,
    'finished camps should be removed before rendering');
  assert.match(source, /const shown = campSport \? current\./,
    'the sport filter must narrow the CURRENT camps, not the unfiltered list');
});

test('a date range names the year once, not on both ends', () => {
  const ctx = context();
  const next = new Date().getFullYear() + 1;
  const range = ctx.campWhen({ start_date: `${next}-01-05`, end_date: `${next}-01-09` });
  const years = (range.match(new RegExp(String(next), 'g')) || []).length;
  assert.equal(years, 1, `"${range}" should carry the year once`);
  assert.match(range, new RegExp(`${next}$`), 'the year belongs at the end of the range');
  // A single-day camp still carries it.
  assert.match(ctx.campWhen({ start_date: `${next}-01-05`, end_date: null }), new RegExp(String(next)));
});

// The admin review screen rendered a pending listing's sign-up link straight into an href. Any signed-in
// account can send a pending listing to the API, and esc() cannot neutralise a javascript: URL — it holds
// nothing to escape. The database now refuses such a link (20260915120000_camp_listing_validation.sql);
// these hold the browser to the same rule wherever a link is rendered.
test('a sign-up link becomes an href only when it is a web address', () => {
  const ctx = context();
  const longest = 'https://example.org/' + 'a'.repeat(2028);
  for (const ok of ['https://example.org/camp', 'http://example.org/signup?id=1', 'HTTPS://EXAMPLE.ORG/CAMP', longest])
    assert.equal(ctx.campSignupHref(ok), ok, `${ok.slice(0, 40)} should stay a link`);
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', ' https://example.org/camp',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', '//example.org/camp', 'www.example.org/camp',
    'https://', 'https://example.org/sign up', longest + 'a', '', null, undefined, 42])
    assert.equal(ctx.campSignupHref(bad), null, `${JSON.stringify(bad)} must not become a link`);
});

test('the submission form refuses what the database refuses, in a sentence', () => {
  const ctx = context();
  const good = { org: 'Riverside Youth Football Camp', contactName: 'Sam', contactEmail: 'camp@example.org',
    ageMin: '8', ageMax: '12', location: 'Bergenfield, NJ', start: '2027-06-01', end: '2027-06-05',
    url: 'https://example.org/camp' };
  const problem = change => ctx.campSubmissionProblem({ ...good, ...change });
  assert.equal(problem({}), '');
  // A listing can be "All ages" and "Dates TBD"; zero is a real bound; a camp can last one day.
  assert.equal(problem({ ageMin: '', ageMax: '', start: '', end: '' }), '');
  assert.equal(problem({ ageMin: '0', ageMax: '0' }), '');
  assert.equal(problem({ start: '2027-06-01', end: '2027-06-01' }), '');
  assert.match(problem({ org: '' }), /organization/);
  assert.match(problem({ url: 'javascript:alert(1)' }), /sign-up link/);
  for (const email of ['not-an-email', 'camp@localhost', 'a b@example.org', 'x@y@example.org', 'a@' + 'b'.repeat(250) + '.org'])
    assert.match(problem({ contactEmail: email }), /email/, `${email.slice(0, 30)} should be refused`);
  assert.match(problem({ ageMin: '12', ageMax: '8' }), /youngest age/);
  for (const age of ['25', '-1', '7.5', '20'])
    assert.match(problem({ ageMax: age }), /0 to 19/, `age ${age} should be refused`);
  assert.match(problem({ start: '2027-06-05', end: '2027-06-01' }), /end before it starts/);
});

// The render functions run with the real esc() and H from js/core.js, so escaping is exercised, not stubbed.
function renderContext() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, state: { ref: { sports: [] } } });
  const core = fs.readFileSync(path.join(base, 'js', 'core.js'), 'utf8');
  for (const name of ['esc', 'H']) {
    const line = core.match(new RegExp('^const ' + name + ' = .*$', 'm'));
    assert.ok(line, `js/core.js should still define ${name} on one line`);
    vm.runInContext(line[0].replace(/^const /, 'var '), ctx);
  }
  vm.runInContext(fs.readFileSync(path.join(base, 'js', 'camps.js'), 'utf8'), ctx);
  return ctx;
}

test('a stored link that is not a web address is shown as text and never linked', () => {
  const ctx = renderContext();
  const listing = { id: '00000000-0000-4000-8000-000000000001', org_name: 'Synthetic Camp', location_text: 'Somewhere',
    contact_name: 'Sam', contact_email: 'camp@example.org', start_date: null, end_date: null, age_min: null,
    age_max: null, description: null, status: 'pending' };
  const crafted = { ...listing, external_signup_url: 'javascript:alert(document.cookie)' };
  const review = ctx.campAdminCard(crafted);
  assert.doesNotMatch(review, /href=/, 'the admin review card must not link a javascript: URL');
  assert.match(review, /Sign-up link is not a web address: javascript:alert\(document\.cookie\)/,
    'the reviewer still sees what was submitted, so they can reject it');
  assert.doesNotMatch(ctx.campCard(crafted), /href=/, 'a family-facing card must not link it either');

  // A web address is still linked on both cards, and still escaped inside the attribute.
  const fine = { ...listing, external_signup_url: 'https://example.org/camp?a=1&b="2"' };
  const escaped = /href="https:\/\/example\.org\/camp\?a=1&amp;b=&quot;2&quot;"/;
  assert.match(ctx.campAdminCard(fine), escaped);
  assert.match(ctx.campCard(fine), escaped);
  assert.match(ctx.campCard(fine), /Sign up on their site/);
});
