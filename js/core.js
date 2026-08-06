const SUPABASE_URL = "https://xqvqjkdxykowwpcmyudz.supabase.co";
const SUPABASE_KEY = "sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s,el=document)=>el.querySelector(s);
const root = $("#root");
const esc = s => (s??"").toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H = (strings,...v)=>strings.reduce((a,s,i)=>a+s+(v[i]??''),'');
// client-side UUID so inserts don't need RETURNING (INSERT...RETURNING re-checks the
// SELECT policy, which fails on `families` because membership is added by an AFTER trigger)
const uuid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&0x3|0x8)).toString(16);});

function toast(msg){
  const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);
  setTimeout(()=>t.remove(),2600);
}
function ageFrom(bd){ if(!bd) return null;
  // Parse 'YYYY-MM-DD' as a LOCAL date (new Date('YYYY-MM-DD') is UTC midnight,
  // which reads back as the previous day in western timezones → age off by one).
  const p=String(bd).slice(0,10).split('-');
  const d=(p.length===3)?new Date(+p[0],+p[1]-1,+p[2]):new Date(bd);
  const n=new Date();
  let a=n.getFullYear()-d.getFullYear(); if(n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate()))a--; return a; }

// ---------- app state ----------
const state = { user:null, ref:null, athletes:[], active:null, activeSportKey:null };
