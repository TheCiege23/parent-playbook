const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function context(extra={}){const c={console,Error,Number,Set,Promise,...extra};vm.createContext(c);vm.runInContext(fs.readFileSync('js/story-tools.js','utf8'),c);return c;}
test('a failed sharing change restores its checkbox and leaves retry enabled',async()=>{
  const c=context(),button={type:'checkbox',checked:false},events=[];
  await c.storyMutation(async()=>({error:{message:'offline'}}),button,{current:()=>true,success:()=>events.push('saved'),failure:()=>events.push('failed')});
  assert.equal(button.checked,true,'failed revocation must not appear applied');assert.equal(button.disabled,false);assert.deepEqual(events,['failed']);
});
test('Story mutations do not run after switching accounts or athletes',async()=>{
  const c=context(),events=[],button={type:'button'};
  await c.storyMutation(async()=>{events.push('write');return {};},button,{current:()=>false,success:()=>events.push('saved'),failure:()=>events.push('failed')});assert.deepEqual(events,[]);assert.equal(button.disabled,false);
});
test('an in-flight Story save cannot open the replacement account’s panel',async()=>{
  const c=context(),events=[],button={type:'button'};let current=true,finish;
  const pending=c.storyMutation(()=>new Promise(resolve=>{finish=resolve;}),button,{current:()=>current,success:()=>events.push('refresh'),failure:()=>events.push('failed')});
  current=false;finish({});await pending;assert.deepEqual(events,[]);assert.equal(button.disabled,false);
});
test('reel validation rejects duplicate order numbers and invalid trims',()=>{
  const c=context();assert.equal(c.validateReelClips([{start:0,end:2,order:1},{start:1,end:4,order:2}]),5);
  for(const clips of [[],[{start:0,end:181}],[{start:2,end:1}],[{start:0,end:2,order:NaN}],[{start:0,end:2,order:1},{start:1,end:4,order:1}]])assert.throws(()=>c.validateReelClips(clips));
});
test('a seek event that did not reach the requested trim time is refused',async()=>{
  const callbacks={},video={readyState:2,currentTime:0,addEventListener:(n,fn)=>callbacks[n]=fn,removeEventListener:n=>delete callbacks[n]};
  const c=context({setTimeout,clearTimeout}),pending=c.storySeek(video,2);video.currentTime=0;callbacks.seeked();await assert.rejects(pending,/selected trim time/);assert.deepEqual(callbacks,{});
});
test('AI setup failures display the server’s retention message',async()=>{
  const c=context({sb:{functions:{invoke:async()=>({data:null,error:{context:{json:async()=>({error:'Video review awaits confirmed Zero Data Retention.'})}}})}}});await assert.rejects(c.storyReviewRequest({}),/Zero Data Retention/);
});
test('an empty AI response is a recoverable failure instead of an unusable draft',async()=>{
  const c=context({sb:{functions:{invoke:async()=>({data:null,error:null})}}});await assert.rejects(c.storyReviewRequest({}),/did not return a coaching draft/);
});
function playback(){const timeouts=new Map(),intervals=new Map(),frames=new Map();let id=0;const video={currentTime:0,pause(){this.paused=true;}},doc={hidden:false};
  const c=context({document:doc,setTimeout:fn=>{timeouts.set(++id,fn);return id;},clearTimeout:n=>timeouts.delete(n),setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:n=>intervals.delete(n),requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:n=>frames.delete(n)});return {c,video,doc,timeouts,intervals,frames};}
test('closing a reel cancels playback even when animation frames stop',async()=>{
  const p=playback();let current=true;const pending=p.c.storyWaitForClip(p.video,3,3,()=>{},()=>current);current=false;[...p.intervals.values()][0]();await assert.rejects(pending,/cancelled/);assert.equal(p.video.paused,true);assert.equal(p.timeouts.size+p.intervals.size+p.frames.size,0);
});
test('hiding a reel tab stops recording rather than silently rendering frozen frames',async()=>{
  const p=playback(),pending=p.c.storyWaitForClip(p.video,3,3,()=>{},()=>true);p.doc.hidden=true;[...p.intervals.values()][0]();await assert.rejects(pending,/Keep this tab visible/);assert.equal(p.video.paused,true);assert.equal(p.timeouts.size+p.intervals.size+p.frames.size,0);
});
