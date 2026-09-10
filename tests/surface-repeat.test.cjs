const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Repeat=require('../tools/reconstruction/surface-repeat.js');
const Hull=require('../tools/reconstruction/visual-hull.js');
function box(width=.54,height=1.8,xOffset=0){const x=width/2,z=.27;return {vertices:[[-x,0,-z],[x,0,-z],[x,height,-z],[-x,height,-z],[-x,0,z],[x,0,z],[x,height,z],[-x,height,z]].map(([x,y,z])=>[x+xOffset,y,z]),faces:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]};}
function pair(mesh=box(),mutate=()=>{}){
  const obj=Hull.toOBJ(mesh),record={schema:'PP_EXPERIMENTAL_SURFACE_V1',createdAt:'2026-09-09T12:00:00Z',meshSha256:crypto.createHash('sha256').update(obj).digest('hex'),protocol:'orthographic-four-silhouette-v1',experimental:true,units:'m',scaleStatus:'assumed-stature-not-validated',heightM:1.8,resolution:96,voxelStepM:1.8/96,vertices:mesh.vertices.length,triangles:mesh.faces.length,reconstructionMs:0,views:Hull.VIEWS.map(view=>({view,model:'synthetic-model',delegate:'TEST',segmentationMs:0,alignment:{width:80,height:120,centerX:40,top:10,bottom:110}}))};
  mutate(record);return {objBytes:new TextEncoder().encode(obj),methodText:JSON.stringify(record)};
}
const options={independentCapturesConfirmed:true,levelsCm:[60,90,120]};
test('repeat sections match analytical boxes and preserve signed second-minus-first differences',async()=>{
  const r=await Repeat.compareFiles(pair(),pair(box(.56)),options);
  assert.equal(r.schema,'PP_SURFACE_REPEAT_V1');assert.equal(r.summary.computedLevels,3);
  for(const row of r.sections){assert.ok(Math.abs(row.first.perimeterCm-216)<1e-8);assert.ok(Math.abs(row.second.perimeterCm-220)<1e-8);assert.ok(Math.abs(row.difference.perimeterCm.signed-4)<1e-8);assert.ok(Math.abs(row.difference.widthCm.signed-2)<1e-8);assert.ok(Math.abs(row.difference.depthCm.signed)<1e-8);}
  const reverse=await Repeat.compareFiles(pair(box(.56)),pair(),options);assert.ok(Math.abs(reverse.sections[0].difference.perimeterCm.signed+4)<1e-8);assert.ok(Math.abs(reverse.summary.maximumAbsolutePerimeterDifferenceCm-4)<1e-8);
});
test('copied surfaces fail even if comments, vertex order or face order change',async()=>{
  const a=pair();await assert.rejects(Repeat.compareFiles(a,pair(),options),/same saved surface/);
  const copy=box(),count=copy.vertices.length;copy.vertices.reverse();copy.faces=copy.faces.reverse().map(f=>f.map(i=>count-1-i));
  await assert.rejects(Repeat.compareFiles(a,pair(copy),options),/same saved surface/);
  const altered=pair(),text=new TextDecoder().decode(altered.objBytes)+'# different comment\n';altered.objBytes=new TextEncoder().encode(text);const record=JSON.parse(altered.methodText);record.meshSha256=crypto.createHash('sha256').update(text).digest('hex');altered.methodText=JSON.stringify(record);
  await assert.rejects(Repeat.compareFiles(a,altered,options),/same saved surface/);
});
test('recorded scale, resolution and model mismatches cannot masquerade as repeatability',async()=>{
  for(const change of [m=>{m.heightM=1.81;m.voxelStepM=1.81/96;},m=>{m.resolution=100;m.voxelStepM=1.8/100;},m=>m.views[0].model='other-model'])
    await assert.rejects(Repeat.compareFiles(pair(),pair(box(.56),change),options),/same|differs/);
  const r=await Repeat.compareFiles(pair(),pair(box(.56),m=>m.views[0].delegate='CPU'),options);assert.equal(r.warnings.length,1);
});
test('file mismatches, unsupported geometry and missing independent-capture declaration fail before results',async()=>{
  const invalid=pair(box(.56));invalid.objBytes[0]=88;
  await assert.rejects(Repeat.compareFiles(pair(),invalid,options),/do not match/);
  const open=box(.56);open.faces.pop();await assert.rejects(Repeat.compareFiles(pair(),pair(open),options),/open/);
  await assert.rejects(Repeat.compareFiles(pair(),pair(box(.56)),{levelsCm:[90]}),/Confirm/);
});
test('invalid or nearly duplicated levels are rejected; valid levels are sorted without fitting the scale',async()=>{
  for(const levelsCm of [[],[0],[180],[NaN],[90,90],[90,90.01],Array(13).fill(90)])await assert.rejects(Repeat.compareFiles(pair(),pair(box(.56)),{...options,levelsCm}),/levels/);
  const r=await Repeat.compareFiles(pair(),pair(box(.56)),{...options,levelsCm:[120,60]});assert.deepEqual(r.sections.map(s=>s.planeCm),[60,120]);assert.equal(r.heightM,1.8);
});
test('multiple contours are reported per level and excluded from descriptive difference summary',async()=>{
  const two=box(.56),foot=box(.2,.4,1),offset=two.vertices.length;two.vertices.push(...foot.vertices);two.faces.push(...foot.faces.map(f=>f.map(i=>i+offset)));
  const r=await Repeat.compareFiles(pair(),pair(two),{...options,levelsCm:[30,90]});assert.equal(r.sections[0].status,'rejected');assert.equal(r.sections[0].first,undefined);assert.equal(r.sections[1].status,'computed');assert.equal(r.summary.rejectedLevels,1);assert.equal(r.summary.computedLevels,1);
  const all=await Repeat.compareFiles(pair(),pair(two),{...options,levelsCm:[30]});assert.equal(all.summary.maximumAbsolutePerimeterDifferenceCm,null);
});
test('result exports contain no geometry, unknown metadata, pass claims or invented anatomical labels',async()=>{
  const r=await Repeat.compareFiles(pair(box(),m=>{m.personName='private-name';m.views[0].photo='private-photo';}),pair(box(.56)),options);
  const text=JSON.stringify(r);assert.ok(!text.includes('private-name'));assert.ok(!text.includes('private-photo'));assert.equal(r.vertices,undefined);assert.equal(r.mesh,undefined);assert.equal(r.pass,undefined);assert.equal(r.accuracy,undefined);assert.equal(r.sections[0].waist,undefined);assert.equal(r.sources.length,2);
});
function ui({hold=false}={}){
  const elements={},jobs=[],downloads=[],stats={terminated:0};
  const el=id=>elements[id]??={value:'',checked:false,hidden:false,disabled:false,files:[],children:[],style:{},textContent:'',appendChild(e){this.children.push(e);},replaceChildren(){this.children=[];},setAttribute(){},click(){}};
  class Worker{
    postMessage(data){const deliver=this.onmessage;jobs.push(async()=>{try{deliver({data:{type:'result',result:await Repeat.compareFiles(data.first,data.second,data.options)}});}catch(error){deliver({data:{type:'error',message:error.message}});}});if(!hold)queueMicrotask(()=>jobs.shift()());}
    terminate(){stats.terminated++;}
  }
  const c=vm.createContext({Worker,Blob,Uint8Array,TextEncoder,TextDecoder,crypto:crypto.webcrypto,console,setTimeout,clearTimeout,window:{addEventListener(){}},URL:{createObjectURL(b){downloads.push(b);return 'blob:test';},revokeObjectURL(){}},document:{getElementById:el,createElement:()=>el('new-'+Math.random()),querySelectorAll:()=>Object.values(elements)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/reconstruction/repeat-lab.js'),'utf8'),c);
  const prepare=()=>{el('permission').checked=true;el('levels').value='60,90';for(const [key,value] of [['first',pair()],['second',pair(box(.56))]]){el(key+'-obj').files=[new Blob([value.objBytes])];el(key+'-method').files=[new Blob([value.methodText])];}};
  return {c,el,jobs,downloads,stats,prepare};
}
test('comparison UI runs actual file validation and exports summaries, invalidating them after input edits',async()=>{
  const s=ui();s.prepare();await s.el('compare').onclick();assert.equal(s.el('output').hidden,false);assert.equal(s.el('rows').children.length,2);assert.equal(s.el('download').disabled,false);assert.equal(s.stats.terminated,1);
  s.el('download').onclick();const report=JSON.parse(await s.downloads[0].text());assert.equal(report.sections.length,2);assert.equal(report.vertices,undefined);
  s.el('levels').oninput();assert.equal(s.el('output').hidden,true);assert.equal(s.el('download').disabled,true);s.el('download').onclick();assert.equal(s.downloads.length,1);
});
test('comparison UI refuses missing permission and prevents synthetic results from being exported',async()=>{
  const s=ui();await s.el('compare').onclick();assert.match(s.el('status').textContent,/Confirm permission/);assert.equal(s.jobs.length,0);
  await s.el('synthetic').onclick();assert.match(s.el('result-title').textContent,/SYNTHETIC/);assert.equal(s.el('download').disabled,true);s.el('download').onclick();assert.equal(s.downloads.length,0);
});
test('clear cancels comparison, releases worker and prevents late results from restoring geometry-derived data',async()=>{
  const s=ui({hold:true});s.prepare();const pending=s.el('compare').onclick();
  for(let i=0;i<30&&!s.jobs.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(s.jobs.length,1);
  s.el('clear').onclick();await s.jobs.shift()();await pending;
  assert.equal(s.stats.terminated,1);assert.equal(s.el('output').hidden,true);assert.equal(s.el('permission').checked,false);assert.equal(s.el('download').disabled,true);assert.match(s.el('status').textContent,/cleared/);
});
