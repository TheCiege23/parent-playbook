const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('composition validation room states the unconfigured boundary and three gated inputs',()=>{
  const html=read('company-composition-demo.html');
  assert.match(html,/Provider not configured/);assert.match(html,/does not currently include a composition model/);assert.match(html,/manifestFile/);assert.match(html,/estimateFile/);assert.match(html,/studyFile/);
  assert.match(html,/does not upload or persist/);assert.match(html,/excludes participant codes and row-level observations/);
});
test('composition demo uses contract validators and incomplete templates cannot be mistaken for evidence',()=>{
  const source=read('tools/company-composition-demo.mjs');
  for(const token of ['validateCompositionModelManifest','validateCompositionEstimate','evaluateCompositionValidationStudy','REPLACE_WITH_PROVIDER_ID','participantCount:0','value:null'])assert.match(source,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(source,/5_000_000/);assert.match(source,/JSON\.stringify\(report/);assert.ok(!source.includes('localStorage'));
});
test('production allowlist and smoke checks include every composition integration asset',()=>{
  const docker=read('Dockerfile'),smoke=read('tools/deployment-smoke.cjs'),worker=read('sw.js');
  for(const name of ['company-composition-demo.html','company-composition-demo.mjs'])assert.match(docker,new RegExp(name.replace('.','\\.')));
  for(const route of ['/company-composition-demo','/company-composition-demo.mjs','/js/body-composition-contract.mjs','/js/body-composition-validation.mjs'])assert.ok(smoke.includes(route));
  assert.match(worker,/pp-v106/);assert.ok(worker.includes('/company-composition-demo'));
});
