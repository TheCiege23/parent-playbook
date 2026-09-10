const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {buildBundle}=require('../tools/sdk-bundle.cjs');
const {verifyBundle}=require('../tools/sdk-verify.cjs');
const {SDK_FILES,BUNDLE_FILES}=require('../tools/sdk-files.cjs');
function fixture(t){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'pp-sdk-bundle-')),output=path.join(parent,'release');
  t.after(()=>{assert.ok(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(parent,{recursive:true,force:true});});
  return {output,result:buildBundle(output)};
}
test('portable bundle includes only allowlisted source, matched imports and an intact manifest',t=>{
  const {output,result}=fixture(t);assert.equal(result.ok,true);assert.equal(result.fileCount,41);
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.files.map(x=>x.path),BUNDLE_FILES);
  assert.equal(manifest.sdkVersion,'0.13.0');
  assert.throws(()=>buildBundle(output),/already exists/);assert.equal(verifyBundle(output).ok,true);
  for(const name of SDK_FILES){
    const source=fs.readFileSync(path.join(output,'js',name),'utf8');
    for(const match of source.matchAll(/(?:from\s*|importScripts\(|new URL\()\s*['"](\.\.?\/[^'"]+|[\w-]+\.(?:js|mjs))['"]/g)){
      assert.ok(fs.existsSync(path.resolve(output,'js',match[1])),name+' missing dependency '+match[1]);
    }
  }
  assert.match(fs.readFileSync(path.join(output,'README.md'),'utf8'),/not a fully offline engine/);
});
test('bundle verification detects changed and missing payload files',t=>{
  const {output}=fixture(t);
  fs.appendFileSync(path.join(output,'js/body-sdk.mjs'),'\n// changed');
  fs.unlinkSync(path.join(output,'js/surface-worker.js'));
  const result=verifyBundle(output);assert.equal(result.ok,false);
  assert.ok(result.errors.includes('Checksum mismatch: js/body-sdk.mjs'));
  assert.ok(result.errors.includes('Missing or unreadable file: js/surface-worker.js'));
});
test('bundle verification rejects unexpected content and untrusted manifest paths',t=>{
  const {output}=fixture(t),p=path.join(output,'manifest.json');
  fs.writeFileSync(path.join(output,'accidental-capture.jpg'),'private fixture');
  const manifest=JSON.parse(fs.readFileSync(p,'utf8'));
  manifest.files[0].path='../outside';manifest.files.push(manifest.files[1]);
  fs.writeFileSync(p,JSON.stringify(manifest));
  const result=verifyBundle(output);assert.equal(result.ok,false);
  assert.ok(result.errors.includes('Unexpected file: accidental-capture.jpg'));
  assert.ok(result.errors.includes('Invalid, duplicate or unexpected manifest entry'));
});
test('copied bundle serves its demo and every SDK asset without repository access',async t=>{
  const {output}=fixture(t);
  const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,[path.join(output,'tools/sdk-demo.cjs'),String(port)],{cwd:output,stdio:['ignore','pipe','pipe'],windowsHide:true});
  try{
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Demo did not start')),8000);
      child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
      child.once('error',error=>{clearTimeout(timeout);reject(error);});
      child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Demo exited '+code));});
    });
    const base='http://127.0.0.1:'+port;
    const home=await fetch(base+'/');assert.equal(home.status,200);assert.match(await home.text(),/SDK 0.13.0/);
    for(const name of SDK_FILES){const res=await fetch(base+'/js/'+name);assert.equal(res.status,200,name);assert.equal(await res.text(),fs.readFileSync(path.join(output,'js',name),'utf8'));}
    assert.equal((await fetch(base+'/.env')).status,404);
    assert.equal((await fetch(base+'/manifest.json')).status,404);
    assert.equal((await fetch(base+'/js/body-sdk.mjs',{method:'POST'})).status,404);
  }finally{
    if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  }
});
