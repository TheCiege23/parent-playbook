// ===================================================================
//  REDEEM INVITE — someone else's first impression
// ===================================================================
// Design handoff, platform §3. A grandmother taps a link in a text message. She has
// never heard of Parent Playbook, she is being asked to make an account, and the old
// screen was a 🤝 emoji and two buttons.
//
// Three rules this file is built on:
//   1. Say what the product IS before asking for an account. This is the only screen
//      inside the app where that is true.
//   2. State the LIMITS, not just the access. The one ✕ line does more for trust than
//      any amount of reassurance copy.
//   3. An expired link is not an error — it's a week-old text message.

// What each role can and can't do, in the recipient's words. The ✕ line is the point.
// Keys are access_role enum values. Getting this wrong still "worked" via the
// fallback, which is exactly why it went unnoticed.
const INVITE_ROLE = {
  family_view: {
    heading:'family view',
    can:['Games, photos and milestones','Weekly plans and progress'],
    cant:'No editing or account changes',
  },
  co_parent: {
    heading:'co-parent access',
    can:['Everything a parent sees','Log games, mark sessions done, add photos'],
    cant:'No billing or account changes',
  },
  coach: {
    heading:'Team Connect access',
    can:['Age, sport, position and current stats','Growth & scan measurements — jump, sprint, reaction, footwork','Can send training updates through the app'],
    cant:'No games, journey, photos, or the weekly plan',
  },
};
function inviteRole(r){ return INVITE_ROLE[r] || INVITE_ROLE.family_view; }

async function renderRedeem(token){
  document.body.classList.remove('auth'); setAppBg();
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Opening invite…</div></div>`;
  let data, error;
  try{ ({ data, error } = await sb.rpc('invite_preview',{ p_token:token })); }
  catch(e){ console.error(e); return renderInviteDead('We couldn\'t open this link',
    'Something went wrong on our end, not yours. Check your connection and try the link again.', token); }
  const info = Array.isArray(data)?data[0]:data;

  if(error||!info||info.status==='not_found'){
    return renderInviteDead('This link doesn\'t work',
      'It may have been mistyped, or the invite was deleted. Nothing is wrong on your end.', token);
  }
  if(info.status!=='pending'){
    // Same layout for all of them; only the headline and the first card change.
    const head={ revoked:'This invite was turned off',
                 accepted:'This link has already been used',
                 expired:'This link has expired',
                 locked:'Too many wrong codes' }[info.status] || 'This link can no longer be used';
    const why={ revoked:`${info.inviter} removed this invite. If that's a surprise, ask them for a new one.`,
                accepted:'Someone already accepted it. If that was you, just log in — the athlete is still there.',
                expired:'Invite links only last a week, so they can\'t be forwarded around forever. Nothing is wrong on your end.',
                locked:'This invite locked itself after five wrong codes, which is what stops someone guessing their way in. Ask for a new one — it takes about ten seconds and the new code arrives with it.'
              }[info.status] || 'Ask for a fresh link.';
    return renderInviteDead(head, why, token, info);
  }

  const role=inviteRole(info.invite_role);
  const familyWide=info.invite_scope==='family';
  const childCount=Math.max(1, Number(info.athlete_count)||1);
  const nm=esc(info.athlete_first_name||'their athlete');
  const who=esc(info.inviter||'A parent');
  const initials=(info.athlete_first_name||'?').trim()[0].toUpperCase();
  const detail=[info.athlete_age!=null?`${info.athlete_age}`:null, info.sport_name?esc(info.sport_name):null]
    .filter(Boolean).join(' · ');

  root.innerHTML = H`
  <div class="app-pad inv-wrap">
    <div class="inv-brand"><div class="lp-mark">P</div><b>Parent Playbook</b></div>

    <div class="inv-faces">
      <span class="f1">${esc(who.trim()[0].toUpperCase())}</span>
      <span class="f2">${familyWide&&childCount>1?esc(String(childCount)):esc(initials)}</span>
    </div>

    <h1>${familyWide?`${who} wants you to follow the family's sports journey.`:`${who} wants you to follow ${nm}'s season.`}</h1>
    <p class="inv-lead">${familyWide
      ? `This one invite includes ${childCount===1?'the child':`all ${childCount} children`} in the household — their games, milestones, photos and weekly plans. Nothing here is public.`
      : `Parent Playbook is where the family keeps ${nm}'s games, milestones and photos — and the weekly plan ${nm} is working on. Nothing here is public.`}</p>

    <div class="card app-pad inv-perms">
      <div class="sec-title" style="margin:0 0 10px">You'd get ${esc(role.heading)}</div>
      ${role.can.map(c=>H`<div class="row yes"><i>✓</i><span>${esc(c)}</span></div>`).join('')}
      <div class="row no"><i>✕</i><span>${esc(role.cant)}</span></div>
    </div>

    <div id="rbox" style="margin-top:18px"></div>
    <p class="muted-note">${who} can remove your access at any time.${!familyWide&&detail?` ${nm} is ${esc(detail)}.`:''}</p>
  </div>`;

  const box=$("#rbox");
  const needsCode=!!info.needs_code;
  if(state.user){
    // The code is asked for HERE, at the last step, and not before the account exists —
    // accept_invite is where it is checked and that call needs a signed-in user. Asking
    // earlier would mean holding it across an email confirmation round trip, which is
    // exactly where it would get lost.
    box.innerHTML=H`
      ${needsCode?H`<div class="sec-title" style="margin:0 0 2px">Your code</div>
        <p class="muted-note" style="margin:0 0 2px">Six digits, from ${esc(info.sent_hint||'the message they sent you')}.</p>
        ${codeRow('invCode')}
        <div class="err" id="codeErr" style="text-align:center"></div>`:''}
      <button class="btn amber" id="accept"${needsCode?' disabled':''}>${familyWide?'Accept family invite':`Accept and follow ${nm}`}</button>
      <p class="muted-note" style="margin-top:10px">You're signed in as ${esc(state.user.email)}. <a href="#" id="skip" style="color:var(--green-d)">Not now</a></p>`;

    const btn=$("#accept");
    let read=()=>null;
    if(needsCode){
      read=bindCodeRow('invCode', full=>{ btn.disabled=!full; });
      btn.disabled=true;
    }
    btn.onclick=()=>acceptAndEnter(token, needsCode?read():null, familyWide);
    $("#skip").onclick=e=>{ e.preventDefault(); history.replaceState({},'',location.pathname); afterLogin(); };
  }else{
    box.innerHTML=H`<button class="btn amber" id="su">Create a free account</button>
      <p class="muted-note" style="margin-top:10px">Already have one? <a href="#" id="li" style="color:var(--green-d)">Log in</a></p>
      ${needsCode?H`<p class="muted-note" style="margin-top:10px">Keep ${esc(info.sent_hint||'their message')} handy —
        you'll be asked for the six-digit code once you're in.</p>`:''}`;
    // Both paths keep ?invite= in the URL, so the token survives email confirmation and
    // acceptAndEnter picks it up on the way back in.
    $("#su").onclick=()=>renderAuth('signup');
    $("#li").onclick=e=>{ e.preventDefault(); renderAuth('login'); };
  }
}

// ---------------------------------------------------------------------------
//  SIX BOXES, NOT ONE FIELD
// ---------------------------------------------------------------------------
// The people typing this are the least technical users the product has — a grandparent
// reading digits off a text message on the same phone they are typing into. Separate
// cells give them somewhere to lose their place and find it again, and they make a
// missing digit visible before the button is pressed rather than after.
//
// Paste is handled explicitly because the realistic path is copying the whole code out
// of the message, and a paste into box one would otherwise put six digits in a
// maxlength-1 field and silently keep the first.
function codeRow(id){
  return H`<div class="code-row" id="${esc(id)}">${
    [0,1,2,3,4,5].map(i=>H`<input type="text" inputmode="numeric" autocomplete="${i===0?'one-time-code':'off'}"
      maxlength="1" aria-label="Digit ${i+1} of 6"/>`).join('')}</div>`;
}

// Returns a reader for the assembled code. `onChange(isComplete)` fires on every edit so
// the caller can enable its button without polling.
function bindCodeRow(id, onChange){
  const row=document.getElementById(id);
  if(!row) return ()=>null;
  const cells=Array.from(row.querySelectorAll('input'));
  const value=()=>cells.map(c=>c.value).join('');
  const fire=()=>{ cells.forEach(c=>c.classList.toggle('filled',!!c.value));
                   if(onChange) onChange(value().length===6); };

  // Fill from `start` with as many digits as were given, clear the rest, and land the caret
  // on the first empty box. Shared by paste and by multi-digit autofill.
  const spread=(digits,start=0)=>{
    const d=digits.replace(/\D/g,'').slice(0,6-start);
    cells.forEach((x,n)=>{ if(n>=start) x.value=d[n-start]||''; });
    cells[Math.min(start+d.length,5)].focus();
    fire();
  };
  cells.forEach((c,i)=>{
    // One digit per box is the design, but more than one can arrive in a single box: iOS
    // one-time-code autofill puts the WHOLE code into the focused field, and some Android
    // keyboards commit a composed string. Taking slice(0,1) there silently dropped five of
    // the six digits and left the parent retyping a code their phone had already offered.
    // Spread them instead, which is what the paste handler below already does.
    c.oninput=()=>{
      const digits=c.value.replace(/\D/g,'');
      if(digits.length>1){ spread(digits,i); return; }
      c.value=digits.slice(0,1);
      if(c.value && i<5) cells[i+1].focus();
      fire();
    };
    // Backspace on an empty box steps back rather than doing nothing, which is what
    // every OTP field people have used already does.
    c.onkeydown=e=>{
      if(e.key==='Backspace' && !c.value && i>0){ e.preventDefault(); cells[i-1].focus(); cells[i-1].value=''; fire(); }
      if(e.key==='ArrowLeft' && i>0){ e.preventDefault(); cells[i-1].focus(); }
      if(e.key==='ArrowRight' && i<5){ e.preventDefault(); cells[i+1].focus(); }
    };
    c.onpaste=e=>{
      const t=(e.clipboardData||window.clipboardData).getData('text')||'';
      const d=t.replace(/\D/g,'').slice(0,6);
      if(!d) return;
      e.preventDefault();
      spread(d);
    };
  });
  return value;
}

// Screen 4 — invalid, revoked, accepted and expired all land here. The tone is
// "here's how to get a new one", never "invalid token".
function renderInviteDead(title, why, token, info){
  const who=info&&info.inviter?esc(info.inviter):'whoever sent it';
  const msg=`Hi — could you send me a new Parent Playbook invite link? The last one stopped working.`;
  root.innerHTML = H`
  <div class="app-pad inv-wrap">
    <div class="inv-brand"><div class="lp-mark">P</div><b>Parent Playbook</b></div>
    <div class="inv-bang">!</div>
    <h1>${esc(title)}</h1>
    <p class="inv-lead">${esc(why)}</p>

    <div class="card app-pad" style="margin-top:20px">
      <div class="grow" style="border:none;padding:0"><div class="gi">🔁</div>
        <div class="gt"><b>Ask ${who} for a new one</b><span>It takes about ten seconds — Profile, then Invite.</span></div></div>
      <button class="btn ghost" id="invCopy" style="margin-top:12px">Copy a message to send</button>
    </div>

    <div class="card app-pad" style="margin-top:12px">
      <div class="grow" style="border:none;padding:0"><div class="gi">👤</div>
        <div class="gt"><b>Already have an account?</b><span>If an athlete was shared with you before, they're still there.</span></div></div>
      <button class="btn" id="invLogin" style="margin-top:12px">Log in</button>
    </div>
  </div>`;
  // "Text Chris" needs a phone number we don't have. Copy-to-clipboard instead of a
  // button that can't work.
  $("#invCopy").onclick=()=>{
    try{ navigator.clipboard.writeText(msg); toast('Message copied — paste it into a text'); }
    catch(e){ toast('Could not copy — the message is: '+msg); }
  };
  $("#invLogin").onclick=()=>renderAuth('login');
}

async function acceptAndEnter(token, code, familyWide=false){
  root.innerHTML = H`<div class="center-screen"><div class="spinner" role="status" aria-label="Loading" style="border-top-color:var(--green);border-color:var(--line)"></div><div>Accepting invite…</div></div>`;
  const { data:acceptedAthleteId, error } = await sb.rpc('accept_invite',{ p_token:token, p_code:code||null });
  if(error){
    const m=error.message||'';
    // A wrong code is a TYPO, not a dead invite. Sending someone to the "ask for a new
    // link" screen for a mistyped digit would be the most annoying possible reading of
    // it — and it would be wrong, because they have four more tries. Back to the same
    // screen with the mistake named, and the URL left intact so the token survives.
    if(/code_wrong/.test(m)){
      await renderRedeem(token);
      const err=$("#codeErr");
      if(err) err.textContent='That code is not right. Check the message and try again.';
      return;
    }
    history.replaceState({},'',location.pathname);
    return renderInviteDead('Could not accept this invite', friendlyAcceptErr(m), token);
  }
  logUsageEvent('invite_accepted');
  history.replaceState({},'',location.pathname);
  // Screen 2 — who this child is, what's next, and the install prompt. A grandparent
  // needs "Add to Home Screen" most and will find it least, so it goes here rather
  // than in a banner she'll dismiss.
  try{
    await Promise.all([ loadAthletes(), loadRef() ]);
    state.active = state.athletes.find(a=>a.id===acceptedAthleteId) || state.athletes[0] || null;
    if(!state.active) return afterLogin();
    renderInviteAccepted(familyWide);
  }catch(e){ console.error(e); try{ await afterLogin(); }catch(_){ bootError(); } }
}

async function renderInviteAccepted(familyWide=false){
  const a=state.active;
  const householdCount=(state.athletes||[]).filter(x=>x.family_id===a.family_id).length;
  const [{data:sports},{data:games}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    sb.from('games').select('*').eq('athlete_id',a.id).order('game_date',{ascending:false}).limit(1),
  ]);
  const p=(sports||[]).find(s=>s.is_primary)||(sports||[])[0];
  const sportName=state.ref?.sports.find(s=>s.key===p?.sport_key)?.name||'';
  const age=ageFrom(a.birthdate);
  const g=(games||[])[0];
  const nm=esc(a.first_name);
  const bits=[age!=null?`${nm} is ${age}`:null, p?.positions?.length?`plays ${esc(p.positions.join('/'))}`:(sportName?`plays ${esc(sportName)}`:null)].filter(Boolean);

  root.innerHTML = H`
  <div class="app-pad inv-wrap">
    <div class="inv-tick">✓</div>
    <h1>You're in.</h1>
    <p class="inv-lead">${familyWide&&householdCount>1
      ? `You can now follow all ${householdCount} children in this household.`
      : `You can follow ${nm}'s season whenever you like.${bits.length?' '+esc(bits.join(', '))+'.':''}`}</p>

    ${g?H`<div class="card app-pad" style="margin-top:20px">
      <div class="sec-title" style="margin:0 0 8px">Most recent</div>
      <div class="gh"><div style="min-width:0">
        <div class="score">${(typeof g.our_score==='number'&&typeof g.their_score==='number')?`${g.our_score}–${g.their_score}`:'Game'}</div>
        <div class="meta">${esc(fmtDate(g.game_date))}${g.opponent?' · vs '+esc(g.opponent):''}${g.home_away?' · '+esc(g.home_away):''}</div>
      </div><span class="result-badge r-${gameResult(g)}">${({win:'Win',loss:'Loss',tie:'Tie',na:'Logged'})[gameResult(g)]}</span></div>
    </div>`:''}

    <div class="card app-pad" style="margin-top:12px">
      <div class="grow" style="border:none;padding:0"><div class="gi">📲</div>
        <div class="gt"><b>Add it to your phone</b><span>Tap Share, then Add to Home Screen — it opens like an app, no store needed.</span></div></div>
    </div>

    <button class="btn amber" id="invGo" style="margin-top:20px">${familyWide&&householdCount>1?"See the family's week":`See ${nm}'s week`}</button>
  </div>`;
  $("#invGo").onclick=()=>renderApp('week');
}

function friendlyAcceptErr(m){
  if(/expired/i.test(m)) return 'Invite links only last a week. Ask for a new one — it takes about ten seconds.';
  if(/revoked/i.test(m)) return 'This invite was turned off before you got to it.';
  if(/locked/i.test(m)) return 'Five wrong codes locked this invite, which is what stops someone guessing their way in. Ask for a new one and a new code comes with it.';
  if(/code_wrong/i.test(m)) return 'That code is not right. Check the message it came in and try the link again.';
  if(/already/i.test(m)) return 'It was already used. If that was you, just log in — the athlete is still there.';
  if(/authenticated/i.test(m)) return 'Log in first, then open the link again.';
  return m || 'Something went wrong on our end, not yours.';
}
