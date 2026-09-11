const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Study=require('../tools/reconstruction/surface-study.js'),Evidence=require('../tools/reconstruction/evidence-report.js');
const progress=JSON.parse(fs.readFileSync(path.join(__dirname,'../tools/parity-progress.json'),'utf8'));
const options={permissionConfirmed:true,location:'Recorded test level',procedure:'Independent synthetic analytical reference for testing only.'};
function setup({hold=false,holdFetch=false}={}){
  const elements={},jobs=[],downloads=[],stats={terminated:0},fetches=[];
  const el=id=>elements[id]??={value:'',checked:false,disabled:false,hidden:false,files:[],children:[],textContent:'',srcdoc:'',appendChild(e){this.children.push(e);},replaceChildren(){this.children=[];},click(){}};
  class Worker{
    postMessage(data){const deliver=this.onmessage;jobs.push(async()=>{try{deliver({data:{type:'result',result:await Study.run(data.cases,data.options)}});}catch(error){deliver({data:{type:'error',message:error.message}});}});if(!hold)queueMicrotask(()=>jobs.shift()());}
    terminate(){stats.terminated++;}
  }
  const c=vm.createContext({Worker,Blob,Uint8Array,TextEncoder,crypto:crypto.webcrypto,EvidenceReport:Evidence,console,setTimeout,clearTimeout,window:{addEventListener(){}},fetch:async()=>holdFetch?await new Promise(resolve=>fetches.push(resolve)):{ok:true,json:async()=>progress},URL:{createObjectURL(b){downloads.push(b);return 'blob:test';},revokeObjectURL(){}},document:{getElementById:el,createElement:()=>el('new-'+Math.random()),querySelectorAll:()=>Object.values(elements)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/reconstruction/study-lab.js'),'utf8'),c);
  return {c,el,jobs,downloads,stats,fetches};
}
async function fixtures(){return setup().c.syntheticCases();}
test('reference study computes signed and absolute error without counting repeated scans as people',async()=>{
  const r=await Study.run(await fixtures(),options);
  assert.equal(r.summary.attempted,3);assert.equal(r.summary.computed,2);assert.equal(r.summary.rejected,1);assert.equal(r.summary.submittedParticipantCodes,1);
  const g=r.methodGroups[0];assert.equal(g.participantsWithResults,1);assert.ok(Math.abs(g.meanSignedErrorCm)<1e-8);assert.ok(Math.abs(g.meanAbsoluteErrorCm-2)<1e-8);assert.ok(Math.abs(g.maximumAbsoluteErrorCm-2)<1e-8);
  assert.match(r.rows[2].reason,/Repeated saved surface/);assert.equal(r.accuracy,undefined);assert.equal(r.pass,undefined);
});
test('different recorded models and grids are kept in separate statistical groups',async()=>{
  for(const mutate of [m=>m.views[0].model='other-model',m=>m.views[0].delegate='CPU',m=>{m.resolution=100;m.voxelStepM=1.8/100;}]){
    const cases=(await fixtures()).slice(0,2),m=JSON.parse(cases[1].methodText);mutate(m);cases[1].methodText=JSON.stringify(m);
    const r=await Study.run(cases,options);assert.equal(r.methodGroups.length,2);assert.equal(r.methodGroups[0].computed,1);assert.equal(r.methodGroups[1].computed,1);
  }
});
test('bad file pairs and invalid sections remain visible without becoming zero-error observations',async()=>{
  const cases=await fixtures();cases[0].objBytes[0]=88;cases[1].planeCm=200;
  const r=await Study.run(cases,options);assert.equal(r.summary.rejected,2);assert.equal(r.summary.computed,1);assert.match(r.rows[0].reason,/match/);assert.match(r.rows[1].reason,/below/);
  const all=await Study.run(cases.slice(0,2),options);assert.equal(all.summary.computed,0);assert.equal(all.methodGroups[0].meanAbsoluteErrorCm,null);
});
test('malformed study inputs and missing permission fail before any geometry comparison',async()=>{
  const cases=await fixtures();for(const change of [{...options,permissionConfirmed:false},{...options,location:''},{...options,procedure:'x'.repeat(601)}])await assert.rejects(Study.run(cases,change));
  await assert.rejects(Study.run([],options));await assert.rejects(Study.run([...cases,...cases],options),/unique ID/);
  cases[0].participantCode='name with spaces';await assert.rejects(Study.run(cases,options),/participant code/);
});
test('unknown imported metadata and geometry never appear in the reference result',async()=>{
  const cases=(await fixtures()).slice(0,1),m=JSON.parse(cases[0].methodText);m.subjectName='secret-name';m.photos=['secret-photo'];cases[0].methodText=JSON.stringify(m);cases[0].otherSecret='secret-other';
  const r=await Study.run(cases,options),text=JSON.stringify(r);assert.ok(!text.includes('secret-'));assert.equal(r.rows[0].vertices,undefined);assert.equal(r.rows[0].points,undefined);assert.equal(r.rows[0].objBytes,undefined);
});
test('presentation brief escapes supplied text, includes rejected rows and uses fixed parity without auto-credit',async()=>{
  const r=await Study.run(await fixtures(),{...options,location:'<img src=x onerror=alert(1)>',procedure:'<script>bad()</script>'});
  const html=Evidence.render(r,progress,{synthetic:true});assert.ok(html.includes('42.8%'));assert.ok(html.includes('SYNTHETIC FIXTURE'));assert.ok(html.includes('Repeated saved surface'));
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<iframe'));assert.ok(html.includes('Mean absolute error'));assert.ok(html.includes('SYNTHETIC BOX FIXTURE'));
  const bad={...progress,categories:[{weight:100,stage:1.5}]};assert.throws(()=>Evidence.render(r,bad),/rubric/);
});
test('synthetic UI can preview a complete evidence brief but cannot export simulated observations',async()=>{
  const s=setup();await s.el('synthetic').onclick();assert.equal(s.el('rows').children.length,3);assert.equal(s.el('json').disabled,true);assert.equal(s.stats.terminated,1);
  await s.el('preview').onclick();assert.equal(s.el('evidence-frame').hidden,false);assert.match(s.el('evidence-frame').srcdoc,/SYNTHETIC FIXTURE/);assert.equal(s.el('html').disabled,true);
  s.el('json').onclick();s.el('html').onclick();assert.equal(s.downloads.length,0);
});
test('actual queued file inputs produce exportable reports and invalidate previews on procedure edits',async()=>{
  const s=setup(),cases=(await fixtures()).slice(0,2);s.el('permission').checked=true;s.el('location').value='Independent line';s.el('procedure').value='Recorded test procedure';
  for(const c of cases){s.el('participant').value=c.participantCode;s.el('plane').value=String(c.planeCm);s.el('tape').value=String(c.referenceCm);s.el('obj').files=[new Blob([c.objBytes])];s.el('method').files=[new Blob([c.methodText])];s.el('add').onclick();}
  assert.equal(s.el('queue').children.length,2);await s.el('run').onclick();assert.equal(s.el('json').disabled,false);
  s.el('json').onclick();const data=JSON.parse(await s.downloads[0].text());assert.equal(data.summary.computed,2);
  await s.el('preview').onclick();assert.equal(s.el('html').disabled,false);s.el('html').onclick();assert.match(await s.downloads[1].text(),/42.8%/);
  s.el('procedure').oninput();assert.equal(s.el('evidence-frame').srcdoc,'');assert.equal(s.el('html').disabled,true);assert.equal(s.el('json').disabled,true);
});
test('clearing an active computation cancels its worker and late results cannot restore the report',async()=>{
  const s=setup({hold:true}),operation=s.el('synthetic').onclick();for(let i=0;i<50&&!s.jobs.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(s.jobs.length,1);
  s.el('clear').onclick();await s.jobs.shift()();await operation;assert.equal(s.stats.terminated,1);assert.equal(s.el('output').hidden,true);assert.equal(s.el('evidence-frame').srcdoc,'');assert.match(s.el('status').textContent,/cleared/);
});
test('clearing during rubric retrieval prevents a stale evidence page from appearing',async()=>{
  const s=setup({holdFetch:true});await s.el('synthetic').onclick();const pending=s.el('preview').onclick();assert.equal(s.fetches.length,1);
  s.el('clear').onclick();s.fetches[0]({ok:true,json:async()=>progress});await pending;assert.equal(s.el('evidence-frame').srcdoc,'');assert.equal(s.el('evidence-frame').hidden,true);assert.equal(s.el('html').disabled,true);
});
