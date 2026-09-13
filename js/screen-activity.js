// ===================================================================
//  ACTIVITY — a route, not a bottom sheet
// ===================================================================
// Design handoff, app screens §3. Why / how / what to say / stop-if is the best writing
// in the product and it was living in a sheet you had to scroll inside another scroll.
// It gets the whole screen and a sticky action.
//
// Three media states, and the layout has to look FINISHED in all three. Most activities
// will have no media for a long time; an empty frame reads as broken, so state 3 has no
// frame at all — the writing carries it.

// Where the activity screen came from, so Back returns there instead of always to Week.
let ACT_RETURN = 'week';

function openActivity(act, ctx){
  if(!act) return;
  const from=(location.hash||'').slice(1);
  ACT_RETURN = (APP_TABS.includes(from) && from!=='activity') ? from : 'week';
  state.activity = { act, ctx: ctx||null };
  renderApp('activity');
}

// Public bucket, keyed by activity title. Separate from athlete-media, which is private
// and signed — a drill clip is content, a photo of a child is not.
function drillMediaUrl(path){
  if(!path) return '';
  if(/^https?:\/\//.test(path)) return path;
  try{ return sb.storage.from('drill-images').getPublicUrl(path).data.publicUrl; }
  catch(e){ return ''; }
}

// State 1 — a loop. Silent, autoplaying, six seconds, endlessly repeating: a parent
// watches it twice and gets it. Always with a poster so the card looks right before it
// loads, and never with sound.
function actLoopHTML(m){
  const poster=m.poster?drillMediaUrl(m.poster):'';
  const sources=[m.mp4&&`<source src="${esc(drillMediaUrl(m.mp4))}" type="video/mp4">`,
                 m.webm&&`<source src="${esc(drillMediaUrl(m.webm))}" type="video/webm">`]
                 .filter(Boolean).join('');
  return H`<figure class="act-loop">
    <video id="actVid" autoplay loop muted playsinline preload="metadata"
           ${poster?`poster="${esc(poster)}"`:''} aria-label="${esc(m.alt||act_titleFallback())}">${sources}</video>
    <figcaption><span>${esc(m.alt||'Loop — the movement, from the front')}</span>
      <button class="slowbtn" id="actSlow" aria-pressed="false">Slow it down</button></figcaption>
  </figure>`;
}
function act_titleFallback(){ return (state.activity&&state.activity.act&&state.activity.act.title)||'Drill'; }

// State 2 — step stills, for held positions. Three maximum: start, finish, and the
// COMMON MISTAKE. Showing wrong beside right is what actually teaches.
function actStillsHTML(list){
  return H`<div class="act-stills">
    ${list.slice(0,3).map(im=>H`<figure class="${im.mistake?'is-mistake':''}">
      <img src="${esc(drillMediaUrl(im.path))}" alt="${esc(im.alt||im.label||'Step')}" loading="lazy" decoding="async"/>
      <figcaption><span class="lbl">${esc(im.label||(im.mistake?'common mistake':'step'))}</span>
        <b>${esc(im.alt||'')}</b>${im.note?H`<span>${esc(im.note)}</span>`:''}</figcaption>
    </figure>`).join('')}
  </div>`;
}

// Called by renderApp. Reads state.activity, which openActivity set.
async function screenActivity(){
  const { act, ctx } = state.activity||{};
  if(!act) return renderApp(ACT_RETURN);   // deep-linked #activity with nothing to show
  const canLog = !!(ctx&&ctx.date) && ctx.loggable!==false && ctx.date<=isoDay(new Date());
  const done = !!(ctx&&ctx.done);
  const dayLabel = (ctx&&ctx.date)
    ? new Date(ctx.date+'T00:00:00').toLocaleDateString(undefined,{weekday:'long'})
    : '';
  const kindLabel = (ctx&&ctx.kind) ? ctx.kind.charAt(0).toUpperCase()+ctx.kind.slice(1) : '';
  const eyebrow = [dayLabel,kindLabel].filter(Boolean).join(' · ');

  // Media, in priority order. `act.media` is optional on the activity object — absent
  // means state 3, and we never render an empty frame.
  const media = act.media || null;
  const loop  = media && (media.mp4||media.webm) ? media : null;
  const stills= !loop && media && Array.isArray(media.stills) && media.stills.length ? media.stills
              : (!loop && Array.isArray(act.images) && act.images.length ? act.images : null);

  const chips=[act.dur, act.where, act.gear].filter(Boolean);

  $("#screen").innerHTML = H`
    <div class="act-top">
      <button class="iconbtn" id="actBack" aria-label="Back">←</button>
      <span class="k-mono">${esc(eyebrow||'Activity')}</span>
    </div>
    <div class="app-pad" style="padding-top:2px;padding-bottom:96px">
      <h1 class="act-title">${esc(act.title)}</h1>
      ${chips.length?H`<div class="act-chips">${chips.map(c=>`<span>${esc(c)}</span>`).join('')}</div>`:''}

      ${loop?actLoopHTML(loop):''}

      ${act.why?H`<div class="act-sec"><div class="sec-title">Why it matters</div>
        <p>${esc(act.why)}</p></div>`:''}

      ${stills?H`<div class="act-sec"><div class="sec-title">What good looks like</div>
        ${actStillsHTML(stills)}</div>`:''}

      ${act.how&&act.how.length?H`<div class="act-sec"><div class="sec-title">How to do it</div>
        <ol class="act-steps">${act.how.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>`:''}

      ${act.say?H`<div class="teach" style="margin-top:18px"><div class="ic">🗣️</div><div>
        <h4>What to say</h4><p>${esc(act.say)}</p></div></div>`:''}

      ${act.mistake?H`<div class="act-sec"><div class="sec-title">Common mistake</div>
        <p>${esc(act.mistake)}</p></div>`:''}

      ${act.stop?H`<div class="act-stop"><b>Stop if</b> ${esc(act.stop)}</div>`:''}

      ${coachCornerHTML()}

      ${(ctx&&ctx.teamSession)?H`<button class="btn ghost" id="actCancel" style="margin-top:16px">${ctx.cancelled?'It happened after all':'Mark cancelled (rain, called off)'}</button>`:''}
      ${(ctx&&ctx.cancelled&&!ctx.teamSession)?H`<button class="btn ghost" id="actUncancel" style="margin-top:12px">Put the team session back</button>`:''}
      ${(ctx&&ctx.changeOptions&&state.canEdit!==false)?H`<button class="btn ghost" id="actChange" style="margin-top:16px">Change this day</button>`:''}
      ${(ctx&&ctx.changedHere&&state.canEdit!==false)?H`<button class="btn ghost" id="actUndoChange" style="margin-top:12px">Undo this week's change</button>`:''}

      ${(!loop&&!stills)?H`<div class="act-ask">
        <b>Got a clip of this drill?</b>
        <span>A six-second video of a real kid doing it beats any description. We review everything before it goes near the app.</span>
        <a href="mailto:support@playbookbp.com?subject=${encodeURIComponent('Drill clip: '+act.title)}">Send it in</a>
      </div>`:''}

      ${sourceHTML(act)}
    </div>
    ${canLog?H`<div class="act-foot">
      <button class="btn ${done?'ghost':'amber'}" id="actDone">${done?'✓ Done — tap to undo':'Mark done'}</button>
    </div>`:''}`;

  $("#actBack").onclick=()=>{ state.activity=null; renderApp(ACT_RETURN); };
  { const b=$("#actDone");
    if(b) b.onclick=()=>done?undoSessionDone(ctx,b):markSessionDone({...ctx,title:act.title},b); }
  { const c=$("#actCancel"); if(c) c.onclick=()=>markCancelled(ctx,c,!ctx.cancelled); }
  { const u=$("#actUncancel"); if(u) u.onclick=()=>markCancelled(ctx,u,false); }
  { const c=$("#actChange"); if(c) c.onclick=()=>openWeekChange(ctx); }
  { const u=$("#actUndoChange"); if(u) u.onclick=()=>undoWeekChange(ctx,u); }
  // "Slow it down" — the single most useful control on a movement clip, and the reason
  // a parent can copy the shape rather than just watch it.
  { const s=$("#actSlow"), v=$("#actVid");
    if(s&&v) s.onclick=()=>{
      const slow=v.playbackRate!==0.5;
      v.playbackRate=slow?0.5:1;
      s.setAttribute('aria-pressed',String(slow));
      s.classList.toggle('on',slow);
      s.textContent=slow?'Normal speed':'Slow it down';
    }; }
}
