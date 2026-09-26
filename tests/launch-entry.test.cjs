const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const {fakeSupabase}=require('./support/fake-supabase.cjs');
function context(hash='#account',search=''){
  const calls=[],elements=new Map();
  const ctx={console,calls,root:{innerHTML:''},state:{user:{id:'coach',email:'coach@example.test'},athletes:[],active:null},
    location:{hash,search,origin:'https://playbookbp.com',pathname:'/'},history:{replaceState(){}},
    document:{body:{classList:{remove(){},add(){}}}},
    H:(s,...v)=>s.reduce((out,x,i)=>out+x+(v[i]??''),''),esc:x=>String(x),setAppBg(){},
    $:s=>{if(!elements.has(s))elements.set(s,{});return elements.get(s);},
    loadAthletes:async()=>{},loadRef:async()=>{},loadPremium:async()=>{},loadAdultTrainingAccess:async()=>{},
    renderApp:async tab=>calls.push(tab),inviteTokenFromUrl:()=>null,teamCodeFromUrl:()=>null,
    openMyOrg:()=>calls.push('rosters'),logOutOfApp:()=>calls.push('logout')};
  vm.createContext(ctx);vm.runInContext(read('js/auth.js'),ctx);vm.runInContext(read('js/account.js'),ctx);
  ctx.loadAthletes=async()=>{};
  ctx.logOutOfApp=()=>calls.push('logout');
  return ctx;
}
test('a coach with no child profile reaches Account before parent onboarding or a pending parent draft',async()=>{
  const ctx=context();ctx.obReadStash=()=>{throw new Error('must not consume parent draft');};
  await ctx.afterLogin();assert.deepEqual(ctx.calls,['account']);
});

test('returning roster owners reach Account from a plain login link',async()=>{
  const ctx=context('');ctx.sb=fakeSupabase({teams:[{id:'roster',created_by:'coach'}]});
  await ctx.afterLogin();assert.deepEqual(ctx.calls,['account']);
});

test('starting a child profile clears coach routing while preserving other query parameters',async()=>{
  const ctx=context('#account','?login=1&account=1&team=BEARS26');ctx.URLSearchParams=URLSearchParams;
  let url;ctx.history.replaceState=(a,b,value)=>url=value;
  ctx.myFamilyId=async()=>null;ctx.renderOnboarding=()=>ctx.calls.push('onboarding');
  await ctx.startChildSetup();assert.equal(url,'/?team=BEARS26');assert.deepEqual(ctx.calls,['onboarding']);
});
test('organization signup and confirmation return preserve the account destination',async()=>{
  const ctx=context();ctx.renderAuth('login');
  assert.match(ctx.root.innerHTML,/Create a free account/);
  ctx.$('#swap').onclick({preventDefault(){}});
  assert.match(ctx.root.innerHTML,/No child profile is required/);
  assert.doesNotMatch(ctx.root.innerHTML,/I am the parent or legal guardian/);
  assert.equal(ctx.authRedirectUrl(),'https://playbookbp.com/?login=1&account=1');
  const returned=context('', '?login=1&account=1');await returned.afterLogin();assert.deepEqual(returned.calls,['account']);
});
test('organization confirmation preserves an invitation as well',()=>{
  const ctx=context();ctx.inviteTokenFromUrl=()=> 'example token';
  assert.equal(ctx.authRedirectUrl(),'https://playbookbp.com/?invite=example%20token&login=1&account=1');
  ctx.location.hash='';ctx.renderAuth('login');ctx.$('#swap').onclick({preventDefault(){}});
  assert.match(ctx.root.innerHTML,/accept the family's invitation/);
  assert.doesNotMatch(ctx.root.innerHTML,/I am the parent or legal guardian/);
});
test('organization account offers roster management and a separate parent setup without a child',()=>{
  const ctx=context();ctx.startChildSetup=()=>ctx.calls.push('child');
  ctx.screenOrganizationAccount();
  assert.match(ctx.root.innerHTML,/Coach &amp; organization tools/);
  ctx.$('#orgAccountRosters').onclick();ctx.$('#orgAccountChild').onclick();ctx.$('#orgAccountLogout').onclick();
  assert.deepEqual(ctx.calls,['rosters','child','logout']);
});
test('dismissing installation survives a later browser install event in the same visit',()=>{
  const events={},classes=new Set(),els={};
  ['a2hs','a2hsGo','a2hsX','a2hsSub','a2hsSteps'].forEach(id=>els[id]={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}});
  const ctx={window:{matchMedia:()=>({matches:false}),addEventListener:(name,fn)=>events[name]=fn},
    navigator:{userAgent:'Chrome'},document:{getElementById:id=>els[id]},localStorage:{getItem:()=>null,setItem(){}},setTimeout};
  vm.createContext(ctx);vm.runInContext(read('js/pwa.js'),ctx);ctx.initInstallBanner();
  events.beforeinstallprompt({preventDefault(){}});assert.equal(classes.has('show'),true);
  els.a2hsX.onclick();events.beforeinstallprompt({preventDefault(){}});assert.equal(classes.has('show'),false);
});
