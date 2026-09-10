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
  const {output,result}=fixture(t);assert.equal(result.ok,true);assert.equal(result.fileCount,132);
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
  // The package previously shipped three company_* migrations that reference public.teams,
  // public.athletes, auth.users and six private.* helpers created by earlier ones. All three
  // failed on a fresh database, so an acquirer could not stand the schema up at all.
  const shipped=fs.readdirSync(path.join(output,'supabase/migrations')).filter(n=>n.endsWith('.sql'));
  const inRepo=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).filter(n=>n.endsWith('.sql'));
  assert.deepEqual(shipped.sort(),inRepo.sort(),'the package must ship every migration, in order');
  // And the tooling an acquirer needs to verify what they were handed.
  for(const tool of ['tools/schema-parity.cjs','tools/operations-check.cjs','tools/sdk-verify.cjs',
    'tests/db/run.cjs','tests/db/inventory.sql','tests/db/posture.sql','HANDOVER.md'])
    assert.ok(fs.existsSync(path.join(output,tool)),'missing from the package: '+tool);
  // The license inventory has to name the two obligations that need a decision.
  const handover=fs.readFileSync(path.join(output,'HANDOVER.md'),'utf8');
  for(const token of ['LGPL-3.0','Google model terms','zero npm dependencies','No body-composition model'])
    assert.ok(handover.includes(token),'HANDOVER.md must disclose: '+token);
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
test('the package ships a server a host can actually run, and it serves only the SDK', async t => {
  const {output} = fixture(t);
  // tools/sdk-demo.cjs binds 127.0.0.1 and refuses a non-localhost Host header, which is correct
  // for a demo and useless to an acquirer. tools/sdk-host.cjs is the hostable counterpart; this
  // proves it binds a real interface, serves the SDK with loadable MIME types, and exposes
  // nothing else from the package — no migrations, no tests, no manifest, no docs.
  const reserve = net.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));

  const child = spawn(process.execPath, [path.join(output, 'tools/sdk-host.cjs'), '--port', String(port), '--host', '127.0.0.1'],
    {cwd: output, stdio: ['ignore','pipe','pipe'], windowsHide: true});
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('host did not start')), 8000);
      child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('host exited ' + code)); });
    });
    const base = 'http://127.0.0.1:' + port;

    const health = await fetch(base + '/healthz');
    assert.equal(health.status, 200);

    // Every SDK module must load, and .mjs must carry a JavaScript type or the module loader
    // refuses it outright — a wrong Content-Type here breaks the SDK with no error in the file.
    for (const name of SDK_FILES) {
      const res = await fetch(base + '/js/' + name);
      assert.equal(res.status, 200, name);
      assert.match(res.headers.get('content-type') || '', /javascript/, name + ' content-type');
    }
    const demo = await fetch(base + '/');
    assert.equal(demo.status, 200);

    // Response headers production sets.
    const headers = (await fetch(base + '/js/body-sdk.mjs')).headers;
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.match(headers.get('cache-control') || '', /must-revalidate/);

    // Everything else in the package stays unreachable over HTTP.
    for (const hidden of [
      '/HANDOVER.md', '/README.md', '/manifest.json', '/tools/sdk-files.cjs',
      '/tests/db/run.cjs', '/tests/db/10-fixtures.sql', '/package.json',
      '/supabase/migrations/20260910190000_company_composition_results.sql',
    ]) {
      assert.equal((await fetch(base + hidden)).status, 404, hidden + ' must not be served');
    }
    assert.equal((await fetch(base + '/js/body-sdk.mjs', {method:'POST'})).status, 405);
  } finally {
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
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
