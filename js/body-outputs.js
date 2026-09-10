// Versioned definitions for our outputs; this is not FITMATCH's metric dictionary.
// Landmark IDs follow Google's Pose Landmarker documentation. These joint proxies
// are not palpated bony landmarks or tape-measure surface distances.
const BODY_OUTPUT_VERSION='body-outputs-v2';
const BODY_SEGMENTS=Object.freeze([
  {key:'upper_arm',label:'Upper arm',left:[11,13],right:[12,14],definition:'Straight 3D distance between predicted shoulder and elbow joints.'},
  {key:'forearm',label:'Forearm',left:[13,15],right:[14,16],definition:'Straight 3D distance between predicted elbow and wrist joints.'},
  {key:'thigh',label:'Thigh',left:[23,25],right:[24,26],definition:'Straight 3D distance between predicted hip and knee joints. This is not a measured femur length.'},
  {key:'lower_leg',label:'Lower leg',left:[25,27],right:[26,28],definition:'Straight 3D distance between predicted knee and ankle joints. This is not a measured tibia length.'},
  {key:'arm_path',label:'Arm joint path',left:[11,13,15],right:[12,14,16],bounds:[.08,.5],definition:'Sum of predicted shoulder-to-elbow and elbow-to-wrist 3D joint distances. It excludes estimated hand length.'},
  {key:'leg_path',label:'Leg joint path',left:[23,25,27],right:[24,26,28],bounds:[.2,.65],definition:'Sum of predicted hip-to-knee and knee-to-ankle 3D joint distances. It excludes ankle-to-floor height.'},
  {key:'shoulder_hip',label:'Shoulder to hip',left:[11,23],right:[12,24],bounds:[.1,.45],definition:'Straight 3D distance between predicted shoulder and hip joints on one side. This is not sitting height.'},
  {key:'ankle_heel',label:'Ankle to heel',left:[27,29],right:[28,30],bounds:[.01,.12],definition:'Straight 3D distance between predicted ankle and heel landmarks. Footwear and pose can affect it.'},
  {key:'foot',label:'Foot landmark length',left:[29,31],right:[30,32],bounds:[.01,.22],definition:'Straight 3D distance between predicted heel and forefoot landmarks. This is not a direct heel-to-toe measurement.'},
]);
const BODY_SIDE_KEYS=Object.freeze(BODY_SEGMENTS.flatMap(s=>['left_'+s.key+'_length','right_'+s.key+'_length']));
const BODY_OUTPUTS=Object.freeze({
  wingspan:{label:'Wingspan',unit:'in',definition:'Predicted shoulder width plus twice the averaged shoulder-to-wrist path and estimated hand length. Not a direct fingertip-to-fingertip measurement.'},
  standing_reach:{label:'Standing reach',unit:'in',definition:'Estimated shoulder height plus averaged shoulder-to-wrist path and estimated hand length. Not a direct overhead reach measurement.'},
  shoulder_width:{label:'Shoulder width',unit:'in',definition:'Distance between predicted shoulder joints from front/back views. Not a palpated biacromial breadth.'},
  hip_width:{label:'Hip joint width',unit:'in',definition:'Distance between predicted hip joints from front/back views. This is not a tape circumference or skeletal breadth.'},
  ear_width:{label:'Ear landmark width',unit:'in',definition:'Distance between predicted ear landmarks from front/back views. Hair, head angle and landmark error can affect it; this is not measured head breadth.'},
  torso_length:{label:'Torso length',unit:'in',definition:'Distance between the predicted shoulder midpoint and hip midpoint. Not sitting height.'},
  leg_length:{label:'Leg length',unit:'in',definition:'Averaged hip-to-knee and knee-to-ankle lengths plus estimated ankle height above the heel. Not inseam or clinical leg length.'},
  ...Object.fromEntries(BODY_SEGMENTS.flatMap(s=>['left','right'].map(side=>[side+'_'+s.key+'_length',{
    label:side[0].toUpperCase()+side.slice(1)+' '+s.label.toLowerCase(),unit:'in',
    definition:s.definition+' Uses only the requested front photo, scaled to the recorded height. Side labels follow the model and may swap in mirrored or incorrectly oriented captures.'
  }]))),
});

function estimateFrontSegments(world,norm,heightIn,statureModel){
  const metrics={},skipped=[];
  if(!Number.isFinite(heightIn)||heightIn<=0||!Number.isFinite(statureModel)||statureModel<=0)return {metrics,skipped};
  for(const segment of BODY_SEGMENTS){
    for(const side of ['left','right']){
      const key=side+'_'+segment.key+'_length',ids=segment[side];
      const visible=ids.every(i=>{const p=norm?.[i],v=p?.visibility??p?.presence;return typeof v==='number'&&Number.isFinite(v)&&v>=.75;});
      const points=ids.map(i=>world?.[i]);
      if(!visible||points.some(p=>!p||![p.x,p.y,p.z].every(Number.isFinite))){skipped.push({key,reason:'the required joints were not clearly visible in the front photo'});continue;}
      const raw=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(points[i].x-p.x,points[i].y-p.y,points[i].z-p.z),0),value=raw*heightIn/statureModel;
      // Broad engineering rejection bounds, not population reference intervals.
      // Both members of a pair use the same view and common scale.
      const bounds=segment.bounds||[.04,.4];
      if(value/heightIn<bounds[0]||value/heightIn>bounds[1]){skipped.push({key,reason:'the segment estimate did not pass the provisional range check'});continue;}
      metrics[key]=Math.round(value*10)/10;
    }
  }
  return {metrics,skipped};
}

function compareBodySides(left,right){
  if(!left||!right)return {difference:null,label:'Both sides were not recorded'};
  const a=readScanRecord(left),b=readScanRecord(right);
  const matchingKeys=BODY_SEGMENTS.some(s=>left.metric_key==='left_'+s.key+'_length'&&right.metric_key==='right_'+s.key+'_length');
  if(!matchingKeys||!a||!b||a.id!==b.id||a.athlete_id!==b.athlete_id||!a.side_method||a.side_method!==b.side_method||!scanCompatibility(left,right))return {difference:null,label:'Requires matching sides from one assessment'};
  const x=Number(left.value),y=Number(right.value);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<=0||y<=0)return {difference:null,label:'Reading unavailable'};
  const difference=Math.round(Math.abs(x-y)*10)/10;
  return {difference,label:difference+' '+left.unit};
}
