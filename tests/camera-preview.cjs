// Local synthetic video fixture. No physical camera, real consent or model inference.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),allowed=['css/app.css','js/sheets.js','js/body-scan.js','js/scan-camera.js','js/photo-identity.js'];
http.createServer((req,res)=>{
 const file=req.url.slice(1);
 if(allowed.includes(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(path.join(root,file)));}
 if(req.url!=='/'){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic scan camera test</title><link rel="stylesheet" href="/css/app.css"><body><p style="padding:14px;text-align:center">LOCAL SYNTHETIC VIDEO TEST · NO PHYSICAL CAMERA · NO ATHLETE DATA</p><main style="padding:20px"><button class="btn amber" id="start">Open test capture</button><p id="result" role="status"></p><img id="captured" hidden alt="Captured synthetic test frame" style="max-width:300px"></main><script>
 const state={user:{id:'test-parent'}},H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'');
 function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 // Explicit test substitution: generates colored test video, never calls a camera.
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=960;const ctx=canvas.getContext('2d');
  function draw(){ctx.fillStyle='#164b40';ctx.fillRect(0,0,720,960);ctx.fillStyle='#efc56b';ctx.fillRect(0,0,100,960);ctx.fillStyle='#fff';ctx.font='32px sans-serif';ctx.fillText('SYNTHETIC VIDEO',150,220);ctx.fillText('NO CAMERA',150,270);ctx.fillText('LEFT',15,80);ctx.fillText('RIGHT',560,880);}
  draw();const stream=canvas.captureStream(2),timer=setInterval(draw,500),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);
  track.stop=()=>{clearInterval(timer);stop();canvas.width=canvas.height=0;document.querySelector('#result').textContent='Synthetic stream stopped.';};return stream;
 }});
 </script><script src="/js/sheets.js"></script><script src="/js/scan-camera.js"></script><script src="/js/photo-identity.js"></script><script src="/js/body-scan.js"></script><script>
 loadScanConsent=async()=>({id:'test-release'});bsMarkActive=()=>{};
 registerBodyProvider({id:'test-provider',measure:async()=>({})});
 let capturedURL=null;const actualReview=bsReview;
 const duplicateTest=document.createElement('button');duplicateTest.className='btn ghost';duplicateTest.textContent='Test duplicate rejection';document.querySelector('main').appendChild(duplicateTest);
 duplicateTest.onclick=()=>{
  const bytes='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#164b40"/><text x="40" y="140" fill="white" font-size="25">SYNTHETIC TEST PHOTO</text></svg>';
  BS.frames={front:new Blob([bytes],{type:'image/svg+xml'})};BS.subject={id:'test-athlete'};BS.consent=true;BS.consentId='test-release';actualReview(1,new Blob([bytes],{type:'image/svg+xml'}));
 };
 bsReview=(i,blob)=>{if(capturedURL)URL.revokeObjectURL(capturedURL);capturedURL=URL.createObjectURL(blob);const img=document.querySelector('#captured');img.src=capturedURL;img.hidden=false;document.querySelector('#result').textContent='Captured synthetic JPEG and stopped stream. Pose review is not part of this fixture.';};
 document.querySelector('#start').onclick=()=>{BS.frames={};BS.subject={id:'test-athlete'};BS.consent=true;BS.consentId='test-release';bsCapture(0);};
 </script></body></html>`);
}).listen(Number(process.argv[2]||8769),'127.0.0.1',()=>console.log('Synthetic camera fixture: http://127.0.0.1:'+Number(process.argv[2]||8769)));
