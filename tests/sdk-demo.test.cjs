const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
let reportAPI;test.before(async()=>{reportAPI={...await import('../js/body-surface-report.mjs'),...await import('../js/body-surface-repeat.mjs'),...await import('../js/body-sdk-report.mjs'),...await import('../js/body-sdk-record.mjs')};});
function setup(){
  const elements={},urls=[],revoked=[],callbacks={},created=[];let next;
  const canvas={beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){}};
  const el=id=>elements[id]??={value:'',checked:false,files:[],hidden:true,disabled:false,textContent:'',naturalWidth:2316,naturalHeight:3088,getContext:()=>canvas,append(){},replaceChildren(){},querySelector(){return el(id+'-button');},addEventListener(name,fn){this['on'+name]=fn;},removeAttribute(k){delete this[k];},remove(){this.isConnected=false;},click(){this.clickedWhileConnected=!!this.isConnected;}};
  const scanner={scan:async()=>{throw next;},reviewPhoto:async()=>({accepted:true,reasons:[],warnings:[]}),dispose(){}};
  const c=vm.createContext({...reportAPI,renderSurfacePreview:(host,surface)=>{host.rendered=true;return ()=>{host.disposed=true;surface.mesh.vertices.length=surface.mesh.faces.length=0;surface.mesh=null;};},createBodyScanner:()=>scanner,AbortController,Blob,console,setTimeout,URL:{createObjectURL(b){const url='blob:'+urls.length;urls.push({url,b});return url;},revokeObjectURL(u){revoked.push(u);}},addEventListener:(name,fn)=>{callbacks[name]=fn;},document:{getElementById:el,createElement:()=>{const node=el('new-'+Math.random());created.push(node);return node;},body:{append(node){node.isConnected=true;}},querySelectorAll:()=>Object.values(elements)}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../tools/sdk-demo.mjs'),'utf8').replace("import {createBodyScanner,renderSurfacePreview} from '/js/body-sdk.mjs';",'').replace("import {createSurfaceReport,surfaceReportHTML} from '/js/body-surface-report.mjs';",'').replace("import {createPoseRepeatSnapshot,createPoseRepeatReport,poseRepeatReportHTML} from '/js/body-surface-repeat.mjs';",'').replace("import {measurementSummaryHTML,measurementReportHTML,measurementReportStyles} from '/js/body-sdk-report.mjs';",'').replace("import {createCompanyAssessmentStore} from '/js/body-sdk-record.mjs';",''),c);
  return {c,el,urls,revoked,callbacks,created,scanner,setError:e=>{next=e;}};
}

test('company dashboard renders real contract values, converts display units and clears its printable report',async()=>{
  const s=setup();s.el('permission').checked=true;s.el('height').value='74';
  s.scanner.scan=async()=>({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.10.0',createdAt:'2026-09-09T12:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'reference'},outputDictionary:'body-outputs-v2',status:'provisional',heightIn:74,processingMs:1400,measurements:[{key:'wingspan',value:76.4,unit:'in',definition:'Estimated wingspan.'}]});
  await s.el('scan').onclick();assert.equal(s.el('measurementDashboard').hidden,false);assert.match(s.el('measurementCards').innerHTML,/76.4 in/);assert.equal(s.el('measurementPrint').disabled,false);
  s.el('measurementUnit').value='cm';s.el('measurementUnit').onchange();assert.match(s.el('measurementCards').innerHTML,/194.1 cm/);
  s.el('measurementPrint').onclick();assert.match(await s.urls.at(-1).b.text(),/194.1 cm/);
  s.el('clear').onclick();assert.equal(s.el('measurementDashboard').hidden,true);assert.equal(s.el('measurementCards').innerHTML,'');assert.equal(s.el('measurementPrint').disabled,true);
});

test('company rehearsal saves, reopens, exports and deletes only under its simulated host session',async()=>{
  const s=setup();s.el('permission').checked=true;s.el('height').value='74';
  s.scanner.scan=async()=>({schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.10.0',createdAt:'2026-09-09T12:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'reference'},outputDictionary:'body-outputs-v2',status:'provisional',heightIn:74,processingMs:1400,measurements:[{key:'wingspan',value:76.4,unit:'in',definition:'Estimated wingspan.'}]});
  s.el('companySession').checked=true;s.el('companyOrg').value='demo-company';s.el('companyActor').value='demo-operator';s.el('companySubject').value='adult-reference-001';s.el('companyConsent').value='consent-001';s.el('companyAssessmentId').value='assessment-001';
  await s.el('scan').onclick();await s.el('companySave').onclick();assert.match(s.el('companyStatus').textContent,/Saved/);const saved=JSON.parse(s.el('companyRecord').textContent);assert.equal(saved.photos,undefined);assert.equal(saved.assessment.photos,undefined);
  s.el('clear').onclick();await s.el('companyReopen').onclick();assert.match(s.el('companyStatus').textContent,/Reopened/);assert.match(s.el('companyRecord').textContent,/assessment-001/);
  await s.el('companyExport').onclick();const record=JSON.parse(await s.urls.at(-1).b.text());assert.equal(record.schema,'PP_COMPANY_BODY_ASSESSMENT_V1');assert.equal(record.assessment.measurements.length,1);assert.equal(s.el('companyExportDownload').hidden,false);assert.equal(s.el('companyExportDownload').download,'body-assessment-assessment-001.json');assert.match(s.el('companyStatus').textContent,/Fresh authorization passed/);
  s.el('companySession').checked=false;await s.el('companyDelete').onclick();assert.match(s.el('companyStatus').textContent,/AUTH_REQUIRED/);
  s.el('companySession').checked=true;await s.el('companyDelete').onclick();assert.match(s.el('companyStatus').textContent,/Deleted/);await s.el('companyReopen').onclick();assert.match(s.el('companyStatus').textContent,/NOT_FOUND/);
});

test('demo keeps passed photo feedback and exports a rejected 3D outcome separately from lengths',async()=>{
  const s=setup();s.el('permission').checked=s.el('surfaceEnabled').checked=true;s.el('height').value='74';
  s.scanner.scanWithSurface=async()=>({sdkVersion:'0.8.0',surfaceStatus:'rejected',surface:null,surfaceFailure:{code:'DISCONNECTED_SURFACE',message:'The reconstructed surface contains disconnected regions.',diagnostics:{componentCount:2}},assessment:{createdAt:'2026-09-09T00:00:00Z',measurements:[{key:'wingspan',value:76}],processingMs:100,captureChecks:[{view:'front',accepted:true,warnings:[]}]}});
  await s.el('scan').onclick();assert.equal(s.el('front-status').textContent,'Capture checks passed.');assert.match(s.el('status').textContent,/3D: rejected/);
  assert.equal(s.el('surfacePreview').hidden,true);assert.equal(s.el('surfaceOutcome').hidden,false);
  s.el('surfaceOutcomeDownload').onclick();const outcome=JSON.parse(await s.urls.at(-1).b.text());assert.equal(outcome.surfaceStatus,'rejected');assert.equal(outcome.surfaceFailure.code,'DISCONNECTED_SURFACE');assert.equal(outcome.measurements,undefined);
  s.el('download').onclick();const lengths=JSON.parse(await s.urls.at(-1).b.text());assert.equal(lengths.measurements.length,1);assert.equal(lengths.surfaceFailure,undefined);
  s.el('height').oninput();assert.equal(s.el('surfaceOutcome').hidden,true);assert.equal(s.el('surfaceOutcomeDownload').disabled,true);
});
test('SDK demo shows each failed view and preserves successful views after scan rejection',async()=>{
  const s=setup();s.setError({code:'CAPTURE_QUALITY',message:'generic',captureChecks:[{view:'front',accepted:false,reasons:['frame_edge']},...['right','back','left'].map(view=>({view,accepted:true,reasons:[]}))]});
  await s.el('scan').onclick();assert.match(s.el('status').textContent,/front/);assert.match(s.el('front-status').textContent,/below both feet/);assert.equal(s.el('right-status').textContent,'Capture checks passed.');assert.equal(s.el('download').disabled,true);
});
test('photo previews release old URLs, distinguish HEIC, and cannot overwrite completed review feedback',async()=>{
  const s=setup();s.el('front').files=[{name:'one.png',type:'image/png'}];s.el('front').onchange();const oldLoad=s.el('preview-front').onload;oldLoad();assert.match(s.el('front-status').textContent,/2316/);
  s.el('front').files=[{name:'two.png',type:'image/png'}];s.el('front').onchange();assert.equal(s.revoked[0],'blob:0');oldLoad();assert.equal(s.el('front-status').textContent,'Photo changed; review again.');
  await s.c.perform('front');s.el('preview-front').onload();assert.match(s.el('front-status').textContent,/Capture checks passed/);
  s.el('front').files=[{name:'original.HEIC',type:''}];s.el('front').onchange();assert.match(s.el('front-status').textContent,/HEIC/);assert.equal(s.el('preview-front').hidden,true);assert.equal(s.urls.length,2);
  s.el('right').files=[{name:'right.png',type:'image/png'}];s.el('right').onchange();s.el('clear').onclick();assert.ok(s.revoked.includes('blob:2'));assert.equal(s.el('preview-right').src,undefined);
});

test('company demo opts into the combined API but downloads only lengths and clears preview geometry',async()=>{
  const s=setup(),mesh={vertices:[[0,1,0]],faces:[[0,0,0]],topologyAdjustment:{protocol:'surface-lower-artifact-removal-v1',componentCountBefore:2,originalOccupiedVoxels:4784,removedVoxels:14,removedFraction:14/4784,affectedFromFloorFraction:.015625,affectedToFloorFraction:.046875}};let received;
  s.el('permission').checked=true;s.el('surfaceEnabled').checked=true;s.el('height').value='70';
  s.scanner.scanWithSurface=async options=>{received=options;return {sdkVersion:'0.12.0',surfaceStatus:'generated',surface:{mesh},assessment:{schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.12.0',createdAt:'2026-09-09T12:00:00Z',engine:{id:'ondevice-pose',version:'1.3.0',model:'reference'},outputDictionary:'body-outputs-v2',status:'provisional',heightIn:70,measurements:[{key:'wingspan',value:70,unit:'in',definition:'Estimated wingspan.'}],processingMs:100}};};
  await s.el('scan').onclick();assert.equal(received.surfacePermissionAcknowledged,true);assert.equal(await received.checkPermission(),true);assert.equal(typeof received.mountReview,'function');
  assert.equal(s.el('surfacePreview').rendered,true);assert.match(s.el('status').textContent,/3D: generated/);assert.ok(!s.el('result').textContent.includes('vertices'));
  const outcome=JSON.parse(s.el('surfaceOutcomeResult').textContent);assert.equal(outcome.surfaceAdjustment.removedVoxels,14);assert.equal(outcome.surfaceAdjustment.originalOccupiedVoxels,4784);
  s.el('companySession').checked=true;s.el('companyOrg').value='demo-company';s.el('companyActor').value='demo-operator';s.el('companySubject').value='adult-reference-001';s.el('companyConsent').value='consent-001';s.el('companyAssessmentId').value='surface-001';
  await s.el('companySave').onclick();const saved=JSON.parse(s.el('companyRecord').textContent);assert.equal(saved.surfaceProcessing.adjustment.removedVoxels,14);assert.equal(saved.surfaceProcessing.adjustment.privateMask,undefined);
  s.el('download').onclick();const downloaded=JSON.parse(await s.urls.at(-1).b.text());assert.equal(downloaded.schema,'PP_BODY_SDK_RESULT_V1');assert.equal(downloaded.surface,undefined);
  s.el('clear').onclick();assert.equal(mesh.vertices.length,0);assert.equal(s.el('surfacePreview').disposed,true);assert.equal(await received.checkPermission(),false);assert.equal(s.el('download').disabled,true);
});

test('demo section report excludes contour geometry and input edits invalidate the old comparison',async()=>{
  const s=setup();s.el('permission').checked=true;s.el('surfaceEnabled').checked=true;
  s.scanner.scanWithSurface=async()=>({surfaceStatus:'generated',surface:{mesh:{vertices:[[0,1,0]],faces:[[0,0,0]]}},assessment:{measurements:[{value:70}],processingMs:1}});
  await s.el('scan').onclick();s.el('sectionLabel').value='Marked line';s.el('sectionPlane').value='100';s.el('sectionTape').value='260';let received;
  s.scanner.measureSurfaceSection=async opts=>{received=opts;return {section:{label:opts.label,planeCm:100,surfacePerimeterCm:280,reference:{signedErrorCm:20},source:{sha256:'fixture'}},contourPoints:[[-.4,1,-.3],[.4,1,-.3],[.4,1,.3],[-.4,1,.3]]};};
  await s.el('sectionMeasure').onclick();assert.equal(received.referenceCm,260);assert.match(s.el('status').textContent,/280.0 cm/);assert.match(s.el('status').textContent,/\+20.0 cm/);
  s.el('sectionDownload').onclick();const report=JSON.parse(await s.urls.at(-1).b.text());assert.equal(report.schema,'PP_SURFACE_SECTION_REPORT_V1');assert.equal(report.section.surfacePerimeterCm,280);assert.equal(report.contourPoints,undefined);
  s.el('sectionPlane').oninput();assert.equal(s.el('sectionDownload').disabled,true);assert.equal(s.el('sectionContour').width,0);assert.equal(s.el('surfacePreview').hidden,false);
});

test('demo applies a four-view pose plane and passes its bounded provenance to the section worker',async()=>{
  const s=setup();s.el('permission').checked=true;s.el('surfaceEnabled').checked=true;
  const posePlanes={protocol:'four-view-pose-plane-markers-v1',inputViewCount:4,markers:[
    {key:'shoulder_midpoint',label:'Pose-inferred shoulder midpoint plane',planeCm:146.2,maxViewSpreadCm:2.8},
    {key:'torso_midpoint',label:'Pose-inferred torso midpoint plane',planeCm:126.4,maxViewSpreadCm:2.1},
    {key:'hip_midpoint',label:'Pose-inferred hip midpoint plane',planeCm:106.6,maxViewSpreadCm:1.7}]};
  s.scanner.scanWithSurface=async()=>({surfaceStatus:'generated',surface:{mesh:{vertices:[[0,1,0]],faces:[[0,0,0]]},posePlanes},assessment:{measurements:[],processingMs:1}});
  await s.el('scan').onclick();assert.equal(s.el('sectionTorso').disabled,false);assert.match(s.el('posePlanesNote').textContent,/Three experimental/);
  s.el('sectionTorso').onclick();assert.equal(s.el('sectionPlane').value,126.4);assert.match(s.el('sectionLabel').value,/torso midpoint/);assert.match(s.el('status').textContent,/Four-view spread: 2.1 cm/);
  let received;s.scanner.measureSurfaceSection=async options=>{received=options;return {section:{protocol:'pose-plane-surface-section-v1',label:options.label,planeCm:options.planeCm,surfacePerimeterCm:101,reference:null,planeSource:options.marker},contourPoints:[[-.1,1,-.1],[.1,1,-.1],[.1,1,.1],[-.1,1,.1]]};};
  await s.el('sectionMeasure').onclick();assert.equal(received.markerKey,'torso_midpoint');assert.equal(s.el('sectionResult').textContent.includes('landmarks'),false);
  s.el('sectionPlane').oninput();await s.el('sectionMeasure').onclick();assert.equal(received.markerKey,null);
});

test('Clear during a section request aborts computation and prevents a late report',async()=>{
  const s=setup();s.el('permission').checked=true;s.el('surfaceEnabled').checked=true;
  s.scanner.scanWithSurface=async()=>({surfaceStatus:'generated',surface:{mesh:{vertices:[[0,1,0]],faces:[[0,0,0]]}},assessment:{measurements:[],processingMs:1}});await s.el('scan').onclick();
  let complete,signal;s.scanner.measureSurfaceSection=opts=>{signal=opts.signal;return new Promise(r=>complete=r);};
  const pending=s.el('sectionMeasure').onclick();s.el('clear').onclick();assert.equal(signal.aborted,true);complete({section:{surfacePerimeterCm:999},contourPoints:[]});await pending;
  assert.equal(s.el('sectionDownload').disabled,true);assert.equal(s.el('sectionResult').textContent,'No surface section yet.');assert.equal(s.el('sectionTools').hidden,true);
});

test('kept locations survive current input edits, reject duplicates and clear with the source scan',async()=>{
  const s=setup();s.el('permission').checked=true;s.el('surfaceEnabled').checked=true;
  s.scanner.scanWithSurface=async()=>({surfaceStatus:'generated',surface:{mesh:{vertices:[[0,1,0]],faces:[[0,0,0]]}},assessment:{measurements:[],processingMs:1}});await s.el('scan').onclick();
  const source={protocol:'orthographic-four-silhouette-v1',fingerprintProtocol:'surface-json-sha256-v1',sha256:'a'.repeat(64),heightM:1.8,resolution:64};
  s.scanner.measureSurfaceSection=async opts=>({section:{protocol:'operator-surface-section-v1',status:'experimental',axis:'y',scaleStatus:'assumed-stature-not-validated',source,label:opts.label,planeCm:opts.planeCm,surfacePerimeterCm:90,widthCm:30,depthCm:20,reference:null},contourPoints:[[-.1,1,-.1],[.1,1,-.1],[.1,1,.1],[-.1,1,.1]]});
  s.el('sectionLabel').value='First line';s.el('sectionPlane').value='100';await s.el('sectionMeasure').onclick();s.el('locationAdd').onclick();assert.match(s.el('locationCount').textContent,/1 of 12/);
  s.el('sectionPlane').oninput();assert.equal(s.el('locationAdd').disabled,true);assert.equal(s.el('locationsJSON').disabled,false);await s.el('sectionMeasure').onclick();s.el('locationAdd').onclick();assert.match(s.el('status').textContent,/distinct/);assert.match(s.el('locationCount').textContent,/1 of 12/);
  s.el('sectionPlane').value='110';s.el('sectionLabel').value='Second line';await s.el('sectionMeasure').onclick();s.el('locationAdd').onclick();s.el('locationsJSON').onclick();const r=JSON.parse(await s.urls.at(-1).b.text());assert.equal(r.locationCount,2);assert.equal(r.sections[1].planeCm,110);assert.equal(r.contourPoints,undefined);
  s.el('locationsHTML').onclick();assert.match(await s.urls.at(-1).b.text(),/Experimental surface location report/);
  s.el('height').oninput();assert.match(s.el('locationCount').textContent,/0 of 12/);assert.equal(s.el('locationsJSON').disabled,true);assert.equal(s.el('locationsHTML').disabled,true);
});

test('company demo keeps a scalar three-plane baseline and compares a new surface without geometry',async()=>{
  const s=setup();s.el('permission').checked=s.el('surfaceEnabled').checked=true;s.el('height').value='74';
  const markers=['shoulder_midpoint','torso_midpoint','hip_midpoint'].map((key,index)=>({key,label:'Pose '+key,planeCm:[156.9,128.1,98.8][index],maxViewSpreadCm:[3.9,2.3,1.7][index]}));
  let capture=0,currentSha='a'.repeat(64);
  s.scanner.scanWithSurface=async()=>{capture++;currentSha=(capture===1?'a':'b').repeat(64);return {surfaceStatus:'generated',surface:{mesh:{vertices:[[0,1,0]],faces:[[0,0,0]]},posePlanes:{protocol:'four-view-pose-plane-markers-v1',inputViewCount:4,markers}},assessment:{measurements:[],processingMs:1}};};
  s.scanner.measureSurfaceSection=async options=>{const marker=markers.find(item=>item.key===options.markerKey),index=markers.indexOf(marker),planeCm=marker.planeCm+(capture-1);return {section:{protocol:'pose-plane-surface-section-v1',status:'experimental',axis:'y',scaleStatus:'assumed-stature-not-validated',source:{protocol:'orthographic-four-silhouette-v1',fingerprintProtocol:'surface-json-sha256-v1',sha256:currentSha,heightM:1.88,resolution:64},label:marker.label,planeCm,planeSource:{protocol:'four-view-pose-plane-markers-v1',key:marker.key,label:marker.label,inputViewCount:4,planeCm,maxViewSpreadCm:marker.maxViewSpreadCm},contourSelection:{protocol:'unique-contour-containing-reconstruction-axis-v1',candidateContourCount:index===2?3:1,containingAxisCount:1},surfacePerimeterCm:[117.5,164.5,123.3][index]+capture-1,widthCm:40+index,depthCm:30+index,reference:null},contourPoints:[[-.1,1,-.1],[.1,1,-.1],[.1,1,.1],[-.1,1,.1]]};};
  const addThree=async()=>{for(const [id] of [['sectionShoulder'],['sectionTorso'],['sectionHip']]){s.el(id).onclick();await s.el('sectionMeasure').onclick();s.el('locationAdd').onclick();}};
  await s.el('scan').onclick();await addThree();assert.equal(s.el('repeatBaseline').disabled,false);s.el('repeatBaseline').onclick();assert.match(s.el('repeatStatus').textContent,/Baseline kept/);
  await s.el('scan').onclick();assert.match(s.el('repeatStatus').textContent,/Baseline kept/);await addThree();s.el('repeatCompare').onclick();assert.match(s.el('repeatStatus').textContent,/computed/);const report=JSON.parse(s.el('repeatResult').textContent);assert.equal(report.summary.maximumAbsolutePerimeterDifferenceCm,1);assert.equal(report.mesh,undefined);assert.equal(report.photos,undefined);
  s.el('repeatJSON').onclick();const downloaded=JSON.parse(await s.urls.at(-1).b.text());assert.equal(downloaded.schema,'PP_POSE_SECTION_REPEAT_V1');s.el('repeatHTML').onclick();assert.match(await s.urls.at(-1).b.text(),/repeat comparison/i);
  s.el('clear').onclick();assert.match(s.el('repeatStatus').textContent,/No baseline/);assert.equal(s.el('repeatCompare').disabled,true);
});
