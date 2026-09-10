// Only served by the isolated test fixture. Production never loads this file.
const state={user:{id:'synthetic-parent'},active:{id:'synthetic-athlete'}};
const H=(s,...v)=>s.reduce((a,x,i)=>a+x+(v[i]??''),'');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=()=>crypto.randomUUID(),ageFrom=()=>30;
function toast(){}function logUsageEvent(){}
let saved=null;
const sb={from(){return {async upsert(rows){saved=rows;return {error:null}}}}};
function renderApp(){document.getElementById('outcome').textContent=saved?.length&&!JSON.stringify(saved).match(/vertices|faces|SYNTHETIC RECTANGLE/)&&Object.keys(BS.frames).length===0?'PASS: measurement saved in memory; photos, silhouettes and geometry excluded. No database write.':'FAIL: inspect saved payload.';}
bsMarkActive=()=>{};bsAppendMaturity=()=>{};
loadScanConsent=async()=>({id:'synthetic-consent'});
registerBodyProvider({id:'ondevice-pose',version:'synthetic',model:'synthetic-lengths',defaultUnit:'in',async measure(){return {metrics:{wingspan:71,torso_length:22},heightIn:180/2.54,confidence:.7,detail:{framesUsed:['front','right','back','left']}};}});
bsCapture=async()=>{
  for(const [index,v] of ['front','right','back','left'].entries()){
    const c=document.createElement('canvas');c.width=80;c.height=120;const ctx=c.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,80,120);ctx.fillStyle=['#194e3f','#205846','#2a604b','#356c51'][index];ctx.fillRect(25,10,30,100);
    BS.frames[v]=await new Promise(resolve=>c.toBlob(resolve,'image/png'));c.width=c.height=0;
  }
  await bsRun();
};
document.getElementById('begin').onclick=()=>{
  saved=null;document.getElementById('outcome').textContent='';BS.frames={};BS.subject={id:'synthetic-athlete',first_name:'Synthetic test',birthdate:'1996-01-01'};BS.consent=true;BS.consentId='synthetic-consent';BS.surfaceRequested=false;BS.heightReference={value:180/2.54,measured_on:'2026-09-09',source:'synthetic fixture'};bsSetup();
};
