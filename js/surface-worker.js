/* Dedicated experiment worker. Never shares the parent scanner's model instance. */
importScripts('./visual-hull.js');
let modelPromise;
function poseLevels(landmarks,prepared,imageHeight){
  const level=(a,b,name)=>{
    const first=landmarks[a],second=landmarks[b];
    if(!first||!second||![first.y,second.y].every(Number.isFinite)||Math.min(first.visibility??1,second.visibility??1)<.45)throw Error(name+' alignment is unclear. Retake the photo.');
    const fraction=(prepared.bottom-(first.y+second.y)/2*imageHeight)/(prepared.bottom-prepared.top);
    if(!Number.isFinite(fraction)||fraction<=.1||fraction>=.98)throw Error(name+' falls outside the reviewed silhouette. Retake the photo.');
    return Math.round(fraction*1e6)/1e6;
  };
  const shoulderFraction=level(11,12,'Shoulder'),hipFraction=level(23,24,'Hip');
  if(shoulderFraction<=hipFraction+.08)throw Error('Shoulder and hip levels are inconsistent. Retake the photo standing upright.');
  return {protocol:'pose-silhouette-levels-v1',shoulderFraction,hipFraction};
}
async function model(){
  if(!modelPromise)modelPromise=(async()=>{
    const version='1.0.1',base='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@'+version;
    const vision=await import(base+'/vision_bundle.mjs');
    const fileset=await vision.FilesetResolver.forVisionTasks(base+'/wasm');
    let lastError;
    for(const delegate of ['GPU','CPU']){
      try{
        const detector=await vision.PoseLandmarker.createFromOptions(fileset,{
          canvas:new OffscreenCanvas(1,1),
          baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',delegate},
          runningMode:'IMAGE',numPoses:2,outputSegmentationMasks:true,
          minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5
        });
        return {detector,delegate,model:'mediapipe-pose-full-float16-v1/tasks-vision-'+version};
      }catch(error){lastError=error;}
    }
    throw lastError;
  })().catch(error=>{modelPromise=null;throw error;});
  return modelPromise;
}
self.onmessage=async({data})=>{
  const start=performance.now();
  try{
    if(data.type==='reconstruct'){
      const mesh=VisualHull.reconstruct(data.masks,data.options);
      self.postMessage({id:data.id,mesh,durationMs:performance.now()-start});return;
    }
    if(data.type!=='segment')throw Error('Unknown experiment request.');
    const engine=await model();
    let result;
    try{
      result=engine.detector.detect(data.bitmap);
      if(result.landmarks?.length!==1||result.segmentationMasks?.length!==1)throw Error('Exactly one detected person and silhouette are required.');
      const mask=result.segmentationMasks[0],landmarks=result.landmarks[0];
      if(!landmarks[23]||!landmarks[24]||Math.max(landmarks[23].visibility||0,landmarks[24].visibility||0)<.5)throw Error('Hip alignment is unclear. Retake the photo.');
      const values=new Float32Array(mask.getAsFloat32Array());
      const prepared=VisualHull.prepareMask({width:mask.width,height:mask.height,data:values,centerX:(landmarks[23].x+landmarks[24].x)/2*mask.width});
      const levels=poseLevels(landmarks,prepared,mask.height);
      self.postMessage({id:data.id,mask:prepared,levels,delegate:engine.delegate,model:engine.model,durationMs:performance.now()-start},[prepared.bits.buffer]);
    }finally{result?.close();}
  }catch(error){self.postMessage({id:data.id,error:error.message||String(error),code:error.code,diagnostics:error.diagnostics});}
  finally{data.bitmap?.close();}
};
