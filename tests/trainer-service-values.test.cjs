// services.price_cents, duration_min and max_group_size are plain `int` columns with no
// check constraint behind them, so the database will take a negative price without
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
// The fix is client-side because adding check constraints is a schema change to a live
// database. The constraint that is missing is recorded here so it is not forgotten.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(base, p), 'utf8');

test('the database really will accept these values', () => {
  const sql = read('supabase/migrations/20260806160436_trainer_marketplace_enums_tables.sql');
  const table = sql.slice(sql.indexOf('create table if not exists services'));
  const body = table.slice(0, table.indexOf(');') + 2);
  assert.match(body, /price_cents int not null/, 'a plain int');
  assert.ok(!/price_cents[^,]*check/.test(body), 'with no check constraint — which is why the client has to');
  assert.ok(!/duration_min[^,]*check/.test(body));
  assert.ok(!/max_group_size[^,]*check/.test(body));
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

test('the sheet now refuses each of them, with a reason', () => {
  const src = read('js/trainer-services.js');
  assert.match(src, /if\(priceCents<0\)\{ errEl\.textContent="A price can't be negative\."; return; \}/);
  assert.match(src, /if\(durMin<=0\)\{ errEl\.textContent='A session has to be at least a minute long\.'; return; \}/);
  assert.match(src, /if\(grpSize<1\)\{ errEl\.textContent='A group is at least one athlete\.'; return; \}/);
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
