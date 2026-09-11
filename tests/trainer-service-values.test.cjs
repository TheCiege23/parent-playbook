// services.price_cents, duration_min and max_group_size were plain `int` columns with no
// check constraint behind them, so the database would take a negative price without
// complaint. The only validation in front of it was
//
//   if(priceV===''||isNaN(parseFloat(priceV))) ...
//
// and parseFloat('-40') is a number, so a typed minus sign went straight through. money()
// then renders that to parents as -$40.00, on a listing that feeds a payments flow.
//
// The `||` fallbacks had the same hole from the other side: parseInt('-5',10)||60 is -5,
// because -5 is truthy. The fallback only ever caught NaN and zero, so a negative duration
// or a group size of -5 was storable too.
//
// Both halves are now in place, and they do different jobs. The constraints in
// 20260911160500_service_value_constraints.sql are the rule: the table is reachable through
// PostgREST by any approved trainer, so a rule enforced only by one screen is a suggestion.
// The checks in the browser are still there because a constraint violation arrives as
// `new row for relation "services" violates check constraint ...`, which is not a sentence
// to show a trainer who typed a minus sign by accident.
//
// The constraints themselves are exercised executably against a real cluster in
// tests/db/security-tests.cjs, group `service-values`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');

test('the base table never constrained these columns', () => {
  // Where the hole was, and why the constraints had to arrive in a later migration rather
  // than being edited into the original one — that file has already run everywhere.
  const sql = read('supabase/migrations/20260806160436_trainer_marketplace_enums_tables.sql');
  const table = sql.slice(sql.indexOf('create table if not exists services'));
  const body = table.slice(0, table.indexOf(');') + 2);
  assert.match(body, /price_cents int not null/, 'a plain int');
  assert.ok(!/price_cents[^,]*check/.test(body), 'with nothing behind it');
  assert.ok(!/duration_min[^,]*check/.test(body));
  assert.ok(!/max_group_size[^,]*check/.test(body));
});

test('the migration adds the rule to the table, where it belongs', () => {
  const sql = read('supabase/migrations/20260911160500_service_value_constraints.sql');
  assert.match(sql, /add constraint services_price_cents_not_negative\s*\n?\s*check \(price_cents >= 0\)/,
    'zero is a real price — a free introductory session — so this is >= and not >');
  assert.match(sql, /add constraint services_duration_min_positive\s*\n?\s*check \(duration_min > 0\)/,
    'a session lasts at least a minute, so this one IS strict');
  assert.match(sql, /add constraint services_max_group_size_at_least_one\s*\n?\s*check \(max_group_size is null or max_group_size >= 1\)/,
    'null means unspecified and must stay allowed; it is not the same as zero');
  // NOT VALID then VALIDATE: the second step is what makes an existing bad row fail here,
  // naming the constraint, rather than inside somebody's unrelated deploy later.
  for (const c of ['services_price_cents_not_negative', 'services_duration_min_positive', 'services_max_group_size_at_least_one']) {
    assert.ok(sql.includes('add constraint ' + c) && sql.includes('validate constraint ' + c),
      c + ' should be added NOT VALID and then validated');
  }
});

test('the old validation let every one of these through', () => {
  // Exactly the check that was there, run against what a trainer can type.
  const oldCheck = v => !(v === '' || isNaN(parseFloat(v)));
  assert.ok(oldCheck('-40'), 'a negative price passed');
  assert.ok(oldCheck('-0.01'), 'so did a negative cent');
  assert.ok(!oldCheck(''), 'it did catch an empty field');
  assert.ok(!oldCheck('abc'), 'and a word');

  // And the fallbacks, which only ever caught NaN and zero.
  const oldInt = (v, fallback) => parseInt(v, 10) || fallback;
  assert.equal(oldInt('-5', 60), -5, 'a negative duration was not caught by ||60');
  assert.equal(oldInt('-5', 1), -5, 'nor a negative group size by ||1');
  assert.equal(oldInt('0', 60), 60, 'zero was the only bad value the fallback reached');
  assert.equal(oldInt('abc', 60), 60);
});

test('the sheet still refuses each of them, with a sentence a person can read', () => {
  const src = read('js/trainer-services.js');
  assert.match(src, /if\(priceCents<0\)\{ errEl\.textContent="A price can't be negative\."; return; \}/);
  assert.match(src, /if\(durMin<=0\)\{ errEl\.textContent='A session has to be at least a minute long\.'; return; \}/);
  assert.match(src, /if\(grpSize<1\)\{ errEl\.textContent='A group is at least one athlete\.'; return; \}/);
});

test('the browser agrees with the database about where the boundaries are', () => {
  // If these ever drift apart, a trainer gets a raw constraint violation for a value the
  // form told them was fine — or the form refuses something the table would have taken.
  const src = read('js/trainer-services.js');
  const sql = read('supabase/migrations/20260911160500_service_value_constraints.sql');
  // price: both allow zero, both refuse negative.
  assert.ok(sql.includes('price_cents >= 0') && /priceCents<0/.test(src),
    'price: zero allowed, negative refused, on both sides');
  // duration: both refuse zero.
  assert.ok(sql.includes('duration_min > 0') && /durMin<=0/.test(src),
    'duration: zero refused on both sides');
  // group size: both refuse zero, both allow unspecified.
  assert.ok(sql.includes('max_group_size >= 1') && /grpSize<1/.test(src),
    'group size: below one refused on both sides');
});

test('the row is built from the values that were checked', () => {
  // The check is worth nothing if the insert re-parses the field and gets something else.
  const src = read('js/trainer-services.js');
  assert.match(src, /duration_min:durMin, price_cents:priceCents, max_group_size:grpSize,/,
    'the insert must use the checked values, not parse the inputs a second time');
  assert.ok(!/price_cents:Math\.round\(parseFloat\(priceV\)\*100\),/.test(src),
    'the second parse must be gone');
  const save = src.slice(src.indexOf("bg.querySelector('#svSave').onclick"));
  const guardEnd = save.indexOf('e.target.disabled=true;');
  for (const guard of ['priceCents<0', 'durMin<=0', 'grpSize<1']) {
    assert.ok(save.indexOf(guard) < guardEnd && save.indexOf(guard) > 0,
      guard + ' has to run before the button is disabled and the write starts');
  }
});

test('a failed delete gives the button back', () => {
  // It set disabled=true, then returned on error without undoing it — leaving the sheet
  // open with nothing on it to press, so a dropped connection meant closing and reopening.
  const src = read('js/trainer-services.js');
  const del = src.slice(src.indexOf("bg.querySelector('#yes').onclick"));
  const block = del.slice(0, del.indexOf('bg.remove()'));
  assert.match(block, /toast\('Could not delete'\); e\.target\.disabled=false; return;/,
    'the failure path must re-enable the button, the way the save path already does');
});
