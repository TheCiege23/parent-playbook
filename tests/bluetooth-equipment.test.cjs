// Your training → Bluetooth equipment, the early web version. These decode byte strings built from the published Heart
// Rate and Fitness Machine characteristic formats (no real equipment was used), check what a finished workout would save
// and that it passes the health record's own checks, and pin the rules: never heart rate or energy, never for a child,
// offered only where the browser has Web Bluetooth, and saved as one undoable import. Every value is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8').replace(/\r\n/g, '\n');
const plain = value => JSON.parse(JSON.stringify(value));
const view = bytes => new DataView(Uint8Array.from(bytes).buffer);
const u16 = n => [n & 255, (n >> 8) & 255];
const s16 = n => u16(n < 0 ? 65536 + n : n);
const u24 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

function context(extra = {}) {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object, DataView, Uint8Array, ...extra });
  vm.runInContext(read('js/dates.js'), ctx);
  vm.runInContext(read('js/adult-health-record.js'), ctx);
  vm.runInContext(read('js/bluetooth-equipment.js'), ctx);
  return ctx;
}

test('heart rate: one or two bytes, no reading from a strap off the skin, and nothing outside a human range', () => {
  const ctx = context();
  assert.equal(ctx.btHeartRate(view([0x06, 128])), 128, 'one byte, contact detected');
  assert.equal(ctx.btHeartRate(view([0x07, ...u16(182)])), 182, 'two bytes');
  assert.equal(ctx.btHeartRate(view([0x07, ...u16(336)])), null, 'both bytes are read: 336 is refused, not taken as its low byte, 80');
  assert.equal(ctx.btHeartRate(view([0x00, 95])), 95, 'contact not reported at all');
  assert.equal(ctx.btHeartRate(view([0x04, 150])), null, 'contact supported but not detected');
  assert.equal(ctx.btHeartRate(view([0x10, 71, ...u16(820)])), 71, 'RR intervals after the rate are ignored');
  assert.equal(ctx.btHeartRate(view([0x01, 90])), null, 'too short for a two-byte rate');
  assert.equal(ctx.btHeartRate(view([0x06, 0])), null);
  assert.equal(ctx.btHeartRate(view([0x06])), null);
});

test('treadmill data: speed and distance found wherever the flags put them', () => {
  const ctx = context();
  // Flags 0x0004: speed (present with bit 0 clear) then total distance.
  assert.deepEqual(plain(ctx.btMachineData('treadmill', view([...u16(0x0004), ...u16(1050), ...u24(2345)]))), { speed: 10.5, distance: 2345 });
  // Bit 1 (average speed) before distance, bit 3 (inclination and ramp) after it.
  assert.deepEqual(plain(ctx.btMachineData('treadmill', view([...u16(0x000e), ...u16(800), ...u16(790), ...u24(70000), ...s16(-15), ...s16(20)]))), { speed: 8, distance: 70000 });
  // Bit 0 set: "more data", so no speed; distance comes first.
  assert.deepEqual(plain(ctx.btMachineData('treadmill', view([...u16(0x0005), ...u24(12)]))), { distance: 12 });
  // A frame cut short keeps what it holds.
  assert.deepEqual(plain(ctx.btMachineData('treadmill', view([...u16(0x0004), ...u16(900), 1]))), { speed: 9 });
  assert.equal(ctx.btMachineData('treadmill', view([4])), null);
  assert.equal(ctx.btMachineData('elliptical', view([...u16(0), ...u16(100)])), null);
});

test('bike and rower data: cadence, stroke rate, power (signed) and distance after the fields before them', () => {
  const ctx = context();
  // Bike flags 0x0074: speed, cadence, distance, resistance, power.
  assert.deepEqual(plain(ctx.btMachineData('bike', view([...u16(0x0074), ...u16(2800), ...u16(170), ...u24(5000), ...s16(12), ...s16(-3)]))),
    { speed: 28, cadence: 85, distance: 5000, power: -3 });
  // Bike flags 0x0040 with bit 8 (energy, five bytes) and bit 11 (elapsed): power still read before them.
  assert.deepEqual(plain(ctx.btMachineData('bike', view([...u16(0x0940), ...u16(3000), ...s16(210), ...u16(50), ...u16(400), 7, ...u16(600)]))),
    { speed: 30, power: 210 });
  // Rower flags 0x002c: stroke rate and count, distance, pace, power.
  assert.deepEqual(plain(ctx.btMachineData('rower', view([...u16(0x002c), 52, ...u16(310), ...u24(1500), ...u16(125), ...s16(180)]))),
    { strokeRate: 26, distance: 1500, power: 180 });
});

test('a workout counts the distance the machine added, through a reset, and ignores a jump that cannot be real', () => {
  const ctx = context();
  const s = ctx.btSession(0);
  for (const d of [1000, 1010, 1025]) ctx.btSessionAdd(s, { kind: 'treadmill', data: { distance: d } });
  ctx.btSessionAdd(s, { kind: 'treadmill', data: { distance: 5 } });
  ctx.btSessionAdd(s, { kind: 'treadmill', data: { distance: 15 } });
  ctx.btSessionAdd(s, { kind: 'treadmill', data: { distance: 9000 } });
  ctx.btSessionAdd(s, { kind: 'treadmill', data: { distance: 9004 } });
  ctx.btSessionAdd(s, { kind: 'treadmill', data: { speed: 9 } });
  for (const bpm of [120, 130, 141]) ctx.btSessionAdd(s, { kind: 'heart', bpm });
  const summary = plain(ctx.btSessionSummary(s, 185400));
  assert.deepEqual(summary, { seconds: 185, minutes: 3, machine: 'treadmill', distanceM: 39, heart: { average: 130, max: 141 } });
});

test('a finished workout saves whole minutes and the distance in your units, never heart rate, and passes the record checks', () => {
  const ctx = context();
  const summary = { seconds: 1905, minutes: 31, machine: 'treadmill', distanceM: 5000, heart: { average: 140, max: 170 } };
  const mi = plain(ctx.btSessionRecords(summary, { units: 'lb', day: '2026-09-14', sessionId: 's1' }));
  assert.deepEqual(mi, [
    { metric_key: 'workout_minutes', value: 31, unit: 'min', measured_on: '2026-09-14', external_id: 'bt-s1-minutes' },
    { metric_key: 'distance', value: 3.11, unit: 'mi', measured_on: '2026-09-14', external_id: 'bt-s1-distance' },
  ]);
  assert.equal(plain(ctx.btSessionRecords(summary, { units: 'kg', day: '2026-09-14', sessionId: 's1' }))[1].value, 5);
  assert.deepEqual(plain(ctx.btSessionRecords({ ...summary, machine: null }, { units: 'lb', day: '2026-09-14', sessionId: 's2' })).map(r => r.metric_key), ['workout_minutes'], 'a strap alone has no distance');
  assert.deepEqual(plain(ctx.btSessionRecords({ ...summary, seconds: 59, minutes: 0, distanceM: 3 }, { units: 'lb', day: '2026-09-14', sessionId: 's3' })), [], 'under a minute and under 0.01 mi saves nothing');
  assert.ok(!JSON.stringify(mi).includes('heart'));

  const source = ctx.btSourceName({ machine: 'Synthetic treadmill', heart: 'Synthetic HR strap' });
  assert.equal(source, 'Synthetic treadmill via Bluetooth');
  const checked = mi.map(r => plain(ctx.adultHealthNormalize(r, { source_kind: 'file_import', source_name: source, origin: 'device', today: '2026-09-14' })));
  assert.ok(checked.every(n => n.ok), JSON.stringify(checked));
  assert.deepEqual(checked.map(n => [n.record.metric_key, n.record.method, n.record.external_id]),
    [['workout_minutes', 'device_measured', 'bt-s1-minutes'], ['distance', 'device_estimated', 'bt-s1-distance']]);

  assert.equal(ctx.btSourceName({ heart: '  Chest\n strap  ' }), 'Chest strap via Bluetooth');
  assert.equal(ctx.btSourceName({}), 'Bluetooth equipment', 'a device with no name is not "Bluetooth equipment via Bluetooth"');
  assert.ok(ctx.btSourceName({ machine: 'x'.repeat(200) }).length <= 80, 'a long device name still fits the record');
});

test('offered only where the browser has Web Bluetooth, saved only as one import, and never shows energy', () => {
  assert.equal(context().bluetoothEquipmentAvailable(), false, 'no navigator');
  assert.equal(context({ navigator: {} }).bluetoothEquipmentAvailable(), false, 'Safari and iPhone: no navigator.bluetooth');
  assert.equal(context({ navigator: { bluetooth: { requestDevice() {} } }, isSecureContext: true }).bluetoothEquipmentAvailable(), true);
  assert.equal(context({ navigator: { bluetooth: { requestDevice() {} } }, isSecureContext: false }).bluetoothEquipmentAvailable(), false);

  const src = read('js/bluetooth-equipment.js');
  const code = src.replace(/\/\/[^\n]*/g, '');
  assert.match(code, /async function openBluetoothEquipment\(units\)\{\n  if \(adultTrainingOff\(\)\) return;/);
  assert.equal((code.match(/sb\.rpc\(/g) || []).length, 1);
  assert.match(code, /sb\.rpc\('save_adult_health_import', \{/);
  assert.doesNotMatch(code, /sb\.from\('adult_health_records'\)|insert\(/, 'no other way into the record');
  assert.doesNotMatch(code, /calorie|kcal|energy|resting_heart_rate/i);
  assert.doesNotMatch(code, /state\.active|athlete/i);
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/);
  assert.match(code, /finished = null; releaseAll\(\); closeSheet\(\); toast\('Workout saved'\);/);
  // The distance shown uses the precision it is saved with (btSessionRecords rounds to hundredths).
  assert.match(code, /const two = n => \(Math\.round\(n \* 100\) \/ 100\)\.toLocaleString\(undefined, \{ minimumFractionDigits:2, maximumFractionDigits:2 \}\);\n  const distanceText = m => miles \? two\(m \/ 1609\.344\) \+ ' mi' : two\(m \/ 1000\) \+ ' km';/);
  assert.match(code, /if \(!bg\.isConnected\) \{ clearInterval\(timer\); releaseAll\(\); return; \}/, 'closing the sheet disconnects the equipment');
});

test('Your training and Connections offer it only with Web Bluetooth and Adult Training, and the privacy page says what is saved', () => {
  const screen = read('js/screen-adult.js');
  assert.match(screen, /\$\{typeof bluetoothEquipmentAvailable === 'function' && bluetoothEquipmentAvailable\(\) \? H`<button class="btn sm ghost" id="adultBluetooth" style="margin-top:10px">Bluetooth equipment<\/button>` : ''\}/);
  assert.match(screen, /\{ const b = \$\("#adultBluetooth"\); if \(b\) b\.onclick = \(\) => openBluetoothEquipment\(units\); \}/);

  const ctx = vm.createContext({ console, Object, Array, String, JSON });
  vm.runInContext(`const H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),''); function esc(v){return String(v??'');}`, ctx);
  vm.runInContext(read('js/connections.js'), ctx);
  const on = ctx.connectionsMarkup({ adultTraining: true, hasChild: false, bluetooth: true });
  assert.match(on, /<b>Bluetooth gym equipment<\/b><small>[^<]*In Chrome on Android or a computer it works in this app now[^<]*iPhone needs the mobile app\.[^<]*<\/small><\/span>\s*<button class="btn sm ghost" data-connection="bluetooth_equipment">Open</);
  assert.match(ctx.connectionsMarkup({ adultTraining: true, hasChild: false, bluetooth: false }), /<b>Bluetooth gym equipment<\/b>[\s\S]*?Needs the Parent Playbook mobile app/);
  assert.ok(!plain(ctx.visibleConnections({ adultTraining: false, hasChild: true, bluetooth: true })).some(c => c.key === 'bluetooth_equipment'), 'never offered without Your training');
  assert.match(read('js/connections.js'), /if \(c\.action\.open === 'bluetooth'\) return openBluetoothEquipment\(\);/);

  assert.match(read('privacy.html'), /<h3>Bluetooth equipment, only if you connect it<\/h3>\n<p>[^<]*Nothing reaches our servers unless you press Save when the workout ends, and then only the workout’s minutes and the distance the machine counted, labelled with the equipment’s name\. Heart rate is never saved\. Children cannot connect equipment\.<\/p>/);
  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('adult-health-record.js') < at('bluetooth-equipment.js') && at('screen-adult.js') < at('bluetooth-equipment.js') && at('bluetooth-equipment.js') < at('init.js'));
  assert.match(read('sw.js'), /'\/js\/adult-progress\.js','\/js\/adult-deletion\.js','\/js\/bluetooth-equipment\.js',/);
});

test('the harness strap and treadmill notify frames the real parsers read', async () => {
  const navigator = {};
  const ctx = vm.createContext({ console, Date, Math, JSON, Number, String, Array, Object, Set, URLSearchParams, DataView, Uint8Array, setInterval, clearInterval, setTimeout,
    crypto: require('node:crypto').webcrypto, location: { search: '?bluetooth=1' }, navigator });
  ctx.window = ctx;
  vm.runInContext(read('tools/adult-harness/fake-supabase.js'), ctx);
  vm.runInContext(read('js/bluetooth-equipment.js'), ctx);
  const seen = { heart: [], treadmill: [] };
  const devices = [];
  for (const [service, char, kind] of [[0x180d, 0x2a37, 'heart'], [0x1826, 0x2acd, 'treadmill']]) {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [service] }] });
    const server = await device.gatt.connect();
    const c = await (await server.getPrimaryService(service)).getCharacteristic(char);
    c.addEventListener('characteristicvaluechanged', ev => seen[kind].push(kind === 'heart' ? ctx.btHeartRate(ev.target.value) : plain(ctx.btMachineData('treadmill', ev.target.value))));
    await c.startNotifications();
    devices.push(device);
  }
  // Wait for the frames the assertions need rather than sleeping a fixed time. A fixed 900 ms failed whenever a loaded
  // machine fired the fake's timers late and too few frames landed inside it. The bound only turns a device that never
  // notifies into a failure with the counts in it, instead of a hang.
  const deadline = Date.now() + 15000;
  while ((seen.heart.length < 2 || seen.treadmill.length < 3) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  devices.forEach(d => d.gatt.disconnect());
  assert.ok(seen.heart.length >= 2 && seen.heart.every(b => b >= 120 && b <= 140), JSON.stringify(seen.heart));
  assert.ok(seen.treadmill.length >= 3, `expected at least three treadmill frames, got ${seen.treadmill.length}`);
  assert.ok(seen.treadmill.every(d => d.speed === 10), JSON.stringify(seen.treadmill));
  // Every frame the real parser read carries a total exactly one metre above the frame before it, however late it came.
  const distances = seen.treadmill.map(d => d.distance);
  assert.ok(distances.every((d, i) => i === 0 || d === distances[i - 1] + 1), `total distance should rise a metre a frame: ${distances}`);
  await assert.rejects(navigator.bluetooth.requestDevice({ filters: [{ services: [0x1234] }] }), /cancelled/);
  assert.deepEqual([...vm.runInContext('window.__harness.bluetooth.connected', ctx)], []);
});

test('the sheet asks before discarding a workout, reports only real disconnections, lets go of failed connections, and restarts distance on reconnect', () => {
  const code = read('js/bluetooth-equipment.js').replace(/\/\/[^\n]*/g, '');
  assert.match(code, /const closeSheet = bg\.remove;\n  bg\.remove = \(\) => \{\n    if \(\(session \|\| finished\) && !confirm\(/);
  assert.match(code, /const releaseAll = \(\) => \{ const h = conn\.heart, m = conn\.machine; conn\.heart = conn\.machine = null; release\(h\); release\(m\); \};/);
  assert.match(code, /if \(conn\.heart\) \{ const c = conn\.heart; conn\.heart = null; release\(c\); paint\(\); \}/);
  assert.match(code, /if \(conn\.machine\) \{ const c = conn\.machine; conn\.machine = null; if \(session\) session\.lastDistance = null; release\(c\); paint\(\); \}/);
  assert.match(code, /if \(!bg\.isConnected\) \{ release\(entry\); return; \}/);
  assert.match(code, /if \(entry && conn\[which\] !== entry\) release\(entry\);\n      else if \(!entry && device\) \{ try \{ device\.gatt\.disconnect\(\); \} catch \(x\) \{\} \}/);
  assert.equal((code.match(/session\.lastDistance = null/g) || []).length, 3, 'on connecting, on an unexpected disconnection, and on pressing Disconnect');
});
