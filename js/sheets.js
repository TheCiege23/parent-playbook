async function uploadMedia(files,{gameId=null,caption=null,takenOn=null}={}){
  const a=state.active;
  // A 60MB clip on a cellular plan at a football field is somebody's data allowance.
  // Queue those for Wi-Fi and upload the rest now; owSendHeldNow() is the override.
  let heldForWifi=0;
  if(typeof owQueueMedia==="function"){
    const r=await owQueueMedia(files,{gameId,caption,takenOn});
    heldForWifi=r.heldForWifi||0;
  }
  for(const file of files){
    if(typeof owShouldHold==="function" && owShouldHold(file)) continue;   // queued above
    const isVid=(file.type||'').startsWith('video');
    let ext=(file.name.split('.').pop()||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(!ext) ext=isVid?'mp4':'jpg';
    const path=`${a.id}/${uuid()}.${ext}`;
    const up=await sb.storage.from('athlete-media').upload(path,file,{contentType:file.type||undefined,upsert:false});
    if(up.error) throw up.error;
    const { error }=await sb.from('media').insert({
      athlete_id:a.id, game_id:gameId, kind:isVid?'video':'photo', path,
      caption:caption||null, taken_on:takenOn||null, created_by:state.user.id });
    if(error){ await sb.storage.from('athlete-media').remove([path]); throw error; }
  }
  if(heldForWifi) toast(heldForWifi===1
    ? '1 large file will upload on Wi-Fi'
    : heldForWifi+' large files will upload on Wi-Fi');
}
function oversize(files){ return [...files].find(f=>f.size>MEDIA_MAX); }

// openLogGame moved to js/log-game.js — it is a two-step flow now, and the row
// commits at the end of step 1 so stats and photos can be skipped without losing it.

function openAddMilestone(onDate){
  const today=onDate||new Date().toISOString().slice(0,10);
  const bg=sheet(H`<h3>Add a milestone</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">A moment worth remembering — a first, a personal best, a big step.</p>
    <div class="field"><label>Date</label><input id="md" type="date" value="${today}" max="${today}"/></div>
    <div class="field"><label>Title</label><input id="mt" placeholder="e.g. First goal of the season"/></div>
    <div class="field"><label>Note (optional)</label><textarea id="mn" rows="2" placeholder="What made it special?"></textarea></div>
    <div class="err" id="merr"></div>
    <button class="btn amber" id="save">Save milestone</button>`);
  bg.querySelector('#save').onclick=async(e)=>{
    const errEl=bg.querySelector('#merr'); errEl.textContent='';
    const t=bg.querySelector('#mt').value.trim(), d=bg.querySelector('#md').value;
    if(!t){ errEl.textContent='Give the milestone a title.'; return; }
    if(!d){ errEl.textContent='Pick a date.'; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const mrow={ id:uuid(), athlete_id:state.active.id, milestone_date:d, title:t,
      note:bg.querySelector('#mn').value.trim()||null, created_by:state.user.id };
    if(!navigator.onLine && typeof owQueue==='function'){
      await owQueue({ kind_op:'milestone_add', row:mrow });
      bg.remove(); toast('Saved — will sync when you\'re back online'); return renderApp('journey');
    }
    const { error }=await sb.from('milestones').insert(mrow);
    if(error){ errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML='Save milestone'; e.target.disabled=false; return; }
    bg.remove(); toast('Milestone added ⭐'); renderApp('journey');
  };
}

function openAddMedia(games, preselect){
  const today=new Date().toISOString().slice(0,10);
  // `preselect` is the game whose "＋ Photos" button was tapped — landing on "None"
  // after choosing a specific game is a small betrayal of the tap.
  const gopts=(games||[]).map(g=>`<option value="${g.id}" ${g.id===preselect?'selected':''}>${esc(fmtDate(g.game_date))}${g.opponent?' vs '+esc(g.opponent):''}</option>`).join('');
  const bg=sheet(H`<h3>Add photos or video</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">From a game or practice. They stay private to your household.</p>
    <div class="field"><label>Choose files</label><input id="mf" type="file" accept="image/*,video/*" multiple/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Up to 100 MB each — short clips work best.</p></div>
    <div class="field"><label>Caption (optional)</label><input id="mc" placeholder="e.g. Championship game, 2026"/></div>
    <div class="row2">
      <div class="field"><label>Taken on</label><input id="md" type="date" value="${today}" max="${today}"/></div>
      ${gopts?H`<div class="field"><label>Attach to a game</label><select id="mg"><option value="">— None —</option>${gopts}</select></div>`:''}
    </div>
    <div class="err" id="merr"></div>
    <button class="btn" id="save">Upload</button>`);
  bg.querySelector('#save').onclick=async(e)=>{
    const errEl=bg.querySelector('#merr'); errEl.textContent='';
    const files=bg.querySelector('#mf').files;
    if(!files.length){ errEl.textContent='Choose at least one photo or video.'; return; }
    const big=oversize(files); if(big){ errEl.textContent=`“${big.name}” is over 100 MB — trim it and try again.`; return; }
    e.target.innerHTML='<span class="spinner"></span> Uploading…'; e.target.disabled=true;
    try{
      await uploadMedia(files,{ gameId:(bg.querySelector('#mg')?.value||null),
        caption:bg.querySelector('#mc').value.trim()||null, takenOn:bg.querySelector('#md').value||null });
      bg.remove(); toast('Added to the gallery 📸'); renderApp('journey');
    }catch(err){ console.error(err); errEl.textContent='Upload failed. '+(err.message||''); e.target.innerHTML='Upload'; e.target.disabled=false; }
  };
}

// Full-screen media viewer. Replaces the bottom sheet, and replaces the share composer
// that CHANGES-2026-08-13 removed from the product.
//
// The privacy rules ARE the spec here:
//   - nothing leaves the app: no share sheet, no export, no public link
//   - media stays on the short-lived signed URLs already batched by screenJourney,
//     from the private athlete-media bucket. A public object is never minted.
//   - invited viewers can look, not take. Download and delete belong to the owner.
//
// "Save to phone" is not sharing — it's a parent putting their own photo in their own
// camera roll. What happens after that is outside the product.
function openMediaViewer(id){
  const store=state.jrnMedia||{byId:{},urls:{},byGame:{}};
  const m=store.byId[id]; if(!m) return;
  const url=store.urls[m.path]||'';
  // The rest of this game's media, so you can thumb along without going back.
  const strip=(m.game_id&&store.byGame[m.game_id])?store.byGame[m.game_id]:[m];
  const canManage = state.jrnCanEdit!==false;

  const body = !url
    ? `<div class="empty" style="color:rgba(246,242,233,.7)">This file couldn't be loaded. Go back and try again.</div>`
    : m.kind==='video'
      ? `<video src="${esc(url)}" controls autoplay playsinline></video>`
      : `<img src="${esc(url)}" alt="${esc(m.caption||'')}"/>`;

  const bg=document.createElement('div');
  bg.className='mv';
  bg.innerHTML = H`
    <div class="mv-top">
      <button class="iconbtn dark" id="mvClose" aria-label="Close">←</button>
      <span class="k-mono">${esc(m.kind==='video'?'Video':'Photo')}</span>
    </div>
    <div class="mv-stage">${body}</div>
    <div class="mv-meta">
      ${m.caption?H`<b>${esc(m.caption)}</b>`:''}
      <span>${m.taken_on?esc(fmtDate(m.taken_on)):esc(fmtDate((m.created_at||'').slice(0,10)))} · private to your household</span>
    </div>
    ${strip.length>1?H`<div class="mv-strip">
      ${strip.map(x=>H`<button class="${x.id===m.id?'on':''}" data-jump="${esc(x.id)}">
        ${mediaThumbInner(x,store.urls[x.path],'gth')}</button>`).join('')}
    </div>`:''}
    <div class="mv-acts">
      ${url?H`<a class="btn ghost dark" id="mvSave" href="${esc(url)}" download="${esc(m.path.split('/').pop()||'photo')}">Save to phone</a>`:''}
      ${canManage?H`<button class="btn danger dark" id="mvDel">Delete</button>`:''}
    </div>`;
  document.body.appendChild(bg);
  const close=()=>{ bg.remove(); document.removeEventListener('keydown',onKey); };
  function onKey(e){ if(e.key==='Escape') close(); }
  document.addEventListener('keydown',onKey);
  bg.querySelector('#mvClose').onclick=close;
  bg.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{ close(); openMediaViewer(b.dataset.jump); });
  { const d=bg.querySelector('#mvDel');
    if(d) d.onclick=async()=>{
      d.innerHTML='<span class="spinner"></span>'; d.disabled=true;
      // Storage first, then the row — the existing order. A row without its file is a
      // broken thumbnail; a file without its row is invisible and harmless.
      await sb.storage.from('athlete-media').remove([m.path]);
      const { error }=await sb.from('media').delete().eq('id',m.id);
      if(error){ console.error(error); reportError(error,'journey:deleteMedia');
        toast('Could not delete'); d.innerHTML='Delete'; d.disabled=false; return; }
      close(); toast('Deleted'); renderApp('journey');
    }; }
}

// ---------- sheets / modals ----------
function sheet(html){
  const bg=document.createElement('div');bg.className='modal-bg';
  bg.innerHTML=`<div class="sheet" tabindex="-1" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  // Esc-to-close + focus. Override remove() so every existing bg.remove() call
  // also tears down the key listener (no dangling handlers).
  const _remove=bg.remove.bind(bg);
  const onKey=e=>{ if(e.key==='Escape') bg.remove(); };
  bg.remove=()=>{ document.removeEventListener('keydown',onKey); _remove(); };
  bg.onclick=e=>{ if(e.target===bg) bg.remove(); };
  document.addEventListener('keydown',onKey);
  document.body.appendChild(bg);
  const card=bg.querySelector('.sheet'); if(card) card.focus();
  return bg;
}
function openSwitch(){
  const bg=sheet(H`<h3>Switch athlete</h3><div style="margin-top:10px">
    ${state.athletes.map(a=>H`<button class="btn ghost" data-id="${a.id}" style="margin-bottom:8px;justify-content:flex-start">
      <span class="avatar" style="width:30px;height:30px;font-size:14px;border-radius:9px">${(a.first_name||'?')[0].toUpperCase()}</span> ${esc(a.first_name)}</button>`).join('')}
  </div>`);
  bg.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{ state.active=state.athletes.find(a=>a.id===b.dataset.id); bg.remove(); renderApp('week'); });
}

// US-centric on purpose: every family this ships to dials ten digits, and asking a
// grandmother for a country code to text her own daughter is a worse failure than not
// supporting Belgium yet. A number typed WITH a + is respected exactly as given, which
// is the escape hatch for everyone else.
function toE164(raw){
  const s=String(raw||'').trim();
  if(!s) return null;
  if(s[0]==='+'){ const d='+'+s.slice(1).replace(/\D/g,''); return /^\+[1-9]\d{7,14}$/.test(d)?d:false; }
  const d=s.replace(/\D/g,'');
  if(d.length===10) return '+1'+d;
  if(d.length===11 && d[0]==='1') return '+'+d;
  return false;                       // false means "typed something wrong", null means "left it blank"
}

function openInvite(){
  const kids = state.athletes||[];
  const multi = kids.length>1;
  const nm=esc(state.active.first_name);
  const bg=sheet(H`<h3>Invite someone to help</h3>
    <p style="color:var(--muted);font-size:13.5px;margin:6px 0 4px">Share a private link with a co-parent, grandparent, or coach. They create their own login and get access to ${multi?H`whoever you pick below`:H`${nm} only`}.</p>
    <div class="teach" style="margin-top:12px"><div class="ic">🎓</div><div><h4>You stay in control</h4>
      <p>Choose their access level. Family view can see the plan and progress; co-parent can also edit; Team Connect is for a coach or trainer you already work with — stats only, no games, journey or photos. You can revoke any invite anytime.</p></div></div>

    ${multi?H`<div class="field"><label>Who is this for?</label>
      <div id="kidPick" style="display:flex;flex-direction:column;gap:8px">
        ${kids.map(a=>H`<label class="kidrow" style="display:flex;align-items:center;gap:10px;padding:10px 12px;
          border:1px solid var(--line);border-radius:12px;cursor:pointer">
          <input type="checkbox" data-kid="${esc(a.id)}" ${a.id===state.active.id?'checked':''} style="width:18px;height:18px;flex:0 0 auto"/>
          <span class="avatar" style="width:28px;height:28px;font-size:13px;border-radius:9px">${esc((a.first_name||'?')[0].toUpperCase())}</span>
          <span>${esc(a.first_name)}</span>
        </label>`).join('')}
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Check as many as you want — one invite goes
        out for each, so accepting one never hands over a sibling's data too.</p></div>`:''}

    <div class="field"><label>Access level</label>
      <div class="chipgrid" id="role" style="grid-template-columns:1fr 1fr">
        <div class="chip on" data-r="family_view">Family view</div>
        <div class="chip" data-r="co_parent">Co-parent (edit)</div>
        <div class="chip" data-r="coach">Team Connect (coach)</div>
      </div></div>

    <div class="field"><label>How should it reach them?</label>
      <div class="chipgrid" id="chan" style="grid-template-columns:1fr 1fr 1fr">
        <div class="chip on" data-c="text">Text</div>
        <div class="chip" data-c="email">Email</div>
        <div class="chip" data-c="link">Just a link</div>
      </div></div>

    <div class="field" id="fPhone"><label>Their mobile number</label>
      <input id="invPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="(201) 555-0134"/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">US numbers only for now — ten digits is
        enough. Outside the US, type it with a + and the country code.</p></div>

    <div class="field" id="fEmail" hidden><label>Their email</label>
      <input id="invEmail" type="email" autocomplete="off" placeholder="grandma@email.com"/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">We'll send it for you.</p></div>

    <div id="linkout"></div>
    <div class="err" id="inverr"></div>
    <button class="btn" id="gen">Create invite</button>`);

  let role='family_view', chan='text';
  bg.querySelectorAll('#role .chip').forEach(c=>c.onclick=()=>{ role=c.dataset.r; bg.querySelectorAll('#role .chip').forEach(x=>x.classList.toggle('on',x===c)); });
  bg.querySelectorAll('#chan .chip').forEach(c=>c.onclick=()=>{
    chan=c.dataset.c; bg.querySelectorAll('#chan .chip').forEach(x=>x.classList.toggle('on',x===c));
    bg.querySelector('#fPhone').hidden = chan!=='text';
    bg.querySelector('#fEmail').hidden = chan!=='email';
  });
  // The row is the hit target, not just the box — same idiom as every other pick-list
  // in this app, and a lot easier to tap accurately than an 18px checkbox on a phone.
  bg.querySelectorAll('.kidrow').forEach(row=>{
    const box=row.querySelector('input[type=checkbox]');
    row.onclick=e=>{ if(e.target!==box) box.checked=!box.checked; };
  });

  bg.querySelector('#gen').onclick=async(e)=>{
    const btn=e.target; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    const errEl=bg.querySelector('#inverr'); errEl.textContent='';
    const stop=msg=>{ errEl.textContent=msg; btn.innerHTML='Create invite'; btn.disabled=false; };

    const kidIds = multi
      ? Array.from(bg.querySelectorAll('#kidPick input:checked')).map(i=>i.dataset.kid)
      : [state.active.id];
    if(!kidIds.length) return stop('Pick at least one child.');

    const email = chan==='email' ? (bg.querySelector('#invEmail').value||'').trim() : '';
    let phone = null;
    if(chan==='text'){
      phone = toE164(bg.querySelector('#invPhone').value);
      if(phone===false) return stop("That number doesn't look right — ten digits for a US mobile.");
      if(phone===null)  return stop('Add their mobile number, or switch to Email or Just a link.');
    }
    if(chan==='email'){
      if(!email) return stop('Add their email address, or switch to Text or Just a link.');
      if(!/.+@.+\..+/.test(email)) return stop("That email address doesn't look right.");
    }

    // One invite row per child, each with its OWN token and code — the loop is what's
    // new here, but every invite it produces is exactly as narrow as the single-child
    // flow always was. Accepting CJ's invite still never touches Savannah's.
    if(chan==='text'||chan==='email') btn.innerHTML='<span class="spinner"></span> Sending…';
    const results=[]; // { name, ok, sent, code, link, why, chan }
    for(const kidId of kidIds){
      const kid = kids.find(k=>k.id===kidId) || state.active;
      const { data, error } = await sb.from('athlete_invites')
        .insert({ athlete_id:kidId, role,
                  invited_email:email||null, invited_phone:phone||null,
                  sent_via:chan }).select().single();
      if(error){
        console.error(error); reportError(error,'invite:create');
        results.push({ name:kid.first_name, ok:false, why:'Could not create the invite' });
        continue;
      }
      if(role==='coach') logUsageEvent('team_connect_invite_sent');

      // The code is issued for EVERY invite, including a link the parent copies by hand.
      // The link on its own used to be the whole credential, which meant one forwarded
      // message handed a stranger standing access to a child's photos. Now the link gets
      // them to a door and the code opens it.
      let code=null;
      try{
        const { data:c, error:ce } = await sb.rpc('issue_invite_code',{ p_invite_id:data.id });
        if(ce) throw ce;
        code=c;
      }catch(err){
        // Not fatal: an invite with no code still works exactly as it did last week. Say
        // so rather than pretending there is a code the recipient will be asked for.
        console.error(err); reportError(err,'invite:code');
      }

      const link=inviteLink(data.token);
      let sent=false, why='';
      // Delivery is a convenience layered on top; the link and code exist either way, so a
      // gateway failure must never read as a failed invite.
      if(chan==='text' || chan==='email'){
        const fn = chan==='text' ? 'send-invite-sms' : 'send-invite';
        try{
          const { data:r, error:se } = await sb.functions.invoke(fn,{ body:{ invite_id:data.id, code } });
          if(se){
            // supabase-js puts se.message at "Edge Function returned a non-2xx status
            // code" for every failure — the actual reason the function wrote (missing
            // Twilio config, its rejection message, an unregistered sender) lives in the
            // response body, reachable only via se.context, a raw Response. Without this,
            // every carefully-worded error the function returns is invisible here.
            why = se.message || '';
            try{
              // Read as text first, not .json() directly — a response the function itself
              // never wrote (a cold-start timeout, an infra-level gateway error page) isn't
              // valid JSON, and .json() throwing there fell into this catch and left `why`
              // at the generic supabase-js message with nothing to diagnose. Reading text
              // works either way; only the interpretation of it branches.
              const raw = se.context && typeof se.context.text==='function' ? await se.context.text() : null;
              if(raw){
                let body = null;
                try{ body = JSON.parse(raw); }catch(_){}
                why = (body && (body.message || body.error)) || raw.slice(0, 300);
              }
            }catch(_){}
          }
          else if(r && r.ok) sent=true;
          else why=(r&&(r.message||r.error))||'';
        }catch(err){ console.error(err); why=err.message||''; }
        if(!sent) reportError(new Error(fn+' failed: '+why),'invite:send');
      }
      results.push({ name:kid.first_name, ok:true, sent, code, link, why, chan });
    }

    const ok = results.filter(r=>r.ok);
    const sentCount = ok.filter(r=>r.sent).length;

    bg.querySelector('#linkout').innerHTML = results.map(r=>{
      if(!r.ok) return H`<div class="err" style="margin-top:10px">${esc(r.name)}: ${esc(r.why)}</div>`;
      return H`<div style="margin-top:14px">
        ${multi?H`<div class="sec-title">${esc(r.name)}</div>`:''}
        ${r.code?H`<div class="sec-title" style="margin-top:${multi?4:14}px">Their code</div>
          <div class="code-show">${esc(r.code)}</div>
          <p style="font-size:11.5px;color:var(--muted);margin:0 2px 10px">Shown once. They'll be asked for it
            after they open the link, so a forwarded message isn't enough on its own.</p>`:''}
        <div class="linkbox"><span style="flex:1">${esc(r.link)}</span></div>
        ${(r.chan==='text'||r.chan==='email')&&!r.sent
          ?H`<p style="font-size:11.5px;color:var(--danger);margin:6px 2px 0">Couldn't send automatically
              (${esc(r.why||'gateway error')}) — copy this and send it yourself.</p>`:''}
      </div>`;
    }).join('');

    if(!ok.length) return stop('Nothing went through — try again.');
    if(chan==='text'||chan==='email'){
      if(sentCount===ok.length) toast(ok.length>1 ? `Sent ${sentCount} invites`
        : (chan==='text'?'Text sent':'Invite sent to '+email));
      else if(sentCount>0) toast(`${sentCount} of ${ok.length} sent — copy the rest below`);
      else errEl.textContent = "Couldn't send automatically — copy the message"+(ok.length>1?'s':'')+" below and send "+(ok.length>1?'them':'it')+" yourself.";
    }

    // Everything this run produced, in one paste — the fallback path a gateway failure
    // (or "Just a link") always lands on, for one child or several.
    const share = ok.map(r =>
      `Follow ${r.name}'s season on Parent Playbook: ${r.link}` + (r.code?`\n\nYour code is ${r.code}`:'')
    ).join('\n\n---\n\n');

    btn.textContent = ok.length>1 ? 'Copy the messages' : 'Copy the message';
    btn.disabled=false;
    btn.onclick=()=>{ navigator.clipboard?.writeText(share);
      toast('Copied — paste it into a text'); };
  };
}

const GOAL_MAX = 3;   // onboarding caps at 3; this used to let you add unlimited duplicates
function openAddGoal(existing){
  // Goals already active for this athlete are shown as taken rather than silently
  // inserted a second time.
  const taken=new Set((existing||[]).filter(g=>g.status==='active').map(g=>g.key));
  const room=Math.max(0, GOAL_MAX-taken.size);
  // Same sport-aware wording as onboarding — a cheerleader shouldn't be offered
  // "Read the game better" here either.
  const lib=goalLibFor(state.activeSportKey||null);
  const grp=t=>lib[t].map(g=>taken.has(g.key)
    ? `<div class="chip" style="opacity:.45;cursor:default" title="Already a goal">${esc(g.label)} ✓</div>`
    : `<div class="chip" data-k="${g.key}" data-t="${t}" data-l="${esc(g.label)}">${esc(g.label)}</div>`).join('');
  const bg=sheet(H`<h3>Add a goal</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 0">${room
      ? `Up to ${GOAL_MAX} at a time — room for ${room} more. Focus beats a long list.`
      : `You already have ${GOAL_MAX} active goals. Tick one off on the Growth screen to make room.`}</p>
    <div class="sec-title" style="margin-top:12px">Skill</div><div class="chipgrid" id="gs">${grp('skill')}</div>
    <div class="sec-title">Physical</div><div class="chipgrid" id="gp">${grp('physical')}</div>
    <div class="err" id="goalerr"></div>
    ${room?`<button class="btn" id="save" style="margin-top:16px">Save goal</button>`:''}
    <button class="btn ghost" id="gclose" style="margin-top:${room?'8px':'16px'}">Close</button>`);
  bg.querySelector('#gclose').onclick=()=>bg.remove();
  if(!room) return;
  const picks=[];
  bg.querySelectorAll('#gs .chip[data-k],#gp .chip[data-k]').forEach(c=>c.onclick=()=>{
    const k=c.dataset.k, i=picks.findIndex(p=>p.key===k);
    if(i>=0) picks.splice(i,1);
    else{
      if(picks.length>=room){ bg.querySelector('#goalerr').textContent=`That's the limit — ${GOAL_MAX} active goals.`; return; }
      picks.push({key:k,type:c.dataset.t,label:c.dataset.l});
    }
    bg.querySelector('#goalerr').textContent='';
    c.classList.toggle('on');
  });
  bg.querySelector('#save').onclick=async(e)=>{
    if(!picks.length){toast('Pick a goal first');return;}
    e.target.innerHTML='<span class="spinner"></span>';e.target.disabled=true;
    const sport=(await sb.from('athlete_sports').select('sport_key').eq('athlete_id',state.active.id).eq('is_primary',true).maybeSingle()).data?.sport_key||null;
    const { error }=await sb.from('goals').insert(picks.map(p=>({athlete_id:state.active.id,type:p.type,sport_key:sport,key:p.key,label:p.label,created_by:state.user.id})));
    // restore the button on failure — bailing out early left it a disabled spinner
    // forever, with no way to retry short of losing the picks
    if(error){ console.error(error); toast('Could not save'); e.target.innerHTML='Save goal'; e.target.disabled=false; return; }
    bg.remove(); toast('Goal added'); renderApp('growth');
  };
}

// presetKey preselects a metric so "+ Height" lands on height instead of dropping the
// parent into a 14-item dropdown defaulted to a 40-yard dash time.
function openAddMeasure(presetKey){
  const today=new Date().toISOString().slice(0,10);
  const metrics=state.ref?.metrics||[];
  // Guard the empty case: with no reference data the picker renders zero options and
  // `selectedOptions[0]` throws on save. afterLogin() now always loads it, but don't
  // hand back a form that can't work if that ever fails.
  if(!metrics.length){
    const b=sheet(H`<h3>Record a measurement</h3>
      <p style="color:var(--muted);font-size:13.5px;margin:8px 0 0">We couldn't load the list of measurements. Check your connection and reopen this screen.</p>
      <button class="btn ghost" id="close" style="margin-top:16px">Close</button>`);
    b.querySelector('#close').onclick=()=>b.remove();
    return;
  }
  const preset=presetKey?metrics.find(m=>m.key===presetKey):null;
  const bg=sheet(H`<h3>${preset?'Record '+esc(preset.name.toLowerCase()):'Record a measurement'}</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Keep conditions the same each time so the trend is honest.</p>
    <div class="field"><label>What did you measure?</label>
      <select id="mk">${metrics.map(m=>`<option value="${m.key}"${m.key===presetKey?' selected':''} data-u="${esc(m.unit||'')}">${esc(m.name)}${m.unit?' ('+esc(m.unit)+')':''}</option>`).join('')}</select>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Tap to change what you're recording — height, weight, sprint times and more.</p></div>
    <div class="row2">
      <div class="field"><label>Value</label><input id="mv" type="number" step="0.01" inputmode="decimal" placeholder="0"/></div>
      <div class="field"><label>Date</label><input id="md" type="date" value="${today}" max="${today}"/></div>
    </div>
    <div class="err" id="xerr"></div>
    <button class="btn" id="save">Save measurement</button>`);
  bg.querySelector('#save').onclick=async(e)=>{
    const errEl=bg.querySelector('#xerr'); errEl.textContent='';
    const sel=bg.querySelector('#mk'), key=sel.value, unit=sel.selectedOptions[0]?.dataset.u;
    const val=parseFloat(bg.querySelector('#mv').value), date=bg.querySelector('#md').value;
    if(isNaN(val)){ errEl.textContent='Enter a value.'; return; }
    if(val<=0){ errEl.textContent='Enter a value greater than zero.'; return; }
    if(date>today){ errEl.textContent="That date is in the future — pick today or earlier."; return; }
    e.target.innerHTML='<span class="spinner"></span>';e.target.disabled=true;
    const { error }=await sb.from('measurements').insert({athlete_id:state.active.id,metric_key:key,value:val,unit:unit||null,measured_on:date,source:'manual',created_by:state.user.id});
    if(error){ console.error(error); errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML='Save measurement'; e.target.disabled=false; return; }
    bg.remove(); toast('Recorded'); renderApp('growth');
  };
}

// ---- add / edit a sport ----
// Everything about one sport in one place: positions, level, practice days, season.
// `row` null = adding. Load is shared across every sport, so adding a second one never
// doubles the training — it just gives the week more to draw from.
function openSportEditor(row, onSaved){
  const adding=!row;
  const existingKeys=(state.athleteSports||[]).map(s=>s.sport_key);
  let sportKey=row?row.sport_key:'';
  let positions=row?[...(row.positions||[])]:[];
  let level=row?(row.level||''):'';
  const draw=()=>{
    const all=state.ref?.sports||[];
    const pick=adding?all.filter(s=>!existingKeys.includes(s.key)):all.filter(s=>s.key===sportKey);
    const levels=sportKey?(all.find(s=>s.key===sportKey)||{}).level_vocab||[]:[];
    return H`<h3>${adding?'Add a sport':'Edit '+esc((all.find(s=>s.key===sportKey)||{}).name||'sport')}</h3>
      <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">${adding
        ? 'Playing more than one is good for young athletes — and the weekly load is shared across both, never doubled.'
        : 'Positions and level for this sport.'}</p>
      ${adding?H`<div class="field"><label>Sport</label>
        <div class="chipgrid" id="spk">
          ${pick.length?pick.map(s=>`<div class="chip ${sportKey===s.key?'on':''}" data-k="${esc(s.key)}">${esc(s.name)}</div>`).join('')
            :'<p style="color:var(--muted);font-size:13px;grid-column:1/-1">Every sport is already added.</p>'}
        </div></div>`:''}
      ${sportKey?H`
        <div class="field"><label>Position(s)</label>${posChips(sportKey, positions, 'spp')}</div>
        <div class="field"><label>Level</label>
          <select id="spl"><option value="">Select level…</option>
            ${levels.map(l=>`<option ${level===l?'selected':''}>${esc(l)}</option>`).join('')}
          </select></div>`:''}
      <div class="err" id="sperr"></div>
      ${sportKey?`<button class="btn" id="spsave">${adding?'Add sport':'Save'}</button>`:''}
      <button class="btn ghost" id="spclose" style="margin-top:8px">Cancel</button>`;
  };
  const bg=sheet(draw());
  const wire=()=>{
    bg.querySelector('#spclose').onclick=()=>bg.remove();
    const k=bg.querySelector('#spk');
    if(k) k.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
      sportKey=c.dataset.k; positions=[]; level='';
      bg.querySelector('.sheet').innerHTML='<div class="grab"></div>'+draw(); wire();
    });
    const p=bg.querySelector('#spp');
    if(p) p.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
      const code=c.dataset.p;
      positions=positions.includes(code)?positions.filter(x=>x!==code):[...positions,code];
      c.classList.toggle('on');
    });
    const l=bg.querySelector('#spl'); if(l) l.onchange=()=>level=l.value;
    const s=bg.querySelector('#spsave');
    if(s) s.onclick=async(e)=>{
      const errEl=bg.querySelector('#sperr'); errEl.textContent='';
      if(!positions.length){ errEl.textContent='Choose at least one position.'; return; }
      if(!level){ errEl.textContent='Select a level.'; return; }
      e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
      let error;
      if(adding){
        ({ error }=await sb.from('athlete_sports').insert({
          athlete_id:state.active.id, sport_key:sportKey, positions, level, is_primary:false }));
      } else {
        ({ error }=await sb.from('athlete_sports').update({ positions, level }).eq('id',row.id));
      }
      if(error){
        console.error(error);
        errEl.textContent=(error.code==='23505'||/duplicate key/i.test(error.message||''))
          ? 'That sport is already set up.' : 'Could not save. '+(error.message||'');
        e.target.innerHTML=adding?'Add sport':'Save'; e.target.disabled=false; return;
      }
      bg.remove(); toast(adding?'Sport added':'Saved');
      if(onSaved) onSaved(); else renderApp('profile');
    };
  };
  wire();
}

async function setPrimarySport(rowId){
  // one primary per athlete — clear the others first
  await sb.from('athlete_sports').update({ is_primary:false }).eq('athlete_id',state.active.id);
  const { error }=await sb.from('athlete_sports').update({ is_primary:true }).eq('id',rowId);
  if(error){ console.error(error); toast('Could not update'); return; }
  toast('Primary sport updated'); renderApp('profile');
}

// Irreversible and total, so it asks for the word to be typed rather than a tap that can
// happen by accident. The list is specific on purpose — "delete your account" understates
// what actually goes, and a parent should see the photos named before they lose them.
function confirmDeleteAccount(){
  const kids=(state.athletes||[]).map(a=>a.first_name).filter(Boolean);
  const bg=sheet(H`<h3>Delete your account?</h3>
    <p style="color:var(--muted);font-size:14px;margin:8px 0 12px;line-height:1.55">
      This permanently erases <b>everything</b>, for good:</p>
    <ul style="margin:0 0 14px;padding-left:20px;font-size:13.5px;line-height:1.7;color:var(--ink)">
      <li>Your login — the email becomes free to sign up with again, from scratch</li>
      <li>${kids.length?H`<b>${esc(kids.join(', '))}</b>'s profile${kids.length>1?'s':''}`:'Any child profiles you own'} and all their history</li>
      <li>Every photo and video you have uploaded</li>
      <li>Measurements, goals, games, milestones and completed sessions</li>
    </ul>
    <p style="color:var(--muted);font-size:13px;margin:0 0 14px;line-height:1.55">
      If another adult shares your household, their children stay with them — only your access is removed.
      There is no undo and no backup we can restore from.</p>
    <div class="field"><label>Type DELETE to confirm</label><input id="delWord" autocapitalize="characters" placeholder="DELETE"/></div>
    <div class="err" id="delErr"></div>
    <button class="btn danger" id="delGo" style="margin-bottom:10px">Permanently delete everything</button>
    <button class="btn ghost" id="delNo">Keep my account</button>`);
  bg.querySelector('#delNo').onclick=()=>bg.remove();
  bg.querySelector('#delGo').onclick=async(e)=>{
    const errEl=bg.querySelector('#delErr'); errEl.textContent='';
    if((bg.querySelector('#delWord').value||'').trim().toUpperCase()!=='DELETE'){
      errEl.textContent='Type DELETE to confirm.'; return;
    }
    const btn=e.target; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    let res;
    try{ res=await sb.functions.invoke('delete-account',{ body:{ confirm:'DELETE' } }); }
    catch(err){ console.error(err); res={ error:err }; }
    if(res.error){
      console.error(res.error);
      errEl.textContent=await fnError(res.error,'Could not delete your account. Please email support@chimaura.com.');
      btn.innerHTML='Permanently delete everything'; btn.disabled=false; return;
    }
    // Sign out locally too — the token is dead server-side, but leaving it in storage
    // would show a stale, half-loaded app until the next reload.
    try{ await sb.auth.signOut(); }catch(err){ /* the user is already gone */ }
    state.user=null; state.athletes=[]; state.active=null; state.ref=null;
    bg.remove();
    toast('Your account and all data have been deleted');
    renderAuth('signup');
  };
}

function confirmRemoveSport(row, name){
  const bg=sheet(H`<h3>Remove ${esc(name)}?</h3>
    <p style="color:var(--muted);font-size:14px;margin:8px 0 16px">
      This takes ${esc(name)} off ${esc(state.active.first_name)}'s weekly plan along with its practice schedule.
      Games, milestones, photos and measurements are all kept.</p>
    <button class="btn danger" id="yes" style="margin-bottom:10px">Remove sport</button>
    <button class="btn ghost" id="no">Keep it</button>`);
  bg.querySelector('#no').onclick=()=>bg.remove();
  bg.querySelector('#yes').onclick=async(e)=>{
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const { error }=await sb.from('athlete_sports').delete().eq('id',row.id);
    if(error){ console.error(error); toast('Could not remove'); e.target.innerHTML='Remove sport'; e.target.disabled=false; return; }
    // never leave the athlete with no primary
    if(row.is_primary){
      const { data }=await sb.from('athlete_sports').select('id').eq('athlete_id',state.active.id).order('created_at').limit(1);
      if(data&&data.length) await sb.from('athlete_sports').update({ is_primary:true }).eq('id',data[0].id);
    }
    bg.remove(); toast('Removed'); renderApp('profile');
  };
}

// ---- practice schedule: the week is planned AROUND these days ----
function schedChips(sel,id){
  return `<div class="chipgrid" id="${id}" style="grid-template-columns:repeat(4,1fr)">
    ${DAY_LABELS.map((d,i)=>`<div class="chip ${sel.includes(i)?'on':''}" data-d="${i}">${d}</div>`).join('')}</div>`;
}
function openPracticeSchedule(sportKey, current, onSaved){
  let picked=[...(current?.practiceDays||[])];
  const gameDay=current?.gameDay;
  const bg=sheet(H`<h3>Practice schedule</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">We plan the week <b>around</b> practice, not on top of it. Change it any time the season does.</p>
    <div class="teach" style="margin-bottom:14px"><div class="ic">🎓</div><div><h4>Why this matters most</h4>
      <p>Stacking home training onto practice days is the main way young athletes get overused. The more the team trains, the less we add — and if the week is already full, we add nothing.</p></div></div>
    <div class="field"><label>Practice days</label>${schedChips(picked,'pd')}
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Tap all that apply. None? Leave them all off.</p></div>
    <div class="field"><label>Usual game day (optional)</label>
      <select id="gd"><option value="">— No regular game day —</option>
        ${DAY_LABELS.map((d,i)=>`<option value="${i}" ${gameDay===i?'selected':''}>${d}</option>`).join('')}
      </select></div>
    <div class="row2">
      <div class="field"><label>First game (approx.)</label>
        <input id="ss" type="date" value="${esc(current?.seasonStart||'')}"/></div>
      <div class="field"><label>Last game (optional)</label>
        <input id="se" type="date" value="${esc(current?.seasonEnd||'')}"/></div>
    </div>
    <p style="font-size:11.5px;color:var(--muted);margin:-4px 2px 14px">
      Before the first game we treat the week as camp — no game day on the plan. A rough date is fine; change it when you know.</p>
    <div class="err" id="serr"></div>
    <button class="btn" id="save">Save schedule</button>`);
  bg.querySelectorAll('#pd .chip').forEach(c=>c.onclick=()=>{
    const i=+c.dataset.d;
    picked=picked.includes(i)?picked.filter(x=>x!==i):[...picked,i];
    c.classList.toggle('on');
  });
  bg.querySelector('#save').onclick=async(e)=>{
    const errEl=bg.querySelector('#serr'); errEl.textContent='';
    const raw=bg.querySelector('#gd').value;
    const gd=raw===''?null:parseInt(raw,10);
    if(gd!=null&&picked.includes(gd)){ errEl.textContent="That day is already a practice day — pick a different game day."; return; }
    if(picked.length>=6){ errEl.textContent="Six or more practice days doesn't leave room to recover. Double-check that with the coach."; return; }
    const ss=bg.querySelector('#ss').value||null, se=bg.querySelector('#se').value||null;
    if(ss&&se&&se<ss){ errEl.textContent="The last game can't be before the first one."; return; }
    if(gd==null&&ss){ errEl.textContent="Pick a game day too, or clear the season dates."; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    const { error }=await sb.from('athlete_sports')
      .update({ practice_days:picked.sort((a,b)=>a-b), game_day:gd, season_start:ss, season_end:se })
      .eq('athlete_id',state.active.id).eq('sport_key',sportKey);
    if(error){ console.error(error); errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML='Save schedule'; e.target.disabled=false; return; }
    bg.remove(); toast('Schedule saved 📅');
    if(onSaved) onSaved(); else renderApp('week');
  };
}

function confirmDelete(){
  const a=state.active;
  const bg=sheet(H`<h3>Delete ${esc(a.first_name)}?</h3>
    <p style="color:var(--muted);font-size:14px;margin:8px 0 16px">This permanently removes ${esc(a.first_name)}'s profile, plans, goals, and measurements for everyone with access. This cannot be undone.</p>
    <button class="btn danger" id="yes" style="margin-bottom:10px">Yes, delete permanently</button>
    <button class="btn ghost" id="no">Keep it</button>`);
  bg.querySelector('#no').onclick=()=>bg.remove();
  bg.querySelector('#yes').onclick=async(e)=>{
    e.target.innerHTML='<span class="spinner"></span>';e.target.disabled=true;
    // Server-side: verifies ownership, deletes the athlete (cascades all rows),
    // AND purges the child's photos/videos from storage so nothing is left behind.
    const { data, error }=await sb.functions.invoke('delete-athlete',{ body:{ athlete_id:a.id } });
    if(error||(data&&data.error)){ toast('Could not delete'); e.target.innerHTML='Yes, delete permanently'; e.target.disabled=false; return; }
    const familyId=a.family_id;
    bg.remove(); await loadAthletes();
    if(state.athletes.length===0){
      state.active=null; toast('Deleted');
      // Keep the household. renderOnboarding() runs the `create` flow, which sets
      // p_new_family=true and mints a SECOND family — orphaning this one along with
      // its members and anyone already invited into it.
      if(familyId){ obReset({ mode:'addChild', familyId }); return obStep(); }
      return renderOnboarding();
    }
    state.active=state.athletes[0]; toast('Deleted'); renderApp('week');
  };
}

// add another athlete into the household currently being viewed
async function startAddChild(){
  try{ await loadRef(); }catch(err){ console.error(err); toast('Could not load — check your connection'); return; }
  const familyId = state.active?.family_id;
  if(!familyId){ return renderOnboarding(); }
  obReset({ mode:'addChild', familyId });
  obStep();
}

