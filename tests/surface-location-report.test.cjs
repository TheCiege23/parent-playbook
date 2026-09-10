const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../js/body-surface-report.mjs');
function section(planeCm=100){return {protocol:'operator-surface-section-v1',status:'experimental',axis:'y',scaleStatus:'assumed-stature-not-validated',label:'Marked line',planeCm,surfacePerimeterCm:90,widthCm:30,depthCm:20,reference:null,
 source:{protocol:'orthographic-four-silhouette-v1',fingerprintProtocol:'surface-json-sha256-v1',sha256:'a'.repeat(64),heightM:1.8,resolution:64}};}
test('location report snapshots only scalar fields and recomputes errors from the recorded tape',async()=>{
 const {createSurfaceReport}=await api,a=section(),b=section(110);b.reference={tapeCm:100,signedErrorCm:999,absoluteErrorCm:999};a.vertices=['PRIVATE'];a.source.account='PRIVATE';
 const r=createSurfaceReport([a,b]);assert.equal(r.locationCount,2);assert.equal(r.referenceCount,1);assert.equal(r.sections[1].reference.signedErrorCm,-10);assert.equal(r.sections[1].reference.absoluteErrorPercent,10);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(r.sections[0].reference,null);
 a.label='changed';assert.equal(r.sections[0].label,'Marked line');assert.equal(r.pass,undefined);assert.match(r.limitations,/not independent scan trials/);
});
test('mixed surfaces, methods, duplicate heights and excess rows cannot form a report',async()=>{
 const {createSurfaceReport}=await api;
 for(const change of [b=>b.source.sha256='b'.repeat(64),b=>b.source.resolution=96,b=>b.source.heightM=1.9]){const b=section(110);change(b);assert.throws(()=>createSurfaceReport([section(),b]),/same source/);}
 assert.throws(()=>createSurfaceReport([section(),section()]),/distinct/);assert.throws(()=>createSurfaceReport([]));assert.throws(()=>createSurfaceReport(Array.from({length:13},(_,i)=>section(i+1))));
 assert.equal(createSurfaceReport(Array.from({length:12},(_,i)=>section(i+1))).locationCount,12);
});
test('invalid report values fail before export instead of becoming null or misleading numbers',async()=>{
 const {createSurfaceReport}=await api;
 for(const change of [s=>s.source.sha256='fake',s=>s.planeCm=180,s=>s.widthCm=NaN,s=>s.depthCm=0,s=>s.reference={tapeCm:Number.MIN_VALUE},s=>s.label='',s=>s.status='validated']){const s=section();change(s);assert.throws(()=>createSurfaceReport([s]),{code:'INVALID_SURFACE_REPORT'});}
});
test('printable report is self-contained, escapes labels and distinguishes missing references',async()=>{
 const {surfaceReportHTML}=await api,a=section(),b=section(120);a.label='<script>alert("x")</script>';b.reference={tapeCm:80};
 const html=surfaceReportHTML([a,b]);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('src='));assert.match(html,/Not entered/);assert.match(html,/\+10.0/);assert.match(html,/one source surface/);assert.match(html,/No pass\/fail accuracy threshold/);
});
test('pose-guided locations preserve bounded plane provenance and reject forged labels or heights',async()=>{
 const {createSurfaceReport,surfaceReportHTML}=await api,s=section();s.protocol='pose-plane-surface-section-v1';s.label='Pose-inferred torso midpoint plane';s.planeSource={protocol:'four-view-pose-plane-markers-v1',key:'torso_midpoint',label:s.label,inputViewCount:4,planeCm:s.planeCm,maxViewSpreadCm:2.4};s.contourSelection={protocol:'unique-contour-containing-reconstruction-axis-v1',candidateContourCount:3,containingAxisCount:1};
 const r=createSurfaceReport([s]);assert.equal(r.sections[0].planeSource.key,'torso_midpoint');assert.equal(r.sections[0].planeSource.maxViewSpreadCm,2.4);assert.match(surfaceReportHTML([s]),/Four-view pose guide; spread 2.4 cm/);
 assert.equal(r.sections[0].contourSelection.candidateContourCount,3);assert.throws(()=>createSurfaceReport([{...s,label:'waist'}]),/provenance/);assert.throws(()=>createSurfaceReport([{...s,planeCm:101}]),/provenance/);assert.throws(()=>createSurfaceReport([{...s,contourSelection:{...s.contourSelection,containingAxisCount:2}}]),/unambiguous/);const manual=section();manual.planeSource=s.planeSource;assert.throws(()=>createSurfaceReport([manual]),/cannot claim/);
});
