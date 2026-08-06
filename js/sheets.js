async function uploadMedia(files,{gameId=null,caption=null,takenOn=null}={}){
  const a=state.active;
  for(const file of files){
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
}
function oversize(files){ return [...files].find(f=>f.size>MEDIA_MAX); }

function openLogGame(){
  const today=new Date().toISOString().slice(0,10);
  const bg=sheet(H`<h3>Log a game</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Record the result, a stat or two, and add photos or video from the day.</p>
    <div class="row2">
      <div class="field"><label>Date</label><input id="gd" type="date" value="${today}" max="${today}"/></div>
      <div class="field"><label>Season (optional)</label><input id="gs" placeholder="e.g. Fall 2026"/></div>
    </div>
    <div class="field"><label>Opponent (optional)</label><input id="go" placeholder="e.g. Eagles"/></div>
    <div class="field"><label>Where</label>
      <div class="chipgrid" id="gha">
        <div class="chip" data-ha="home">Home</div><div class="chip" data-ha="away">Away</div><div class="chip" data-ha="neutral">Neutral</div>
      </div></div>
    <div class="row2">
      <div class="field"><label>Our score</label><input id="gour" type="number" inputmode="numeric" placeholder="—"/></div>
      <div class="field"><label>Their score</label><input id="gtheir" type="number" inputmode="numeric" placeholder="—"/></div>
    </div>
    <div class="field"><label>Stats (optional)</label>
      <div id="stats"></div>
      <button class="btn sm ghost" id="addStat" style="margin-top:8px">＋ Add a stat</button>
    </div>
    <div class="field"><label>Notes (optional)</label><textarea id="gn" rows="2" placeholder="One thing that went well, one to work on."></textarea></div>
    <div class="field"><label>Photos / video (optional)</label><input id="gf" type="file" accept="image/*,video/*" multiple/>
      <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Up to 100 MB each — short clips work best.</p></div>
    <div class="err" id="gerr"></div>
    <button class="btn" id="save">Save game</button>`);
  let ha='';
  bg.querySelectorAll('#gha .chip').forEach(c=>c.onclick=()=>{ ha=(ha===c.dataset.ha?'':c.dataset.ha); bg.querySelectorAll('#gha .chip').forEach(x=>x.classList.toggle('on',x.dataset.ha===ha)); });
  const statsEl=bg.querySelector('#stats');
  const addStatRow=()=>{ const d=document.createElement('div'); d.className='row2'; d.style.marginBottom='8px';
    d.innerHTML=`<input class="sk" placeholder="Stat (e.g. Goals)" style="padding:12px;border:1.5px solid var(--line);border-radius:12px"/><input class="sv" placeholder="Value" style="padding:12px;border:1.5px solid var(--line);border-radius:12px"/>`;
    statsEl.appendChild(d); };
  bg.querySelector('#addStat').onclick=addStatRow;
  bg.querySelector('#save').onclick=async(e)=>{
    const errEl=bg.querySelector('#gerr'); errEl.textContent='';
    const gd=bg.querySelector('#gd').value; if(!gd){ errEl.textContent='Pick the game date.'; return; }
    const numOr=id=>{ const v=bg.querySelector(id).value; return v===''?null:parseInt(v,10); };
    const our=numOr('#gour'), their=numOr('#gtheir');
    const stats={}; statsEl.querySelectorAll('.row2').forEach(r=>{ const k=r.querySelector('.sk').value.trim(), v=r.querySelector('.sv').value.trim(); if(k&&v) stats[k]=v; });
    const files=bg.querySelector('#gf').files;
    const big=oversize(files); if(big){ errEl.textContent=`“${big.name}” is over 100 MB — trim it and try again.`; return; }
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    try{
      const gid=uuid();
      let result='na'; if(our!=null&&their!=null) result=our>their?'win':our<their?'loss':'tie';
      const { error }=await sb.from('games').insert({ id:gid, athlete_id:state.active.id, game_date:gd,
        season:bg.querySelector('#gs').value.trim()||null, opponent:bg.querySelector('#go').value.trim()||null,
        home_away:ha||null, our_score:our, their_score:their, result,
        notes:bg.querySelector('#gn').value.trim()||null, stats, created_by:state.user.id });
      if(error) throw error;
      if(files.length){ e.target.innerHTML='<span class="spinner"></span> Uploading…'; await uploadMedia(files,{gameId:gid,takenOn:gd}); }
      bg.remove(); toast('Game logged 🏅'); renderApp('journey');
    }catch(err){ console.error(err); errEl.textContent='Could not save. '+(err.message||''); e.target.innerHTML='Save game'; e.target.disabled=false; }
  };
}

function openAddMilestone(){
  const today=new Date().toISOString().slice(0,10);
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
    const { error }=await sb.from('milestones').insert({ athlete_id:state.active.id, milestone_date:d, title:t,
      note:bg.querySelector('#mn').value.trim()||null, created_by:state.user.id });
    if(error){ errEl.textContent='Could not save. '+(error.message||''); e.target.innerHTML='Save milestone'; e.target.disabled=false; return; }
    bg.remove(); toast('Milestone added ⭐'); renderApp('journey');
  };
}

function openAddMedia(games){
  const today=new Date().toISOString().slice(0,10);
  const gopts=(games||[]).map(g=>`<option value="${g.id}">${esc(fmtDate(g.game_date))}${g.opponent?' vs '+esc(g.opponent):''}</option>`).join('');
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

function openMediaViewer(m,url){
  const body = !url ? `<div class="empty">This file couldn't be loaded.</div>`
    : m.kind==='video'
      ? `<video src="${esc(url)}" controls autoplay playsinline style="width:100%;border-radius:14px;background:#000;max-height:60dvh"></video>`
      : `<img src="${esc(url)}" style="width:100%;border-radius:14px;display:block" alt="${esc(m.caption||'')}"/>`;
  const bg=sheet(H`<h3>${esc(m.caption||(m.kind==='video'?'Video':'Photo'))}</h3>
    ${m.taken_on?`<span class="pill" style="margin:6px 0 2px">${esc(fmtDate(m.taken_on))}</span>`:''}
    <div style="margin-top:10px">${body}</div>
    <button class="btn danger" id="delm" style="margin-top:14px">Delete this ${m.kind==='video'?'video':'photo'}</button>`);
  bg.querySelector('#delm').onclick=async(e)=>{
    e.target.innerHTML='<span class="spinner"></span>'; e.target.disabled=true;
    await sb.storage.from('athlete-media').remove([m.path]);
    const { error }=await sb.from('media').delete().eq('id',m.id);
    if(error){ toast('Could not delete'); e.target.innerHTML='Delete'; e.target.disabled=false; return; }
    bg.remove(); toast('Deleted'); renderApp('journey');
  };
}

// ---------- sheets / modals ----------
function sheet(html){
  const bg=document.createElement('div');bg.className='modal-bg';
  bg.innerHTML=`<div class="sheet"><div class="grab"></div>${html}</div>`;
  bg.onclick=e=>{ if(e.target===bg) bg.remove(); };
  document.body.appendChild(bg); return bg;
}
function openSwitch(){
  const bg=sheet(H`<h3>Switch athlete</h3><div style="margin-top:10px">
    ${state.athletes.map(a=>H`<button class="btn ghost" data-id="${a.id}" style="margin-bottom:8px;justify-content:flex-start">
      <span class="avatar" style="width:30px;height:30px;font-size:14px;border-radius:9px">${(a.first_name||'?')[0].toUpperCase()}</span> ${esc(a.first_name)}</button>`).join('')}
  </div>`);
  bg.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{ state.active=state.athletes.find(a=>a.id===b.dataset.id); bg.remove(); renderApp('week'); });
}

function openInvite(){
  const bg=sheet(H`<h3>Invite someone to help</h3>
    <p style="color:var(--muted);font-size:13.5px;margin:6px 0 4px">Share a private link with a co-parent, grandparent, or coach. They create their own login and get access to ${esc(state.active.first_name)} only.</p>
    <div class="teach" style="margin-top:12px"><div class="ic">🎓</div><div><h4>You stay in control</h4>
      <p>Choose their access level. Family view can see the plan and progress; co-parent can also edit. You can revoke any invite anytime.</p></div></div>
    <div class="field"><label>Access level</label>
      <div class="chipgrid" id="role" style="grid-template-columns:1fr 1fr">
        <div class="chip on" data-r="family_view">Family view</div>
        <div class="chip" data-r="co_parent">Co-parent (edit)</div>
      </div></div>
    <div id="linkout"></div>
    <button class="btn" id="gen">Create invite link</button>`);
  let role='family_view';
  bg.querySelectorAll('#role .chip').forEach(c=>c.onclick=()=>{ role=c.dataset.r; bg.querySelectorAll('#role .chip').forEach(x=>x.classList.toggle('on',x===c)); });
  bg.querySelector('#gen').onclick=async(e)=>{
    const btn=e.target; btn.innerHTML='<span class="spinner"></span>'; btn.disabled=true;
    const { data, error } = await sb.from('athlete_invites').insert({ athlete_id:state.active.id, role }).select().single();
    if(error){ toast('Could not create link'); btn.textContent='Try again'; btn.disabled=false; return; }
    const link=inviteLink(data.token);
    bg.querySelector('#linkout').innerHTML=H`
      <div class="linkbox"><span style="flex:1">${esc(link)}</span></div>`;
    btn.textContent='Copy link';
    btn.onclick=()=>{ navigator.clipboard?.writeText(link); toast('Link copied — share it privately'); };
  };
}

function openAddGoal(){
  const on=new Set();
  const grp=t=>GOAL_LIB[t].map(g=>`<div class="chip" data-k="${g.key}" data-t="${t}" data-l="${esc(g.label)}">${esc(g.label)}</div>`).join('');
  const bg=sheet(H`<h3>Add a goal</h3>
    <div class="sec-title" style="margin-top:12px">Skill</div><div class="chipgrid" id="gs">${grp('skill')}</div>
    <div class="sec-title">Physical</div><div class="chipgrid" id="gp">${grp('physical')}</div>
    <button class="btn" id="save" style="margin-top:16px">Save goal</button>`);
  const picks=[];
  bg.querySelectorAll('#gs .chip,#gp .chip').forEach(c=>c.onclick=()=>{
    const k=c.dataset.k, i=picks.findIndex(p=>p.key===k);
    if(i>=0) picks.splice(i,1); else picks.push({key:k,type:c.dataset.t,label:c.dataset.l});
    c.classList.toggle('on');
  });
  bg.querySelector('#save').onclick=async(e)=>{
    if(!picks.length){toast('Pick a goal first');return;}
    e.target.innerHTML='<span class="spinner"></span>';e.target.disabled=true;
    const sport=(await sb.from('athlete_sports').select('sport_key').eq('athlete_id',state.active.id).eq('is_primary',true).maybeSingle()).data?.sport_key||null;
    const { error }=await sb.from('goals').insert(picks.map(p=>({athlete_id:state.active.id,type:p.type,sport_key:sport,key:p.key,label:p.label,created_by:state.user.id})));
    if(error){toast('Could not save');return;}
    bg.remove(); toast('Goal added'); renderApp('growth');
  };
}

function openAddMeasure(){
  const metrics=state.ref?.metrics||[];
  const bg=sheet(H`<h3>Record a measurement</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">Keep conditions the same each time so the trend is honest.</p>
    <div class="field"><label>What did you measure?</label>
      <select id="mk">${metrics.map(m=>`<option value="${m.key}" data-u="${esc(m.unit||'')}">${esc(m.name)}${m.unit?' ('+esc(m.unit)+')':''}</option>`).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Value</label><input id="mv" type="number" step="0.01" inputmode="decimal" placeholder="0"/></div>
      <div class="field"><label>Date</label><input id="md" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
    </div>
    <button class="btn" id="save">Save measurement</button>`);
  bg.querySelector('#save').onclick=async(e)=>{
    const sel=bg.querySelector('#mk'), key=sel.value, unit=sel.selectedOptions[0].dataset.u;
    const val=parseFloat(bg.querySelector('#mv').value), date=bg.querySelector('#md').value;
    if(isNaN(val)){toast('Enter a value');return;}
    e.target.innerHTML='<span class="spinner"></span>';e.target.disabled=true;
    const { error }=await sb.from('measurements').insert({athlete_id:state.active.id,metric_key:key,value:val,unit:unit||null,measured_on:date,source:'manual',created_by:state.user.id});
    if(error){toast('Could not save');return;}
    bg.remove(); toast('Recorded'); renderApp('growth');
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
    const { error }=await sb.from('athletes').delete().eq('id',a.id);
    if(error){toast('Could not delete');return;}
    bg.remove(); await loadAthletes();
    if(state.athletes.length===0){ state.active=null; return renderOnboarding(); }
    state.active=state.athletes[0]; toast('Deleted'); renderApp('week');
  };
}

// add another athlete into the household currently being viewed
async function startAddChild(){
  await loadRef();
  const familyId = state.active?.family_id;
  if(!familyId){ return renderOnboarding(); }
  obReset({ mode:'addChild', familyId });
  obStep();
}

