const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
  const c=vm.createContext({console});
  vm.runInContext(`function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`,c);
  for(const file of ['dates','body-outputs','scan-record','body-insights','assessment-report'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+file+'.js'),'utf8'),c);
  return c;
}
const row=(value,date='2026-09-09',extra={})=>({id:'m',athlete_id:'a',metric_key:'wingspan',value,unit:'in',source:'photo',measured_on:date,...extra});
test('report uses selected dates and escapes user data without external assets',()=>{
  const c=setup(),html=c.assessmentReport({first_name:'<script>bad()</script>'},[row(60,'2026-06-01'),row(63),row(999,'2026-10-01')],'2026-09-09','2026-06-01');
  assert.ok(html.includes('63 in'));assert.ok(html.includes('+3 in'));assert.ok(!html.includes('999 in'));assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('src='));assert.ok(html.includes('default-src'));
});
test('report does not compare incompatible units or fabricate empty results',()=>{
  const c=setup();assert.ok(c.assessmentReport({},[row(60),row(150,'2026-06-01',{unit:'cm'})],'2026-09-09','2026-06-01').includes('Different units'));
  assert.ok(c.assessmentReport({},[],'','').includes('No recorded measurements'));
});
test('CSV escapes commas, quotes, newlines and spreadsheet formulas while preserving numbers',()=>{
  const c=setup(),csv=c.assessmentCSV([row(60,'2026-09-09',{metric_key:'=HYPERLINK("bad")',id:'one,\n"two"'})]);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(csv.includes('"one,\n""two"""'));assert.ok(csv.includes('"60"'));
  for(const metric_key of [' +1','@SUM(A1)','-1+2','\t=1']) assert.ok(c.assessmentCSV([row(1,'2026-09-09',{metric_key})]).includes('"\''+metric_key));
});
test('recorded timing and file-check protocol appear in reports and exports with their scope',()=>{
  const c=setup();let id=0;c.uuid=()=>String(++id);
  const record=c.buildScanRecord({metrics:{wingspan:60},detail:{photoIdentity:{protocol:'exact-photo-bytes-v1',checked_views:4,distinct_files:true,digest:'PRIVATE'}}},{athleteId:'a',actorId:'p',consentId:'release',engine:{id:'pose',version:'1.2.1'},defaultUnit:'in',capturedAt:'2026-09-09T12:00:00Z',processingMs:1800});
  const html=c.assessmentReport({first_name:'Example'},record.rows,'2026-09-09',''),csv=c.assessmentCSV(record.rows);
  assert.match(html,/Measurement processing: 1.8 s/);assert.match(html,/Excludes photo capture, review and saving/);assert.match(html,/Four different photo files/);
  assert.match(csv,/measurement_processing_ms/);assert.match(csv,/"1800"/);assert.match(csv,/exact-photo-bytes-v1/);assert.ok(!csv.includes('PRIVATE'));
});
