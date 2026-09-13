const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('the parent flow connects plan, growth, journey and settings on every main screen',()=>{
  const shell=read('js/shell.js');
  assert.match(shell,/function playbookPath/);
  for(const [file,route] of [
    ['js/screen-week.js','week'],['js/screen-growth.js','growth'],['js/screen-scan.js','scan'],
    ['js/journey.js','journey'],['js/screen-profile.js','profile'],['js/account.js','account'],
  ]) assert.match(read(file),new RegExp(`playbookPath\\(['"]${route}['"]\\)`),`${file} should show the connected playbook path`);
  assert.match(shell,/route:'account', label:'Settings'/);
});

test('a multi-sport week lets the parent choose every schedule that shapes the plan',()=>{
  const week=read('js/screen-week.js');
  assert.match(week,/function openWeekScheduleEditor/);
  assert.match(week,/rows\.length<=1/);
  assert.match(week,/data-week-sport/);
  assert.match(week,/Every sport shares one training load/);
});

test('Journey uses the resolved household role and Growth has a valid goals section',()=>{
  const journey=read('js/journey.js'), growth=read('js/screen-growth.js');
  assert.match(journey,/const canEdit = state\.canEdit!==false/);
  assert.doesNotMatch(journey,/myRole==='owner' \|\| myRole==='editor'/);
  assert.match(growth,/\$\{maturityOffsetPrompt\(mat,a\)\}[\s\S]*\$\{growthPrompt\(mat\)\}[\s\S]*<div class="section-head">/);
});

test('co-parents can change the athlete plan while family viewers do not see edit controls',()=>{
  const profile=read('js/screen-profile.js'), account=read('js/account.js');
  assert.match(profile,/const canEdit=state\.canEdit!==false/);
  assert.match(profile,/\$\{canEdit\?'<button class="btn sm ghost" id="editSched">Edit<\/button>'/);
  assert.match(profile,/x\.role==='co_parent'\|\|x\.role==='owner'\?'edit':'view'/);
  assert.match(account,/\$\{state\.canEdit\?H`<div class="navrow danger" id="delAthlete"/);
  assert.match(account,/if\(state\.canEdit\) fillScanConsents\(\)/);
});

test('scan history groups all outputs from one body scan into one session',()=>{
  const c=vm.createContext({Map,String,Date,JSON});
  vm.runInContext(read('js/scan-record.js').split('async function saveScanRecord')[0],c);
  const scan=read('js/screen-scan.js');
  vm.runInContext(scan.slice(0,scan.indexOf('async function screenScan')),c);
  const note='PP_SCAN_V1:'+JSON.stringify({schema:1,id:'scan-1',athlete_id:'a1',captured_at:'2026-09-13T12:00:00Z',engine:{id:'pose',version:'1',model:'m'}});
  const grouped=c.scanHistorySessions([
    {id:'r1',athlete_id:'a1',metric_key:'wingspan',measured_on:'2026-09-13',source:'photo',note},
    {id:'r2',athlete_id:'a1',metric_key:'reach',measured_on:'2026-09-13',source:'photo',note},
    {id:'r3',athlete_id:'a1',metric_key:'vertical',measured_on:'2026-09-12',source:'video',note:null},
  ]);
  assert.equal(grouped.length,2);
  assert.equal(grouped[0].rows.length,2);
});

test('a youth body scan records guardian permission and child agreement before capture',()=>{
  const body=read('js/body-scan.js');
  assert.match(body,/2026-09-13\.ondevice\.v5/);
  assert.match(body,/id="bsOk3"/);
  assert.match(body,/they agree to have these\s+four photographs taken/);
  assert.match(body,/minor_assent_attested: minor \? true : null/);
  assert.doesNotMatch(body,/if\s*\(age\s*<\s*ADULT_AGE\)\s*return\s*\{\s*ok:false/);
});
