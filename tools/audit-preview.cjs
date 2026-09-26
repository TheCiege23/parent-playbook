// Local preview with an explicit public-file allowlist. Never serves secrets or audit notes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const pages=new Set(['index.html','404.html','coaches.html','organizations.html','privacy.html','terms.html','datadeletion.html','icon.svg','manifest.webmanifest','sw.js','og.png','tools/adult-harness/index.html','tools/adult-harness/fake-supabase.js','tools/adult-harness/synthetic-highlight.mp4']);
const mime={'.mp4':'video/mp4','.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json','.wasm':'application/wasm'};
http.createServer((req,res)=>{
  let file;
  try{file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';}catch{res.writeHead(400);return res.end();}
  if(!path.extname(file))file+='.html';
  const target=path.resolve(root,file);
  if(req.method!=='GET'||!target.startsWith(root+path.sep)||(!pages.has(file)&&! /^(css|js|img|assets)\//.test(file))){res.writeHead(404);return res.end();}
  fs.readFile(target,(err,data)=>{
    if(err){res.writeHead(404);return res.end();}
    const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'};
    if(path.extname(file)==='.mp4'){
      headers['Accept-Ranges']='bytes';const range=req.headers.range;
      if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start=0,end=data.length-1;
        if(match){if(match[1]){start=Number(match[1]);if(match[2])end=Number(match[2]);}else if(match[2])start=Math.max(0,data.length-Number(match[2]));else start=-1;}
        if(!match||start<0||start>=data.length||end<start){res.writeHead(416,{'Content-Range':'bytes */'+data.length});return res.end();}
        end=Math.min(end,data.length-1);res.writeHead(206,{...headers,'Content-Range':'bytes '+start+'-'+end+'/'+data.length,'Content-Length':end-start+1});return res.end(data.subarray(start,end+1));
      }
    }
    res.writeHead(200,{...headers,'Content-Length':data.length});res.end(data);
  });
}).listen(Number(process.env.PP_AUDIT_PORT)||8787,'127.0.0.1',()=>console.log('Public app preview: http://127.0.0.1:'+ (Number(process.env.PP_AUDIT_PORT)||8787)));
