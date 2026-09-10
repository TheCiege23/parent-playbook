// Browser integration fixture: real SDK/demo/geometry, explicitly synthetic inference.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=8780;
const files=['body-section-worker.js','mesh-section.js','surface-section.js','body-surface-report.mjs','body-sdk-report.mjs','body-sdk.mjs','body-sdk-surface.mjs','surface-review.mjs','visual-hull.js','surface-worker.js','photo-import.mjs','photo-import-worker.js','heic-decode.js'];
const surfaceWorker=`importScripts('/js/surface-worker-real.js');const next=self.onmessage;self.onmessage=async e=>{
  if(e.data.type!=='segment')return next(e);
  const width=80,height=120,data=new Float32Array(width*height);for(let y=10;y<110;y++)for(let x=25;x<55;x++)data[y*width+x]=1;
  const mask=VisualHull.prepareMask({width,height,data,centerX:39.5});e.data.bitmap.close();self.postMessage({id:e.data.id,mask,model:'SYNTHETIC RECTANGLE',delegate:'TEST'},[mask.bits.buffer]);};`;
const load=`document.getElementById('fixtureLoad').onclick=async()=>{
  for(const [i,v] of ['front','right','back','left'].entries()){
    const c=document.createElement('canvas');c.width=80;c.height=120;const ctx=c.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,80,120);ctx.fillStyle=['#194e3f','#205846','#2a604b','#356c51'][i];ctx.fillRect(25,10,30,100);
    const blob=await new Promise(r=>c.toBlob(r,'image/png')),dt=new DataTransfer();dt.items.add(new File([blob],v+'-SYNTHETIC.png',{type:'image/png'}));const input=document.getElementById(v);input.files=dt.files;input.dispatchEvent(new Event('change'));c.width=c.height=0;
  }document.getElementById('height').value='70';};`;
http.createServer((req,res)=>{
  if(req.method!=='GET'||!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);return res.end();}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'");
  let body,type='text/javascript';
  if(req.url==='/'){type='text/html; charset=utf-8';body=fs.readFileSync(path.join(root,'tools/sdk-demo.html'),'utf8').replace('<main>','<main><section><h2>SYNTHETIC SDK INTEGRATION TEST</h2><p>Rectangle images and length values are fixtures. No person, measurement accuracy, account or storage is tested.</p><button id="fixtureLoad">Load synthetic rectangle inputs</button></section>').replace('</main>','<script type="module" src="/fixture-load.mjs"></script></main>');}
  else if(req.url==='/fixture-load.mjs')body=load;
  else if(req.url==='/sdk-demo.mjs')body=fs.readFileSync(path.join(root,'tools/sdk-demo.mjs'));
  else if(req.url==='/js/body-sdk-worker.js')body="self.onmessage=({data})=>self.postMessage({type:'result',result:{schema:'PP_BODY_SDK_RESULT_V1',sdkVersion:'0.8.0',heightIn:data.heightIn,processingMs:10,measurements:[{key:'wingspan',value:70,unit:'in'}],limitations:['SYNTHETIC LENGTH']}});";
  else if(req.url==='/js/surface-worker.js')body=surfaceWorker;
  else if(req.url==='/js/surface-worker-real.js')body=fs.readFileSync(path.join(root,'js/surface-worker.js'));
  else if(files.some(f=>req.url==='/js/'+f))body=fs.readFileSync(path.join(root,req.url.slice(1)));
  else {res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',type);res.end(body);
}).listen(port,'127.0.0.1',()=>console.log('Synthetic SDK integration: http://127.0.0.1:'+port));
