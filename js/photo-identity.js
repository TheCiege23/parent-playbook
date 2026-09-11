// Exact file reuse check, not visual similarity, identity or facing-direction detection.
// Digests are temporary and never included in measurement records or analytics.
const PHOTO_IDENTITY_PROTOCOL='exact-photo-bytes-v1';
async function photoByteDigest(frame){
  if(!frame||typeof frame.arrayBuffer!=='function'||!Number.isFinite(frame.size)||frame.size<=0)throw Error('photo_file_unreadable');
  if(frame.size>25*1024*1024)throw Error('photo_file_too_large');
  if(typeof crypto==='undefined'||!crypto.subtle?.digest)throw Error('photo_check_unavailable');
  let bytes=await frame.arrayBuffer();
  try{
    if(bytes.byteLength!==frame.size)throw Error('photo_file_unreadable');
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  }finally{bytes=null;}
}
async function duplicatePhotoView(frame,frames,view){
  const digest=await photoByteDigest(frame);
  for(const key of ['front','right','back','left']){
    if(key!==view&&frames?.[key]&&await photoByteDigest(frames[key])===digest)return key;
  }
  return null;
}
async function requireDistinctPhotos(frames){
  const seen=new Set(),keys=['front','right','back','left'];
  if(keys.some(k=>!frames?.[k]))throw Error('needs_four_views');
  for(const key of keys){
    const digest=await photoByteDigest(frames[key]);
    if(seen.has(digest))throw Error('duplicate_photos');
    seen.add(digest);
  }
  return {protocol:PHOTO_IDENTITY_PROTOCOL,checked_views:4,distinct_files:true};
}
