// The six-box invite code entry.
//
// Each box took one digit: `c.value.replace(/\D/g,'').slice(0,1)`. More than one digit can
// reach a single box — iOS one-time-code autofill puts the WHOLE code into the focused
// field, and some Android keyboards commit a composed string — and those extra five digits
// were silently dropped, leaving a parent retyping a code their phone had already offered.
//
// Paste already handled the multi-digit case. Both now go through one `spread`.
//
// This exercises the real bindCodeRow against a small DOM stand-in rather than asserting on
// source text, so the focus moves and the clearing behaviour are actually run.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');

// Enough of an input element for this widget: value, classList, focus, and the handlers it
// assigns. Nothing here pretends to be a browser beyond what the code touches.
function makeRow() {
  let focused = -1;
  const cells = Array.from({ length: 6 }, (_, i) => ({
    value: '', _i: i,
    classList: { _on: new Set(), toggle(c, on) { on ? this._on.add(c) : this._on.delete(c); }, contains(c) { return this._on.has(c); } },
    focus() { focused = i; },
  }));
  return {
    cells,
    focusedIndex: () => focused,
    querySelectorAll: () => cells,
  };
}

function bind(row, onChange) {
  const ctx = vm.createContext({
    document: { getElementById: () => row },
    Array, Math, console, String, Number,
  });
  const source = fs.readFileSync(path.join(base, 'js', 'invites.js'), 'utf8');
  const start = source.indexOf('function bindCodeRow');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start > 0 && end > start, 'invites.js should still define bindCodeRow');
  vm.runInContext(source.slice(start, end), ctx);
  return ctx.bindCodeRow('code', onChange);
}

const valueOf = row => row.cells.map(c => c.value).join('');

test('typing one digit per box fills and advances', () => {
  const row = makeRow();
  let complete = false;
  const read = bind(row, ok => { complete = ok; });
  for (let i = 0; i < 6; i++) { row.cells[i].value = String(i + 1); row.cells[i].oninput(); }
  assert.equal(read(), '123456');
  assert.equal(complete, true);
});

test('a whole code arriving in one box is spread, not truncated', () => {
  // The autofill case. Before, this left "1" in the first box and dropped the rest.
  const row = makeRow();
  let complete = false;
  const read = bind(row, ok => { complete = ok; });
  row.cells[0].value = '123456';
  row.cells[0].oninput();
  assert.equal(read(), '123456', 'all six digits should survive');
  assert.equal(complete, true, 'the accept button should become enabled');
});

test('a formatted code keeps only its digits', () => {
  const row = makeRow();
  const read = bind(row, () => {});
  row.cells[0].value = '12 34-56';
  row.cells[0].oninput();
  assert.equal(read(), '123456');
});

test('a partial autofill fills what it has and leaves the caret on the next empty box', () => {
  const row = makeRow();
  const read = bind(row, () => {});
  row.cells[0].value = '123';
  row.cells[0].oninput();
  assert.equal(read(), '123');
  assert.equal(row.focusedIndex(), 3, 'the caret belongs on the first empty box');
});

test('multi-digit input into a later box fills from that box, not from the start', () => {
  const row = makeRow();
  const read = bind(row, () => {});
  row.cells[0].value = '9'; row.cells[0].oninput();
  row.cells[1].value = '2345';
  row.cells[1].oninput();
  assert.equal(read(), '92345', 'the digit already entered must not be overwritten');
});

test('pasting a code fills every box', () => {
  const row = makeRow();
  let prevented = false;
  const read = bind(row, () => {});
  row.cells[0].onpaste({ clipboardData: { getData: () => '654321' }, preventDefault() { prevented = true; } });
  assert.equal(read(), '654321');
  assert.equal(prevented, true, 'the raw paste must not also land in the box');
});

test('a paste with no digits is ignored rather than clearing the code', () => {
  const row = makeRow();
  const read = bind(row, () => {});
  row.cells[0].value = '1'; row.cells[0].oninput();
  row.cells[0].onpaste({ clipboardData: { getData: () => 'hello' }, preventDefault() {} });
  assert.equal(read(), '1', 'a junk paste should leave what was typed alone');
});

test('backspace on an empty box steps back and clears the previous one', () => {
  const row = makeRow();
  const read = bind(row, () => {});
  row.cells[0].value = '1'; row.cells[0].oninput();
  row.cells[1].onkeydown({ key: 'Backspace', preventDefault() {} });
  assert.equal(read(), '');
  assert.equal(row.focusedIndex(), 0);
});
