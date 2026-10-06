function storyPanel(title){const bg=sheet('<h3>'+esc(title)+'</h3><p role="status">Loading…</p>'),card=bg.querySelector('.sheet');card.classList.add('story-tools');card.removeAttribute('aria-labelledby');card.setAttribute('aria-label',title);return {bg,card};}
function storyDismiss(bg,card,label='Close'){
  card.insertAdjacentHTML('beforeend','<div class="story-tools-footer"><button class="btn ghost" data-story-close>'+esc(label)+'</button></div>');
  card.querySelector('[data-story-close]').onclick=()=>bg.remove();
}
async function storyMutation(fn,button,{current,success,failure}){
  const previous=button.type==='checkbox'?!button.checked:undefined;button.disabled=true;
  try{if(!current())return;const result=await fn();if(result.error)throw result.error;if(current())success();}
  catch(error){if(previous!==undefined)button.checked=previous;if(current())failure(error);}
  finally{button.disabled=false;}
}
async function storyReviewRequest(body){
  const response=await sb.functions.invoke('story-video-review',{body});let details=response.data;
  if(response.error?.context?.json){try{details=await response.error.context.json();}catch{}}
  if(response.error||details?.error)throw Error(typeof details?.error==='string'?details.error:'Review unavailable. Try again later.');
  if(!details?.result)throw Error('The review did not return a coaching draft. Try again later.');return details;
}
async function storySigned(media){
  const groups={};for(const m of media)(groups[m.storyBucket||'athlete-media']||=[]).push(m);
  const urls={};for(const [bucket,items]of Object.entries(groups)){
    const r=await sb.storage.from(bucket).createSignedUrls(items.map(m=>m.path),300);if(r.error)throw r.error;
    for(const file of r.data||[])if(file.signedUrl&&!file.error)urls[bucket+':'+file.path]=file.signedUrl;
  }return urls;
}
async function refreshStoryReviewAlert(){
  const target=document.getElementById('storyReviewAlert'),athleteId=state.active?.id,userId=state.user?.id;
  if(!target||!athleteId||!userId||state.canEdit===false||state.role==='coach')return;
  const current=()=>target.isConnected&&state.active?.id===athleteId&&state.user?.id===userId&&state.canEdit!==false&&state.role!=='coach';
  try{
    const result=await sb.from('story_contributions').select('id',{count:'exact',head:true}).eq('athlete_id',athleteId).eq('status','pending');
    if(result.error)throw result.error;if(!current())return;
    const count=result.count||0;target.hidden=!count;
    target.innerHTML=count?`<div class="app-pad" style="padding-top:0;padding-bottom:10px"><button class="btn ghost" data-story-review-alert>${count===1?'1 Story contribution needs':count+' Story contributions need'} your approval</button></div>`:'';
  }catch(error){
    if(!current())return;
    target.hidden=false;target.innerHTML='<div class="app-pad" style="padding-top:0;padding-bottom:10px"><button class="btn ghost" data-story-review-alert>Check Story approvals</button><p class="muted-note">The approval count could not load.</p></div>';
  }
  if(!current())return;
  const button=target.querySelector('[data-story-review-alert]');if(button)button.onclick=()=>{if(current())openStoryCollaboration();};
}

async function openStoryCollaboration(){
  const athleteId=state.active.id,userId=state.user.id,parent=state.canEdit!==false&&state.role!=='coach';
  const {bg,card}=storyPanel(parent?'Coach story contributions':'Shared highlights & contributions');
  const current=()=>bg.isConnected&&state.active?.id===athleteId&&state.user?.id===userId;
  try{
    const [grants,media,submissions,access]=await Promise.all([
      sb.from('story_coach_grants').select('*').eq('athlete_id',athleteId),
      sb.from('media').select('*').eq('athlete_id',athleteId),
      sb.from('story_contributions').select('*').eq('athlete_id',athleteId).order('created_at',{ascending:false}),
      parent?sb.from('athlete_access').select('guardian_id').eq('athlete_id',athleteId).eq('role','coach').is('revoked_at',null):Promise.resolve({data:[]})
    ]);for(const r of [grants,media,submissions,access])if(r.error)throw r.error;if(!current())return bg.remove();
    const coaches=access.data||[];let names={};
    if(coaches.length){const r=await sb.from('guardians').select('id,display_name').in('id',coaches.map(c=>c.guardian_id));if(r.error)throw r.error;for(const g of r.data||[])names[g.id]=g.display_name||'Coach';}
    const shared=parent&&media.data?.length?await sb.from('story_shared_media').select('*').in('media_id',media.data.map(m=>m.id)): {data:[]};if(shared.error)throw shared.error;
    const files=(submissions.data||[]).filter(c=>c.storage_path).map(c=>({path:c.storage_path,storyBucket:'story-contributions'}));
    const urls=await storySigned([...(media.data||[]),...files]);if(!current())return bg.remove();
    const fileHTML=(kind,path,bucket)=>!urls[bucket+':'+path]?'<p>File unavailable.</p>':kind==='video'?`<video controls playsinline preload="metadata" style="width:100%" src="${esc(urls[bucket+':'+path])}"></video>`:`<img style="max-width:100%" alt="Story contribution" src="${esc(urls[bucket+':'+path])}">`;
    card.innerHTML=`<h3>${parent?'Coach story contributions':'Shared highlights & contributions'}</h3><p>Coaches only see the family highlights selected below. Every contribution needs parent approval before it enters the story.</p>
      ${parent?coaches.map(c=>{const id=c.guardian_id,enabled=(grants.data||[]).some(g=>g.coach_id===id&&g.enabled);return `<section class="card app-pad" style="margin:12px 0"><label><input type="checkbox" data-grant="${esc(id)}" ${enabled?'checked':''}> Allow ${esc(names[id]||'Coach')} to contribute</label>${enabled?(media.data||[]).map(m=>`<label style="display:block;margin:12px 0"><input type="checkbox" data-share="${esc(m.id)}" data-coach="${esc(id)}" ${(shared.data||[]).some(s=>s.media_id===m.id&&s.coach_id===id)?'checked':''}> Share ${esc(m.caption||m.kind)}</label>`).join(''):''}</section>`;}).join('')||'<p>No connected coaches. Invite a coach through Profile first.</p>':`<h4>Selected family highlights</h4>${(media.data||[]).map(m=>`<article class="card app-pad">${fileHTML(m.kind,m.path,'athlete-media')}<h4>${esc(m.caption||'Shared highlight')}</h4></article>`).join('')||'<p>No highlights have been shared with you.</p>'}`}
      <h4>Contributions</h4>${(submissions.data||[]).map(c=>`<article class="card app-pad" style="margin:12px 0"><p>${esc(c.status)} · ${c.author_id===userId?'You':'Contributor'}</p><h4>${esc(c.title)}</h4><p>${esc(c.note||'')}</p>${c.storage_path?fileHTML(c.kind,c.storage_path,'story-contributions'):''}${parent&&c.status==='pending'?`<button class="btn sm amber" data-review="${esc(c.id)}" data-decision="approved">Approve</button> <button class="btn sm ghost" data-review="${esc(c.id)}" data-decision="rejected">Reject</button>`:''}</article>`).join('')||'<p>No contributions yet.</p>'}
      ${parent||(grants.data||[]).some(g=>g.coach_id===userId&&g.enabled)?'<button class="btn amber" id="storySubmit">Submit a contribution</button>':'<p>Ask the parent to enable Story contributions.</p>'}<p id="collabMessage" role="status"></p><button class="btn ghost" id="collabClose">Close</button>`;
    const refresh=()=>{bg.remove();refreshStoryReviewAlert();openStoryCollaboration();};
    const write=(fn,button)=>storyMutation(fn,button,{current,success:refresh,failure:()=>{card.querySelector('#collabMessage').textContent='Could not save. Your change was not applied. Check your connection and retry.';}});
    card.querySelectorAll('[data-grant]').forEach(b=>b.onchange=()=>write(()=>sb.from('story_coach_grants').upsert({athlete_id:athleteId,coach_id:b.dataset.grant,enabled:b.checked}),b));
    card.querySelectorAll('[data-share]').forEach(b=>b.onchange=()=>write(()=>b.checked?sb.from('story_shared_media').insert({media_id:b.dataset.share,coach_id:b.dataset.coach}):sb.from('story_shared_media').delete().eq('media_id',b.dataset.share).eq('coach_id',b.dataset.coach),b));
    card.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>write(()=>sb.rpc('review_story_contribution',{contribution_id:b.dataset.review,decision:b.dataset.decision}),b));
    const submit=card.querySelector('#storySubmit');if(submit)submit.onclick=()=>{bg.remove();openStoryContribution(athleteId);};card.querySelector('#collabClose').onclick=()=>bg.remove();
  }catch(e){console.error(e);if(current()){card.innerHTML='<h3>Could not load contributions</h3><p role="alert">Check your connection and access, then retry.</p>';storyDismiss(bg,card);}}
}
function openStoryContribution(athleteId){
  const userId=state.user?.id;
  const {bg,card}=storyPanel('Submit a story contribution');
  card.innerHTML='<h3>Submit a story contribution</h3><p>The parent reviews this before it enters the story.</p><label for="scTitle">Title</label><input id="scTitle" maxlength="160" placeholder="60-yard touchdown"><label for="scNote">Note</label><textarea id="scNote" maxlength="4000"></textarea><label for="scFile">Photo or video (optional)</label><input id="scFile" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"><p>Up to 100 MB. Use a short clip.</p><p id="scError" role="alert"></p><button class="btn amber" id="scSave">Submit for approval</button>';
  storyDismiss(bg,card,'Cancel');
  const current=()=>bg.isConnected&&state.active?.id===athleteId&&state.user?.id===userId;
  card.querySelector('#scSave').onclick=async()=>{
    const button=card.querySelector('#scSave'),err=card.querySelector('#scError'),title=card.querySelector('#scTitle').value.trim(),file=card.querySelector('#scFile').files[0];
    if(!title){err.textContent='Add a title.';return;}if(file&&file.size>MEDIA_MAX){err.textContent='Trim the file to 100 MB or less.';return;}
    button.disabled=true;let row;
    try{
      if(!current())return;const id=uuid(),kind=file?(file.type.startsWith('video/')?'video':'photo'):'note';
      const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};
      if(file&&!extensions[file.type])throw Error('Use a supported photo or video format.');
      row={id,athlete_id:athleteId,author_id:userId,title,note:card.querySelector('#scNote').value.trim()||null,kind,status:'pending',storage_path:file?athleteId+'/'+id+'.'+extensions[file.type]:null};
      const created=await sb.from('story_contributions').insert(row);if(created.error)throw created.error;
      if(!current())return;
      if(file){const upload=await sb.storage.from('story-contributions').upload(row.storage_path,file,{contentType:file.type,upsert:false});if(upload.error){await sb.from('story_contributions').delete().eq('id',id);throw upload.error;}}
      if(!current())return;bg.remove();toast('Submitted for parent approval');openStoryCollaboration();
    }catch(e){console.error(e);if(current())err.textContent=e.message||'Could not submit. Try again.';}finally{button.disabled=false;}
  };
}
function validateReelClips(clips){
  if(!Array.isArray(clips)||!clips.length||clips.length>12)throw Error('Choose between 1 and 12 clips.');let duration=0;
  for(const c of clips){if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start)throw Error('Each clip needs a valid start and end time.');duration+=c.end-c.start;}
  const orders=clips.filter(c=>c.order!==undefined).map(c=>c.order);if(orders.some(o=>!Number.isInteger(o)||o<1)||new Set(orders).size!==orders.length)throw Error('Give each included clip a different positive order number.');
  if(duration>180)throw Error('Keep the reel under three minutes.');return duration;
}
function storyVideo(url){if(!url)return Promise.reject(Error('This video is unavailable. Reopen the story and try again.'));return new Promise((resolve,reject)=>{const v=document.createElement('video');v.crossOrigin='anonymous';v.playsInline=true;v.preload='auto';const timer=setTimeout(()=>{v.removeAttribute('src');v.load();reject(Error('Video load timed out.'));},15000);v.onloadedmetadata=()=>{clearTimeout(timer);resolve(v);};v.onerror=()=>{clearTimeout(timer);reject(Error('This video could not be loaded or its codec is unsupported.'));};v.src=url;});}
function storySeek(video,at){return new Promise((resolve,reject)=>{
  if(Math.abs(video.currentTime-at)<.001&&video.readyState>=2)return resolve();
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);video.removeEventListener('error',failed);};
  const done=()=>{cleanup();Math.abs(video.currentTime-at)>.15?reject(Error('This video could not reach the selected trim time. Try another clip.')):resolve();},failed=()=>{cleanup();reject(Error('Could not seek video.'));};
  const timer=setTimeout(()=>{cleanup();reject(Error('Video seek timed out.'));},15000);
  video.addEventListener('seeked',done,{once:true});video.addEventListener('error',failed,{once:true});try{video.currentTime=at;}catch(error){cleanup();reject(error);}
});}
function storyWaitForClip(video,end,duration,draw,current){return new Promise((resolve,reject)=>{
  let frame,finished=false;
  const finish=error=>{if(finished)return;finished=true;clearTimeout(deadline);clearInterval(watch);cancelAnimationFrame(frame);video.pause();error?reject(error):resolve();};
  const check=()=>{if(!current())finish(Error('Rendering cancelled.'));else if(document.hidden)finish(Error('Rendering stopped. Keep this tab visible and try again.'));else if(video.error)finish(Error('Video playback failed.'));else if(video.currentTime>=end||video.ended)finish();};
  const deadline=setTimeout(()=>finish(Error('Playback stalled. Try a shorter clip.')),(duration+15)*1000);
  const watch=setInterval(check,250);
  function render(){check();if(finished)return;try{draw();}catch(error){finish(error);return;}frame=requestAnimationFrame(render);}render();
});}
async function openStoryReel(media){
  const videos=media.filter(m=>m.kind==='video'),{bg,card}=storyPanel('Edit a highlight reel');
  if(!videos.length){card.innerHTML='<h3>Edit a highlight reel</h3><p>Add a Journey video first.</p>';storyDismiss(bg,card);return;}
  card.innerHTML='<h3>Edit a highlight reel</h3><p>Choose clips, trim their start/end in seconds, and set their order. Rendering happens on this device in real time. Keep this window open.</p>'+videos.map((m,i)=>`<fieldset class="card app-pad"><legend>${esc(m.caption||'Clip '+(i+1))}</legend><label><input type="checkbox" data-reel="${i}"> Include</label><label>Order<input type="number" data-order="${i}" value="${i+1}" min="1" max="${videos.length}"></label><label>Start (seconds)<input type="number" data-start="${i}" value="0" min="0" step="0.1"></label><label>End (seconds)<input type="number" data-end="${i}" min="0" step="0.1" placeholder="e.g. 15"></label></fieldset>`).join('')+'<label><input type="checkbox" id="reelAudio" checked> Include original audio</label><button class="btn amber" id="reelRender">Render & download reel</button><p id="reelStatus" role="status"></p>';
  storyDismiss(bg,card,'Close / cancel rendering');
  card.querySelector('#reelRender').onclick=async()=>{
    const button=card.querySelector('#reelRender'),status=card.querySelector('#reelStatus');let recorder,stream,audio,active,stopped;const loaded=[];
    button.disabled=true;const athleteId=state.active?.id,userId=state.user?.id,includeAudio=card.querySelector('#reelAudio').checked;const current=()=>bg.isConnected&&state.active?.id===athleteId&&state.user?.id===userId;const controls=[...card.querySelectorAll('input')];controls.forEach(input=>input.disabled=true);
    try{
      const clips=[...card.querySelectorAll('[data-reel]')].filter(c=>c.checked).map(c=>{const i=c.dataset.reel;return {media:videos[i],start:Number(card.querySelector('[data-start="'+i+'"]').value),end:Number(card.querySelector('[data-end="'+i+'"]').value),order:Number(card.querySelector('[data-order="'+i+'"]').value)};}).sort((a,b)=>a.order-b.order);
      validateReelClips(clips);if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream)throw Error('Use a browser with video recording support.');
      const urls=await storySigned(clips.map(c=>c.media));if(!current())throw Error('Rendering cancelled.');
      for(const c of clips){c.video=await storyVideo(urls[(c.media.storyBucket||'athlete-media')+':'+c.media.path]);loaded.push(c.video);if(!current())throw Error('Rendering cancelled.');if(!Number.isFinite(c.video.duration)||c.end>c.video.duration)throw Error('A trim extends beyond its clip.');}
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const paint=canvas.getContext('2d');stream=canvas.captureStream(30);
      if(includeAudio){audio=new AudioContext();await audio.resume();const destination=audio.createMediaStreamDestination();for(const c of clips)audio.createMediaElementSource(c.video).connect(destination);destination.stream.getAudioTracks().forEach(t=>stream.addTrack(t));}
      else clips.forEach(c=>c.video.muted=true);
      const mime=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw Error('No supported recording format.');
      const chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>reject(Error('Reel recording failed.'));});stopped.catch(()=>{});
      for(const [index,c]of clips.entries()){
        active=c.video;await storySeek(active,c.start);
        if(!current())throw Error('Rendering cancelled.');
        const draw=()=>{paint.fillStyle='#10271f';paint.fillRect(0,0,1280,720);const scale=Math.min(1280/active.videoWidth,720/active.videoHeight),w=active.videoWidth*scale,h=active.videoHeight*scale;paint.drawImage(active,(1280-w)/2,(720-h)/2,w,h);paint.fillStyle='rgba(0,0,0,.65)';paint.fillRect(0,650,1280,70);paint.fillStyle='#fff';paint.font='24px sans-serif';paint.fillText((c.media.caption||'Highlight').slice(0,75),24,695);};
        draw();if(recorder.state==='inactive')recorder.start(1000);else if(recorder.state==='paused')recorder.resume();
        status.textContent='Rendering clip '+(index+1)+' of '+clips.length+'…';await active.play();
        await storyWaitForClip(active,c.end,c.end-c.start,draw,current);if(recorder.state==='recording')recorder.pause();
      }
      recorder.stop();await stopped;if(!current())throw Error('Rendering cancelled.');const blob=new Blob(chunks,{type:mime});if(!blob.size)throw Error('No video was recorded.');
      const reelName='highlight-reel.'+(mime.includes('mp4')?'mp4':'webm');if(typeof saveFile==='function')await saveFile(blob,reelName);else{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=reelName;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}status.textContent='Reel saved. Review it before sharing.';
    }catch(e){console.error(e);status.textContent=e.message||'Could not render.';}
    finally{active?.pause();if(recorder&&recorder.state!=='inactive'){recorder.stop();try{await stopped;}catch{}}stream?.getTracks().forEach(t=>t.stop());if(audio)await audio.close();for(const video of loaded){video.pause();video.removeAttribute('src');video.load();}controls.forEach(input=>input.disabled=false);button.disabled=false;}
  };
}
async function sampleStoryFrames(url){
  const video=await storyVideo(url),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');
  const frames=[];
  try{if(!Number.isFinite(video.duration)||video.duration<1||video.duration>120)throw Error('Use a clip between 1 and 120 seconds.');for(let i=0;i<12;i++){const at=video.duration*(i+.5)/12;await storySeek(video,at);context.fillStyle='#000';context.fillRect(0,0,640,360);const scale=Math.min(640/video.videoWidth,360/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;context.drawImage(video,(640-w)/2,(360-h)/2,w,h);frames.push({at,image:canvas.toDataURL('image/jpeg',.65)});}return frames;}
  finally{video.pause();video.removeAttribute('src');video.load();}
}
function openStoryAnalysis(media){
  const videos=media.filter(m=>m.kind==='video'&&!m.storyBucket),{bg,card}=storyPanel('AI coaching review');
  card.innerHTML='<h3>AI coaching review</h3><p>OpenAI receives up to 12 still frames, approximate timestamps, the jersey/team description and your question. No audio or full video is sent. Provider retention rules apply; turning off response storage does not guarantee zero retention.</p><p>This produces a draft for a coach to review. It cannot establish exact speed, yardage, biomechanics or injury risk from game footage.</p><label for="reviewClip">Family video</label><select id="reviewClip">'+videos.map(m=>`<option value="${esc(m.id)}">${esc(m.caption||'Untitled video')}</option>`).join('')+'</select><label for="reviewSubject">Which athlete? Jersey number and team color</label><input id="reviewSubject" maxlength="300" placeholder="Number 12, blue jersey, carrying the ball"><label for="reviewQuestion">Coaching question</label><textarea id="reviewQuestion" maxlength="600" placeholder="What is visible about ball security and cutting decisions?"></textarea><label><input type="checkbox" id="reviewConsent"> I approve sending these sampled frames and descriptions to OpenAI for this review.</label><button class="btn amber" id="reviewGo" '+(videos.length?'':'disabled')+'>Analyze selected clip</button><p id="reviewStatus" role="status"></p><div id="reviewResult"></div>';
  storyDismiss(bg,card);
  card.querySelector('#reviewGo').onclick=async()=>{
    const button=card.querySelector('#reviewGo'),status=card.querySelector('#reviewStatus');if(!card.querySelector('#reviewConsent').checked){status.textContent='Review the processing disclosure and opt in first.';return;}
    const subject=card.querySelector('#reviewSubject').value.trim();if(!subject){status.textContent='Identify the athlete first.';return;}const athleteId=state.active.id,userId=state.user.id;button.disabled=true;
    try{card.querySelector('#reviewResult').innerHTML='';const m=videos.find(v=>v.id===card.querySelector('#reviewClip').value);const urls=await storySigned([m]);status.textContent='Sampling video frames…';const frames=await sampleStoryFrames(urls['athlete-media:'+m.path]);
      if(!bg.isConnected||state.active?.id!==athleteId||state.user?.id!==userId)throw Error('Access changed.');status.textContent='Preparing an unreviewed coaching draft…';
      const review=await storyReviewRequest({media_id:m.id,consent:'openai-frames-v1',subject,question:card.querySelector('#reviewQuestion').value.trim(),frames});
      if(!bg.isConnected||state.active?.id!==athleteId||state.user?.id!==userId)return;const result=review.result;
      card.querySelector('#reviewResult').innerHTML='<h4>AI draft · not coach reviewed</h4><p>'+esc(result.summary)+'</p><p>Visibility: '+esc(result.visibility)+'</p>'+result.observations.map(o=>`<article class="card app-pad"><h4>${Number(o.at).toFixed(1)} seconds</h4><p>${esc(o.observation)}</p><p>Ask your coach: ${esc(o.practice_question)}</p></article>`).join('')+'<ul>'+result.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';status.textContent='Draft ready. Review against the original clip.';
    }catch(e){console.error(e);status.textContent=e.message||'Review failed.';}finally{button.disabled=false;}
  };
}
