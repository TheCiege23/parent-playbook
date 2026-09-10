const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(extra={}){
  const c=vm.createContext({console:{...console,warn(){}},crypto:require('node:crypto').webcrypto,...extra});
  for(const file of ['body-outputs','photo-identity','photo-quality','pose-measure'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+file+'.js'),'utf8'),c);
  return c;
}
function pose(){
  const n=Array.from({length:33},()=>({x:.5,y:.4,z:0,visibility:.9}));
  for(const [i,x,y] of [[0,.5,.1],[2,.48,.12],[5,.52,.12],[7,.46,.15],[8,.54,.15],[11,.39,.28],[12,.61,.28],[13,.38,.41],[14,.62,.41],[15,.37,.53],[16,.63,.53],[23,.43,.5],[24,.57,.5],[25,.43,.7],[26,.57,.7],[27,.43,.88],[28,.57,.88],[29,.43,.9],[30,.57,.9],[31,.42,.91],[32,.58,.91]])Object.assign(n[i],{x,y});
  return {landmarks:[n],worldLandmarks:[n.map(p=>({x:p.x*1.8,y:p.y*1.8,z:0}))]};
}
test('photo checks accept a clear upright frame without claiming accuracy',()=>{
  const c=setup(),r=c.checkPhotoPose(pose(),'front');assert.equal(r.accepted,true);assert.equal(r.protocol,'photo-quality-v1');
  const summary=c.photoCheckSummary(r);assert.ok(!JSON.stringify(summary).includes('landmarks'));assert.ok(!('accuracy' in summary));
});
test('missing people, multiple people and malformed model results fail closed',()=>{
  const c=setup();for(const result of [null,{landmarks:[]},{landmarks:[[],[]]}, {landmarks:[[]]}, {landmarks:pose().landmarks,worldLandmarks:[[]]}])assert.equal(c.checkPhotoPose(result,'front').accepted,false);
  const bad=pose();bad.worldLandmarks[0][25].x=NaN;assert.equal(c.checkPhotoPose(bad,'front').accepted,false);
});
test('cropped feet, weak landmarks, small subjects and invalid views are rejected',()=>{
  const c=setup();const cases=[p=>p.landmarks[0][31].y=1,p=>p.landmarks[0][25].visibility=.1,p=>{for(const n of p.landmarks[0])n.y=.4+n.y*.2;}];
  for(const mutate of cases){const p=pose();mutate(p);assert.equal(c.checkPhotoPose(p,'front').accepted,false);}
  assert.equal(c.checkPhotoPose(pose(),'unknown').accepted,false);
});
test('side views allow an occluded far side; direction checks stay advisory',()=>{
  const c=setup(),p=pose();for(const i of [12,24,26,28])p.landmarks[0][i].visibility=.1;
  assert.equal(c.checkPhotoPose(p,'left').accepted,true);assert.equal(c.checkPhotoPose(p,'front').accepted,false);
  const wide=pose();wide.landmarks[0][11].x=.3;wide.landmarks[0][12].x=.7;
  const result=c.checkPhotoPose(wide,'right');assert.equal(result.accepted,true);assert.ok(result.warnings.some(r=>r.code==='check_direction'));
});
test('review releases bitmaps after a successful check and after inference failure',async()=>{
  let closed=0;const c=setup({createImageBitmap:async()=>({close(){closed++;}})});
  c.loadPoseLandmarker=async()=>({detect:()=>pose()});await c.reviewPosePhoto({frame:{},view:'front'});assert.equal(closed,1);
  c.loadPoseLandmarker=async()=>({detect(){throw Error('GPU lost');}});await assert.rejects(c.reviewPosePhoto({frame:{},view:'front'}),/GPU lost/);assert.equal(closed,2);
});
test('the actual measurement provider enforces four checked views and records the protocol',async()=>{
  let closed=0;const c=setup({createImageBitmap:async()=>({close(){closed++;}})});
  c.loadPoseLandmarker=async()=>({detect:()=>pose()});
  const frames=Object.fromEntries(['front','right','back','left'].map(k=>[k,new Blob([k])]));
  const result=await c.measureFromFrames({frames,heightIn:60});
  assert.equal(Object.keys(result.metrics).length,25);assert.equal(result.detail.captureChecks.length,4);assert.equal(closed,4);assert.equal(result.detail.sideMethod,'front-joint-proxy-v2');assert.equal(result.detail.outputDictionary,'body-outputs-v2');assert.ok(!JSON.stringify(result).includes('worldLandmarks'));
  assert.equal(result.detail.photoIdentity.distinct_files,true);
  await assert.rejects(c.measureFromFrames({frames:{...frames,left:new Blob(['front'])},heightIn:60}),/duplicate_photos/);assert.equal(closed,4);
  await assert.rejects(c.measureFromFrames({frames:{front:{},back:{}},heightIn:60}),/needs_four_views/);
  c.loadPoseLandmarker=async()=>({detect:()=>({landmarks:[[],[]]})});
  await assert.rejects(c.measureFromFrames({frames,heightIn:60}),/capture_quality/);assert.equal(closed,8);
});
