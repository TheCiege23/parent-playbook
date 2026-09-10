// Local-only comparison host; no directory access, uploads, or account connection.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const files={'/':'repeat-lab.html','/repeat-lab.js':'repeat-lab.js','/repeat-worker.js':'repeat-worker.js',
  '/mesh-section.js':'../../js/mesh-section.js','/surface-archive.js':'surface-archive.js','/surface-repeat.js':'surface-repeat.js'};
const port=Number(process.argv[2]||8775);
http.createServer((req,res)=>{
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);return res.end();}
  if(req.method!=='GET'||!Object.hasOwn(files,req.url)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':'text/javascript');res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.end(fs.readFileSync(path.join(__dirname,files[req.url])));
}).listen(port,'127.0.0.1',()=>console.log('Repeat-scan comparison lab: http://127.0.0.1:'+port));
