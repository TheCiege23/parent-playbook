// Every push job a parent receives is scheduled by a migration, so a project rebuilt from supabase/migrations sends
// what production sends. Until 2026-09-13 notify-daily and notify-measure were scheduled only in the live project.
// And no schedule in the migrations sets both a day of the month and a day of the week: cron runs such a line when
// EITHER field matches, which is how the "first Sunday" measure nudge came to run every Sunday and on days 1 to 7 too.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '../supabase/migrations');
const files = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
const read = file => fs.readFileSync(path.join(dir, file), 'utf8');

// Every cron.schedule('name', 'schedule', ...) call, in migration order, with the SQL up to the next call.
function scheduleCalls() {
  const calls = [];
  for (const file of files) {
    const sql = read(file);
    const starts = [...sql.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
      calls.push({ file, name: m[1], schedule: m[2], command: sql.slice(m.index, end) });
    });
  }
  return calls;
}

test('every cron.schedule call in the migrations is the named form, so the checks below see all of them', () => {
  const total = files.reduce((sum, file) => sum + (read(file).match(/cron\.schedule\(/g) || []).length, 0);
  assert.ok(total > 0);
  assert.equal(scheduleCalls().length, total, 'an unnamed cron.schedule(schedule, command) call would be invisible to these checks');
});

test('the four push jobs are scheduled by migrations, at the times production runs them, reading the key from Vault', () => {
  const latest = new Map();
  for (const call of scheduleCalls()) latest.set(call.name, call);
  const pushJobs = [...latest.values()]
    .filter(call => /\/functions\/v1\/notify-/.test(call.command))
    .map(call => [call.name, call.schedule, call.command.match(/\/functions\/v1\/(notify-[a-z-]+)/)[1]])
    .sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(pushJobs, [
    ['daily-nudge', '12 20 * * *', 'notify-daily'],
    ['gameday-push', '0 23 * * *', 'notify-gameday'],
    ['measure-nudge', '14 14 * * 0', 'notify-measure'],
    ['weekly-plan-push', '0 22 * * 0', 'notify-weekly'],
  ]);
  for (const call of latest.values()) {
    if (!/\/functions\/v1\//.test(call.command)) continue;
    assert.match(call.command, /vault\.decrypted_secrets where name='service_role_key'/, call.name + ' must read the key from Vault when it fires');
    assert.doesNotMatch(call.command, /eyJ[A-Za-z0-9_-]{10,}|sb_secret_/, call.name + ' must not embed a key');
  }
});

test('no schedule sets both the day of the month and the day of the week', () => {
  for (const call of scheduleCalls()) {
    const fields = call.schedule.trim().split(/\s+/);
    assert.equal(fields.length, 5, call.file + ': ' + call.name + ' should be a five-field schedule');
    const [, , dayOfMonth, , dayOfWeek] = fields;
    assert.ok(dayOfMonth === '*' || dayOfWeek === '*',
      call.file + ': ' + call.name + " ('" + call.schedule + "') would run when EITHER day field matches, not when both do");
  }
});
