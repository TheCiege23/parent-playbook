// ===================================================================
//  ADMIN — DRILL LIBRARY
//  Training content used to be 106 KB of JavaScript constants, so adding a
//  drill or fixing a cue meant a developer, a code change, and a deploy.
//  This edits the `drills` table instead: content changes ship without one.
//
//  Every published row must carry a source — enforced by a CHECK constraint
//  (drills_published_needs_source), not just by this form. Uncited work can
//  be saved as a draft while it is being sourced, and stays invisible to
//  parents until it isn't.
// ===================================================================
let adDrills = [];            // rows currently loaded
let adSport  = '';            // '' = every sport
let adBand   = '';            // '' = every band
const AD_BANDS = [['young','Young (under ~10)'],['mid','Middle (~10–13)'],['old','Older (14+)']];

// The engine buckets five age bands into three drill buckets (skillsFor), so the
// library is written against the buckets, not the bands.
function adBandLabel(b){ const f=AD_BANDS.find(x=>x[0]===b); return f?f[1]:b; }
function adSportName(k){ return (state.ref&&state.ref.sports.find(s=>s.key===k)||{}).name || k || 'Any sport'; }

async function openAdminDrills(){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Loading library…</div></div>`;
  try{ await loadRef(); }catch(err){ console.error(err); }
  try{
    let q=sb.from('drills').select('*').order('sport_key').order('band').order('sort');
    if(adSport) q=q.eq('sport_key',adSport);
    if(adBand)  q=q.eq('band',adBand);
    const { data, error }=await q;
    if(error) throw error; adDrills=data||[];
  }catch(err){ console.error(err); return adminError(openAdminDrills); }

  const sports=(state.ref&&state.ref.sports)||[];
  const published=adDrills.filter(d=>d.status==='published').length;
  const drafts=adDrills.length-published;

  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h1 style="font-size:22px">Drill library</h1><button class="pill" id="adDone">Done</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin:0 0 12px">${published} published · ${drafts} draft${drafts===1?'':'s'}. Published drills appear in a child's week ahead of the built-in library.</p>

    <div class="field" style="margin-bottom:8px"><label>Sport</label>
      <select id="adSportSel">
        <option value="">All sports</option>
        ${sports.map(s=>`<option value="${esc(s.key)}"${adSport===s.key?' selected':''}>${esc(s.name)}</option>`).join('')}
      </select></div>
    <div class="field" style="margin-bottom:12px"><label>Age bucket</label>
      <select id="adBandSel">
        <option value="">All ages</option>
        ${AD_BANDS.map(([k,l])=>`<option value="${esc(k)}"${adBand===k?' selected':''}>${esc(l)}</option>`).join('')}
      </select></div>

    <button class="btn" id="adNew" style="margin-bottom:14px">+ New drill</button>

    ${adDrills.length? adDrills.map(d=>H`
      <button class="card app-pad" data-ed="${esc(d.id)}" style="width:100%;text-align:left;display:block;margin-bottom:10px;border:none;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div style="min-width:0">
            <b style="font-size:15px">${esc(d.title)}</b>
            <div style="color:var(--muted);font-size:12.5px;margin-top:2px">
              ${esc(adSportName(d.sport_key))} · ${esc(adBandLabel(d.band))}${d.position_codes&&d.position_codes.length?' · '+esc(d.position_codes.join(', ')):''}
            </div>
            <div style="font-size:12px;margin-top:4px;color:${d.source_name?'var(--good)':'var(--danger)'}">
              ${d.source_name?'✓ '+esc(d.source_name):'⚠ no source'}
            </div>
          </div>
          <span class="pill" style="background:${d.status==='published'?'#E9F1EF':'var(--line)'};color:${d.status==='published'?'var(--good)':'var(--muted)'}">${d.status==='published'?'Live':'Draft'}</span>
        </div>
      </button>`).join('')
      : `<div class="card app-pad"><div class="empty">No drills yet for this filter. The built-in library covers these athletes until you add one.</div></div>`}
  </div>`;

  $("#adDone").onclick=()=>renderApp('profile');
  $("#adSportSel").onchange=e=>{ adSport=e.target.value; openAdminDrills(); };
  $("#adBandSel").onchange=e=>{ adBand=e.target.value; openAdminDrills(); };
  $("#adNew").onclick=()=>adminEditDrill(null);
  root.querySelectorAll('[data-ed]').forEach(b=>b.onclick=()=>adminEditDrill(b.dataset.ed));
}

// ---- single drill ----
function adminEditDrill(id){
  const d = id ? (adDrills.find(x=>x.id===id)||{}) : {};
  const isNew = !id;
  const sports=(state.ref&&state.ref.sports)||[];
  const lines=a=>Array.isArray(a)?a.join('\n'):'';
  const csv=a=>Array.isArray(a)?a.join(', '):'';

  root.innerHTML = H`<div class="app-pad" style="padding-top:26px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <button class="pill" id="adBack">‹ Library</button>
      ${isNew?'':`<button class="btn sm ghost" id="adDel" style="color:var(--danger)">Delete</button>`}
    </div>
    <h1 style="font-size:22px;margin:0 0 14px">${isNew?'New drill':'Edit drill'}</h1>

    <div class="sec-title">Who it's for</div>
    <div class="card app-pad">
      <div class="field"><label>Sport</label>
        <select id="dSport">
          <option value="">Any sport (generic)</option>
          ${sports.map(s=>`<option value="${esc(s.key)}"${d.sport_key===s.key?' selected':''}>${esc(s.name)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Age bucket</label>
        <select id="dBand">${AD_BANDS.map(([k,l])=>`<option value="${esc(k)}"${d.band===k?' selected':''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Position codes</label>
        <input id="dPos" value="${esc(csv(d.position_codes))}" placeholder="RB, WR — blank means every position"/>
        <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Must match the codes in the positions table exactly. Blank = sport-general.</p></div>
      <div class="field"><label>Goals it serves</label>
        <input id="dGoals" value="${esc(csv(d.goal_keys))}" placeholder="speed, agility — blank means all"/>
        <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">A drill tagged with a family's chosen goal is scheduled ahead of untagged ones.</p></div>
      <div class="field"><label>Levels</label>
        <input id="dLevels" value="${esc(csv(d.levels))}" placeholder="rec, travel — blank means all"/></div>
    </div>

    <div class="sec-title">The drill</div>
    <div class="card app-pad">
      <div class="field"><label>Title *</label><input id="dTitle" value="${esc(d.title||'')}" placeholder="Ball security: high &amp; tight"/></div>
      <div class="field"><label>Duration</label><input id="dDur" value="${esc(d.duration||'')}" placeholder="10 min"/></div>
      <div class="field"><label>Why it matters *</label><textarea id="dWhy" rows="2" placeholder="What this builds, in a parent's language.">${esc(d.why||'')}</textarea></div>
      <div class="field"><label>How to do it * — one step per line</label><textarea id="dHow" rows="4" placeholder="5 reps each side&#10;Walk it first, then jog">${esc(lines(d.how))}</textarea></div>
      <div class="field"><label>What to say</label><input id="dSay" value="${esc(d.say||'')}" placeholder="&quot;High and tight — squeeze it.&quot;"/></div>
      <div class="field"><label>Common mistake</label><input id="dMistake" value="${esc(d.mistake||'')}" placeholder="Carrying it away from the body."/></div>
      <div class="field"><label>When to stop</label><input id="dStop" value="${esc(d.stop||'')}" placeholder="Any pain, or when focus fades."/>
        <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">Every drill in the app carries a stop condition. Keep that true.</p></div>
    </div>

    <div class="sec-title">Step images</div>
    <div class="card app-pad">
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px;line-height:1.5">Up to 6, shown in order under "How to do it". A parent mid-drill can glance at a picture; they can't read a paragraph. Every image needs a description — it's what a screen reader announces, and what shows if the image fails to load.</p>
      <div id="dImgList"></div>
      <div class="field" style="margin-bottom:0"><label>Add an image</label>
        <input id="dImgFile" type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml"/>
        <p style="font-size:11.5px;color:var(--muted);margin:6px 2px 0">JPG, PNG, WebP or SVG, up to 5 MB. These are public — never upload a photo of a child.</p></div>
    </div>

    <div class="sec-title">Where it came from</div>
    <div class="card app-pad">
      <p style="font-size:12.5px;color:var(--muted);margin:0 0 12px;line-height:1.5">Shown to the parent under the drill. A drill cannot be published without a source — save it as a draft until you have one.</p>
      <div class="field"><label>Source name</label><input id="dSrc" value="${esc(d.source_name||'')}" placeholder="USA Football — Football Development Model"/></div>
      <div class="field"><label>Source URL</label><input id="dUrl" type="url" value="${esc(d.source_url||'')}" placeholder="https://…"/></div>
      <div class="field"><label>What in the source this comes from</label><textarea id="dNote" rows="2" placeholder="Which section, recommendation, or finding this drill derives from.">${esc(d.source_note||'')}</textarea></div>
      <div class="field"><label>Reviewed by</label><input id="dBy" value="${esc(d.reviewed_by||'')}" placeholder="Who checked this against the source"/></div>
      <div class="field"><label>Reviewed on</label><input id="dOn" type="date" value="${esc(d.reviewed_on?String(d.reviewed_on).slice(0,10):'')}"/></div>
    </div>

    <div class="sec-title">Publishing</div>
    <div class="card app-pad">
      <div class="field"><label>Status</label>
        <select id="dStatus">
          <option value="draft"${d.status!=='published'?' selected':''}>Draft — not shown to anyone</option>
          <option value="published"${d.status==='published'?' selected':''}>Published — live in children's weeks</option>
        </select></div>
      <div class="field"><label>Sort order</label><input id="dSort" type="number" value="${esc(d.sort!=null?d.sort:0)}"/></div>
    </div>

    <div class="err" id="dErr"></div>
    <button class="btn" id="dSave" style="margin-top:14px">${isNew?'Create drill':'Save changes'}</button>
  </div>`;

  $("#adBack").onclick=openAdminDrills;
  { const del=$("#adDel"); if(del) del.onclick=()=>adminDeleteDrill(id); }
  $("#dSave").onclick=e=>adminSaveDrill(id,e.target);

  // ---- step images ----
  adImages = Array.isArray(d.images) ? d.images.slice() : [];
  adRenderImages();
  $("#dImgFile").onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    if(adImages.length>=6){ toast('6 images is the limit'); e.target.value=''; return; }
    if(f.size>5*1024*1024){ toast('Image is over 5 MB'); e.target.value=''; return; }
    const btn=e.target; btn.disabled=true;
    const ext=(f.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
    const path=(($("#dSport").value||'general'))+'/'+uuid()+'.'+ext;
    const up=await sb.storage.from('drill-images').upload(path,f,{contentType:f.type||undefined,upsert:false});
    btn.disabled=false; e.target.value='';
    if(up.error){ console.error(up.error); toast(up.error.message||'Upload failed'); return; }
    adImages.push({path, alt:''});
    adRenderImages();
    toast('Uploaded — add a description');
  };
}

// Kept outside adminEditDrill so the row handlers can reach it.
let adImages = [];
function adRenderImages(){
  const box=$("#dImgList"); if(!box) return;
  box.innerHTML = adImages.length ? adImages.map((im,i)=>H`
    <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)">
      <img src="${esc(drillImageUrl(im.path))}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:8px;background:var(--line);flex:0 0 auto"/>
      <div style="flex:1;min-width:0">
        <input class="adAlt" data-i="${i}" value="${esc(im.alt||'')}" placeholder="Describe this step — e.g. 'Ball tucked high against the ribs'"/>
      </div>
      <button class="btn sm ghost adImgUp" data-i="${i}" title="Move up" style="color:var(--muted)">↑</button>
      <button class="btn sm ghost adImgDel" data-i="${i}" style="color:var(--danger)">✕</button>
    </div>`).join('')
    : `<p style="font-size:12.5px;color:var(--muted);margin:0 0 10px">No images yet.</p>`;
  box.querySelectorAll('.adAlt').forEach(el=>el.oninput=()=>{ adImages[+el.dataset.i].alt=el.value; });
  box.querySelectorAll('.adImgDel').forEach(b=>b.onclick=()=>{ adImages.splice(+b.dataset.i,1); adRenderImages(); });
  box.querySelectorAll('.adImgUp').forEach(b=>b.onclick=()=>{
    const i=+b.dataset.i; if(i<1) return;
    const t=adImages[i-1]; adImages[i-1]=adImages[i]; adImages[i]=t; adRenderImages();
  });
}

const adList = v => String(v||'').split(/[\n,]/).map(s=>s.trim()).filter(Boolean);

async function adminSaveDrill(id,btn){
  const err=$("#dErr"); err.textContent='';
  const row={
    sport_key: $("#dSport").value || null,
    band:      $("#dBand").value,
    position_codes: adList($("#dPos").value),
    goal_keys: adList($("#dGoals").value),
    levels:    adList($("#dLevels").value),
    title:     $("#dTitle").value.trim(),
    duration:  $("#dDur").value.trim() || null,
    why:       $("#dWhy").value.trim(),
    how:       adList($("#dHow").value),
    say:       $("#dSay").value.trim() || null,
    mistake:   $("#dMistake").value.trim() || null,
    stop:      $("#dStop").value.trim() || null,
    source_name: $("#dSrc").value.trim() || null,
    source_url:  $("#dUrl").value.trim() || null,
    source_note: $("#dNote").value.trim() || null,
    reviewed_by: $("#dBy").value.trim() || null,
    reviewed_on: $("#dOn").value || null,
    status:    $("#dStatus").value,
    sort:      parseInt($("#dSort").value,10)||0,
    images:    adImages.map(im=>({path:im.path, alt:(im.alt||'').trim()})),
    updated_at:new Date().toISOString(),
  };
  const missingAlt=row.images.findIndex(im=>!im.alt);
  if(missingAlt>-1){
    $("#dErr").textContent='Image '+(missingAlt+1)+' needs a description — it is what a screen reader reads out.';
    return;
  }
  if(!row.title){ err.textContent='Give the drill a title.'; return; }
  if(!row.why){ err.textContent='Say why it matters — the parent sees this.'; return; }
  if(!row.how.length){ err.textContent='Add at least one step under "How to do it".'; return; }
  if(row.status==='published' && !row.source_name){
    err.textContent='A published drill needs a source. Add one, or set the status to Draft.'; return;
  }

  const label=btn.textContent; btn.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; btn.disabled=true;
  const q = id ? sb.from('drills').update(row).eq('id',id)
               : sb.from('drills').insert({ ...row, id:uuid() });
  const { error }=await q;
  if(error){
    console.error(error);
    // The CHECK constraint is the backstop if the form is ever bypassed.
    err.textContent = /drills_published_needs_source/.test(error.message||'')
      ? 'A published drill needs a source. Add one, or set the status to Draft.'
      : (error.message||'Could not save');
    btn.innerHTML=label; btn.disabled=false; return;
  }
  // Children's weeks are built from the cached copy, so refresh it before leaving.
  state.ref=null; try{ await loadRef(); }catch(e){ console.error(e); }
  toast(id?'Drill saved':'Drill created');
  openAdminDrills();
}

async function adminDeleteDrill(id){
  const d=adDrills.find(x=>x.id===id);
  if(!confirm('Delete "'+((d&&d.title)||'this drill')+'"? Children currently doing it will fall back to the built-in library.')) return;
  const { error }=await sb.from('drills').delete().eq('id',id);
  if(error){ console.error(error); toast(error.message||'Could not delete'); return; }
  state.ref=null; try{ await loadRef(); }catch(e){ console.error(e); }
  toast('Drill deleted');
  openAdminDrills();
}
