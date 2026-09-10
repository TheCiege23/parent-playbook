const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
function context(extra={}){
  const ctx=vm.createContext({console,Number,Map,Set,Date,Blob,JSON,setTimeout,...extra});
  vm.runInContext(`function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`,ctx);
  for(const file of ['body-outputs.js','cdc-stature.js','maturity.js','scan-record.js','body-insights.js','assessment-report.js']) vm.runInContext(fs.readFileSync(path.join(base,'js',file),'utf8'),ctx);
  return ctx;
}
const r=(date,value,extra={})=>({id:date,metric_key:'wingspan',value,unit:'in',source:'photo',measured_on:date,...extra});
test('historical snapshots exclude future readings and resolve same-day records deterministically',()=>{
  const c=context(),rows=[r('2026-09-09',65),r('2026-08-01',60,{id:'a',created_at:'2026-08-01T10:00:00Z'}),r('2026-08-01',61,{id:'b',created_at:'2026-08-01T11:00:00Z'})];
  assert.equal(c.biSnapshot(rows,'2026-08-01').get('wingspan').value,61);
  assert.equal(c.biSnapshot(rows,'2026-07-01').size,0);
});
test('comparisons refuse mixed units and methods; body changes are neutral',()=>{
  const c=context();
  assert.equal(c.biComparison(r('2026-09-09',63),r('2026-08-01',60)).label,'+3 in');
  assert.equal(c.biComparison(r('2026-09-09',63),r('2026-08-01',160,{unit:'cm'})).delta,null);
  assert.equal(c.biComparison(r('2026-09-09',63),r('2026-08-01',60,{source:'manual'})).delta,null);
});
test('invalid readings are excluded and names are escaped',()=>{
  const c=context();
  assert.equal(c.biValidRows([r('2026-09-09',null),r('2026-09-09',''),r('2026-09-09','bad'),r('2026-09-09',60)]).length,1);
  const html=c.biMarkup({first_name:'<img src=x onerror=alert(1)>'},[],'','');
  assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('3D body reconstruction · temporary experiment'));
});
test('growth context handles the actual percentile result object and preserves missing inputs',()=>{
  const c=context();
  const athlete={first_name:'Sample',birthdate:'2014-01-01',sex_at_birth:'male',mother_height_in:64,father_height_in:70};
  const html=c.biMarkup(athlete,[r('2026-09-09',60,{metric_key:'height',source:'manual'})],'2026-09-09','');
  assert.match(html,/\d+(st|nd|rd|th)<\/strong>/);assert.match(html,/Mid-parental range/);
  assert.ok(c.biMarkup({first_name:'Sample'},[],'','').includes('Add parental heights'));
});
test('screen loads every page, compares dates interactively, and exports original records',async()=>{
  const rows=Array.from({length:501},(_,i)=>r('2026-09-09',60,{id:String(i)}));
  const elements={},host={innerHTML:'',querySelector:s=>elements[s]??(elements[s]={})};
  const calls=[];let blob;
  const doc={querySelector:()=>host,createElement:()=>({click(){calls.push('download')}})};
  const c=context({document:doc,state:{active:{id:'athlete',first_name:'Sample'}},topBar:()=>'',bindTop(){},renderApp(){},URL:{createObjectURL:b=>{blob=b;return 'blob:test'},revokeObjectURL(){}},setTimeout:fn=>fn(),sb:{from:()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:{},error:null}},order(){return this},range(a,b){calls.push([a,b]);return Promise.resolve({data:rows.slice(a,b+1),error:null})}})}});
  await c.screenBodyInsights();assert.equal(calls.length,2);
  elements['#biExport'].onclick();const data=JSON.parse(await blob.text());assert.equal(data.measurements.length,501);assert.equal(data.athlete.id,'athlete');
  elements['#biReport'].onclick();assert.match(await blob.text(),/Sample's assessment report/);
  elements['#biCSV'].onclick();assert.match(await blob.text(),/measurement_id/);assert.equal((await blob.text()).split('\r\n').length,502);
  elements['#biBaseline'].onchange({target:{value:''}});assert.ok(host.innerHTML.includes('No comparison'));
});
test('failed queries propagate and a stale request cannot paint another athlete',async()=>{
  const host={innerHTML:'',querySelector(){throw Error('must not draw')}};
  const state={active:{id:'one'}};
  const sb={from:()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:{},error:null}},order(){return this},async range(){state.active={id:'two'};return {data:[],error:null}}})};
  const c=context({document:{querySelector:()=>host},state,sb});await c.screenBodyInsights();assert.match(host.innerHTML,/Loading/);
  sb.from=()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:{},error:null}},order(){return this},async range(){return {error:Error('network')}}});
  await assert.rejects(c.screenBodyInsights(),/network/);
});

test('a late failed query cannot replace a newly navigated screen or another account',async()=>{
  for(const change of ['navigation','account']){
    const host={innerHTML:''},other={innerHTML:'New screen'};let current=host;
    const state={active:{id:'a'},user:{id:'parent'}};
    const c=context({state,document:{querySelector:()=>current},sb:{from:()=>({select(){return this},eq(){return this},async maybeSingle(){return {data:{}}},order(){return this},async range(){if(change==='navigation') current=other;else state.user={id:'someone-else'};return {error:Error('late failure')}}})}});
    await c.screenBodyInsights();assert.equal(other.innerHTML,'New screen');assert.match(host.innerHTML,/Loading/);
  }
});
