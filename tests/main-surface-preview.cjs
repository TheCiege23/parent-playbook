// Isolated browser rehearsal of the actual parent scan screens. All input is synthetic.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=Number(process.argv[2]||8779);
const files=['css/app.css','css/body-insights.css','js/sheets.js','js/body-scan.js','js/scan-record.js','js/body-outputs.js','js/surface-review.mjs','js/visual-hull.js'];
const worker=`importScripts('/js/surface-worker-real.js');const realRequest=self.onmessage;self.onmessage=async event=>{
  if(event.data.type!=='segment')return realRequest(event);
  const width=80,height=120,data=new Float32Array(width*height);
  for(let y=10;y<110;y++)for(let x=25;x<55;x++)data[y*width+x]=1;
  const mask=VisualHull.prepareMask({width,height,data,centerX:39.5});event.data.bitmap.close();
  self.postMessage({id:event.data.id,mask,model:'SYNTHETIC RECTANGLE',delegate:'TEST'},[mask.bits.buffer]);
};`;
http.createServer((req,res)=>{
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)||req.method!=='GET'){res.writeHead(403);return res.end();}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'");
  const file=req.url.slice(1);
  if(file==='js/surface-worker.js'){res.setHeader('Content-Type','text/javascript');return res.end(worker);}
  if(files.includes(file)||file==='js/surface-worker-real.js'||file==='tests/main-surface-preview.js'){
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(path.join(root,file==='js/surface-worker-real.js'?'js/surface-worker.js':file)));
  }
  if(req.url!=='/'){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic main-app 3D rehearsal</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/body-insights.css"><body><main style="padding:24px;max-width:700px;margin:auto"><h1>Main-app scan rehearsal</h1><p>SYNTHETIC RECTANGLE PHOTOS AND LENGTHS. No real people, model accuracy, account or database.</p><button id="begin" class="btn amber">Rehearse the main scan flow</button><p id="outcome" role="status"></p></main>${['sheets','body-outputs','scan-record','body-scan'].map(f=>'<script src="/js/'+f+'.js"></script>').join('')}<script src="/tests/main-surface-preview.js"></script></body></html>`);
}).listen(port,'127.0.0.1',()=>console.log('Synthetic main-app rehearsal: http://127.0.0.1:'+port));
