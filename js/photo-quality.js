// Capture heuristics, not a measurement-accuracy or identity test.
// MediaPipe normalized landmarks: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js
// Thresholds are provisional engineering choices pending real-device reference trials.
const PHOTO_QUALITY_VERSION = 'photo-quality-v1';
function checkPhotoPose(result,view){
  const reasons=[],warnings=[];
  const add=(list,code,message)=>list.push({code,message});
  const finish=()=>({protocol:PHOTO_QUALITY_VERSION,view,accepted:reasons.length===0,reasons,warnings});
  if(!['front','right','back','left'].includes(view)){
    add(reasons,'unknown_view','Choose one of the four guided views.');return finish();
  }
  const poses=Array.isArray(result?.landmarks)?result.landmarks:[],world=Array.isArray(result?.worldLandmarks)?result.worldLandmarks:[];
  if(poses.length!==1){
    add(reasons,poses.length>1?'multiple_people':'no_person',poses.length>1?'Keep only the athlete in the photo. Avoid mirrors and people in the background.':'We could not find a person clearly. Show the whole body with light in front.');return finish();
  }
  const n=poses[0],w=world[0];
  if(!Array.isArray(n) || n.length!==33 || n.some(p=>!p || ![p.x,p.y].every(Number.isFinite)) || !Array.isArray(w) || w.length!==33 || w.some(p=>!p || ![p.x,p.y,p.z].every(Number.isFinite))){
    add(reasons,'incomplete_landmarks','The body landmarks could not be read. Retake in clear light.');return finish();
  }
  const visible=i=>{const p=n[i];return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.visibility??p.presence) && (p.visibility??p.presence)>=.5;};
  const left=[11,23,25,27],right=[12,24,26,28];
  const facing=view==='front'||view==='back';
  const chain=ids=>ids.every(visible);
  if(facing?!(chain(left)&&chain(right)):!(chain(left)||chain(right)))
    add(reasons,'body_hidden','Show shoulders, hips, knees and ankles clearly. Keep the whole body in view.');
  const head=[0,2,5,7,8].filter(visible),feet=[29,30,31,32].filter(visible);
  if(!head.length || !feet.length)
    add(reasons,'head_or_feet_hidden','Include the head and feet with clear space above and below them.');
  const body=[...head,11,12,13,14,15,16,23,24,25,26,27,28,...feet].filter(visible);
  if(body.some(i=>n[i].x<=.015 || n[i].x>=.985 || n[i].y<=.015 || n[i].y>=.985))
    add(reasons,'frame_edge','Step back slightly. A visible body landmark is touching the edge of the photo.');
  if(head.length && feet.length){
    const span=Math.max(...feet.map(i=>n[i].y))-Math.min(...head.map(i=>n[i].y));
    if(span<.35) add(reasons,'too_small_or_not_upright','Move closer and stand upright so the body fills more of the photo.');
    if(Math.min(...head.map(i=>n[i].y))<.08) add(warnings,'headroom','Check that the top of the head has not been cropped.');
  }
  if(![13,15].every(visible) && ![14,16].every(visible))
    add(warnings,'arms_hidden','Keep elbows and wrists visible to help estimate wingspan and reach.');
  if([11,12,23,24].every(visible)){
    const shoulderY=(n[11].y+n[12].y)/2,hipY=(n[23].y+n[24].y)/2;
    const torso=hipY-shoulderY;
    const width=Math.abs(n[11].x-n[12].x);
    // Advisory only: perspective, body shape and model uncertainty can change this ratio.
    if(torso>0 && (facing?width/torso<.4:width/torso>1))
      add(warnings,'check_direction',facing?'Check that the athlete is facing directly toward or away from the camera.':'Check that the athlete is turned fully sideways.');
  }
  return finish();
}
function photoCheckSummary(check){
  return {view:check.view,protocol:check.protocol,accepted:check.accepted,
    reasons:check.reasons.map(r=>r.code),warnings:check.warnings.map(r=>r.code)};
}
async function reviewPosePhoto({frame,view}){
  const landmarker=await loadPoseLandmarker();let bitmap;
  try{bitmap=await createImageBitmap(frame);return checkPhotoPose(landmarker.detect(bitmap),view);}
  finally{bitmap?.close?.();}
}
