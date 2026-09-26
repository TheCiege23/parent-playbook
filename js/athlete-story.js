// Private presentation of the existing Journey records. No new coach grants.
async function storyLoad(athleteId){
  const results=await Promise.all([
    sb.from('athlete_sports').select('sport_key,positions,level,is_primary').eq('athlete_id',athleteId),
    sb.from('games').select('*').eq('athlete_id',athleteId).order('game_date',{ascending:false}),
    sb.from('milestones').select('*').eq('athlete_id',athleteId).order('milestone_date',{ascending:false}),
    sb.from('media').select('*').eq('athlete_id',athleteId).order('created_at',{ascending:false})
  ]);
  const failed=results.find(r=>r.error);if(failed)throw failed.error;
  return {sports:results[0].data||[],games:results[1].data||[],achievements:results[2].data||[],media:results[3].data||[]};
}
function storyResumeHTML(athlete,data){
  const name=k=>state.ref?.sports.find(s=>s.key===k)?.name||k;
  return `<article class="story-resume"><span class="story-eyebrow">ATHLETE RÉSUMÉ</span><h2>${esc(athlete.first_name)}</h2>
    <p>Family-recorded sports history · ${data.games.length} games logged</p>
    <h3>Sports &amp; positions</h3>${data.sports.length?'<ul>'+data.sports.map(s=>`<li>${esc(name(s.sport_key))}${s.positions?.length?' · '+esc(s.positions.join(', ')):''}${s.level?' · '+esc(s.level):''}</li>`).join('')+'</ul>':'<p>No sport recorded yet.</p>'}
    <h3>Achievements</h3>${data.achievements.length?'<ul>'+data.achievements.map(m=>`<li><strong>${esc(m.title)}</strong> · ${esc(fmtDate(m.milestone_date))}</li>`).join('')+'</ul>':'<p>Add a championship, award or milestone to start the record.</p>'}
    <h3>Seasons</h3>${data.games.length?'<ul>'+[...new Set(data.games.map(g=>g.season||'Undated'))].map(sn=>`<li>${esc(sn)} · ${data.games.filter(g=>(g.season||'Undated')===sn).length} games logged</li>`).join('')+'</ul>':'<p>No games logged yet.</p>'}
    <p class="muted-note">These records are entered by the family. They are not independently verified. Private notes, full birthdate, health measurements and media links are excluded from this résumé.</p></article>`;
}
async function openAthleteStory(){
  const athlete={...state.active},userId=state.user?.id;
  if(!athlete.id||!userId)return;
  const sameSession=()=>state.user?.id===userId&&state.active?.id===athlete.id;
  const bg=sheet('<h3>Athlete Story</h3><p role="status">Loading the story…</p>');
  const card=bg.querySelector('.sheet');card.removeAttribute('aria-labelledby');card.setAttribute('aria-label','Athlete Story');
  let data,urls={};
  try{
    data=await storyLoad(athlete.id);
    if(!sameSession()||!bg.isConnected)return bg.remove();
    if(data.media.length){
      const signed=await sb.storage.from('athlete-media').createSignedUrls(data.media.map(m=>m.path),300);
      if(signed.error)throw signed.error;
      (signed.data||[]).forEach(m=>{if(m.signedUrl&&!m.error)urls[m.path]=m.signedUrl;});
    }
  }catch(error){
    console.error(error);if(!sameSession()||!bg.isConnected)return bg.remove();
    card.innerHTML='<h3>Could not load the story</h3><p role="alert">Check your connection and try again.</p><button class="btn ghost" id="storyRetry">Retry</button>';
    bg.querySelector('#storyRetry').onclick=()=>{bg.remove();openAthleteStory();};return;
  }
  if(!sameSession()||!bg.isConnected)return bg.remove();
  const editable=state.canEdit!==false,videos=data.media.filter(m=>m.kind==='video');
  const photoMarkup=m=>urls[m.path]?`<img src="${esc(urls[m.path])}" alt="${esc(m.caption||'Story photo')}" loading="lazy">`:'<p>Photo unavailable. Reopen the story to retry.</p>';
  card.classList.add('story-sheet');
  card.innerHTML=`<header class="story-hero"><span class="story-eyebrow">ATHLETE STORY · PRIVATE</span><h2>${esc(athlete.first_name)}’s story</h2><p>The wins, the work, and the moments worth keeping.</p><div class="story-counts"><span><b>${data.achievements.length}</b> achievements</span><span><b>${videos.length}</b> video highlights</span><span><b>${data.games.length}</b> games</span></div></header>
    <nav class="story-links" aria-label="Story sections"><a href="#storyHall">Hall of Fame</a><a href="#storyHighlights">Highlights</a><a href="#storyResume">Résumé</a></nav>
    <section id="storyHall"><div class="story-heading"><h3>Hall of Fame</h3>${editable?'<button class="btn sm amber" id="storyAddAward">＋ Achievement</button>':''}</div><p class="muted-note">Championships, awards, personal bests and milestones.</p>
    <div class="story-awards">${data.achievements.map(m=>`<article><span aria-hidden="true">🏆</span><time>${esc(fmtDate(m.milestone_date))}</time><h4>${esc(m.title)}</h4>${m.note?`<p>${esc(m.note)}</p>`:''}</article>`).join('')||'<p class="empty">Your first achievement belongs here. Add a title such as “League champions — Fall 2026.”</p>'}</div>
    ${data.media.some(m=>m.kind==='photo')?'<h4>Story photos</h4><div class="story-photos">'+data.media.filter(m=>m.kind==='photo').map(photoMarkup).join('')+'</div>':''}</section>
    <section id="storyHighlights"><div class="story-heading"><h3>Highlights</h3>${editable?'<button class="btn sm ghost" id="storyAddHighlight">＋ Photo or video</button>':''}</div><p class="muted-note">Your saved Journey videos, newest first. Add a caption such as “60-yard touchdown” and attach the clip to its game.</p>
    <div class="story-clips">${videos.map(m=>`<article>${urls[m.path]?`<video controls playsinline preload="metadata" src="${esc(urls[m.path])}"></video>`:'<p>Video unavailable. Reopen the story to retry.</p>'}<h4>${esc(m.caption||'Untitled highlight')}</h4><p>${esc(fmtDate(m.taken_on||m.created_at?.split('T')[0]))}</p></article>`).join('')||'<p class="empty">Save a short game or practice clip to start your highlights.</p>'}</div><p class="muted-note">Video analysis and an edited reel are not available yet. Clips play individually.</p></section>
    <section id="storyResume">${storyResumeHTML(athlete,data)}${editable?'<button class="btn ghost" id="storyExport">Save printable résumé</button><p class="muted-note">Downloads a text-only HTML file. Open it and use Print → Save as PDF. Review the contents before sharing.</p>':''}<p id="storyMessage" role="status"></p></section>
    <button class="btn ghost" id="storyClose">Back to Journey</button>`;
  bg.querySelectorAll('.story-links a').forEach(link=>link.onclick=e=>{e.preventDefault();bg.querySelector(link.getAttribute('href')).scrollIntoView({behavior:'smooth',block:'start'});});
  bg.querySelector('#storyClose').onclick=()=>bg.remove();
  if(editable){
    bg.querySelector('#storyAddAward').onclick=()=>{if(!sameSession())return bg.remove();bg.remove();openAddMilestone();};
    bg.querySelector('#storyAddHighlight').onclick=()=>{if(!sameSession())return bg.remove();bg.remove();openAddMedia(data.games);};
    bg.querySelector('#storyExport').onclick=async()=>{
      const button=bg.querySelector('#storyExport'),message=bg.querySelector('#storyMessage');button.disabled=true;
      try{
        const fresh=await storyLoad(athlete.id);
        if(!sameSession()||!bg.isConnected||state.canEdit===false)return;
        const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Athlete résumé</title><style>body{font:16px/1.6 system-ui;max-width:800px;margin:40px auto;padding:24px;color:#153a31}h2{font-size:32px}h3{margin-top:30px}.muted-note{font-size:13px;color:#53645e}</style><body>'+storyResumeHTML(athlete,fresh)+'</body></html>';
        assessmentDownload(html,'text/html;charset=utf-8','athlete-resume.html');message.textContent='Printable résumé saved.';
      }catch(error){console.error(error);if(sameSession()&&bg.isConnected)message.textContent='Could not export. Check your connection and try again.';}
      finally{button.disabled=false;}
    };
  }
}
