// OPERATIONS.md tells whoever runs production what to do. A runbook that names a script that has moved,
// leaves out a scheduled job added since, or states a monitor schedule the workflow no longer runs is worse
// than none, because it is the page people trust during an incident. These tests hold it to the repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const runbook = fs.readFileSync(path.join(root, 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
const quoted = [...runbook.matchAll(/`([^`\n]+)`/g)].map(m => m[1]);

test('every repository path the runbook names exists', () => {
  const ROOT_FILES = new Set(['Dockerfile', 'Caddyfile', 'sw.js', 'SIGNING-KEY.pub.pem']);
  const paths = quoted.filter(text => ROOT_FILES.has(text) || /^(?:\.github|tools|tests|supabase|js)\/[\w.\/-]+$/.test(text));
  assert.ok(paths.length >= 10, 'the runbook should name the scripts it relies on; found ' + paths.length);
  const missing = [...new Set(paths)].filter(p => !fs.existsSync(path.join(root, p)));
  assert.deepEqual(missing, [], 'OPERATIONS.md names paths that do not exist');
});

test('every job the migrations schedule is named in the runbook', () => {
  const dir = path.join(root, 'supabase', 'migrations');
  const jobs = new Set();
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,/g)) jobs.add(m[1]);
  }
  assert.ok(jobs.size >= 7, 'expected the retention and notification jobs; found ' + [...jobs].join(', '));
  const unnamed = [...jobs].filter(job => !quoted.includes(job));
  assert.deepEqual(unnamed, [], 'these scheduled jobs are missing from OPERATIONS.md');
});

test('the monitor schedule the runbook states is the one the workflow runs', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/production-monitor.yml'), 'utf8');
  const cron = (workflow.match(/- cron: '([^']+)'/) || [])[1];
  assert.ok(cron, 'the workflow has no schedule');
  assert.ok(quoted.includes(cron), 'OPERATIONS.md should state the monitor schedule `' + cron + '`');
});
