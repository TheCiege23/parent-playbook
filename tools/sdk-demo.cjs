// Local SDK integration host; no uploads or database. Exact routes only.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const files = {'/':'tools/sdk-demo.html','/sdk-demo.mjs':'tools/sdk-demo.mjs'};
for (const file of require('./sdk-files.cjs').SDK_FILES) files['/js/'+file] = 'js/'+file;
const port = Number(process.argv[2] || 8774);
http.createServer((req, res) => {
  if (!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)) {res.writeHead(403); return res.end();}
  if (req.method !== 'GET' || !Object.hasOwn(files, req.url)) {res.writeHead(404); return res.end();}
  res.setHeader('Content-Type', req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript');
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; img-src 'self' blob:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.end(fs.readFileSync(path.join(__dirname,'..',files[req.url])));
}).listen(port,'127.0.0.1',()=>console.log('Company SDK demo: http://127.0.0.1:'+port));
