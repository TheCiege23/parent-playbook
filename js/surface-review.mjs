// Temporary, on-device reconstruction inside the assessment flow. No persistence API.
const views=['front','right','back','left'];
const labels={front:'Front',right:'Anatomical right',back:'Back',left:'Anatomical left'};
const aborted=()=>new DOMException('The scan session ended or its permission changed.','AbortError');

export function derivePosePlaneMarkers(sources,heightM){
  if(!Array.isArray(sources)||sources.length!==4||!Number.isFinite(heightM)||heightM<.8||heightM>2.5)throw Error('Four bounded pose-level summaries and recorded height are required.');
  const rows=sources.map(source=>{
    const levels=source?.levels;
    if(levels?.protocol!=='pose-silhouette-levels-v1'||![levels.shoulderFraction,levels.hipFraction].every(v=>Number.isFinite(v)&&v>.1&&v<.98)||levels.shoulderFraction<=levels.hipFraction+.08)throw Error('A pose-level summary is invalid.');
    return levels;
  });
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[1]+sorted[2])/2;};
  const make=(key,label,values)=>{
    const fraction=median(values),planeCm=Math.round(fraction*heightM*1000)/10,maxViewSpreadCm=Math.round((Math.max(...values)-Math.min(...values))*heightM*1000)/10;
    return {key,label,planeCm,maxViewSpreadCm};
  };
  const shoulders=rows.map(r=>r.shoulderFraction),hips=rows.map(r=>r.hipFraction),mids=rows.map(r=>(r.shoulderFraction+r.hipFraction)/2);
  return {protocol:'four-view-pose-plane-markers-v1',status:'experimental',inputViewCount:4,scaleStatus:'assumed-stature-not-validated',
    markers:[make('shoulder_midpoint','Pose-inferred shoulder midpoint plane',shoulders),make('torso_midpoint','Pose-inferred torso midpoint plane',mids),make('hip_midpoint','Pose-inferred hip midpoint plane',hips)],
    limitations:'Plane heights are derived from four pose estimates normalized to the reviewed silhouette floor and head. They are guides for clothed-surface sections, not detected anatomical girths or validated measurements.'};
}

// Same normalized floor/hip-center coordinates and opposite-view reversal as the hull.
// Pixel classes: 0 background, 1 first view only, 2 opposite only, 3 both.
export function compareSurfaceProjections(first,opposite,{width=240,height=320}={}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>512||height>512)throw Error('Invalid comparison dimensions.');
  for(const m of [first,opposite])if(!m||!(m.bits instanceof Uint8Array)||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<8||m.height<8||m.width*m.height>4e6||m.bits.length!==m.width*m.height||![m.centerX,m.top,m.bottom].every(Number.isFinite)||m.centerX<0||m.centerX>=m.width||m.top<-.5||m.bottom>m.height-.5||m.bottom<=m.top)throw Error('Two prepared silhouettes are required.');
  const pixels=new Uint8Array(width*height);
  const inside=(m,x,y)=>{const span=m.bottom-m.top,u=Math.round(m.centerX+x*span),v=Math.round(m.bottom-y*span);return u>=0&&u<m.width&&v>=0&&v<m.height&&m.bits[v*m.width+u]===1;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const horizontal=(x-width/2+.5)/height,aboveFloor=1-(y+.5)/height;
    pixels[y*width+x]=(inside(first,horizontal,aboveFloor)?1:0)|(inside(opposite,-horizontal,aboveFloor)?2:0);
  }
  return {width,height,pixels};
}

// Capture-consistency diagnostic only. Intersection-over-union describes how
// similarly two normalized silhouettes project; it is not measurement accuracy.
export function summarizeProjectionAgreement(comparison,{lowerFraction=.2}={}){
  const {width,height,pixels}=comparison||{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>512||height>512||!(pixels instanceof Uint8Array)||pixels.length!==width*height)throw Error('A bounded projection comparison is required.');
  if(!Number.isFinite(lowerFraction)||lowerFraction<=0||lowerFraction>.5)throw Error('Lower-region fraction must be greater than zero and at most one half.');
  const lowerStart=Math.floor(height*(1-lowerFraction));
  const counts={overall:{intersectionPixels:0,unionPixels:0},lower:{intersectionPixels:0,unionPixels:0}};
  for(let i=0;i<pixels.length;i++){
    const value=pixels[i];if(value>3)throw Error('Projection comparison contains an invalid pixel class.');
    if(value){counts.overall.unionPixels++;if(value===3)counts.overall.intersectionPixels++;}
    if(Math.floor(i/width)>=lowerStart&&value){counts.lower.unionPixels++;if(value===3)counts.lower.intersectionPixels++;}
  }
  const finish=region=>({...region,iou:region.unionPixels?Math.round(region.intersectionPixels/region.unionPixels*1000)/1000:null});
  return {protocol:'opposite-silhouette-agreement-v1',width,height,lowerFraction,overall:finish(counts.overall),lower:finish(counts.lower)};
}

// Only scalar geometry diagnostics may cross into a host's failure record.
export function surfaceFailureSummary(error,stage){
  stage=stage==='reconstruction'?'reconstruction':'segmentation';
  const disconnected=stage==='reconstruction'&&error?.code==='DISCONNECTED_SURFACE';
  const result={stage,code:disconnected?'DISCONNECTED_SURFACE':stage==='reconstruction'?'SURFACE_RECONSTRUCTION_FAILED':'SURFACE_SEGMENTATION_FAILED',
    message:disconnected?'The reconstructed surface contains disconnected regions.':stage==='reconstruction'?'The experimental surface could not be reconstructed.':'A usable silhouette could not be prepared.',diagnostics:null};
  const d=error?.diagnostics,integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max,fraction=v=>Number.isFinite(v)&&v>=0&&v<=1;
  if(disconnected&&d?.protocol==='surface-connectivity-v1'&&integer(d.resolution,24,128)&&integer(d.occupiedVoxels,100,2e6)&&integer(d.componentCount,2,d.occupiedVoxels)&&fraction(d.largestComponentFraction)&&Array.isArray(d.components)&&d.components.length===Math.min(d.componentCount,8)&&d.components.every((c,i)=>integer(c?.voxels,1,d.occupiedVoxels)&&fraction(c.fromFloorFraction)&&fraction(c.toFloorFraction)&&c.fromFloorFraction<c.toFloorFraction&&(!i||(c.closestBridgeVoxels==null||integer(c.closestBridgeVoxels,1,3))))) {
    result.diagnostics={protocol:d.protocol,resolution:d.resolution,occupiedVoxels:d.occupiedVoxels,componentCount:d.componentCount,largestComponentFraction:d.largestComponentFraction,
      components:d.components.map((c,i)=>({voxels:c.voxels,fromFloorFraction:c.fromFloorFraction,toFloorFraction:c.toFloorFraction,...(i&&integer(c.closestBridgeVoxels,1,3)?{closestBridgeVoxels:c.closestBridgeVoxels}:{})}))};
  }
  return result;
}
export function reviewSurface({frames,heightM,mount,isCurrent,authorize,prepareBitmap=createImageBitmap,signal,retentionNotice,onFailure}){
  if(!Number.isFinite(heightM)||heightM<.8||heightM>2.5) return Promise.reject(Error('The experimental preview requires a recorded height between 80 and 250 cm.'));
  return new Promise((resolve,reject)=>{
    let ended=false,worker=null,pending=null,sequence=0,busy=true,stage='segmentation';
    const masks={},photos={},sources={};
    const bg=mount(`<h3>Review the four silhouettes</h3>
      <p class="muted-note">Experimental 3D preview. Check each outline against its photo, including the head, both feet and clothing. The yellow line should pass through the hip center. For the most consistent capture, keep the phone fixed at hip height and the same zoom while the subject rotates on one marked floor center. If an outline is wrong, continue with lengths and retake the photos for a new preview.</p>
      <p class="muted-note">This models the visible clothed surface. Perspective, shoes and pose affect its shape and scale. It does not measure body fat or anatomical girths.</p>
      <p role="status" aria-live="polite" id="surfaceStatus">Preparing silhouettes…</p>
      ${views.map(v=>`<section class="card app-pad" style="margin:12px 0"><h4>${labels[v]}</h4>
        <canvas id="surfaceCanvas-${v}" width="1" height="1" style="display:block;max-width:100%;max-height:300px;margin:8px auto" aria-label="${labels[v]} photo and silhouette overlay"></canvas>
        <p class="muted-note" id="surfaceNote-${v}">Waiting for the model.</p>
        <label style="display:block">View <select id="surfaceDisplay-${v}" disabled><option value="overlay">Photo + silhouette</option><option value="photo">Photo only</option><option value="mask">Silhouette only</option></select></label>
        <label style="display:block;margin:8px 0">Hip center (% of photo width) <input id="surfaceCenter-${v}" type="number" step="0.1" min="0" max="100" style="width:90px" disabled></label>
        <label><input id="surfaceCheck-${v}" type="checkbox" disabled> I checked the ${labels[v].toLowerCase()} view, the whole outline and the hip center.</label></section>`).join('')}
      <p class="muted-note" id="surfaceCount">0 of 4 views reviewed</p>
      <details><summary>Compare opposite views and foot alignment</summary>
        <p class="muted-note">Each pair shares the current hip-center line and inferred floor-to-head scale. The opposite view is mirrored into the same direction. Green shows only the first view, pink only the opposite view, and white their overlap. These are outline differences, not an accuracy score. Perspective and stance can cause differences even when both photos pass capture checks.</p>
        ${[['front','back'],['right','left']].map(([a,b])=>`<section><h4>${labels[a]} / ${labels[b]}</h4><p class="muted-note">Green: ${labels[a]}. Pink: ${labels[b]}. White: overlap.</p><canvas id="surfacePair-${a}" width="0" height="0" style="display:block;max-width:100%;max-height:320px;margin:auto" aria-label="${labels[a]} and ${labels[b]} normalized silhouette comparison"></canvas><p class="muted-note">Feet and lower legs — bottom 20% of the inferred height</p><canvas id="surfaceFeet-${a}" width="0" height="0" style="display:block;max-width:100%;max-height:180px;margin:auto" aria-label="${labels[a]} and ${labels[b]} foot alignment close-up"></canvas><p id="surfacePairNote-${a}" class="muted-note">Waiting for both silhouettes.</p></section>`).join('')}
        <p class="muted-note">Inspect the source photos before changing a hip-center line. Changes update these comparisons and require that view to be checked again. Do not adjust the lines merely to force the outlines to overlap.</p>
      </details>
      <label style="display:block;margin:12px 0"><input id="surfaceCleanup" type="checkbox" checked> If the strict build finds only tiny detached sampling artifacts within the bottom 10% of the surface, remove them and disclose the adjustment.</label>
      <p class="muted-note">This applies only when the main connected body contains at least 99.5% of all occupied voxels and no more than 256 lower-region voxels are removed. It never joins separated regions or fills a gap.</p>
      <button class="btn amber" id="surfaceBuild" disabled>Build experimental 3D preview</button>
      <button class="btn ghost" id="surfaceSkip" style="margin-top:10px">Continue with lengths only</button>
      <p class="muted-note" id="surfaceRetention">The photos and silhouettes are discarded after this step. The preview lasts until you close or save the assessment. It is not saved to your account or shared with an organization.</p>`);
    const $=id=>bg.querySelector('#'+id),remove=bg.remove.bind(bg);
    if(typeof retentionNotice==='string')$('surfaceRetention').textContent=retentionNotice;
    const current=()=>!ended&&bg.isConnected&&isCurrent();
    const finish=(value,error)=>{
      if(ended)return;ended=true;clearInterval(guard);signal?.removeEventListener('abort',abort);worker?.terminate();worker=null;
      if(pending){clearTimeout(pending.timer);pending.reject(aborted());pending=null;}
      for(const v of views){masks[v]?.bits.fill(0);delete masks[v];delete sources[v];
        if(photos[v])photos[v].width=photos[v].height=0;delete photos[v];
        const c=$('surfaceCanvas-'+v);c.width=c.height=0;
      }
      for(const a of ['front','right'])for(const kind of ['Pair','Feet']){const c=$('surface'+kind+'-'+a);c.width=c.height=0;}
      frames=null;remove();error?reject(error):resolve(value);
    };
    bg.remove=()=>finish(null);
    const guard=setInterval(()=>{if(!current())finish(null,aborted());},200);
    const abort=()=>finish(null,aborted());
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    const check=async()=>{if(!current())throw aborted();const allowed=await authorize();if(!allowed||!current())throw aborted();};
    const ask=(type,payload,transfer=[])=>new Promise((ok,no)=>{
      if(!current())return no(aborted());
      if(!worker){
        worker=new Worker(new URL('./surface-worker.js',import.meta.url));
        worker.onmessage=({data})=>{if(!pending||data.id!==pending.id)return;const p=pending;pending=null;clearTimeout(p.timer);data.error?p.reject(Object.assign(Error(data.error),{code:data.code,diagnostics:data.diagnostics})):p.resolve(data);};
        worker.onerror=()=>{const p=pending;pending=null;worker?.terminate();worker=null;if(p){clearTimeout(p.timer);p.reject(Error('The 3D worker could not run. You can keep the length estimates.'));}};
      }
      const id=++sequence;
      const timer=setTimeout(()=>{if(pending?.id!==id)return;pending=null;worker?.terminate();worker=null;no(Error('The 3D step timed out. You can keep the length estimates.'));},90000);
      pending={id,timer,resolve:ok,reject:no};
      try{worker.postMessage({id,type,...payload},transfer);}catch(error){clearTimeout(timer);pending=null;no(error);}
    });
    function valid(v){const m=masks[v],raw=$('surfaceCenter-'+v).value,x=Number(raw)/100*m?.width;return m&&raw!==''&&Number.isFinite(x)&&x>=m.left&&x<=m.right;}
    function refresh(){
      $('surfaceBuild').disabled=busy||!views.every(v=>valid(v)&&$('surfaceCheck-'+v).checked);
      $('surfaceCleanup').disabled=busy;
      $('surfaceCount').textContent=views.filter(v=>valid(v)&&$('surfaceCheck-'+v).checked).length+' of 4 views reviewed';
      for(const v of views)for(const kind of ['Display','Center','Check'])$('surface'+kind+'-'+v).disabled=busy||!masks[v];
    }
    function paint(v){
      const m=masks[v];if(!m)return;const c=$('surfaceCanvas-'+v),ctx=c.getContext('2d'),mode=$('surfaceDisplay-'+v).value;
      c.width=m.width;c.height=m.height;
      if(mode!=='mask')ctx.drawImage(photos[v],0,0,m.width,m.height);
      if(mode!=='photo'){
        const layer=document.createElement('canvas');layer.width=m.width;layer.height=m.height;
        try{const pixels=ctx.createImageData(m.width,m.height);
          for(let i=0;i<m.bits.length;i++){const j=i*4;pixels.data[j]=m.bits[i]?70:10;pixels.data[j+1]=m.bits[i]?232:33;pixels.data[j+2]=m.bits[i]?175:28;pixels.data[j+3]=mode==='mask'?255:(m.bits[i]?110:0);}
          layer.getContext('2d').putImageData(pixels,0,0);ctx.drawImage(layer,0,0);
        }finally{layer.width=layer.height=0;}
      }
      ctx.strokeStyle='#f4cf7b';ctx.lineWidth=Math.max(1,m.width/200);ctx.beginPath();ctx.moveTo(m.centerX,m.top);ctx.lineTo(m.centerX,m.bottom);ctx.moveTo(0,m.top);ctx.lineTo(m.width,m.top);ctx.moveTo(0,m.bottom);ctx.lineTo(m.width,m.bottom);ctx.stroke();
      paintComparisons();
    }
    function paintComparisons(){
      for(const [a,b] of [['front','back'],['right','left']]){
        const c=$('surfacePair-'+a),feet=$('surfaceFeet-'+a),note=$('surfacePairNote-'+a);
        if(!masks[a]||!masks[b]||!valid(a)||!valid(b)){c.width=c.height=feet.width=feet.height=0;note.textContent='Two silhouettes and valid hip-center lines are required.';continue;}
        const comparison=compareSurfaceProjections(masks[a],masks[b]),agreement=summarizeProjectionAgreement(comparison);c.width=comparison.width;c.height=comparison.height;
        const context=c.getContext('2d'),rgba=context.createImageData(c.width,c.height),colors=[[10,33,28],[70,232,175],[236,118,174],[245,245,245]];
        try{
          for(let i=0;i<comparison.pixels.length;i++){const color=colors[comparison.pixels[i]],j=i*4;rgba.data[j]=color[0];rgba.data[j+1]=color[1];rgba.data[j+2]=color[2];rgba.data[j+3]=255;}
          context.putImageData(rgba,0,0);feet.width=c.width*2;feet.height=Math.round(c.height*.2)*2;
          const footContext=feet.getContext('2d');footContext.imageSmoothingEnabled=false;footContext.drawImage(c,0,c.height*.8,c.width,c.height*.2,0,0,feet.width,feet.height);
          const percent=value=>value===null?'unavailable':Math.round(value*100)+'%';
          note.textContent='Capture consistency: overall overlap '+percent(agreement.overall.iou)+'; feet/lower legs '+percent(agreement.lower.iou)+'. '+
            (agreement.lower.iou!==null&&agreement.lower.iou<.5?'Lower-region agreement is limited. Retake with the phone position and zoom fixed while the subject rotates on the same floor center. ':'')+
            'This projection agreement is not a measurement-accuracy score.';
        }finally{comparison.pixels.fill(0);rgba.data.fill(0);}
      }
    }
    function fail(error){
      if(ended)return;if(error.name==='AbortError')return finish(null,error);busy=false;refresh();
      const summary=surfaceFailureSummary(error,stage);
      try{onFailure?.(summary);}catch{}
      const fragments=summary.diagnostics?.components.slice(1);
      const lower=fragments?.length&&summary.diagnostics.componentCount===summary.diagnostics.components.length&&fragments.every(c=>c.toFloorFraction<=.2);
      $('surfaceStatus').textContent=summary.code==='DISCONNECTED_SURFACE'
        ? (lower?'A detached region was found near the feet or lower legs. ':'The reconstructed surface contains disconnected regions. ')+
          'Check the stance, outlines and hip-center alignment across all four views. No 3D surface has been accepted. You can keep the length estimates.'
        : error.message;
    }
    for(const v of views){
      $('surfaceDisplay-'+v).onchange=()=>paint(v);
      $('surfaceCheck-'+v).onchange=refresh;
      $('surfaceCenter-'+v).oninput=()=>{$('surfaceCheck-'+v).checked=false;if(valid(v)){masks[v].centerX=Number($('surfaceCenter-'+v).value)/100*masks[v].width;paint(v);}else paintComparisons();refresh();};
    }
    $('surfaceSkip').onclick=()=>finish(null);
    $('surfaceBuild').onclick=async()=>{
      if(busy||!views.every(v=>valid(v)&&$('surfaceCheck-'+v).checked))return;
      stage='reconstruction';busy=true;refresh();$('surfaceStatus').textContent='Building the surface from your four reviewed silhouettes…';
      let output;
      try{await check();output=await ask('reconstruct',{masks,options:{heightM,resolution:64,allowLowerArtifactRemoval:$('surfaceCleanup').checked}});await check();
        const sourceViews=views.map(view=>({view,...sources[view],review:'manual-view-review-v1'}));
        finish({mesh:output.mesh,processingMs:Math.round(output.durationMs),posePlanes:derivePosePlaneMarkers(sourceViews,heightM),views:sourceViews.map(({levels,...view})=>view)});
      }catch(error){if(output?.mesh){output.mesh.vertices.length=output.mesh.faces.length=0;}fail(error);}
    };
    (async()=>{
      try{
        for(const v of views){
          await check();$('surfaceStatus').textContent='Reading the '+labels[v].toLowerCase()+' silhouette…';
          let bitmap=null,photo=null;
          try{
            bitmap=await prepareBitmap(frames[v]);if(!current())throw aborted();
            photo=document.createElement('canvas');photo.width=bitmap.width;photo.height=bitmap.height;photo.getContext('2d').drawImage(bitmap,0,0);
            const response=await ask('segment',{bitmap},[bitmap]);bitmap=null;
            if(!current()){response.mask?.bits.fill(0);throw aborted();}
            masks[v]=response.mask;photos[v]=photo;photo=null;sources[v]={model:response.model,delegate:response.delegate,levels:response.levels};
            $('surfaceCenter-'+v).value=(response.mask.centerX/response.mask.width*100).toFixed(2);
            $('surfaceNote-'+v).textContent='Silhouette ready. Check the outline and hip center.';paint(v);
          }finally{bitmap?.close();if(photo)photo.width=photo.height=0;}
        }
        busy=false;refresh();$('surfaceStatus').textContent='Check all four views, then build the preview.';
      }catch(error){fail(error);}
    })();
  });
}

export function renderSurfacePreview(host,preview,{retentionNotice}={}){
  let mesh=preview.mesh,yaw=.45,planeCm=null;
  const adjustment=mesh?.topologyAdjustment,adjustmentText=adjustment?.protocol==='surface-lower-artifact-removal-v1'
    ? ` A bounded topology adjustment removed ${adjustment.removedVoxels} detached lower-region voxels (${(adjustment.removedFraction*100).toFixed(2)}% of the initial intersection); it did not fill or join geometry.`:'';
  host.innerHTML='<h4>Experimental 3D surface</h4><canvas width="480" height="540" style="display:block;width:100%;max-width:480px;margin:auto;border-radius:12px" aria-label="Rotatable surface reconstructed from four reviewed silhouettes"></canvas><label style="display:block;margin:10px 0">Rotate preview <input type="range" min="-180" max="180" value="26" style="width:100%"></label><p class="muted-note">Visible clothing surface, scaled using recorded height. Shape and scale accuracy are unvalidated. No anatomical girths or body composition are derived.'+adjustmentText+' This preview will be discarded when you close or save.</p>';
  if(typeof retentionNotice==='string')host.querySelector('p').textContent='Visible clothing surface, scaled using recorded height. Shape and scale accuracy are unvalidated. No anatomical girths or body composition are derived.'+adjustmentText+' '+retentionNotice;
  const canvas=host.querySelector('canvas'),slider=host.querySelector('input'),ctx=canvas.getContext('2d');
  function draw(){
    if(!mesh)return;ctx.fillStyle='#0a211c';ctx.fillRect(0,0,canvas.width,canvas.height);
    const cos=Math.cos(yaw),sin=Math.sin(yaw),scale=Math.min(canvas.height*.82/mesh.heightM,canvas.width*.7/mesh.heightM);
    const pts=mesh.vertices.map(([x,y,z])=>[canvas.width/2+(x*cos+z*sin)*scale,canvas.height*.92-y*scale,-x*sin+z*cos]);
    const faces=mesh.faces.map(f=>({f,z:f.reduce((s,i)=>s+pts[i][2],0)})).sort((a,b)=>a.z-b.z);
    for(const {f} of faces){const [a,b,c]=f.map(i=>pts[i]),[u,v,w]=f.map(i=>mesh.vertices[i]);
      const nx=(v[1]-u[1])*(w[2]-u[2])-(v[2]-u[2])*(w[1]-u[1]),ny=(v[2]-u[2])*(w[0]-u[0])-(v[0]-u[0])*(w[2]-u[2]),nz=(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
      const light=.4+.6*Math.max(0,((nx*cos+nz*sin)*-.35+ny*.45+(-nx*sin+nz*cos)*.82)/(Math.hypot(nx,ny,nz)||1));
      ctx.fillStyle=`rgb(${Math.round(164*light)},${Math.round(212*light)},${Math.round(186*light)})`;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(c[0],c[1]);ctx.closePath();ctx.fill();
    }
  }
  function drawWithPlane(){draw();if(!mesh||planeCm===null)return;
    const scale=Math.min(canvas.height*.82/mesh.heightM,canvas.width*.7/mesh.heightM),y=canvas.height*.92-planeCm/100*scale;
    ctx.strokeStyle='#f4cf7b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(canvas.width*.1,y);ctx.lineTo(canvas.width*.9,y);ctx.stroke();
  }
  slider.oninput=()=>{yaw=Number(slider.value)*Math.PI/180;drawWithPlane();};draw();
  const dispose=()=>{if(!mesh)return;slider.oninput=null;canvas.width=canvas.height=0;mesh.vertices.length=mesh.faces.length=0;mesh=null;preview.mesh=null;host.replaceChildren();};
  dispose.setSectionPlane=value=>{planeCm=mesh&&Number.isFinite(value)&&value>0&&value<mesh.heightM*100?value:null;drawWithPlane();};
  return dispose;
}
