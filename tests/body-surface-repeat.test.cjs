const test=require('node:test'),assert=require('node:assert/strict');
let Repeat;
test.before(async()=>{Repeat=await import('../js/body-surface-repeat.mjs');});
const keys=['shoulder_midpoint','torso_midpoint','hip_midpoint'];
function sections(sha='a'.repeat(64),offset=0){
  const source={protocol:'orthographic-four-silhouette-v1',fingerprintProtocol:'surface-json-sha256-v1',sha256:sha,heightM:1.88,resolution:64};
  return keys.map((key,index)=>{const planeCm=[156.9,128.1,98.8][index]+offset,perimeter=[117.5,164.5,123.3][index]+offset;return {protocol:'pose-plane-surface-section-v1',status:'experimental',axis:'y',scaleStatus:'assumed-stature-not-validated',source,label:'Pose '+key,planeCm,planeSource:{protocol:'four-view-pose-plane-markers-v1',key,label:'Pose '+key,inputViewCount:4,planeCm,maxViewSpreadCm:[3.9,2.3,1.7][index]},contourSelection:{protocol:'unique-contour-containing-reconstruction-axis-v1',candidateContourCount:key==='hip_midpoint'?3:1,containingAxisCount:1},surfacePerimeterCm:perimeter,widthCm:40+index,depthCm:30+index,reference:null};});
}
test('three pose sections become a scalar snapshot with no geometry or tape values',()=>{
  const input=sections(),snapshot=Repeat.createPoseRepeatSnapshot(input),text=JSON.stringify(snapshot);
  assert.equal(snapshot.sections.length,3);assert.equal(snapshot.sections[2].candidateContourCount,3);assert.ok(!text.includes('vertices'));assert.ok(!text.includes('reference'));assert.equal(snapshot.source.sha256,'a'.repeat(64));
});
test('independent snapshots report plane and perimeter differences without an accuracy claim',()=>{
  const first=Repeat.createPoseRepeatSnapshot(sections()),second=Repeat.createPoseRepeatSnapshot(sections('b'.repeat(64),2));
  const report=Repeat.createPoseRepeatReport(first,second);assert.equal(report.sections.length,3);assert.equal(report.sections[0].difference.planeCm,2);assert.equal(report.sections[0].difference.surfacePerimeterCm,2);assert.equal(report.summary.maximumAbsolutePerimeterDifferenceCm,2);assert.equal(report.pass,undefined);assert.equal(report.accuracy,undefined);
  const html=Repeat.poseRepeatReportHTML(first,second);assert.match(html,/second capture minus first/);assert.match(html,/\+2\.0/);assert.ok(!html.includes('<script>'));
});
test('same surface, mismatched methods and incomplete pose sets are rejected',()=>{
  const first=Repeat.createPoseRepeatSnapshot(sections());
  assert.throws(()=>Repeat.createPoseRepeatReport(first,Repeat.createPoseRepeatSnapshot(sections())),/same surface/);
  const changed=sections('b'.repeat(64));changed.forEach(section=>section.source.resolution=96);assert.throws(()=>Repeat.createPoseRepeatReport(first,Repeat.createPoseRepeatSnapshot(changed)),/same reconstruction/);
  assert.throws(()=>Repeat.createPoseRepeatSnapshot(sections().slice(0,2)),/shoulder/);
  const duplicate=sections();duplicate[2].planeSource.key='torso_midpoint';assert.throws(()=>Repeat.createPoseRepeatSnapshot(duplicate),/exactly once/);
});
test('mutated snapshots cannot inject invalid values or fingerprints into a comparison',()=>{
  const first=Repeat.createPoseRepeatSnapshot(sections()),second=Repeat.createPoseRepeatSnapshot(sections('b'.repeat(64)));
  for(const mutate of [s=>s.source.sha256='secret',s=>s.createdAt='not-a-date',s=>s.sections[0].label='',s=>s.sections[0].surfacePerimeterCm=NaN,s=>s.sections[0].candidateContourCount=0,s=>s.sections[0].key='waist']){const copy=structuredClone(second);mutate(copy);assert.throws(()=>Repeat.createPoseRepeatReport(first,copy));}
});
