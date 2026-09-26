// ===================================================================
//  JOURNEY — the athlete's lifelong diary (games, milestones, media)
// ===================================================================
const SPORT_EMOJI={football:'🏈',soccer:'⚽',basketball:'🏀',volleyball:'🏐',baseball:'⚾',softball:'🥎',
  track:'🏃',cheer:'📣',cheerleading:'📣',gymnastics:'🤸',dance:'🩰',tennis:'🎾',hockey:'🏒',
  swimming:'🏊',golf:'⛳',wrestling:'🤼',lacrosse:'🥍',general:'🏅'};
function sportEmojiFor(sportKey){ return SPORT_EMOJI[sportKey]||SPORT_EMOJI.general; }
// Per-sport accent gradient for headers — football keeps the brand green,
// every other sport gets its own tint. All chosen dark enough for white text.
const SPORT_COLOR={
  football:['#0E3B31','#17936F'], soccer:['#2f6db0','#1e4e86'], basketball:['#c65a1e','#9a4413'],
  baseball:['#26428f','#1a2e66'], softball:['#0f766e','#0b5651'], volleyball:['#5b46b3','#3f3088'],
  cheer:['#b23a76','#8a2a5a'], cheerleading:['#b23a76','#8a2a5a'], gymnastics:['#7c46c9','#5a30a0'],
  dance:['#c04d7a','#96375d'], track:['#c0442a','#93301c'], tennis:['#4d7c0f','#37600a'],
  hockey:['#33507f','#233a5e'], swimming:['#0e7d99','#0a5c70'], golf:['#2f7d3a','#215c2b'],
  wrestling:['#8a3a3a','#652929'], lacrosse:['#0f7d73','#0a5c55'], general:['#0E3B31','#17936F'] };
function sportColors(sportKey){ return SPORT_COLOR[sportKey]||SPORT_COLOR.general; }
function sportGradient(sportKey){ const c=sportColors(sportKey); return 'linear-gradient(135deg,'+c[0]+','+c[1]+' 78%)'; }
// A subtle, license-free per-sport watermark: the sport's emoji tiled at low
// opacity as an inline SVG data URI. Adapts to each child's sport automatically.
function sportPattern(emoji){
  // Double quotes inside the SVG get percent-encoded, so the returned value has
  // no literal quotes and is safe to drop into a double-quoted style attribute.
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112">'
    +'<text x="22" y="42" font-size="34" fill="#ffffff" fill-opacity="0.16" transform="rotate(-14 22 42)">'+emoji+'</text>'
    +'<text x="80" y="96" font-size="34" fill="#ffffff" fill-opacity="0.16" transform="rotate(-14 80 96)">'+emoji+'</text>'
    +'</svg>';
  return "url('data:image/svg+xml,"+encodeURIComponent(svg)+"')";
}
const MEDIA_MAX=100*1024*1024; // 100 MB per file

function gameResult(g){
  if(g.result && g.result!=='na') return g.result;
  if(typeof g.our_score==='number' && typeof g.their_score==='number')
    return g.our_score>g.their_score?'win':g.our_score<g.their_score?'loss':'tie';
  return 'na';
}
function fmtDate(d){ if(!d) return ''; const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function mediaThumbInner(m,url,cls){
  if(!url) return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:10px">…</div>`;
  if(m.kind==='video') return `<video class="${cls}" src="${esc(url)}#t=0.1" preload="metadata" muted playsinline></video><span class="play">▶</span>`;
  // An uncaptioned photo still needs a real accessible name — it's the primary
  // content of this screen, not decoration, so alt="" would wrongly hide it
  // from a screen reader entirely.
  return `<img class="${cls}" src="${esc(url)}" loading="lazy" alt="${esc(m.caption||'Journey photo'+(m.taken_on?' from '+fmtDate(m.taken_on):''))}"/>`;
}

// ===================================================================
//  JOURNEY — grouped by sport, then season
// ===================================================================
// Design handoff, app screens §4, as amended by CHANGES-2026-08-13: sharing is gone.
// There is no composer, no export card, no public URL — the only outward action is
// "Save to phone", which is a parent putting their own photo in their own camera roll.
//
// A kid who plays football in the fall and basketball in the winter gets two clean
// records, not one jumbled feed. Milestones sit inline with the games by date rather
// than in a separate timeline — same data, one chronological column.

// Which sport tab is showing. Null = the athlete's primary.
let JRN_SPORT = null;

function seasonOf(g){ return (g && g.season) ? g.season : 'Undated'; }
// season is free text, so the only sane default is whatever they typed last. Without
// this every game after the first starts blank and the grouping quietly falls apart.
function jrnLastSeason(){ return (state && state.jrnSeason) || ''; }

// Merge games and milestones into one date-ordered column. Two record types, one
// column, because that is how the year actually happened.
function jrnTimeline(games, miles){
  const rows=[
    ...(games||[]).map(g=>({ kind:'game', on:g.game_date, data:g })),
    ...(miles||[]).map(m=>({ kind:'milestone', on:m.milestone_date, data:m })),
  ];
  rows.sort((a,b)=> (b.on||'').localeCompare(a.on||'') );
  return rows;
}

async function screenJourney(){
  logUsageEvent('view_journey');
  const a=state.active;
  const weekStart=isoDay(mondayOfThisWeek()), weekEnd=dateForDayIndex(6);
  const [{data:sports},{data:games},{data:miles},{data:media},{data:sessions},{data:measures},{data:goals}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    sb.from('games').select('*').eq('athlete_id',a.id).order('game_date',{ascending:false}),
    sb.from('milestones').select('*').eq('athlete_id',a.id).order('milestone_date',{ascending:false}),
    sb.from('media').select('*').eq('athlete_id',a.id).order('created_at',{ascending:false}),
    sb.from('sessions').select('done_on,title').eq('athlete_id',a.id).gte('done_on',weekStart).lte('done_on',weekEnd),
    state.canEdit===false ? Promise.resolve({data:[]}) : sb.from('measurements').select('metric_key,value,unit,measured_on').eq('athlete_id',a.id).order('measured_on',{ascending:false}).limit(1),
    state.canEdit===false ? Promise.resolve({data:[]}) : sb.from('goals').select('label').eq('athlete_id',a.id).eq('status','active').order('created_at').limit(1),
  ]);
  const primary = sports?.find(s=>s.is_primary)||sports?.[0];
  state.athleteSports = sports || [];
  // loadRole() already resolves both direct athlete access and household membership.
  // Re-reading only athlete_access here used the retired `editor` role name and could
  // hide Journey controls from a valid co-parent.
  const canEdit = state.canEdit!==false;

  // Sport tabs. A game logged before games.sport_key existed has null — it belongs to
  // the primary sport, which is what the backfill assumed and what the UI must match.
  const played = (sports||[]).map(s=>s.sport_key);
  const sportKeyOf = g => g.sport_key || primary?.sport_key || 'general';
  const withGames = [...new Set((games||[]).map(sportKeyOf))];
  const tabs = [...new Set([...(primary?[primary.sport_key]:[]), ...played, ...withGames])].filter(Boolean);
  const activeSport = (JRN_SPORT && tabs.includes(JRN_SPORT)) ? JRN_SPORT : (tabs[0]||'general');
  state.activeSportKey = activeSport; setAppBg();

  const nameOf = k => state.ref?.sports.find(s=>s.key===k)?.name || k;
  const sportName = nameOf(activeSport);
  const emoji = SPORT_EMOJI[activeSport]||'🏅';

  const myGames = (games||[]).filter(g=>sportKeyOf(g)===activeSport);
  // Milestones aren't sport-tagged. Showing them under every tab would duplicate them,
  // so they ride with the sport that was primary when they were recorded — which we
  // can't know. They go under the FIRST tab only, and are labelled as the athlete's.
  const myMiles = (activeSport===tabs[0]) ? (miles||[]) : [];

  // sign private media urls (batch)
  const urlMap={};
  const paths=(media||[]).map(m=>m.path);
  if(paths.length){
    const { data:signed } = await sb.storage.from('athlete-media').createSignedUrls(paths,21600); // 6h — survives a long Journey session
    (signed||[]).forEach(s=>{ if(s.signedUrl && !s.error) urlMap[s.path]=s.signedUrl; });
  }
  const mediaById={}; (media||[]).forEach(m=>mediaById[m.id]=m);
  const mediaByGame={}; (media||[]).forEach(m=>{ if(m.game_id){(mediaByGame[m.game_id]=mediaByGame[m.game_id]||[]).push(m);} });
  state.jrnMedia = { byId:mediaById, urls:urlMap, byGame:mediaByGame };
  state.jrnCanEdit = canEdit;   // invited viewers can look, not take

  const rec={win:0,loss:0,tie:0}; myGames.forEach(g=>{const r=gameResult(g); if(rec[r]!=null)rec[r]++;});
  const total=myGames.length;
  const years=myGames.map(g=>g.game_date&&g.game_date.slice(0,4)).filter(Boolean);
  const since = years.length?Math.min(...years.map(Number)):null;
  const photoCount=(media||[]).length;
  const seasons=[...new Set(myGames.map(seasonOf))];
  state.jrnSeason = seasons.find(x=>x!=='Undated') || '';

  // ---- empty state: the one screen allowed to be sentimental ----
  if(!(games||[]).length && !(miles||[]).length){
    $("#screen").innerHTML = H`
      ${topBar('Journey')}
      <div class="app-pad" style="padding-top:6px">
        ${playbookPath('journey')}
        <button class="btn ghost" id="athleteStory">Hall of Fame, highlights &amp; résumé →</button>
        <div class="jrn-empty">
          <div class="k">${esc(a.first_name)}'s journey</div>
          <h2>Nothing here yet — and that's the point.</h2>
          <p>In ten years ${esc(a.first_name)} won't remember the score of a single game this season. You will. The photo from the sideline, what you wrote down after, the first time something clicked.</p>
          <div class="rows">
            <div><i>🏅</i><div><b>Games</b><span>Score, a stat or two, and how it went</span></div></div>
            <div><i>★</i><div><b>Milestones</b><span>Firsts, personal bests, the big ones</span></div></div>
            <div><i>📷</i><div><b>Photos</b><span>Private to your house, always</span></div></div>
          </div>
          ${canEdit?H`<button class="btn amber" id="logGame">Log ${esc(a.first_name)}'s first game</button>
          <p class="sub">Takes about a minute</p>`:'<p class="sub">Whoever owns this profile can start the record.</p>'}
        </div>
      </div>`;
    bindTop();
    bindPlaybookPath();
    $('#athleteStory').onclick=openAthleteStory;
    { const b=$("#logGame"); if(b) b.onclick=()=>openLogGame(); }
    return;
  }

  const gameCard=g=>{
    const r=gameResult(g);
    const rlabel={win:'Win',loss:'Loss',tie:'Tie',na:'Logged'}[r];
    const scoreStr=(typeof g.our_score==='number'&&typeof g.their_score==='number')?`${g.our_score}–${g.their_score}`:'';
    const statsEntries=g.stats&&typeof g.stats==='object'?Object.entries(g.stats):[];
    const gm=mediaByGame[g.id]||[];
    return H`<div class="gcard">
      <div class="gh">
        <div style="min-width:0">
          <div class="score">${scoreStr||'Game'}</div>
          <div class="meta">${esc(fmtDate(g.game_date))}${g.opponent?' · vs '+esc(g.opponent):''}${g.home_away?' · '+esc(g.home_away):''}</div>
        </div>
        <span class="result-badge r-${r}">${rlabel}</span>
      </div>
      ${statsEntries.length?`<div class="statchips">${statsEntries.map(([k,v])=>`<span class="statchip">${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>`:''}
      ${g.notes?`<p style="font-size:13px;color:var(--ink);margin:10px 0 0;line-height:1.5">${esc(g.notes)}</p>`:''}
      ${gm.length?`<div class="gmedia">${gm.map(m=>`<button class="thbtn" data-mid="${m.id}">${mediaThumbInner(m,urlMap[m.path],'gth')}</button>`).join('')}</div>`:''}
      ${canEdit?`<div class="gactions"><button class="btn sm ghost" data-editgame="${esc(g.id)}">Edit</button>
        <button class="btn sm ghost" data-addphoto="${esc(g.id)}">＋ Photos</button></div>`:''}
    </div>`;
  };

  const mileCard=m=>H`<div class="mcard">
    <div class="mi">★</div>
    <div><div class="k">${esc(fmtDate(m.milestone_date))} · Milestone</div>
      <b>${esc(m.title)}</b>${m.note?H`<p>${esc(m.note)}</p>`:''}</div>
  </div>`;

  $("#screen").innerHTML = H`
    ${topBar(`${total} game${total===1?'':'s'}${since?` · since ${since}`:''}`)}
    <div class="app-pad" style="padding-top:6px">

      ${playbookPath('journey')}
      <button class="btn ghost" id="athleteStory" style="margin-bottom:16px">Hall of Fame, highlights &amp; résumé →</button>

      <div class="journey-bridge">
        <div><span>Week</span><b>${(sessions||[]).length}</b><small>sessions done</small></div>
        ${canEdit?`<div><span>Growth</span><b>${(measures||[])[0]?esc(fmtMeasure((measures||[])[0].metric_key,(measures||[])[0].value,(measures||[])[0].unit)):'—'}</b><small>${(measures||[])[0]?esc(metricName((measures||[])[0].metric_key)):'no measurement yet'}</small></div>`:''}
        ${canEdit?`<div><span>Goal</span><b class="text-value">${(goals||[])[0]?esc((goals||[])[0].label):'Choose one'}</b><small>shapes the plan</small></div>`:''}
      </div>

      ${tabs.length>1?H`<div class="jrn-tabs" role="tablist">
        ${tabs.map(k=>H`<button role="tab" aria-selected="${k===activeSport?'true':'false'}"
          class="${k===activeSport?'on':''}" data-sport="${esc(k)}">${esc(nameOf(k))}</button>`).join('')}
      </div>`:''}

      <div class="jhero" style="background:${sportGradient(activeSport)}">
        <div class="tex"></div>
        <div style="position:relative">
          <div class="k">${esc(a.first_name)}'s ${esc(sportName)}</div>
          <h2 style="font-size:22px;margin:6px 0 2px">${total} game${total===1?'':'s'}${seasons.length?`. ${seasons.length} season${seasons.length===1?'':'s'}.`:''}</h2>
        </div>
        <div class="rec">
          <div class="b"><b>${rec.win}</b><span>Wins</span></div>
          <div class="b"><b>${rec.loss}</b><span>Losses</span></div>
          <div class="b"><b>${rec.tie}</b><span>Ties</span></div>
          <div class="b"><b>${photoCount}</b><span>Photos</span></div>
        </div>
      </div>

      ${canEdit?H`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px">
        <button class="btn sm" id="logGame">＋ Game</button>
        <button class="btn sm amber" id="addMile">＋ Milestone</button>
        <button class="btn sm ghost" id="addMedia">＋ Media</button>
      </div>`:''}

      ${seasons.length?seasons.map(sn=>{
        const inSeason=myGames.filter(g=>seasonOf(g)===sn);
        // Milestones fall into the season whose games bracket their date; anything
        // outside every season window lands in the last group rather than vanishing.
        const dates=inSeason.map(g=>g.game_date).filter(Boolean);
        const lo=dates.length?dates[dates.length-1]:null, hi=dates.length?dates[0]:null;
        const mine=myMiles.filter(m=>lo&&hi ? (m.milestone_date>=lo&&m.milestone_date<=hi)
                                           : sn===seasons[seasons.length-1]);
        const rows=jrnTimeline(inSeason, mine);
        // The season's record, inline in the header. A parent scanning a season wants
        // "5 – 2 – 1" before they want eight individual scores.
        const rec = inSeason.reduce((t,g)=>{ const r=gameResult(g);
          if(r==='win')t.w++; else if(r==='loss')t.l++; else if(r==='tie')t.t++; return t; },
          {w:0,l:0,t:0});
        const recLine = (rec.w||rec.l||rec.t) ? `${rec.w} – ${rec.l} – ${rec.t}` : '';
        return H`
        <div class="jrn-season">
          <div class="sec-title">${esc(sn)}</div>
          <span class="pill">${inSeason.length} game${inSeason.length===1?'':'s'}${recLine?' · '+recLine:''}</span>
        </div>
        <div class="jrn-grid">${rows.map(r=>r.kind==='game'?gameCard(r.data):mileCard(r.data)).join('')}</div>`;
      }).join('')
      :H`<div class="card app-pad" style="margin-top:16px"><div class="empty">No ${esc(sportName)} games logged yet${canEdit?' — tap <b>＋ Game</b> after the next one':''}.</div></div>`}

      ${(()=>{ const orphan=myMiles.filter(m=>!myGames.some(g=>g.game_date));
        return orphan.length&&!myGames.length ? orphan.map(mileCard).join('') : ''; })()}

      ${(media&&media.length)?H`<div class="sec-title">Gallery</div>
      <div class="gal">${media.map(m=>`<button class="galcell" data-mid="${m.id}">${mediaThumbInner(m,urlMap[m.path],'gth')}</button>`).join('')}</div>`:''}

      <p class="muted-note" style="margin-top:18px">Photos and videos stay private to your household and the people you invite. Nothing here is ever posted anywhere or given a public link.</p>
    </div>`;
  bindTop();
  bindPlaybookPath();
  $('#athleteStory').onclick=openAthleteStory;
  { const b=$("#logGame");  if(b) b.onclick=()=>openLogGame(); }
  { const b=$("#addMile");  if(b) b.onclick=()=>openAddMilestone(); }
  { const b=$("#addMedia"); if(b) b.onclick=()=>openAddMedia(games||[]); }
  $("#screen").querySelectorAll('[data-sport]').forEach(b=>b.onclick=()=>{ JRN_SPORT=b.dataset.sport; renderApp('journey'); });
  $("#screen").querySelectorAll('[data-editgame]').forEach(b=>{
    const g=(games||[]).find(x=>x.id===b.dataset.editgame); if(g) b.onclick=()=>openLogGame(g);
  });
  $("#screen").querySelectorAll('[data-addphoto]').forEach(b=>{
    const g=(games||[]).find(x=>x.id===b.dataset.addphoto); if(g) b.onclick=()=>openAddMedia(games||[], g.id);
  });
  $("#screen").querySelectorAll('[data-mid]').forEach(el=>{
    const id=el.getAttribute('data-mid');
    el.onclick=()=>openMediaViewer(id);
  });
}
