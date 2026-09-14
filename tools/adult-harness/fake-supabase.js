// A stand-in for the Supabase client, for tools/adult-harness/index.html only.
//
// It lets the real app scripts run in a browser against an in-memory database, so a screen can be clicked through and
// read back without a live project, an account or real data. Every row it holds is synthetic and lives only in this
// page; a reload starts again. It is not a model of Postgres: it answers the query-builder calls the app makes, applies
// a few foreign-key cascades the screens rely on, and implements save_adult_health_import. Row-level security, check
// constraints and every other rule are the database's job and are tested in tests/db, not here.
(function(){
  const USER = Object.freeze({ id:'00000000-0000-4000-8000-0000000000aa', email:'synthetic-parent@example.invalid' });
  // Two scenarios, chosen with ?scenario= in the page address.
  //   adult (the default): a parent with Adult Training and no child. The app will not start without a reference
  //     catalogue (js/reference.js refuses an empty sports list), so it carries one synthetic sport.
  //   family: a parent with one synthetic child who plays football, and a database shaped like production today:
  //     the tables and functions of migrations not yet applied to the live project answer as missing, so the
  //     screens' fallbacks are what runs. The football catalogue rows are the public reference seed
  //     (20260730143332_seed_football.sql), not personal data.
  //   family&adult=1: the same family, with Adult Training granted and its migrations applied, for flows that cross
  //     both (a calendar sync that carries the parent's own workouts beside the child's plan).
  const SCENARIO = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('scenario')) || 'adult';
  const WITH_ADULT = SCENARIO === 'family' && typeof location !== 'undefined' && new URLSearchParams(location.search).get('adult') === '1';
  const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  const db = SCENARIO === 'family' ? familySeed() : {
    adult_training_access:[{ guardian_id:USER.id, granted_at:new Date().toISOString(), note:'synthetic harness account' }],
    sports:[{ key:'synthetic_sport', name:'Synthetic sport', selectable:true, sort:1 }],
  };
  function familySeed(){
    const family = '00000000-0000-4000-8000-0000000000fa', athlete = '00000000-0000-4000-8000-0000000000c1';
    const birth = new Date(); birth.setFullYear(birth.getFullYear() - 11); birth.setMonth(2, 14);
    return {
      sports:[
        { key:'general', name:'General Athleticism', level_vocab:[], selectable:false, sort:99 },
        { key:'football', name:'Football', level_vocab:['Flag', 'Pee Wee', 'Junior', 'Senior', 'Freshman', 'JV', 'Varsity'], selectable:true, sort:1 },
      ],
      positions:[{ sport_key:'football', code:'RB', name:'Running Back', sort:2 }, { sport_key:'football', code:'WR', name:'Wide Receiver', sort:3 }],
      metrics:[
        { sport_key:'general', key:'height', name:'Height', unit:'in', lower_is_better:false, is_general:true, sort:1 },
        { sport_key:'general', key:'weight', name:'Weight', unit:'lb', lower_is_better:false, is_general:true, sort:2 },
        { sport_key:'football', key:'dash_40', name:'40-yard dash', unit:'s', lower_is_better:true, is_general:false, sort:1 },
      ],
      guardians:[{ id:USER.id, display_name:'Synthetic parent', created_at:day(-60) }],
      families:[{ id:family, name:'Synthetic family', created_by:USER.id, created_at:day(-60) }],
      family_members:[{ family_id:family, guardian_id:USER.id, role:'owner', created_at:day(-60) }],
      ...(WITH_ADULT ? { adult_training_access:[{ guardian_id:USER.id, granted_at:new Date().toISOString(), note:'synthetic harness account' }] } : {}),
      athletes:[{ id:athlete, family_id:family, first_name:'Sam', nickname:null, birthdate:birth.toISOString().slice(0, 10), dominant_hand:null, created_by:USER.id, created_at:day(-60) }],
      athlete_sports:[{ id:'00000000-0000-4000-8000-0000000000e1', athlete_id:athlete, sport_key:'football', positions:['RB'], level:'Junior', is_primary:true,
        practice_days:[1, 3], game_day:5, season_start:day(-30), season_end:day(60), season_state:null, parent_experience:null, created_at:day(-60) }],
      measurements:[
        { id:'00000000-0000-4000-8000-0000000000d1', athlete_id:athlete, metric_key:'height', value:56, unit:'in', measured_on:day(-40), source:'manual', created_by:USER.id, created_at:day(-40) },
        { id:'00000000-0000-4000-8000-0000000000d2', athlete_id:athlete, metric_key:'height', value:56.5, unit:'in', measured_on:day(-5), source:'manual', created_by:USER.id, created_at:day(-5) },
        { id:'00000000-0000-4000-8000-0000000000d3', athlete_id:athlete, metric_key:'weight', value:80, unit:'lb', measured_on:day(-5), source:'manual', created_by:USER.id, created_at:day(-5) },
      ],
    };
  }
  // What production does not have yet: the tables and functions of the migrations after 20260912123000.
  const MISSING_TABLES = SCENARIO !== 'family' ? [] : [
    'week_exceptions', 'body_scan_assessments', 'company_api_keys', 'adult_training_access', 'adult_profiles', 'adult_goals',
    'adult_schedule_items', 'adult_schedule_exercises', 'adult_workout_logs', 'adult_nutrition_preferences', 'adult_recipes',
    'adult_meal_plan_items', 'adult_nutrition_days', 'adult_health_records', 'adult_health_import_batches',
  ].filter(t => !(WITH_ADULT && t.startsWith('adult_')));
  const MISSING_FUNCTIONS = (SCENARIO !== 'family' ? [] : ['save_body_scan_assessment', 'apply_stripe_subscription_event', 'save_adult_health_import'])
    .filter(f => !(WITH_ADULT && f === 'save_adult_health_import'));
  const calls = [];
  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(16).slice(2));
  const table = name => (db[name] ||= []);

  // Column defaults the screens rely on, as the migrations declare them (a goal is saved without a status and listed
  // only when active).
  const DEFAULTS = {
    adult_profiles:{ units:'lb' },
    adult_goals:{ status:'active' },
    adult_schedule_exercises:{ position:0 },
    adult_nutrition_preferences:{ avoid_allergens:[] },
    adult_recipes:{ allergens:[], plate_groups:[] },
  };

  // What the screens expect a delete to take with it.
  const CASCADE = {
    adult_schedule_items:[['adult_schedule_exercises', 'item_id', 'delete'], ['adult_workout_logs', 'schedule_item_id', 'null']],
    adult_recipes:[['adult_meal_plan_items', 'recipe_id', 'null']],
    adult_health_import_batches:[['adult_health_records', 'batch_id', 'delete']],
    external_composition_records:[['external_composition_attachments', 'record_uuid', 'delete']],
  };
  function removeRows(name, doomed){
    if (!doomed.length) return;
    db[name] = table(name).filter(r => !doomed.includes(r));
    for (const [child, column, action] of CASCADE[name] || []) {
      const ids = doomed.map(r => r.id);
      if (action === 'delete') removeRows(child, table(child).filter(r => ids.includes(r[column])));
      else table(child).forEach(r => { if (ids.includes(r[column])) r[column] = null; });
    }
  }
  const compare = (a, b) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);

  function query(name){
    const st = { op:'select', filters:[], orders:[], limit:null, single:null, payload:null, onConflict:null, head:false, count:false };
    const matches = row => st.filters.every(f => f(row));
    const done = (data, extra = {}) => {
      calls.push([st.op, name]);
      if (st.single === 'maybe') return { data:(data || [])[0] ?? null, error:null, ...extra };
      if (st.single === 'one') return (data || []).length ? { data:data[0], error:null, ...extra } : { data:null, error:{ code:'PGRST116', message:'no rows' }, ...extra };
      return { data, error:null, ...extra };
    };
    const run = () => {
      if (MISSING_TABLES.includes(name)) {
        calls.push([st.op + ' (missing)', name]);
        return { data:null, error:{ code:'PGRST205', message:"Could not find the table 'public." + name + "' in the schema cache" } };
      }
      const rows = table(name);
      if (st.op === 'select') {
        let out = rows.filter(matches);
        const count = out.length;
        for (const [column, ascending] of [...st.orders].reverse()) out = [...out].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
        if (st.limit != null) out = out.slice(0, st.limit);
        return done(st.head ? null : out.map(r => ({ ...r })), st.count ? { count } : {});
      }
      if (st.op === 'insert' || st.op === 'upsert') {
        const incoming = (Array.isArray(st.payload) ? st.payload : [st.payload]).map(r => ({ ...r }));
        const written = [];
        for (const row of incoming) {
          const keys = st.onConflict ? st.onConflict.split(',').map(s => s.trim()) : null;
          const existing = keys ? rows.find(r => keys.every(k => r[k] === row[k])) : null;
          if (existing) { Object.assign(existing, row); written.push(existing); continue; }
          const full = { id:uuid(), created_at:now(), ...(DEFAULTS[name] || {}), ...row };
          rows.push(full); written.push(full);
        }
        return done(written.map(r => ({ ...r })));
      }
      if (st.op === 'update') {
        const hit = rows.filter(matches);
        hit.forEach(r => Object.assign(r, st.payload));
        return done(hit.map(r => ({ ...r })));
      }
      const doomed = rows.filter(matches);
      removeRows(name, doomed);
      return done(doomed.map(r => ({ ...r })));
    };
    const b = {
      select(columns, opts){ if (st.op === 'select') { st.head = !!(opts && opts.head); st.count = !!(opts && opts.count); } return b; },
      insert(payload){ st.op = 'insert'; st.payload = payload; return b; },
      upsert(payload, opts){ st.op = 'upsert'; st.payload = payload; st.onConflict = opts && opts.onConflict || null; return b; },
      update(payload){ st.op = 'update'; st.payload = payload; return b; },
      delete(){ st.op = 'delete'; return b; },
      eq(c, v){ st.filters.push(r => r[c] === v); return b; },
      neq(c, v){ st.filters.push(r => r[c] !== v); return b; },
      in(c, vs){ st.filters.push(r => (vs || []).includes(r[c])); return b; },
      is(c, v){ st.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return b; },
      gte(c, v){ st.filters.push(r => r[c] != null && r[c] >= v); return b; },
      lte(c, v){ st.filters.push(r => r[c] != null && r[c] <= v); return b; },
      gt(c, v){ st.filters.push(r => r[c] != null && r[c] > v); return b; },
      lt(c, v){ st.filters.push(r => r[c] != null && r[c] < v); return b; },
      like(){ return b; }, ilike(){ return b; }, or(){ return b; }, not(){ return b; }, contains(){ return b; }, filter(){ return b; }, match(o){ Object.entries(o || {}).forEach(([c, v]) => b.eq(c, v)); return b; },
      order(c, opts){ st.orders.push([c, !(opts && opts.ascending === false)]); return b; },
      limit(n){ st.limit = n; return b; },
      range(from, to){ st.limit = to - from + 1; return b; },
      maybeSingle(){ st.single = 'maybe'; return b; },
      single(){ st.single = 'one'; return b; },
      then(resolve, reject){ try { resolve(run()); } catch (e) { reject(e); } },
    };
    return b;
  }

  // The one database function the adult screens call. Same duplicate keys as the migration's unique indexes.
  function saveAdultHealthImport({ p_batch, p_records }){
    const batches = table('adult_health_import_batches'), records = table('adult_health_records');
    const rejected = Number(p_batch.rows_rejected || 0), received = Number(p_batch.rows_received || (p_records.length + rejected));
    let batch = batches.find(x => x.id === p_batch.id);
    if (!batch) { batch = { id:p_batch.id, guardian_id:USER.id, source_kind:'file_import', source_name:p_batch.source_name, origin:p_batch.origin, received_at:now(), rows_received:received, rows_saved:0, rows_duplicate:0, rows_rejected:rejected }; batches.push(batch); }
    const key = r => [r.source_kind, String(r.source_name || '').toLowerCase(), r.metric_key, r.external_id ? 'id:' + r.external_id : r.measured_on + '|' + Number(r.value) + '|' + r.unit].join('|');
    const seen = new Set(records.filter(r => r.guardian_id === USER.id).map(key));
    for (const input of p_records) {
      const row = { id:uuid(), guardian_id:USER.id, metric_key:input.metric_key, value:Number(input.value), unit:input.unit, measured_on:input.measured_on,
        source_kind:'file_import', source_name:batch.source_name, method:input.method, external_id:input.external_id || null, batch_id:batch.id, created_at:now() };
      if (seen.has(key(row))) continue;
      seen.add(key(row)); records.push(row);
    }
    batch.rows_saved = records.filter(r => r.batch_id === batch.id).length;
    batch.rows_duplicate = Math.max(batch.rows_received - batch.rows_rejected - batch.rows_saved, 0);
    return { batch:batch.id, saved:batch.rows_saved, duplicates:batch.rows_duplicate };
  }

  // Google, in the family scenario: a sign-in that grants the scope it is asked for, and an in-memory Calendar API
  // answering the calls js/calendar-sync.js makes. Calendar requests never leave the page; anything else passes through.
  const gcal = { calendars:{}, events:{}, requests:[] };
  if (SCENARIO === 'family') {
    window.google = { accounts:{ oauth2:{ initTokenClient(cfg){
      return { requestAccessToken(){ setTimeout(() => cfg.callback({ access_token:'synthetic-google-token', expires_in:3600, scope:cfg.scope }), 0); } };
    } } } };
    const passThrough = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    const reply = (status, body) => ({ status, ok:status >= 200 && status < 300, json:async () => body });
    window.fetch = async (input, init) => {
      const url = String((input && input.url) || input);
      if (!url.startsWith('https://www.googleapis.com/calendar/v3')) return passThrough ? passThrough(input, init) : reply(503, null);
      const method = ((init && init.method) || 'GET').toUpperCase();
      const auth = init && init.headers && init.headers.Authorization;
      const u = new URL(url);
      const p = u.pathname.replace('/calendar/v3', '');
      const body = init && init.body ? JSON.parse(init.body) : null;
      const log = status => { gcal.requests.push([method, p, status, auth]); return status; };
      const missing = () => reply(log(404), { error:{ message:'Not Found' } });
      if (auth !== 'Bearer synthetic-google-token') return reply(log(401), { error:{ message:'Invalid Credentials' } });
      let m;
      if (method === 'GET' && p === '/users/me/calendarList') return reply(log(200), { items:Object.values(gcal.calendars) });
      if (method === 'POST' && p === '/calendars') {
        const id = 'synthetic-calendar-' + (Object.keys(gcal.calendars).length + 1) + '@group.calendar.google.com';
        gcal.calendars[id] = { id, ...body }; gcal.events[id] = {};
        return reply(log(200), gcal.calendars[id]);
      }
      if ((m = p.match(/^\/calendars\/([^/]+)$/)) && method === 'GET') {
        const cal = gcal.calendars[decodeURIComponent(m[1])];
        return cal ? reply(log(200), cal) : missing();
      }
      if ((m = p.match(/^\/calendars\/([^/]+)\/events$/))) {
        const events = gcal.events[decodeURIComponent(m[1])];
        if (!events) return missing();
        if (method === 'GET') {
          const marked = u.searchParams.get('privateExtendedProperty') === 'ppSync=1';
          return reply(log(200), { items:Object.values(events).filter(e => e.status !== 'cancelled'
            && (!marked || (e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.ppSync === '1'))) });
        }
        if (method === 'POST') {
          // Google keeps an event's id after it is deleted, so inserting it again is refused.
          if (events[body.id]) return reply(log(409), { error:{ message:'The requested identifier already exists.' } });
          events[body.id] = { ...body, status:'confirmed' };
          return reply(log(200), events[body.id]);
        }
      }
      if ((m = p.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
        const events = gcal.events[decodeURIComponent(m[1])], id = decodeURIComponent(m[2]);
        if (!events) return missing();
        if (method === 'PUT') { events[id] = { ...body, id, status:'confirmed' }; return reply(log(200), events[id]); }
        if (method === 'DELETE') {
          if (!events[id] || events[id].status === 'cancelled') return reply(log(410), null);
          events[id].status = 'cancelled';
          return reply(log(204), null);
        }
      }
      return reply(log(400), { error:{ message:'The harness does not answer ' + method + ' ' + p } });
    };
  }

  // Bluetooth, with ?bluetooth=1 in any scenario: a synthetic heart-rate strap and a synthetic treadmill that notify
  // readings built from the published characteristic formats, so the equipment sheet can be driven without a real device
  // or Chrome's device picker. requestDevice picks by the service asked for; nothing leaves the page.
  const bluetooth = { notifications:0, connected:[] };
  if (typeof navigator !== 'undefined' && typeof location !== 'undefined' && new URLSearchParams(location.search).get('bluetooth') === '1') {
    const notFound = message => Object.assign(new Error(message), { name:'NotFoundError' });
    const fakeDevice = (name, service, characteristic, frame) => {
      const listeners = { device:[], char:[] };
      let timer = null, n = 0;
      const char = {
        uuid:characteristic, value:null,
        addEventListener(type, fn){ if (type === 'characteristicvaluechanged') listeners.char.push(fn); },
        removeEventListener(type, fn){ listeners.char = listeners.char.filter(f => f !== fn); },
        async startNotifications(){
          clearInterval(timer);
          timer = setInterval(() => { n++; bluetooth.notifications++; char.value = frame(n); listeners.char.slice().forEach(fn => fn({ target:char })); }, 250);
          return char;
        },
        async stopNotifications(){ clearInterval(timer); timer = null; return char; },
      };
      const device = {
        name, id:'synthetic-' + name.toLowerCase().replace(/\s+/g, '-'),
        addEventListener(type, fn){ if (type === 'gattserverdisconnected') listeners.device.push(fn); },
        gatt:{
          connected:false,
          async connect(){ this.connected = true; bluetooth.connected.push(name); return server; },
          disconnect(){
            if (!this.connected) return;
            this.connected = false; clearInterval(timer); timer = null;
            bluetooth.connected = bluetooth.connected.filter(x => x !== name);
            listeners.device.forEach(fn => fn({ target:device }));
          },
        },
      };
      const server = {
        device,
        async getPrimaryService(uuid){
          if (uuid !== service) throw notFound('No such service on ' + name);
          return { async getCharacteristic(u){ if (u !== characteristic) throw notFound('No such characteristic on ' + name); return char; } };
        },
      };
      return device;
    };
    const view = bytes => new DataView(Uint8Array.from(bytes).buffer);
    // Heart Rate Measurement: flags 0x06 (one-byte rate, skin contact detected), 120 to 140 bpm.
    const strap = () => fakeDevice('Synthetic HR strap', 0x180d, 0x2a37, n => view([0x06, 120 + (n % 21)]));
    // Treadmill Data: flags 0x0004 (speed, and total distance), 10.00 km/h, 0.7 m further each quarter second.
    const treadmill = () => fakeDevice('Synthetic treadmill', 0x1826, 0x2acd, n => {
      const d = Math.round(n * 0.7);
      return view([0x04, 0x00, 0xe8, 0x03, d & 255, (d >> 8) & 255, (d >> 16) & 255]);
    });
    Object.defineProperty(navigator, 'bluetooth', { configurable:true, value:{
      async requestDevice(options){
        const services = ((options && options.filters) || []).flatMap(f => f.services || []);
        if (services.includes(0x180d)) return strap();
        if (services.includes(0x1826)) return treadmill();
        throw notFound('User cancelled the requestDevice() chooser.');
      },
    } });
  }

  const client = {
    from:query,
    rpc:async (name, args) => {
      calls.push(['rpc', name]);
      if (MISSING_FUNCTIONS.includes(name)) return { data:null, error:{ code:'PGRST202', message:'Could not find the function public.' + name } };
      if (name === 'save_adult_health_import') return { data:saveAdultHealthImport(args), error:null };
      return { data:null, error:null };
    },
    auth:{
      getSession:async () => ({ data:{ session:{ user:USER, access_token:'synthetic' } }, error:null }),
      getUser:async () => ({ data:{ user:USER }, error:null }),
      onAuthStateChange:() => ({ data:{ subscription:{ unsubscribe(){} } } }),
      signOut:async () => ({ error:null }),
      signInWithPassword:async () => ({ data:null, error:{ message:'The harness has no sign-in.' } }),
      updateUser:async () => ({ data:null, error:null }),
    },
    storage:{ from:() => ({
      upload:async path => ({ data:{ path }, error:null }), remove:async () => ({ data:[], error:null }), list:async () => ({ data:[], error:null }),
      getPublicUrl:() => ({ data:{ publicUrl:'' } }), createSignedUrl:async () => ({ data:{ signedUrl:'' }, error:null }),
    }) },
    functions:{ invoke:async () => ({ data:null, error:null }) },
    channel(){ const ch = { on(){ return ch; }, subscribe(){ return ch; }, unsubscribe(){ return ch; } }; return ch; },
    removeChannel(){},
  };

  window.supabase = { createClient:() => client };
  window.__harness = { db, calls, USER, SCENARIO, WITH_ADULT, MISSING_TABLES, MISSING_FUNCTIONS, gcal, bluetooth,
    calendarClientId:SCENARIO === 'family' ? 'synthetic-harness-client.apps.googleusercontent.com' : '' };
})();
