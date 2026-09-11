const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function events(){const listeners=new Map();return {addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(k,fn){listeners.get(k)?.delete(fn);},emit(k){for(const fn of [...listeners.get(k)||[]])fn();},count(){return [...listeners.values()].reduce((n,s)=>n+s.size,0);}};}
function setup(){
 const seen={grants:0,stops:0,authorization:0,states:[],canvas:[],draw:[]},win=events(),doc=Object.assign(events(),{hidden:false}),intervals=new Map(),timeouts=new Map();let id=0;
 const track=Object.assign(events(),{stop(){seen.stops++;}}),stream={getTracks:()=>[track]};
 const video={isConnected:true,videoWidth:2400,videoHeight:3200,srcObject:null,play:async()=>{},pause(){seen.paused=true;}};
 doc.createElement=kind=>{assert.equal(kind,'canvas');const canvas={width:0,height:0,getContext:()=>({drawImage(...args){seen.draw=args;}}),toBlob(fn,type,quality){seen.encoding={type,quality};seen.blobCallback=fn;if(!seen.deferBlob)fn({kind:'captured-jpeg'});}};seen.canvas.push(canvas);return canvas;};
 const c=vm.createContext({console,window:win,document:doc,navigator:{mediaDevices:{async getUserMedia(constraints){seen.grants++;seen.constraints=constraints;return stream;}}},setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:i=>intervals.delete(i),setTimeout:fn=>{timeouts.set(++id,fn);return id;},clearTimeout:i=>timeouts.delete(i)});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/scan-camera.js'),'utf8'),c);
 let active=true,allowed=true;
 const opts={video,isCurrent:()=>active,authorize:async()=>{seen.authorization++;return allowed;},onState:s=>seen.states.push(s)};
 return {c,seen,video,track,stream,win,doc,intervals,timeouts,opts,active:v=>{active=v;},allowed:v=>{allowed=v;},make:()=>c.createScanCamera(opts)};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('camera needs consent and requests video only without starting on construction',async()=>{
 const s=setup(),camera=s.make();assert.equal(s.seen.grants,0);s.allowed(false);assert.equal(await camera.start(),false);assert.equal(s.seen.grants,0);assert.equal(s.win.count()+s.doc.count(),0);assert.equal(s.intervals.size,0);
 const t=setup();await t.make().start();assert.equal(t.seen.constraints.audio,false);assert.equal(t.seen.constraints.video.facingMode.ideal,'environment');assert.equal(t.seen.authorization,2);t.c.stopScanCameras();
});
test('capture keeps the full aspect ratio, rechecks consent and releases tracks and canvas',async()=>{
 const s=setup(),camera=s.make();assert.equal(await camera.start(),true);assert.equal(s.video.srcObject,s.stream);
 const blob=await camera.capture();assert.equal(blob.kind,'captured-jpeg');assert.equal(s.seen.authorization,3);
 assert.equal(s.seen.draw[0],s.video);assert.deepEqual(s.seen.draw.slice(1),[0,0,1200,1600]);assert.equal(s.seen.encoding.type,'image/jpeg');assert.equal(s.seen.stops,1);assert.equal(s.video.srcObject,null);
 assert.equal(s.seen.canvas[0].width,0);assert.equal(s.seen.canvas[0].height,0);assert.equal(s.win.count()+s.doc.count(),0);assert.equal(s.intervals.size+s.timeouts.size,0);assert.equal(await camera.capture(),null);
});
test('cancelled or timed-out permission requests immediately stop a late camera grant',async()=>{
 for(const timeout of [false,true]){
  const s=setup();let grant;s.c.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>{grant=r;});const camera=s.make(),pending=camera.start();await flush();
  if(timeout)[...s.timeouts.values()][0]();else camera.stop();grant(s.stream);
  assert.equal(await pending,false);assert.equal(s.seen.stops,1);assert.equal(s.video.srcObject,null);assert.equal(s.intervals.size,0);
 }
});
test('background, navigation, session invalidation and track disconnect stop preview',async()=>{
 for(const interrupt of [s=>{s.doc.hidden=true;s.doc.emit('visibilitychange');},s=>s.win.emit('pagehide'),s=>s.win.emit('hashchange'),s=>{s.active(false);[...s.intervals.values()][0]();},s=>{s.video.isConnected=false;[...s.intervals.values()][0]();},s=>s.track.emit('ended')]){
  const s=setup(),camera=s.make();await camera.start();interrupt(s);assert.equal(s.seen.stops,1);assert.equal(camera.isReady(),false);assert.equal(s.video.srcObject,null);assert.equal(await camera.capture(),null);
 }
});
test('consent revoked during permission prompt or before capture prevents a usable frame',async()=>{
 const s=setup();s.opts.authorize=async()=>++s.seen.authorization===1;assert.equal(await s.make().start(),false);assert.equal(s.seen.stops,1);assert.equal(s.video.srcObject,null);
 const t=setup(),camera=t.make();await camera.start();t.allowed(false);assert.equal(await camera.capture(),null);assert.equal(t.seen.canvas.length,0);assert.equal(t.seen.stops,1);
});
test('permission rejection, playback failure and empty encoding clean up with a retry message',async()=>{
 const s=setup();s.c.navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});};assert.equal(await s.make().start(),false);assert.match(s.seen.states.at(-1).message,/not allowed/);
 const t=setup();t.video.play=async()=>{throw Error('play failed');};assert.equal(await t.make().start(),false);assert.equal(t.seen.stops,1);assert.equal(t.video.srcObject,null);
 const u=setup(),camera=u.make();u.seen.deferBlob=true;await camera.start();const pending=camera.capture();await flush();u.seen.blobCallback(null);assert.equal(await pending,null);assert.equal(u.seen.stops,1);assert.equal(u.seen.canvas[0].width,0);
});
test('closing while JPEG encoding is pending discards the late photo',async()=>{
 const s=setup(),camera=s.make();s.seen.deferBlob=true;await camera.start();const pending=camera.capture();await flush();assert.equal(s.seen.stops,1);camera.stop();s.seen.blobCallback({private:true});assert.equal(await pending,null);assert.equal(s.seen.canvas[0].width,0);
});
test('actual capture sheet routes a live photo to review and closes the stream on dismissal',async()=>{
 for(const take of [true,false]){
  const s=setup(),elements={};const bg={isConnected:true,querySelector:key=>elements[key]??(elements[key]=key==='#bsVideo'?s.video:{}),querySelectorAll:()=>[],remove(){this.isConnected=false;s.video.isConnected=false;}};
  Object.assign(s.c,{state:{user:{id:'parent'}},sheet:()=>bg,H:(strings,...values)=>strings.reduce((out,str,i)=>out+str+(values[i]??''),''),esc:String});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/body-scan.js'),'utf8'),s.c);
  s.c.seen=s.seen;vm.runInContext(`BS.subject={id:'athlete'};BS.consent=true;BS.consentId='release';loadScanConsent=async()=>({id:'release'});bsMarkActive=()=>{};shrinkFrame=async file=>file;bsReview=(i,file)=>{seen.review={i,file}};registerBodyProvider({id:'pose',measure:async()=>({})});`,s.c);
  s.c.bsCapture(0);await elements['#bsLive'].onclick();assert.equal(s.video.hidden,false);assert.equal(elements['#bsShot'].disabled,false);
  if(take){await elements['#bsShot'].onclick();assert.equal(s.seen.review.file.kind,'captured-jpeg');assert.equal(s.seen.review.i,0);}else{bg.remove();assert.equal(s.seen.review,undefined);}
  assert.equal(s.seen.stops,1);assert.equal(s.video.srcObject,null);assert.equal(bg.isConnected,false);
 }
});
