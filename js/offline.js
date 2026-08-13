// ===================================================================
//  OFFLINE — the week survives, the journey doesn't
// ===================================================================
// Design handoff, platform §4. sw.js is network-first for the shell and passes Supabase
// straight through, so before this the app opened offline and showed nothing.
//
// Two deliberate asymmetries:
//   - The WEEK is cached. It's small, non-sensitive, and it's the thing a parent needs
//     standing on a field with one bar of signal.
//   - The JOURNEY is not. Photos and game history are private media on short-lived
//     signed URLs; sw.js deliberately never stores them and this doesn't either. The
//     tabs that can't work say why instead of pretending.

const OW_WEEK_KEY = 'pp_week_cache';
const OW_DB = 'pp_outbox';
const OW_STORE = 'ops';

// ---- the week snapshot ----------------------------------------------------------
// Written after every successful render. Holds only what the offline screen shows:
// the built plan, who it's for, and which days are ticked.
function owSaveWeek(snapshot){
  try{
    localStorage.setItem(OW_WEEK_KEY, JSON.stringify({ at: Date.now(), ...snapshot }));
  }catch(e){ /* quota or private mode — the app just loses its offline copy */ }
}
function owReadWeek(){
  try{
    const raw = localStorage.getItem(OW_WEEK_KEY); if(!raw) return null;
    const c = JSON.parse(raw);
    if(!c || !c.days || !c.at) return null;
    // A week-old plan is the wrong week. Better to say "we can't reach the server"
    // than to show Monday's session on the following Thursday.
    if(Date.now() - c.at > 8*24*60*60*1000) return null;
    return c;
  }catch(e){ return null; }
}

// ---- the outbox -----------------------------------------------------------------
// One queue for everything that changes state while offline. Every op carries the
// client-side id the online path would have used, so replay is an upsert and running
// it twice is harmless.
function owOpen(){
  return new Promise((res,rej)=>{
    if(!self.indexedDB) return rej(new Error('no indexedDB'));
    const r = indexedDB.open(OW_DB, 1);
    r.onupgradeneeded = ()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains(OW_STORE)) db.createObjectStore(OW_STORE,{ keyPath:'id' });
    };
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}
async function owTx(mode, fn){
  const db = await owOpen();
  return new Promise((res,rej)=>{
    const tx = db.transaction(OW_STORE, mode);
    const store = tx.objectStore(OW_STORE);
    let out;
    try{ out = fn(store); }catch(e){ rej(e); return; }
    tx.oncomplete = ()=>res(out && out.result !== undefined ? out.result : out);
    tx.onerror = ()=>rej(tx.error);
  });
}
async function owQueue(op){
  op.id = op.id || uuid();
  op.queued_at = Date.now();
  try{ await owTx('readwrite', s=>s.put(op)); owBadge(); return true; }
  catch(e){ console.error('outbox write failed', e); return false; }
}
async function owAll(){
  try{ return await new Promise(async (res,rej)=>{
    const db = await owOpen();
    const tx = db.transaction(OW_STORE,'readonly');
    const req = tx.objectStore(OW_STORE).getAll();
    req.onsuccess = ()=>res(req.result||[]);
    req.onerror = ()=>rej(req.error);
  }); }catch(e){ return []; }
}
async function owDelete(id){ try{ await owTx('readwrite', s=>s.delete(id)); }catch(e){} }
async function owCount(){ return (await owAll()).length; }

// Replay. Upsert-by-id everywhere, so a flush that half-succeeded and runs again
// cannot double-log a session or duplicate a game.
const OW_REPLAY = {
  async session_done(op){
    return sb.from('sessions').upsert({
      athlete_id:op.athlete_id, done_on:op.done_on, title:op.title,
      kind:op.kind||null, week_index:op.week_index??null, created_by:op.created_by,
    },{ onConflict:'athlete_id,done_on,title' });
  },
  async session_undo(op){
    return sb.from('sessions').delete()
      .eq('athlete_id',op.athlete_id).eq('done_on',op.done_on).eq('title',op.title);
  },
};

let owFlushing = false;
async function owFlush(){
  if(owFlushing || !navigator.onLine || !state.user) return { sent:0, left:await owCount() };
  owFlushing = true;
  let sent = 0;
  try{
    const ops = await owAll();
    ops.sort((a,b)=>a.queued_at-b.queued_at);
    for(const op of ops){
      const fn = OW_REPLAY[op.kind_op];
      if(!fn){ await owDelete(op.id); continue; }        // unknown op from an older build
      let error;
      try{ ({ error } = await fn(op) || {}); }catch(e){ error = e; }
      if(error){
        // Stop on the first real failure — the network is probably still bad, and
        // hammering the rest achieves nothing. They stay queued.
        console.error('replay failed', op.kind_op, error);
        break;
      }
      await owDelete(op.id); sent++;
    }
  } finally { owFlushing = false; }
  owBadge();
  return { sent, left: await owCount() };
}

// A quiet count, never a red badge. Queued work isn't an error.
async function owBadge(){
  const el=document.getElementById('owBadge'); if(!el) return;
  const n=await owCount();
  el.hidden = n===0;
  el.textContent = n===1 ? '1 change waiting to sync' : `${n} changes waiting to sync`;
}

function owInit(){
  // Flush on reconnect and on app open — the two moments it can possibly work.
  window.addEventListener('online', async ()=>{
    const r = await owFlush();
    if(r.sent) toast(r.sent===1?'Synced 1 change':`Synced ${r.sent} changes`);
    if(r.sent && typeof renderApp==='function' && state.active) renderApp('week');
  });
  window.addEventListener('offline', owBadge);
  if(navigator.onLine) owFlush();
}

// ---- three distinct failure screens ---------------------------------------------
// bootError showed one message for offline, server-unreachable and signed-out. They
// need different screens because they need different actions from the person reading.
function owFailureKind(err){
  if(!navigator.onLine) return 'offline';
  const m = String(err && (err.message||err) || '').toLowerCase();
  if(/jwt|refresh token|not authenticated|invalid claim/.test(m)) return 'signed_out';
  return 'unreachable';
}

// Offline, but we have a cached week — show it, read-only, and say so.
function owRenderCachedWeek(cache){
  const days = cache.days||[];
  const doneSet = new Set(cache.done||[]);
  const todayIdx = (new Date().getDay()+6)%7;
  root.innerHTML = H`
    <div class="ow-bar"><i>📡</i><div><b>You're offline</b><span>Showing the week we saved${cache.at?' · '+esc(owAgo(cache.at)):''}</span></div></div>
    <div class="app-pad" style="padding-top:8px">
      <div class="top" style="padding-left:0;padding-right:0">
        <div class="who"><div class="avatar">${esc((cache.first_name||'?')[0].toUpperCase())}</div>
          <div><h3>${esc(cache.first_name||'')}</h3><span>${esc(cache.sub||'')}</span></div></div>
      </div>
      <p id="owBadge" class="ow-queued" hidden></p>
      ${days.map((w,i)=>H`
        <div class="day ${doneSet.has(i)?'is-done':''} ${i===todayIdx?'is-today':''}">
          <span class="chk static ${w.t==='rest'?'rest':''} ${doneSet.has(i)?'seen':''}" aria-hidden="true">${doneSet.has(i)?'✓':(w.t==='rest'?'z':'')}</span>
          <div class="d"><b>${esc(w.d)}</b>${i===todayIdx?'<span>Today</span>':'<span>&nbsp;</span>'}</div>
          <div class="body"><h4>${esc(w.title)}</h4><p>${esc(w.sub||'')}</p></div>
          <span class="tag t-${esc(w.t)}">${esc(w.type)}</span>
        </div>`).join('')}
      <div class="card app-pad" style="margin-top:14px">
        <div class="grow" style="border:none;padding:0"><div class="gi">🔒</div>
          <div class="gt"><b>Journey and Growth need a connection</b><span>Photos and game history are never stored on this device — that's deliberate.</span></div></div>
      </div>
      <button class="btn ghost" id="owRetry" style="margin-top:16px">Try again</button>
    </div>`;
  owBadge();
  $("#owRetry").onclick=()=>location.reload();
}
function owAgo(ts){
  const m=Math.round((Date.now()-ts)/60000);
  if(m<2) return 'just now';
  if(m<60) return m+' minutes ago';
  const h=Math.round(m/60); if(h<24) return h===1?'an hour ago':h+' hours ago';
  const d=Math.round(h/24); return d===1?'yesterday':d+' days ago';
}
