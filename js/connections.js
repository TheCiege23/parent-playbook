// ===================================================================
//  CONNECTIONS — where outside data can come from, and what is true today
// ===================================================================
// Settings → Connections, step 2 of the device connections plan. It lists each connection the plan names with its real
// status, never a hopeful one: what works in this web app now, what is planned, and what waits for a Parent Playbook
// mobile app. Nothing here connects to anything, stores a permission or asks for one. It also writes down the rules a
// child's device data will follow, before any child connection exists.

// who: 'adult' entries belong to Your training and appear only when Adult Training is on for this account; 'child' and
// 'family' entries need a child profile when they have an action that opens one.
const CONNECTIONS = Object.freeze([
  Object.freeze({ key:'file_readings', who:'adult', status:'web', name:'Readings from a file',
    brings:'Weight, tape measurements, steps, active and workout minutes, distance and resting heart rate, from a CSV file a scale or fitness app exports.',
    lands:'Your training → Progress', action:Object.freeze({ label:'Open Your training', route:'adult' }) }),
  Object.freeze({ key:'composition_results', who:'adult', status:'web', name:'Body composition results',
    brings:'From a DXA scan, a clinic analyser, a smart scale, a health app or a report you type in, each shown as measured or as a device estimate.',
    lands:'Your training → Progress', action:Object.freeze({ label:'Open Your training', route:'adult' }) }),
  Object.freeze({ key:'child_composition', who:'child', status:'web', name:'Your child’s clinic results',
    brings:'A DXA or clinic result for your child, imported under the body scan permission you gave for them.',
    lands:'Scan → Body insights', action:Object.freeze({ label:'Open Body insights', route:'insights' }) }),
  Object.freeze({ key:'calendar_file', who:'family', status:'web', name:'Add a game to your calendar',
    brings:'One game day at a time, as a calendar file your phone opens. No account link and no permission to give.',
    lands:'Your phone’s own calendar', action:Object.freeze({ label:'Open Week', route:'week' }) }),
  Object.freeze({ key:'google_calendar', who:'family', status:'planned', name:'Google Calendar sync',
    brings:'Your children’s next four weeks of practices, games, home sessions and rest days, in a “Parent Playbook” calendar that updates when you press Sync and is the only calendar it can reach.',
    lands:'Your Google Calendar' }),
  Object.freeze({ key:'apple_health', who:'adult', status:'needs_app', name:'Apple Health and Apple Watch',
    brings:'Workouts, steps, heart rate, distance and weight you choose to share.', lands:'Your training → Progress' }),
  Object.freeze({ key:'health_connect', who:'adult', status:'needs_app', name:'Health Connect on Android',
    brings:'Workouts, steps, heart rate and weight from Android watches, phones, scales and fitness apps, one category at a time.',
    lands:'Your training → Progress' }),
  Object.freeze({ key:'bluetooth_equipment', who:'adult', status:'needs_app', name:'Bluetooth gym equipment',
    brings:'Readings from a treadmill, bike, rower or heart-rate monitor that supports the Bluetooth fitness machine standard.',
    lands:'Your training' }),
]);
const CONNECTION_STATUS = Object.freeze({
  web:'Works in this app',
  planned:'Planned',
  needs_app:'Needs the Parent Playbook mobile app',
});
const CONNECTION_GROUPS = Object.freeze([['web', 'Works now'], ['planned', 'Planned'], ['needs_app', 'With the mobile app']]);

// The connections this account should see. env: { adultTraining, hasChild }.
function visibleConnections(env){
  const e = env || {};
  // Google Calendar sync works in the web app once js/calendar-sync.js has a client id; until then it is planned.
  // With Your training it can also carry the parent's own workouts, so it is offered to a parent with no child.
  return CONNECTIONS.map(c => (c.key === 'google_calendar' && e.calendarSync ? { ...c, status:'web', action:{ label:'Set up', open:'calendar' } } : c))
    .map(c => (c.key === 'google_calendar' && e.adultTraining ? { ...c, brings:c.brings + ' With Your training, you can add your own workouts too.' } : c))
    // Where this browser has Web Bluetooth, an early web version works now (js/bluetooth-equipment.js); elsewhere it waits for the app.
    .map(c => (c.key === 'bluetooth_equipment' && e.bluetooth ? { ...c, status:'web', brings:c.brings + ' In Chrome on Android or a computer it works in this app now, showing readings while you train and saving the minutes and distance you choose. iPhone needs the mobile app.', action:{ label:'Open', open:'bluetooth' } } : c))
    .filter(c => (c.who !== 'adult' || e.adultTraining) && (c.who === 'adult' || !c.action || e.hasChild || (c.key === 'google_calendar' && e.adultTraining)));
}

function connectionsMarkup(env){
  const e = env || {}, list = visibleConnections(e);
  return H`<h3>Connections</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Where outside data can come from, and what is true today. Nothing here connects on its own, and nothing is shared because it is listed.</p>
    ${CONNECTION_GROUPS.map(([status, title]) => {
      const items = list.filter(c => c.status === status);
      if (!items.length) return '';
      return H`<div class="sec-title">${esc(title)}</div>
      <div class="card app-pad">${items.map(c => H`<div class="mrow"><span><b>${esc(c.name)}</b><small>${esc(c.brings)} Goes to ${esc(c.lands)}.</small></span>
        ${c.status === 'web' && c.action ? H`<button class="btn sm ghost" data-connection="${esc(c.key)}">${esc(c.action.label)}</button>`
          : H`<b style="font-weight:600;font-size:12px;text-align:right;max-width:40%">${esc(CONNECTION_STATUS[c.status])}</b>`}</div>`).join('')}</div>`;
    }).join('')}
    ${e.hasChild ? H`<div class="sec-title">Children’s device data</div>
      <div class="card app-pad"><p style="margin:0;font-size:13.5px;line-height:1.55"><b>Off.</b> No watch, phone or gym equipment connects for a child today. If that is ever added, it stays off until a parent turns it on for that child, it never sets calorie or weight-loss targets, and it reaches no coach, camp, trainer or company unless you share it.</p></div>` : ''}`;
}

function openConnections(){
  const env = { adultTraining:adultTrainingOn(), hasChild:hasActiveAthlete(), calendarSync:typeof calendarSyncAvailable === 'function' && calendarSyncAvailable(),
    bluetooth:typeof bluetoothEquipmentAvailable === 'function' && bluetoothEquipmentAvailable() };
  const bg = sheet(connectionsMarkup(env));
  bg.querySelectorAll('[data-connection]').forEach(b => b.onclick = () => {
    const c = visibleConnections(env).find(x => x.key === b.dataset.connection);
    if (!c || !c.action) return;
    bg.remove();
    if (c.action.open === 'calendar') return openCalendarSync();
    if (c.action.open === 'bluetooth') return openBluetoothEquipment();
    renderApp(c.action.route);
  });
}
