// Local preview with an explicit public-file allowlist. Never serves secrets or audit notes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const pages=new Set(['index.html','404.html','coaches.html','organizations.html','privacy.html','terms.html','datadeletion.html','icon.svg','manifest.webmanifest','sw.js','og.png','tools/adult-harness/index.html','tools/adult-harness/fake-supabase.js']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json','.wasm':'application/wasm'};
http.createServer((req,res)=>{
  let file;
  try{file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';}catch{res.writeHead(400);return res.end();}
  if(!path.extname(file))file+='.html';
  const target=path.resolve(root,file);
  if(req.method!=='GET'||!target.startsWith(root+path.sep)||(!pages.has(file)&&! /^(css|js|img|assets)\//.test(file))){res.writeHead(404);return res.end();}
  fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
}).listen(Number(process.env.PP_AUDIT_PORT)||8787,'127.0.0.1',()=>console.log('Public app preview: http://127.0.0.1:'+ (Number(process.env.PP_AUDIT_PORT)||8787)));
