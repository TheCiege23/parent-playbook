const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fakeSupabase}=require('./support/fake-supabase.cjs');
function setup(sb){
  const els=new Map(),chips=[];
  const ctx={console:{error(){}},sb,state:{user:{id:'coach'},ref:{sports:[{key:'soccer',name:'Soccer'}]}},
    root:{innerHTML:'',querySelectorAll:s=>s.includes('ocDays')?chips:[]},
    $:s=>{if(!els.has(s))els.set(s,{value:'',disabled:false});return els.get(s);},
    H:(s,...v)=>s.reduce((o,x,i)=>o+x+(v[i]??''),''),esc:String,
    DAY_LABELS:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],schedChips:()=>'',renderApp(){},logUsageEvent(){},toast(){}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/org.js'),'utf8'),ctx);
  return {ctx,chips};
}
test('a single owned roster retains the list and the create-another action',async()=>{
  const {ctx}=setup(fakeSupabase({teams:[{id:'one',created_by:'coach',name:'First',sport_key:'soccer',is_active:true}]}));
  await ctx.openMyOrg();assert.match(ctx.root.innerHTML,/Your rosters/);assert.match(ctx.root.innerHTML,/Start another roster/);
  await ctx.$('#orgNew').onclick();assert.match(ctx.root.innerHTML,/Start a roster/);
});
test('a rejected create request restores the actual button even when a nested element was clicked',async()=>{
  const {ctx}=setup({from(){throw Error('offline');}});await ctx.openOrgCreate();
  ctx.$('#ocName').value='QA roster';ctx.$('#ocSport').value='soccer';
  await ctx.$('#ocGo').onclick({target:{}});
  assert.equal(ctx.$('#ocGo').disabled,false);assert.equal(ctx.$('#ocGo').innerHTML,'Create roster');
  assert.match(ctx.$('#ocErr').textContent,/check your connection/);
});
test('conflicting practice and game days are rejected before writing a roster',async()=>{
  const sb=fakeSupabase();const {ctx,chips}=setup(sb);
  chips.push({dataset:{d:'2'},classList:{toggle(){}},setAttribute(){}});
  await ctx.openOrgCreate();ctx.$('#ocName').value='QA roster';ctx.$('#ocSport').value='soccer';
  chips[0].onclick();ctx.$('#ocGameDay').value='2';await ctx.$('#ocGo').onclick({});
  assert.match(ctx.$('#ocErr').textContent,/already a practice day/);assert.equal(sb.log.length,0);
});
test('partial roster data failure renders a retry instead of an empty roster',async()=>{
  const sb=fakeSupabase({teams:[{id:'one'}],team_memberships:[{team_id:'one',athlete_id:'child'}]},
    {errors:{'select:measurements':{message:'offline'}}});
  const {ctx}=setup(sb);await ctx.openOrgRoster('one');
  assert.match(ctx.root.innerHTML,/Couldn't load/);assert.match(ctx.root.innerHTML,/Retry/);
});
