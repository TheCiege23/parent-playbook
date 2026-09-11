const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
 const elements={},seen={revoked:0,checks:0},bg={isConnected:true,querySelector:s=>elements[s]??(elements[s]={disabled:true}),querySelectorAll:()=>[],remove(){seen.removed=true;bg.isConnected=false;}};
 const c=vm.createContext({console:{...console,error(){}},Blob,crypto:require('node:crypto').webcrypto,state:{user:{id:'parent'}},sheet:html=>{seen.html=html;return bg;},H:(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),''),esc:s=>String(s),URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){seen.revoked++;}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/photo-identity.js'),'utf8'),c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/body-scan.js'),'utf8'),c);
 c.originalCapture=c.bsCapture;
 c.seen=seen;
 vm.runInContext(`BS.subject={id:'athlete'};BS.consent=true;BS.consentId='consent';loadScanConsent=async()=>({id:'consent'});bsMarkActive=()=>{};bsRefuse=()=>{seen.refused=true};bsCapture=i=>{seen.next=i};registerBodyProvider({id:'pose',measure:async()=>({}),reviewFrame:async()=>{seen.checks++;return {accepted:true,reasons:[],warnings:[]}}});`,c);
 return {c,elements,seen,bg};
}
test('review accepts only after model check and stores the exact in-memory photo',async()=>{
 const {c,elements,seen}=setup(),file=new Blob(['sample']);await c.bsReview(0,file);assert.equal(seen.checks,1);assert.equal(elements['#bsUse'].disabled,false);
 elements['#bsUse'].onclick();assert.equal(vm.runInContext('BS.frames.front',c),file);assert.equal(seen.next,1);assert.equal(seen.revoked,1);
});
test('rejected checks and inference errors never enable or save the photo',async()=>{
 for(const fn of [`async()=>({accepted:false,reasons:[{message:'Move back'}],warnings:[]})`,`async()=>{throw Error('GPU')}`]){
  const {c,elements}=setup();vm.runInContext('BODY_PROVIDER.reviewFrame='+fn,c);await c.bsReview(0,new Blob(['sample']));assert.equal(elements['#bsUse'].disabled,true);elements['#bsUse'].onclick();assert.equal(vm.runInContext('BS.frames.front',c),undefined);
 }
});
test('revoked consent stops processing; stale account results are discarded',async()=>{
 const first=setup();first.c.loadScanConsent=async()=>null;await first.c.bsReview(0,new Blob(['sample']));assert.equal(first.seen.checks,0);assert.equal(first.seen.refused,true);assert.equal(first.seen.revoked,1);
 const second=setup();vm.runInContext(`BODY_PROVIDER.reviewFrame=async()=>{state.user=null;return {accepted:true}}`,second.c);await second.c.bsReview(0,new Blob(['sample']));assert.equal(second.seen.removed,true);assert.equal(second.elements['#bsUse'].disabled,true);
});
test('closing a review releases its URL and discards the unfinished frame set',async()=>{
 const {c,bg,seen}=setup();vm.runInContext("BS.frames.back=new Blob(['back'])",c);await c.bsReview(0,new Blob(['sample']));bg.remove();bg.remove();assert.equal(seen.revoked,1);assert.equal(vm.runInContext('Object.keys(BS.frames).length',c),0);
});
test('review rejects exact reuse of another view before pose inference but permits a replacement of its own view',async()=>{
 const s=setup();vm.runInContext("BS.frames.front=new Blob(['same-photo'])",s.c);
 await s.c.bsReview(1,new Blob(['same-photo']));assert.equal(s.seen.checks,0);assert.equal(s.elements['#bsUse'].disabled,true);assert.match(s.elements['#bsPhotoCheck'].textContent,/already accepted for the front/);
 const t=setup();vm.runInContext("BS.frames.front=new Blob(['same-photo'])",t.c);await t.c.bsReview(0,new Blob(['same-photo']));assert.equal(t.elements['#bsUse'].disabled,false);assert.equal(t.seen.checks,1);
});
test('logout while file identity is being checked cannot enable acceptance',async()=>{
 const s=setup();s.c.duplicatePhotoView=async()=>{s.c.state.user=null;return null;};await s.c.bsReview(0,new Blob(['sample']));assert.equal(s.seen.checks,0);assert.equal(s.seen.removed,true);assert.equal(s.elements['#bsUse'].disabled,true);
});
test('a photo finishing resize after logout, replacement scan or dismissal cannot enter review',async()=>{
 for(const change of ['state.user=null','BS.frames={newScan:true}','bg.remove()']){
  const {c,elements,bg,seen}=setup();c.bg=bg;c.bsReview=()=>{seen.reviewed=true};
  vm.runInContext(`BS.frames.back=new Blob(['back']);shrinkFrame=async f=>{${change};return f}`,c);c.originalCapture(0);elements['#bsFile'].files=[{}];await elements['#bsFile'].onchange();assert.equal(seen.reviewed,undefined);
  if(change==='BS.frames={newScan:true}')assert.equal(vm.runInContext('BS.frames.newScan',c),true);else assert.equal(vm.runInContext('Object.keys(BS.frames).length',c),0);
 }
});
test('HEIC capture refreshes consent before import and sends only the converted photo to review',async()=>{
 for(const allowed of [true,false]){
  const s=setup();Object.assign(s.c,{AbortController,setInterval:()=>1,clearInterval(){}});let conversions=0;
  const converted=new Blob(['png'],{type:'image/png'});s.c.convertCapturePhoto=async()=>{conversions++;return converted;};s.c.shrinkFrame=async f=>f;s.c.bsReview=(i,f)=>{s.seen.reviewed=f;};s.c.loadScanConsent=async()=>allowed?{id:'consent'}:null;
  s.c.originalCapture(0);s.elements['#bsFile'].files=[new Blob(['heic'],{type:'image/heic'})];await s.elements['#bsFile'].onchange();assert.equal(conversions,allowed?1:0);assert.equal(s.seen.reviewed,allowed?converted:undefined);
 }
});
test('closing or changing accounts during HEIC import aborts it and prevents late review',async()=>{
 for(const mode of ['close','account']){
  const s=setup();let guard,resolve,signal;Object.assign(s.c,{AbortController,setInterval:fn=>{guard=fn;return 1;},clearInterval(){}});
  s.c.convertCapturePhoto=async(f,options)=>{signal=options.signal;return new Promise(r=>resolve=r);};s.c.shrinkFrame=async f=>f;s.c.bsReview=()=>{s.seen.reviewed=true;};
  s.c.originalCapture(0);s.elements['#bsFile'].files=[new Blob(['heic'],{type:'image/heic'})];const pending=s.elements['#bsFile'].onchange();await Promise.resolve();await Promise.resolve();
  if(mode==='close')s.bg.remove();else{s.c.state.user=null;guard();}assert.equal(signal.aborted,true);resolve(new Blob(['late']));await pending;assert.equal(s.seen.reviewed,undefined);
 }
});
