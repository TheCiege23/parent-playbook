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
  // A square photo, so the normalized ratio and the pixel ratio are the same number and this
  // case still asserts exactly what it always asserted.
  const result=c.checkPhotoPose(wide,'right',{width:1000,height:1000});assert.equal(result.accepted,true);assert.ok(result.warnings.some(r=>r.code==='check_direction'));
  // Without dimensions the ratio cannot be computed, only guessed, so the check stays silent
  // rather than telling a parent to re-take a photo on a number it could not work out.
  assert.ok(!c.checkPhotoPose(wide,'right').warnings.some(r=>r.code==='check_direction'));
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

test('the direction check does not depend on the shape of the photograph',()=>{
  // Normalized x is a fraction of the photo's width and normalized y a fraction of its
  // height, so width/torso only becomes a ratio of two lengths once the aspect is put back.
  // Before that, the same athlete at the same angle crossed the 0.4 threshold in a 4:3 photo
  // and cleared it in a 3:4 one: a warning about which way a child is facing that actually
  // depended on the shape of the picture.
  const c=setup();
  // Shoulders 300px apart, torso 400px: a true ratio of 0.75, comfortably facing the camera.
  const framed=(w,h)=>{
    const p=pose();
    const shoulderNorm=300/w, torsoNorm=400/h;
    p.landmarks[0][11].x=.5-shoulderNorm/2; p.landmarks[0][12].x=.5+shoulderNorm/2;
    p.landmarks[0][11].y=.30; p.landmarks[0][12].y=.30;
    p.landmarks[0][23].y=.30+torsoNorm;    p.landmarks[0][24].y=.30+torsoNorm;
    return c.checkPhotoPose(p,'front',{width:w,height:h});
  };
  const warned=r=>r.warnings.some(x=>x.code==='check_direction');
  assert.equal(warned(framed(1200,1200)),false,'square: a facing athlete should not be warned');
  assert.equal(warned(framed(1200,1600)),false,'portrait: the same athlete, the same verdict');
  assert.equal(warned(framed(1600,1200)),false,'landscape: the same athlete, the same verdict');
});

test('a genuinely turned athlete is still flagged, in any photo shape',()=>{
  const c=setup();
  const framed=(w,h)=>{
    const p=pose();
    const shoulderNorm=90/w, torsoNorm=400/h;   // true ratio 0.225 — clearly turned away
    p.landmarks[0][11].x=.5-shoulderNorm/2; p.landmarks[0][12].x=.5+shoulderNorm/2;
    p.landmarks[0][11].y=.30; p.landmarks[0][12].y=.30;
    p.landmarks[0][23].y=.30+torsoNorm;    p.landmarks[0][24].y=.30+torsoNorm;
    return c.checkPhotoPose(p,'front',{width:w,height:h});
  };
  const warned=r=>r.warnings.some(x=>x.code==='check_direction');
  for(const [label,w,h] of [['square',1200,1200],['portrait',1200,1600],['landscape',1600,1200]])
    assert.equal(warned(framed(w,h)),true,`${label}: a turned athlete should still be flagged`);
});

test('a malformed dimensions object is treated as unknown, not as a ratio',()=>{
  const c=setup();
  const wide=pose();wide.landmarks[0][11].x=.3;wide.landmarks[0][12].x=.7;
  const warned=d=>c.checkPhotoPose(wide,'right',d).warnings.some(x=>x.code==='check_direction');
  // Zero or negative dimensions would make the ratio infinite or sign-flipped; none of these
  // may produce a verdict.
  for(const d of [{width:0,height:1000},{width:1000,height:0},{width:-4,height:10},{},null])
    assert.equal(warned(d),false,`dimensions ${JSON.stringify(d)} should not produce a direction verdict`);
});
