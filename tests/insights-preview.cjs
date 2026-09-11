// Local-only synthetic fixture. Never included in the production Docker allowlist.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const allowed=['css/app.css','css/body-insights.css','js/assessment-report.js','js/body-outputs.js','js/body-insights.js','js/scan-record.js','js/cdc-stature.js','js/maturity.js'];
http.createServer((req,res)=>{
  const file=req.url.slice(1);
  if(allowed.includes(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(path.join(root,file)));}
  if(req.url!=='/'){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','text/html');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/body-insights.css"><title>Body Insights — synthetic local preview</title></head><body style="background:#f6f2e9"><p style="padding:12px;text-align:center;background:#e7eee9">LOCAL TEST · SYNTHETIC DATA · NOT A REAL ATHLETE</p><main id="screen"></main><script>function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}</script><script src="/js/cdc-stature.js"></script><script src="/js/maturity.js"></script><script src="/js/scan-record.js"></script><script src="/js/body-outputs.js"></script><script src="/js/body-insights.js"></script><script src="/js/assessment-report.js"></script><script>
  const athlete={first_name:'Sample athlete',birthdate:'2014-01-01',sex_at_birth:'male',mother_height_in:64,father_height_in:70};
  const rows=[];for(const [i,date] of ['2026-03-01','2026-06-01','2026-09-09'].entries())for(const [metric_key,value,unit,source] of [['height',58+i,'in','manual'],['wingspan',59+i,'in','photo'],['standing_reach',74+i,'in','photo'],['shoulder_width',14+i*.2,'in','photo'],['leg_length',29+i*.4,'in','photo'],['torso_length',18+i*.2,'in','photo'],['vertical',10+i,'in','video'],['reaction_time',.38-i*.02,'s','video'],['footwork_cadence',3+i*.2,'steps/s','video']])rows.push({metric_key,value,unit,source,measured_on:date});
  function uuid(){return crypto.randomUUID();}
  for(const date of ['2026-06-01','2026-09-09']){
    for(const [i,s] of BODY_SEGMENTS.entries()) for(const side of ['left','right']) rows.push({metric_key:side+'_'+s.key+'_length',value:10+i*2+(side==='right'?.3:0),unit:'in',source:'photo',measured_on:date});
    const scanRows=rows.filter(r=>r.source==='photo'&&r.measured_on===date);
    const record=buildScanRecord({metrics:Object.fromEntries(scanRows.map(r=>[r.metric_key,r.value])),confidence:.72,detail:{framesUsed:['front','back','right','left'],sideMethod:'front-joint-proxy-v1',outputDictionary:'body-outputs-v1'}},{athleteId:'fixture',actorId:'fixture',consentId:'fixture',capturedAt:date+'T12:00:00Z',engine:{id:'ondevice-pose',version:'1.2.0',model:'synthetic-fixture'},height:{value:60,measured_on:date,source:'manual'},defaultUnit:'in'});
    for(const row of scanRows) row.note=record.rows[0].note;
  }
  function draw(date='2026-09-09',baseline='2026-06-01'){document.querySelector('#screen').innerHTML=biMarkup(athlete,rows,date,baseline);document.querySelector('#biDate').onchange=e=>draw(e.target.value,'2026-03-01');document.querySelector('#biBaseline').onchange=e=>draw(date,e.target.value);document.querySelector('#biReport').onclick=()=>assessmentDownload(assessmentReport(athlete,rows,date,baseline),'text/html','synthetic-report.html');document.querySelector('#biCSV').onclick=()=>assessmentDownload(assessmentCSV(rows),'text/csv','synthetic-measurements.csv');for(const id of ['biScan','biGrowth','biExport'])document.getElementById(id).disabled=true;}
  draw();</script></body></html>`);
}).listen(Number(process.argv[2]||8765),'127.0.0.1',()=>console.log('Synthetic preview: http://127.0.0.1:'+Number(process.argv[2]||8765)));
