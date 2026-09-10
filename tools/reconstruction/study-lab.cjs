const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const files={'/':'study-lab.html','/study-lab.js':'study-lab.js','/study-worker.js':'study-worker.js','/mesh-section.js':'../../js/mesh-section.js',
  '/surface-archive.js':'surface-archive.js','/surface-reference.js':'surface-reference.js','/surface-study.js':'surface-study.js','/evidence-report.js':'evidence-report.js',
  '/progress.json':'../parity-progress.json'};
const port=Number(process.argv[2]||8776);
http.createServer((req,res)=>{
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);return res.end();}
  if(req.method!=='GET'||!Object.hasOwn(files,req.url)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':req.url==='/progress.json'?'application/json':'text/javascript');res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-src 'self' blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.end(fs.readFileSync(path.join(__dirname,files[req.url])));
}).listen(port,'127.0.0.1',()=>console.log('Reference study and evidence brief: http://127.0.0.1:'+port));
