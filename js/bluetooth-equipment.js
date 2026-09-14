// ===================================================================
//  YOUR TRAINING → BLUETOOTH EQUIPMENT (an early web version)
// ===================================================================
// Step 8 of the device connections plan, as far as a web app can take it. In Chrome on Android or a computer, a parent
// connects a heart-rate strap (the Bluetooth Heart Rate service) or a treadmill, exercise bike or rower that speaks the
// Bluetooth Fitness Machine standard, and sees its readings while they train. When they stop, they choose whether to save
// the workout's minutes and the distance the machine counted, each labelled with the equipment's name. Heart rate is
// shown, not saved: the record keeps resting heart rate, and a workout's heart rate is not that. Energy the machine
// reports is skipped, never shown.
//
// Safari and iPhone have no Web Bluetooth, so there the sheet is not offered and Connections still says it needs the
// mobile app. Nothing here has been tried on real equipment: the parsers follow the published characteristic formats and
// are tested on byte strings built from them.
//
// A session saves through save_adult_health_import as one import from a device, so it can be undone from Your imports
// like any other. The record's source kind stays file_import until a migration adds a Bluetooth kind (a migration ships
// in the buyer package, so it waits for a package rebuild); the source name ("… via Bluetooth") and the import's origin
// say where it came from. Only in Your training, so never for a child.

const BT_SERVICE = Object.freeze({ heartRate:0x180d, fitnessMachine:0x1826 });
const BT_CHAR = Object.freeze({ heartRate:0x2a37, treadmill:0x2acd, bike:0x2ad2, rower:0x2ad1 });
const BT_MACHINE_LABEL = Object.freeze({ treadmill:'Treadmill', bike:'Exercise bike', rower:'Rower' });
// A single reading that adds more than this to the distance is treated as noise, not as running 500 m in a second.
const BT_MAX_DISTANCE_STEP_M = 500;

function bluetoothEquipmentAvailable(){
  return typeof navigator !== 'undefined' && !!navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function'
    && (typeof isSecureContext === 'undefined' || isSecureContext === true);
}

// Heart Rate Measurement (0x2A37): flags, then the rate as one byte or, with flag bit 0, two. Bits 1-2 report skin
// contact; a strap that says it is not touching skin gives no reading.
function btHeartRate(view){
  if (!view || view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  if ((flags & 1) && view.byteLength < 3) return null;
  const bpm = flags & 1 ? view.getUint16(1, true) : view.getUint8(1);
  if (((flags >> 1) & 3) === 2) return null;
  return bpm >= 20 && bpm <= 250 ? bpm : null;
}

// Fitness Machine data characteristics: a 16-bit flags field, then each field its flag says is present, in order. Each
// entry is [flag bit, name or null to skip, byte size (negative when signed), scale, 'clear' when present with the bit
// clear]. Only speed, cadence, stroke rate, power and total distance are kept.
const BT_FIELDS = Object.freeze({
  treadmill:[[0, 'speed', 2, 0.01, 'clear'], [1, null, 2], [2, 'distance', 3, 1], [3, null, 4], [4, null, 4], [5, null, 1], [6, null, 1],
    [7, null, 5], [8, null, 1], [9, null, 1], [10, null, 2], [11, null, 2], [12, null, 4]],
  bike:[[0, 'speed', 2, 0.01, 'clear'], [1, null, 2], [2, 'cadence', 2, 0.5], [3, null, 2], [4, 'distance', 3, 1], [5, null, 2], [6, 'power', -2, 1],
    [7, null, 2], [8, null, 5], [9, null, 1], [10, null, 1], [11, null, 2], [12, null, 2]],
  rower:[[0, 'strokeRate', 1, 0.5, 'clear'], [0, null, 2, 1, 'clear'], [1, null, 1], [2, 'distance', 3, 1], [3, null, 2], [4, null, 2], [5, 'power', -2, 1],
    [6, null, 2], [7, null, 2], [8, null, 5], [9, null, 1], [10, null, 1], [11, null, 2], [12, null, 2]],
});

function btMachineData(kind, view){
  const fields = BT_FIELDS[kind];
  if (!fields || !view || view.byteLength < 2) return null;
  const flags = view.getUint16(0, true), out = {};
  let at = 2;
  for (const [bit, name, size, scale = 1, when] of fields) {
    const set = !!(flags & (1 << bit));
    if (when === 'clear' ? set : !set) continue;
    const bytes = Math.abs(size);
    if (at + bytes > view.byteLength) break;
    if (name) {
      const raw = bytes === 1 ? view.getUint8(at)
        : bytes === 2 ? (size < 0 ? view.getInt16(at, true) : view.getUint16(at, true))
        : view.getUint16(at, true) + view.getUint8(at + 2) * 65536;
      out[name] = Math.round(raw * scale * 100) / 100;
    }
    at += bytes;
  }
  return out;
}

// A workout in progress: heart-rate readings, the latest machine values, and the distance the machine added while it ran.
function btSession(startMs){
  return { startMs, machine:null, heart:[], distanceM:0, lastDistance:null, names:{ heart:null, machine:null } };
}
function btSessionAdd(s, reading){
  if (reading.kind === 'heart') { if (reading.bpm) s.heart.push(reading.bpm); return s; }
  s.machine = reading.kind;
  const d = reading.data && reading.data.distance;
  if (d == null) return s;
  if (s.lastDistance != null && d >= s.lastDistance && d - s.lastDistance <= BT_MAX_DISTANCE_STEP_M) s.distanceM += d - s.lastDistance;
  // A lower total means the machine started counting again; a huge jump is noise. Either way, count on from here.
  s.lastDistance = d;
  return s;
}
function btSessionSummary(s, endMs){
  const seconds = Math.max(0, Math.round((endMs - s.startMs) / 1000));
  return {
    seconds, minutes:Math.floor(seconds / 60), machine:s.machine, distanceM:Math.round(s.distanceM),
    heart:s.heart.length ? { average:Math.round(s.heart.reduce((a, b) => a + b, 0) / s.heart.length), max:Math.max(...s.heart) } : null,
  };
}

// What a finished workout saves: its whole minutes, and the machine's distance in the parent's units. Never heart rate.
function btSessionRecords(summary, { units, day, sessionId }){
  const rows = [];
  if (summary.minutes >= 1 && summary.minutes <= 1440)
    rows.push({ metric_key:'workout_minutes', value:summary.minutes, unit:'min', measured_on:day, external_id:'bt-' + sessionId + '-minutes' });
  const unit = units === 'kg' ? 'km' : 'mi';
  const distance = Math.round(summary.distanceM / (unit === 'km' ? 1000 : 1609.344) * 100) / 100;
  if (summary.machine && distance >= 0.01)
    rows.push({ metric_key:'distance', value:distance, unit, measured_on:day, external_id:'bt-' + sessionId + '-distance' });
  return rows;
}

// The name a session is saved under: the machine's if one was connected, otherwise the strap's. Bluetooth names are
// whatever the device says, so they are trimmed here and escaped wherever they are shown.
function btDeviceName(name, fallback){
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;
}
function btSourceName(names){
  const name = btDeviceName(names && (names.machine || names.heart), '');
  return name ? name.slice(0, 66) + ' via Bluetooth' : 'Bluetooth equipment';
}

async function openBluetoothEquipment(units){
  if (adultTrainingOff()) return;
  if (!bluetoothEquipmentAvailable()) { toast('Bluetooth equipment works in Chrome on Android or a computer'); return; }
  if (!units) {
    const r = await sb.from('adult_profiles').select('units').eq('guardian_id', state.user.id).maybeSingle();
    units = (r && r.data && r.data.units) || 'lb';
  }
  const conn = { heart:null, machine:null };
  const live = {};
  let session = null, sessionId = null, startDay = null, finished = null;
  const bg = sheet(H`<h3>Bluetooth equipment</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Connect a heart-rate strap, or a treadmill, exercise bike or rower that supports the Bluetooth fitness machine standard. This device talks to it directly. When you stop, you choose whether to save the workout’s minutes and the distance the machine counted. Heart rate is shown, not saved.</p>
    <div class="card app-pad">
      <div class="mrow"><span><b>Heart-rate strap</b><small id="btHeartName">Not connected</small></span><button class="btn sm ghost" id="btHeart">Connect</button></div>
      <div class="mrow"><span><b>Treadmill, bike or rower</b><small id="btMachineName">Not connected</small></span><button class="btn sm ghost" id="btMachine">Connect</button></div>
    </div>
    <div class="card app-pad">
      <div class="mrow"><span>Time</span><b id="btTime">0:00</b></div>
      <div class="mrow"><span>Heart rate</span><b id="btBpm">–</b></div>
      <div class="mrow"><span>Speed</span><b id="btSpeed">–</b></div>
      <div class="mrow"><span id="btPaceLabel">Cadence</span><b id="btCadence">–</b></div>
      <div class="mrow"><span>Power</span><b id="btPower">–</b></div>
      <div class="mrow"><span>Distance this workout</span><b id="btDistance">–</b></div>
    </div>
    <div id="btSummary" aria-live="polite"></div>
    <div class="err" id="btErr"></div>
    <button class="btn" id="btStart" disabled>Start workout</button>
    <p class="muted-note">Works in Chrome on Android and computers, with equipment that follows the Bluetooth standards. If a reading looks wrong, don’t save it.</p>`);
  const $b = sel => bg.querySelector(sel);
  const err = $b('#btErr'), startBtn = $b('#btStart'), summaryEl = $b('#btSummary');
  // Closing mid-workout, or with a finished workout not yet saved, asks first: those readings exist only on this sheet.
  const closeSheet = bg.remove;
  bg.remove = () => {
    if ((session || finished) && !confirm(session ? 'Stop this workout without saving it?' : 'Close without saving this workout?')) return;
    closeSheet();
  };
  const miles = units !== 'kg';
  const one = n => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits:1 });
  // Distance shows the two decimals it is saved with, so the summary never says 0 mi above a save of 0.01 mi.
  const two = n => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
  const distanceText = m => miles ? two(m / 1609.344) + ' mi' : two(m / 1000) + ' km';
  const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');

  const release = c => {
    if (!c) return;
    try { c.char.removeEventListener('characteristicvaluechanged', c.handler); } catch (e) {}
    try { const p = c.char.stopNotifications(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    try { if (c.device.gatt && c.device.gatt.connected !== false) c.device.gatt.disconnect(); } catch (e) {}
  };
  // Clear the slot before disconnecting: Chrome fires gattserverdisconnected inside disconnect(), and a slot still holding
  // the device would report it as an unexpected disconnection.
  const releaseAll = () => { const h = conn.heart, m = conn.machine; conn.heart = conn.machine = null; release(h); release(m); };

  function paint(){
    $b('#btHeartName').textContent = conn.heart ? conn.heart.name : 'Not connected';
    $b('#btMachineName').textContent = conn.machine ? conn.machine.name + ' · ' + BT_MACHINE_LABEL[conn.machine.kind] : 'Not connected';
    $b('#btHeart').textContent = conn.heart ? 'Disconnect' : 'Connect';
    $b('#btMachine').textContent = conn.machine ? 'Disconnect' : 'Connect';
    $b('#btTime').textContent = clock(session ? Math.max(0, Math.round((Date.now() - session.startMs) / 1000)) : 0);
    $b('#btBpm').textContent = conn.heart && live.bpm ? live.bpm + ' bpm' : '–';
    $b('#btSpeed').textContent = conn.machine && live.speed != null ? one(miles ? live.speed / 1.609344 : live.speed) + (miles ? ' mph' : ' km/h') : '–';
    const rower = conn.machine && conn.machine.kind === 'rower';
    $b('#btPaceLabel').textContent = rower ? 'Stroke rate' : 'Cadence';
    $b('#btCadence').textContent = rower && live.strokeRate != null ? one(live.strokeRate) + ' strokes/min'
      : conn.machine && conn.machine.kind === 'bike' && live.cadence != null ? Math.round(live.cadence) + ' rpm' : '–';
    $b('#btPower').textContent = conn.machine && live.power != null ? Math.round(live.power) + ' W' : '–';
    $b('#btDistance').textContent = session && session.machine ? distanceText(session.distanceM) : '–';
    startBtn.textContent = session ? 'Stop workout' : 'Start workout';
    startBtn.disabled = !session && !conn.heart && !conn.machine;
  }

  function onReading(kind, view){
    if (!bg.isConnected) return releaseAll();
    if (kind === 'heart') {
      live.bpm = btHeartRate(view);
      if (session && live.bpm) btSessionAdd(session, { kind:'heart', bpm:live.bpm });
    } else {
      const data = btMachineData(kind, view);
      if (!data) return;
      for (const k of ['speed', 'cadence', 'strokeRate', 'power']) if (data[k] != null) live[k] = data[k];
      if (session) btSessionAdd(session, { kind, data });
    }
    paint();
  }

  async function connect(which){
    err.textContent = '';
    let device = null, entry = null;
    try {
      device = await navigator.bluetooth.requestDevice({ filters:[{ services:[which === 'heart' ? BT_SERVICE.heartRate : BT_SERVICE.fitnessMachine] }] });
      const server = await device.gatt.connect();
      let char = null, kind = 'heart';
      if (which === 'heart') char = await (await server.getPrimaryService(BT_SERVICE.heartRate)).getCharacteristic(BT_CHAR.heartRate);
      else {
        const service = await server.getPrimaryService(BT_SERVICE.fitnessMachine);
        for (const k of ['treadmill', 'bike', 'rower']) {
          try { char = await service.getCharacteristic(BT_CHAR[k]); kind = k; break; } catch (e) { char = null; }
        }
        if (!char) { try { device.gatt.disconnect(); } catch (e) {} throw new Error('That machine doesn’t share treadmill, bike or rower readings.'); }
      }
      if (!bg.isConnected) { try { device.gatt.disconnect(); } catch (e) {} return; }
      entry = { device, char, kind, name:btDeviceName(device.name, which === 'heart' ? 'Heart-rate strap' : BT_MACHINE_LABEL[kind]), handler:ev => onReading(kind, ev.target.value) };
      char.addEventListener('characteristicvaluechanged', entry.handler);
      await char.startNotifications();
      // Closed while connecting: let this device go rather than leave it connected with nothing listening.
      if (!bg.isConnected) { release(entry); return; }
      const old = conn[which];
      conn[which] = entry;
      release(old);
      if (session) { session.names[which] = entry.name; if (which === 'machine') session.lastDistance = null; }
      device.addEventListener('gattserverdisconnected', () => {
        if (conn[which] !== entry) return;
        conn[which] = null;
        // A machine that comes back may have counted on meanwhile, or be another machine: count on from its next total.
        if (session && which === 'machine') session.lastDistance = null;
        err.textContent = entry.name + ' disconnected.';
        paint();
      });
      paint();
    } catch (e) {
      // A connection that failed partway is let go, so it does not stay connected in the background.
      if (entry && conn[which] !== entry) release(entry);
      else if (!entry && device) { try { device.gatt.disconnect(); } catch (x) {} }
      if (e && e.name === 'NotFoundError' && /cancel/i.test(e.message || '')) return;
      err.textContent = (e && e.message) || 'Could not connect.';
    }
  }

  $b('#btHeart').onclick = () => { if (conn.heart) { const c = conn.heart; conn.heart = null; release(c); paint(); } else connect('heart'); };
  $b('#btMachine').onclick = () => { if (conn.machine) { const c = conn.machine; conn.machine = null; if (session) session.lastDistance = null; release(c); paint(); } else connect('machine'); };

  startBtn.onclick = () => {
    err.textContent = '';
    if (!session) {
      if (!conn.heart && !conn.machine) return;
      session = btSession(Date.now());
      session.names = { heart:conn.heart && conn.heart.name, machine:conn.machine && conn.machine.name };
      sessionId = uuid(); startDay = todayISO(); finished = null; summaryEl.innerHTML = '';
    } else {
      finished = { summary:btSessionSummary(session, Date.now()), names:session.names };
      session = null;
      showSummary();
    }
    paint();
  };

  function showSummary(){
    const { summary, names } = finished;
    const rows = btSessionRecords(summary, { units, day:startDay, sessionId });
    const minutes = rows.find(r => r.metric_key === 'workout_minutes'), distance = rows.find(r => r.metric_key === 'distance');
    summaryEl.innerHTML = H`<div class="sec-title">Workout finished</div>
      <div class="card app-pad">
        <div class="mrow"><span>Time</span><b>${esc(clock(summary.seconds))}</b></div>
        ${summary.machine ? H`<div class="mrow"><span>Distance</span><b>${esc(distanceText(summary.distanceM))}</b></div>` : ''}
        ${summary.heart ? H`<div class="mrow"><span><b>Heart rate</b><small>Shown here only, not saved</small></span><b>${summary.heart.average} average · ${summary.heart.max} highest</b></div>` : ''}
        <p class="muted-note" style="margin:8px 0 0">${rows.length
          ? 'Saves ' + [minutes ? minutes.value + ' workout ' + (minutes.value === 1 ? 'minute' : 'minutes') : '', distance ? distance.value + ' ' + distance.unit : ''].filter(Boolean).join(' and ') + ' to your record as “' + esc(btSourceName(names)) + '”. You can undo it from Your imports.'
          : 'Nothing to save: a workout saves from one whole minute.'}</p>
      </div>
      ${rows.length ? H`<button class="btn" id="btSave">Save to my record</button>` : ''}
      <button class="btn ghost" id="btDiscard" style="margin-top:8px">${rows.length ? 'Don’t save' : 'Close'}</button>`;
    const save = summaryEl.querySelector('#btSave');
    summaryEl.querySelector('#btDiscard').onclick = () => { finished = null; summaryEl.innerHTML = ''; };
    if (!save) return;
    save.onclick = async () => {
      save.disabled = true; err.textContent = '';
      const source_name = btSourceName(names);
      const ctx = { source_kind:'file_import', source_name, origin:'device', today:todayISO() };
      const checked = rows.map(r => adultHealthNormalize(r, ctx));
      if (checked.some(n => !n.ok)) { err.textContent = (checked.find(n => !n.ok).error) || 'Those readings can’t be saved.'; save.disabled = false; return; }
      const records = checked.map(n => n.record);
      const { error } = await sb.rpc('save_adult_health_import', {
        p_batch:{ id:sessionId, source_name, origin:'device', rows_received:records.length, rows_rejected:0 },
        p_records:records,
      });
      if (error) { adultFail(error, 'adult:bluetooth', 'Could not save the workout'); save.disabled = false; return; }
      finished = null; releaseAll(); closeSheet(); toast('Workout saved'); renderApp('adult');
    };
  }

  const timer = setInterval(() => {
    if (!bg.isConnected) { clearInterval(timer); releaseAll(); return; }
    if (session) paint();
  }, 1000);
  paint();
}
