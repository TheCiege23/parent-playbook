// .github/workflows/ci.yml runs the suites on every pull request. A workflow that quietly stopped running one
// of them, narrowed the test glob, stopped running on pull requests, or started depending on a secret would
// keep showing green while checking less. This pins what it runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('CI runs both suites on every pull request and push to main, read-only and without secrets', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /^on:\n  pull_request:\n  push:\n    branches: \[main\]$/m, 'CI should run on every pull request and on pushes to main');
  assert.match(workflow, /^\s+run: node --test "tests\/\*\.test\.cjs"$/m, 'CI should run the whole JavaScript suite, with the same glob the deck counts');
  assert.match(workflow, /^\s+run: node tests\/db\/run\.cjs$/m, 'CI should run the database suite');
  assert.match(workflow, /^permissions:\n  contents: read$/m, 'CI should hold read-only repository permissions');
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./, 'CI must not need a secret');
});
