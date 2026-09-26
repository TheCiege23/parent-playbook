const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fakeSupabase}=require('./support/fake-supabase.cjs');
const read=file=>fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');

test('Profile binds the real invitation button while the hidden landing invite section remains',async()=>{
  const elements=new Map(),empty={querySelectorAll:()=>[]};
  const get=s=>{if(!elements.has(s))elements.set(s,{...empty});return elements.get(s);};
  const ctx={console,state:{user:{id:'owner'},active:{id:'kid',first_name:'QA',family_id:'family'},athletes:[],ref:{sports:[]},canEdit:true},
    sb:{from:()=>{const q={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,gte:()=>q,lte:()=>q,then:resolve=>resolve({data:[],error:null})};return q;}},
    $:get,H:(s,...v)=>s.reduce((out,x,i)=>out+x+(v[i]??''),''),esc:String,ageFrom:()=>12,
    isoDay:()=> '2026-09-21',mondayOfThisWeek:()=>new Date(),dateForDayIndex:()=> '2026-09-27',
    logUsageEvent(){},setAppBg(){},topBar:()=>'',playbookPath:()=>'',bindTop(){},bindPlaybookPath(){},
    openEditAthlete(){},startAddChild(){},renderApp(){},document:{querySelectorAll:()=>[]}};
  let opened=0;ctx.openInvite=()=>opened++;
  vm.createContext(ctx);vm.runInContext(read('js/screen-profile.js'),ctx);
  await ctx.screenProfile();
  assert.match(read('index.html'),/<section id="invite"/,'real landing section persists behind the app');
  assert.match(get('#screen').innerHTML,/id="profileInvite"/);
  assert.equal(get('#invite').onclick,undefined,'hidden landing section is not wired as an app button');
  get('#profileInvite').onclick();assert.equal(opened,1);
});

function notifContext({on=false,failSave=false,failEnable=false}={}){
  const elements={},el=()=>({classList:{contains:()=>true,toggle(){}},setAttribute(){},querySelector:()=>null});
  for(const id of ['pushState','prefWeekly','prefGame'])elements[id]=el();
  const prefs={weekly:true,game_day:true},writes=[],toasts=[];
  const ctx={console:{error(){}},document:{getElementById:id=>elements[id]},state:{user:{id:'owner'}},
    pushNeedsInstall:()=>false,pushSupported:()=>true,pushIsOn:async()=>on,
    enablePush:async()=>{if(failEnable)throw new Error('offline');return false;},
    sb:{from:()=>({upsert:async row=>{writes.push(row);if(failSave)throw new Error('offline');return {error:null};}})},
    toast:msg=>toasts.push(msg),reportError(){}};
  vm.createContext(ctx);vm.runInContext(read('js/account.js'),ctx);ctx.bindNotifPrefs(prefs);
  return {ctx,elements,prefs,writes,toasts};
}

test('enabled reminder preferences show that the device still needs registration',async()=>{
  const {elements}=notifContext();await new Promise(setImmediate);
  assert.match(elements.pushState.innerHTML,/not enabled on this device/);
  assert.match(elements.pushState.innerHTML,/Enable reminders on this device/);
});

test('failed preference saves leave the switch unchanged and retryable',async()=>{
  const {elements,prefs}=notifContext({failSave:true});
  await elements.prefWeekly.onclick();assert.equal(prefs.weekly,true);assert.equal(elements.prefWeekly.disabled,false);
});

test('leaving settings during a push check does not save preferences for another account',async()=>{
  const {ctx,elements,writes}=notifContext();elements.prefWeekly.classList.contains=()=>false;
  ctx.pushIsOn=async()=>{ctx.state.user={id:'other'};return true;};
  await elements.prefWeekly.onclick();assert.equal(writes.length,0);assert.equal(elements.prefWeekly.disabled,false);
});

test('a NULL invite result is a wrong code, never a successful acceptance',async()=>{
  let reopened=0,accepted=0;const errorElement={};
  const ctx={root:{},sb:{rpc:async()=>({data:null,error:null})},H:(s,...v)=>s.reduce((out,x,i)=>out+x+(v[i]??''),''),
    $:()=>errorElement,logUsageEvent:()=>accepted++,renderRedeem:async()=>reopened++};
  vm.createContext(ctx);vm.runInContext(read('js/invites.js'),ctx);
  ctx.renderRedeem=async()=>reopened++;
  await ctx.acceptAndEnter('synthetic','000000');assert.equal(reopened,1);assert.equal(accepted,0);
  assert.match(errorElement.textContent,/code is not right/);
});
