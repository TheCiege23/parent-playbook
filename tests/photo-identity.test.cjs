const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
function setup(){const c=vm.createContext({crypto:webcrypto});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/photo-identity.js'),'utf8'),c);return c;}
const frames=()=>Object.fromEntries(['front','right','back','left'].map(k=>[k,new Blob([k])]));
test('same bytes in distinct files are rejected regardless of filename or MIME metadata',async()=>{
 const c=setup(),photos=frames();photos.front=new Blob(['same'],{type:'image/jpeg'});
 assert.equal(await c.duplicatePhotoView(new Blob(['same'],{type:'image/png'}),photos,'right'),'front');
 assert.equal(await c.duplicatePhotoView(new Blob(['same']),photos,'front'),null);
 photos.back=new Blob(['same']);await assert.rejects(c.requireDistinctPhotos(photos),/duplicate_photos/);
});
test('four different files return only protocol status and do not claim visual distinctness',async()=>{
 const c=setup(),summary=await c.requireDistinctPhotos(frames());assert.deepEqual(JSON.parse(JSON.stringify(summary)),{protocol:'exact-photo-bytes-v1',checked_views:4,distinct_files:true});
 const edited=frames();edited.front=new Blob(['same']);edited.right=new Blob(['same-edited']);assert.equal((await c.requireDistinctPhotos(edited)).distinct_files,true);
});
test('missing, empty, oversized and unreadable frames fail closed',async()=>{
 const c=setup();await assert.rejects(c.requireDistinctPhotos({front:new Blob(['x'])}),/needs_four_views/);
 for(const frame of [null,{},new Blob([]),{size:2,arrayBuffer:async()=>new ArrayBuffer(1)}])await assert.rejects(c.photoByteDigest(frame),/photo_file_unreadable/);
 await assert.rejects(c.photoByteDigest({size:26*1024*1024,arrayBuffer(){throw Error('must not allocate');}}),/photo_file_too_large/);
 c.crypto={};await assert.rejects(c.photoByteDigest(new Blob(['x'])),/photo_check_unavailable/);
});
