const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
 let n=0;const c=vm.createContext({console,uuid:()=>`id-${++n}`});
 vm.runInContext(`function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`,c);
 for(const file of ['dates','body-outputs','scan-record','body-insights','assessment-report'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+file+'.js'),'utf8'),c);
 return c;
}
function joints(){
 const world=Array.from({length:33},()=>({x:0,y:0,z:0})),norm=Array.from({length:33},()=>({visibility:.9}));
 for(const [i,x,y] of [[11,0,0],[12,10,0],[13,3,4],[15,3,9],[14,16,8],[16,16,18],[23,0,20],[25,0,40],[27,0,60],[29,0,63],[31,0,66],[24,10,20],[26,10,42],[28,10,65],[30,10,68],[32,10,72]])world[i]={x,y,z:0};
 return {world,norm};
}
function record(c,metrics,date='2026-09-09'){
 return c.buildScanRecord({metrics,detail:{sideMethod:'front-joint-proxy-v2',outputDictionary:'body-outputs-v2'}},{athleteId:'a',actorId:'p',consentId:'consent',capturedAt:date+'T12:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'test'},height:{value:60,measured_on:date},defaultUnit:'in'});
}
test('eighteen side outputs preserve straight and joint-path geometry with common height scaling',()=>{
 const c=setup(),p=joints(),out=c.estimateFrontSegments(p.world,p.norm,60,100);
 assert.equal(Object.keys(out.metrics).length,18);assert.equal(out.metrics.left_upper_arm_length,3);assert.equal(out.metrics.right_upper_arm_length,6);
 assert.equal(out.metrics.left_thigh_length,12);assert.equal(out.metrics.right_thigh_length,13.2);assert.equal(out.metrics.right_lower_leg_length,13.8);
 assert.equal(out.metrics.left_arm_path_length,6);assert.equal(out.metrics.right_arm_path_length,12);assert.equal(out.metrics.left_leg_path_length,24);assert.equal(out.metrics.right_leg_path_length,27);
 const scaled=c.estimateFrontSegments(p.world,p.norm,72,100);assert.equal(scaled.metrics.left_upper_arm_length,3.6);
});
test('weak landmarks, nonfinite coordinates and implausible segments stay missing',()=>{
 const c=setup(),p=joints();p.norm[15].visibility=.74;p.world[24].x=NaN;p.world[28].y=200;
 const out=c.estimateFrontSegments(p.world,p.norm,60,100);
 assert.equal(out.metrics.left_forearm_length,undefined);assert.equal(out.metrics.right_thigh_length,undefined);assert.equal(out.metrics.right_lower_leg_length,undefined);assert.equal(out.metrics.left_upper_arm_length,3);
 assert.ok(out.skipped.length>=3);assert.ok(out.skipped.some(s=>s.key==='left_arm_path_length'));assert.ok(out.skipped.some(s=>s.key==='right_leg_path_length'));assert.equal(Object.keys(c.estimateFrontSegments(p.world,p.norm,NaN,100).metrics).length,0);
});
test('side comparison requires correct counterpart keys and one compatible assessment',()=>{
 const c=setup(),a=record(c,{left_upper_arm_length:10,right_upper_arm_length:10.4}),b=record(c,{right_upper_arm_length:10.4});
 assert.equal(c.compareBodySides(a.rows[0],a.rows[1]).difference,.4);
 assert.equal(c.compareBodySides(a.rows[0],b.rows[0]).difference,null);
 assert.equal(c.compareBodySides(a.rows[0],{...a.rows[1],unit:'cm'}).difference,null);
 assert.equal(c.compareBodySides(a.rows[0],{...a.rows[1],metric_key:'right_thigh_length'}).difference,null);
 assert.equal(c.compareBodySides(a.rows[0],null).difference,null);
 assert.equal(c.compareBodySides({...a.rows[0],note:'legacy'},a.rows[1]).difference,null);
});
test('latest side panel never fills a missing side from an older scan or future date',()=>{
 const c=setup(),older=record(c,{left_upper_arm_length:9,right_upper_arm_length:9.8},'2026-08-01'),latest=record(c,{left_upper_arm_length:10}),future=record(c,{left_upper_arm_length:99,right_upper_arm_length:99},'2026-10-01');
 const html=c.biSidePairs([...older.rows,...latest.rows,...future.rows],'2026-09-09');
 assert.ok(html.includes('10 in'));assert.ok(!html.includes('9.8 in'));assert.ok(!html.includes('99 in'));assert.ok(html.includes('Both sides were not recorded'));
 assert.ok(c.biSidePairs(older.rows,'2026-07-01')==='');
});
test('dictionary, report and CSV carry definitions and provenance without landmarks',()=>{
 const c=setup(),r=record(c,{left_upper_arm_length:10,right_upper_arm_length:11});
 assert.equal(vm.runInContext('Object.keys(BODY_OUTPUTS).length',c),25);assert.equal(r.meta.side_method,'front-joint-proxy-v2');assert.equal(r.meta.output_dictionary,'body-outputs-v2');
 const html=c.assessmentReport({first_name:'Sample'},r.rows,'2026-09-09','');assert.ok(html.includes('Left & right segment estimates'));assert.ok(html.includes('shoulder and elbow'));assert.ok(html.includes('not a diagnosis'));
 const csv=c.assessmentCSV(r.rows);assert.ok(csv.includes('front-joint-proxy-v2'));assert.ok(csv.includes('body-outputs-v2'));assert.ok(!csv.includes('worldLandmarks'));
});
