// Explicit synthetic browser fixture. No Supabase connection or real athlete records.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),files=['css/app.css','css/body-insights.css','js/body-outputs.js','js/scan-record.js','js/body-insights.js','js/assessment-report.js','js/org-insights.js'];
const table={teams:[{id:'demo-team',name:'Northside Sports Academy · Sample',created_by:'demo-admin'}],athletes:[{id:'a',first_name:'Alex (sample)'},{id:'b',first_name:'Blair (sample)'},{id:'c',first_name:'Casey (sample)'},{id:'d',first_name:'Drew (sample)'}],measurements:[],company_body_assessments:[{id:'company-copy-a',assessment_id:'demo-scan-a-2026-09-08',team_id:'demo-team',athlete_id:'a',captured_at:'2026-09-08T12:00:00Z',saved_at:'2026-09-09T12:00:00Z',retention_until:'2027-09-09T23:59:59Z'}]};
table.team_memberships=table.athletes.map(a=>({id:'membership-'+a.id,team_id:'demo-team',athlete_id:a.id}));
for(const [athlete,key,value,date,version] of [['a','wingspan',60,'2026-09-08','1.2.1'],['a','shoulder_width',14,'2026-09-08','1.2.1'],['d','torso_length',19,'2026-09-07','1.2.1'],['d','wingspan',62,'2026-08-01','1.2.0'],['b','leg_length',31,'2026-09-08',null]]){
 const meta={schema:1,id:'demo-scan-'+athlete+'-'+date,athlete_id:athlete,captured_at:date+'T12:00:00Z',engine:{id:'on-device-demo',version,model:'synthetic fixture'},output_dictionary:'body-outputs-v2',processing:{protocol:'provider-wall-time-v1',duration_ms:1200},input_height:{value:60,unit:'in'},quality:{}};
 table.measurements.push({id:athlete+key+date,athlete_id:athlete,metric_key:key,value,unit:'in',source:'photo',measured_on:date,note:version?'PP_SCAN_V1:'+JSON.stringify(meta):null});
}
const port=Number(process.argv[2]||8773);
http.createServer((req,res)=>{
 const file=req.url.slice(1);
 if(files.includes(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(path.join(root,file)));}
 if(!['/','/athlete'].includes(req.url)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
 res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic organization assessments preview</title><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/body-insights.css"><body><p style="padding:16px;background:#ffe6a0;text-align:center">SYNTHETIC COMPANY DASHBOARD · NO REAL ATHLETES OR DATABASE</p><main id="previewRoot"></main><script>
 const tables=${JSON.stringify(table)},state={user:{id:'demo-admin'}},root=document.getElementById('previewRoot');
 function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function openOrgRoster(){openOrgBodyInsights('demo-team');}
 const sb={from(table){const filters=[],orders=[];const q={select:()=>q,eq:(k,v)=>(filters.push(r=>r[k]===v),q),in:(k,vs)=>(filters.push(r=>vs.includes(r[k])),q),order:k=>(orders.push(k),q),range:async(a,b)=>({data:rows().slice(a,b+1),error:null}),maybeSingle:async()=>({data:rows()[0]||null,error:null})};function rows(){let r=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));for(const k of orders)r=r.slice().sort((a,b)=>String(a[k]).localeCompare(String(b[k])));return r;}return q;}};
 </script>${files.filter(f=>f.endsWith('.js')).map(f=>'<script src="/'+f+'"></script>').join('')}<script>location.pathname==='/athlete'?openOrgBodyAthlete('demo-team','a','2026-09-09'):openOrgBodyInsights('demo-team');</script></body></html>`);
}).listen(port,'127.0.0.1',()=>console.log('Synthetic organization preview: http://127.0.0.1:'+port));
