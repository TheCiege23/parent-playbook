// Loopback-only experiment. Exact allowlist; no upload endpoint, database, or logs of photos.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const files={
 '/':['silhouette-lab.html','text/html; charset=utf-8'],
 '/silhouette-lab.js':['silhouette-lab.js','text/javascript'],
 '/silhouette-worker.js':['silhouette-worker.js','text/javascript'],
 '/visual-hull.js':['../../js/visual-hull.js','text/javascript'],
 '/mesh-section.js':['../../js/mesh-section.js','text/javascript'],
 '/surface-reference.js':['surface-reference.js','text/javascript'],
 '/surface-archive.js':['surface-archive.js','text/javascript'],
 '/avatar-files.js':['avatar-files.js','text/javascript'],
};
for(const file of ['photo-import.mjs','photo-import-worker.js','heic-decode.js','surface-worker.js','visual-hull.js'])files['/js/'+file]=['../../js/'+file,'text/javascript'];
const port=Number(process.argv[2]||8771);
http.createServer((req,res)=>{
  if(req.headers.host!=='127.0.0.1:'+port&&req.headers.host!=='localhost:'+port){res.writeHead(403);return res.end();}
  const file=files[req.url];
  if(req.method!=='GET'||!Object.hasOwn(files,req.url)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file[1]);res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; img-src 'self' blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.end(fs.readFileSync(path.join(__dirname,file[0])));
}).listen(port,'127.0.0.1',()=>console.log('Experimental silhouette lab: http://127.0.0.1:'+port));
