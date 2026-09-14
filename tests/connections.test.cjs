// Settings → Connections. It must say only what is true: what works in the web app, what is planned, and what waits for
// a mobile app. These run the real catalogue and markup, and check the page connects nothing, stores nothing, and
// states the rules for a child's device data before any child connection exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));

function context() {
  const ctx = vm.createContext({ console, Object, Array, String, JSON });
  vm.runInContext(`const H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'');
    function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`, ctx);
  vm.runInContext(read('js/connections.js'), ctx);
  return ctx;
}
const constant = (ctx, name) => plain(vm.runInContext(name, ctx));

test('each connection has its real status: nothing native is offered from the web app, and nothing claims to be connected', () => {
  const ctx = context();
  const all = constant(ctx, 'CONNECTIONS');
  const status = Object.fromEntries(all.map(c => [c.key, c.status]));
  assert.deepEqual(status, {
    file_readings: 'web', composition_results: 'web', child_composition: 'web', calendar_file: 'web',
    google_calendar: 'planned', apple_health: 'needs_app', health_connect: 'needs_app', bluetooth_equipment: 'needs_app',
  });
  for (const c of all) {
    assert.ok(c.name && c.brings && c.lands, c.key + ' says what it brings and where it goes');
    assert.equal(!!c.action, c.status === 'web', c.key + ': only what works now has an action');
  }
  assert.deepEqual(constant(ctx, 'CONNECTION_STATUS'), { web: 'Works in this app', planned: 'Planned', needs_app: 'Needs the Parent Playbook mobile app' });
  assert.doesNotMatch(JSON.stringify(all), /\bconnected\b|\bsyncing\b|\bsynced\b/i);
});

test('an account sees only what applies to it: Your training entries need Adult Training, and child actions need a child', () => {
  const ctx = context();
  const keys = env => plain(ctx.visibleConnections(env)).map(c => c.key);
  assert.deepEqual(keys({ adultTraining: false, hasChild: true }), ['child_composition', 'calendar_file', 'google_calendar'],
    'without Adult Training nothing mentions Your training');
  assert.deepEqual(keys({ adultTraining: true, hasChild: false }),
    ['file_readings', 'composition_results', 'google_calendar', 'apple_health', 'health_connect', 'bluetooth_equipment']);
  assert.equal(keys({ adultTraining: true, hasChild: true }).length, 8);
  const routes = constant(ctx, 'CONNECTIONS').filter(c => c.action).map(c => c.action.route);
  const tabs = read('js/shell.js').match(/const APP_TABS=\[([^\]]*)\];/)[1];
  for (const route of routes) assert.match(tabs, new RegExp(`'${route}'`), route + ' is a real route');
});

test('only what works now has a button; the rest show their status; the child rules appear with a child', () => {
  const ctx = context();
  const html = ctx.connectionsMarkup({ adultTraining: true, hasChild: true });
  assert.deepEqual([...html.matchAll(/data-connection="([a-z_]+)"/g)].map(m => m[1]),
    ['file_readings', 'composition_results', 'child_composition', 'calendar_file']);
  assert.equal((html.match(/Needs the Parent Playbook mobile app/g) || []).length, 3);
  assert.match(html, /<b>Google Calendar sync<\/b>[\s\S]*?Planned/);
  assert.doesNotMatch(html, />\s*Connect\s*</, 'no button pretends to connect anything');
  assert.match(html, /Children’s device data[\s\S]*<b>Off\.<\/b> No watch, phone or gym equipment connects for a child today\. If that is ever added, it stays off until a parent turns it on for that child, it never sets calorie or weight-loss targets, and it reaches no coach, camp, trainer or company unless you share it\./);
  assert.doesNotMatch(ctx.connectionsMarkup({ adultTraining: true, hasChild: false }), /Children’s device data/);
});

test('the page connects nothing and stores nothing', () => {
  const src = read('js/connections.js');
  assert.doesNotMatch(src, /\bsb\.|fetch\(|localStorage|sessionStorage|navigator\.|indexedDB|XMLHttpRequest/);
  assert.match(src, /const env = \{ adultTraining:adultTrainingOn\(\), hasChild:hasActiveAthlete\(\) \};/);
  assert.doesNotMatch(src, /state\.active/);
});

test('a name and its detail sit on separate lines in every such row, without restyling the scan history', () => {
  const css = read('css/app.css');
  assert.match(css, /\.mrow:not\(\.scan-history-row\)>span>b\+small\{display:block;/);
  assert.match(css, /\.scan-history-row>span small\{color:var\(--muted\);font-size:11px;/);
  for (const file of ['js/connections.js', 'js/screen-adult.js', 'js/screen-adult-eating.js', 'js/adult-composition.js'])
    assert.match(read(file), /<div class="mrow"><span><b>\$\{esc\([^)]*\)\}<\/b><small>/, file + ' uses the pattern the rule styles');
});

test('Connections is reachable from Account and from Your training', () => {
  const account = read('js/account.js');
  assert.match(account, /<div class="navrow" id="toConnections" role="button" tabindex="0"><div class="gi">🔗<\/div>/);
  assert.match(account, /go\('toConnections', openConnections\);/);
  const screen = read('js/screen-adult.js');
  assert.match(screen, /<button class="btn sm ghost" id="adultConnections" style="margin-top:10px">Connections<\/button>/);
  assert.match(screen, /\{ const b = \$\("#adultConnections"\); if \(b\) b\.onclick = \(\) => openConnections\(\); \}/);
  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('shell.js') > -1 && at('shell.js') < at('connections.js') && at('connections.js') < at('init.js'));
  assert.match(read('sw.js'), /'\/js\/account\.js','\/js\/connections\.js',/);
});
