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
  return `<img class="${cls}" src="${esc(url)}" loading="lazy" alt="${esc(m.caption||'')}"/>`;
}

async function screenJourney(){
  const a=state.active;
  const [{data:sports},{data:games},{data:miles},{data:media}] = await Promise.all([
    sb.from('athlete_sports').select('*').eq('athlete_id',a.id),
    sb.from('games').select('*').eq('athlete_id',a.id).order('game_date',{ascending:false}),
    sb.from('milestones').select('*').eq('athlete_id',a.id).order('milestone_date',{ascending:false}),
    sb.from('media').select('*').eq('athlete_id',a.id).order('created_at',{ascending:false}),
  ]);
  const primary = sports?.find(s=>s.is_primary)||sports?.[0];
  const sportKey = primary?.sport_key||'general';
  state.activeSportKey = sportKey; setAppBg();
  const sportName = primary ? (state.ref?.sports.find(s=>s.key===sportKey)?.name || sportKey) : 'Athlete';

  // sign private media urls (batch)
  const urlMap={};
  const paths=(media||[]).map(m=>m.path);
  if(paths.length){
    const { data:signed } = await sb.storage.from('athlete-media').createSignedUrls(paths,21600); // 6h — survives a long Journey session
    (signed||[]).forEach(s=>{ if(s.signedUrl && !s.error) urlMap[s.path]=s.signedUrl; });
  }
  const mediaById={}; (media||[]).forEach(m=>mediaById[m.id]=m);
  const mediaByGame={}; (media||[]).forEach(m=>{ if(m.game_id){(mediaByGame[m.game_id]=mediaByGame[m.game_id]||[]).push(m);} });

  const rec={win:0,loss:0,tie:0}; (games||[]).forEach(g=>{const r=gameResult(g); if(rec[r]!=null)rec[r]++;});
  const total=(games||[]).length;
  const years=(games||[]).map(g=>g.game_date&&g.game_date.slice(0,4)).filter(Boolean);
  const since = years.length?Math.min(...years.map(Number)):null;

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
          <div class="meta">${esc(fmtDate(g.game_date))}${g.opponent?' · vs '+esc(g.opponent):''}${g.home_away?' · '+esc(g.home_away):''}${g.season?' · '+esc(g.season):''}</div>
        </div>
        <span class="result-badge r-${r}">${rlabel}</span>
      </div>
      ${statsEntries.length?`<div class="statchips">${statsEntries.map(([k,v])=>`<span class="statchip">${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>`:''}
      ${g.notes?`<p style="font-size:13px;color:var(--ink);margin:10px 0 0;line-height:1.5">${esc(g.notes)}</p>`:''}
      ${gm.length?`<div class="gmedia">${gm.map(m=>`<button class="thbtn" data-mid="${m.id}">${mediaThumbInner(m,urlMap[m.path],'gth')}</button>`).join('')}</div>`:''}
    </div>`;
  };

  $("#screen").innerHTML = H`
    ${topBar('Career diary')}
    <div class="app-pad" style="padding-top:6px">
      <div class="jhero" style="background:${sportGradient(sportKey)}">
        <div class="tex"></div>
        <div style="position:relative">
          <div class="k">${esc(a.first_name)}'s journey</div>
          <h2 style="font-size:22px;margin:6px 0 2px">${esc(sportName)} career</h2>
          <p style="font-size:13px;opacity:.9;margin:0">${total} game${total===1?'':'s'} logged${since?` · since ${since}`:''}</p>
        </div>
        <div class="rec">
          <div class="b"><b>${rec.win}</b><span>Wins</span></div>
          <div class="b"><b>${rec.loss}</b><span>Losses</span></div>
          <div class="b"><b>${rec.tie}</b><span>Ties</span></div>
          <div class="b"><b>${total}</b><span>Games</span></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:14px">
        <button class="btn sm" id="logGame">＋ Game</button>
        <button class="btn sm amber" id="addMile">＋ Milestone</button>
        <button class="btn sm ghost" id="addMedia">＋ Media</button>
      </div>

      <div class="sec-title">Game log</div>
      ${total?(games.map(gameCard).join('')):`<div class="card app-pad"><div class="empty">No games yet. Tap <b>＋ Game</b> after the next one to start ${esc(a.first_name)}'s record — scores, stats, and photos all in one place.</div></div>`}

      <div class="sec-title">Milestones</div>
      <div class="card app-pad">
        ${(miles&&miles.length)?`<div class="tl">${miles.map(m=>`<div class="it"><div class="dt">${esc(fmtDate(m.milestone_date))}</div><b>${esc(m.title)}</b>${m.note?`<p>${esc(m.note)}</p>`:''}</div>`).join('')}</div>`
          :`<div class="empty">First goal, first start, a new personal best — mark the moments worth remembering.</div>`}
      </div>

      <div class="sec-title">Gallery</div>
      ${(media&&media.length)?`<div class="gal">${media.map(m=>`<button class="galcell" data-mid="${m.id}">${mediaThumbInner(m,urlMap[m.path],'gth')}</button>`).join('')}</div>`
        :`<div class="card app-pad"><div class="empty">Photos and videos you add — from any game or practice — collect here.</div></div>`}

      <p class="muted-note" style="margin-top:18px">Your photos and videos are private to your household and the people you invite. Only you can share or delete them.</p>
    </div>`;
  bindTop();
  $("#logGame").onclick=()=>openLogGame();
  $("#addMile").onclick=()=>openAddMilestone();
  $("#addMedia").onclick=()=>openAddMedia(games||[]);
  $("#screen").querySelectorAll('[data-mid]').forEach(el=>{
    const m=mediaById[el.getAttribute('data-mid')]; if(m) el.onclick=()=>openMediaViewer(m,urlMap[m.path]);
  });
}

