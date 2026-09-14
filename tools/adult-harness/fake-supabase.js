// A stand-in for the Supabase client, for tools/adult-harness/index.html only.
//
// It lets the real app scripts run in a browser against an in-memory database, so a screen can be clicked through and
// read back without a live project, an account or real data. Every row it holds is synthetic and lives only in this
// page; a reload starts again. It is not a model of Postgres: it answers the query-builder calls the app makes, applies
// a few foreign-key cascades the screens rely on, and implements save_adult_health_import. Row-level security, check
// constraints and every other rule are the database's job and are tested in tests/db, not here.
(function(){
  const USER = Object.freeze({ id:'00000000-0000-4000-8000-0000000000aa', email:'synthetic-parent@example.invalid' });
  // The app will not start without its reference catalogue (js/reference.js refuses an empty sports list), so the
  // harness carries one synthetic sport. Nothing else is seeded: the account has Adult Training and no child.
  const db = {
    adult_training_access:[{ guardian_id:USER.id, granted_at:new Date().toISOString(), note:'synthetic harness account' }],
    sports:[{ key:'synthetic_sport', name:'Synthetic sport', selectable:true, sort:1 }],
  };
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

  const client = {
    from:query,
    rpc:async (name, args) => {
      calls.push(['rpc', name]);
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
  window.__harness = { db, calls, USER };
})();
