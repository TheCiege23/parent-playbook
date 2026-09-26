const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fakeSupabase}=require('./support/fake-supabase.cjs');
function context(extra={}){
  const state={user:{id:'parent'},active:{id:'athlete',first_name:'QA'},canEdit:true,role:'owner'};
  const ctx={state,console:{error(){}},Date,Error,document:{getElementById:()=>null},...extra};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/sheets.js','utf8'),ctx);vm.runInContext(fs.readFileSync('js/story-tools.js','utf8'),ctx);if(extra.sheet)ctx.sheet=extra.sheet;return ctx;
}
function revokeSetup(errors={}){
  const grant={id:'grant',athlete_id:'athlete',guardian_id:'coach',role:'coach',revoked_at:null};
  const other={...grant,id:'sibling',athlete_id:'other'};
  const sb=fakeSupabase({athlete_access:[grant,other]},{errors}),events=[],elements={};
  const originalFrom=sb.from;sb.from=table=>{const q=originalFrom(table),then=q.then;q.then=(resolve,reject)=>then(result=>resolve({...result,data:result.error?null:[{id:grant.id}]}),reject);return q;};
  const bg={isConnected:true,remove(){this.isConnected=false;},querySelector:s=>elements[s]||=( {disabled:false,textContent:''})};
  const ctx=context({sb,sheet:html=>{bg.html=html;return bg;},H:(s,...v)=>s.reduce((o,x,i)=>o+x+(v[i]??''),''),esc:String,toast:x=>events.push(x),renderApp:x=>events.push(x)});
  ctx.confirmRemoveAthleteAccess(grant);return {ctx,sb,bg,elements,events,grant,other};
}
test('removing connected access revokes only the selected athlete grant and preserves history',async()=>{
  const h=revokeSetup();await h.elements['#accessRemoveYes'].onclick();
  assert.ok(h.grant.revoked_at);assert.equal(h.other.revoked_at,null);assert.equal(h.sb.tables.athlete_access.length,2);
  assert.equal(h.bg.isConnected,false);assert.deepEqual(h.events,['Access removed','profile']);
  assert.match(h.bg.html,/Previously downloaded files/);assert.match(h.bg.html,/other athletes is unchanged/);
});
test('a failed access revocation stays open with retry and no success message',async()=>{
  const h=revokeSetup({'update:athlete_access':{message:'offline'}});await h.elements['#accessRemoveYes'].onclick();
  assert.equal(h.grant.revoked_at,null);assert.equal(h.bg.isConnected,true);assert.equal(h.elements['#accessRemoveYes'].disabled,false);
  assert.match(h.elements['#accessRemoveError'].textContent,/Could not remove/);assert.deepEqual(h.events,[]);
});
test('an access confirmation left open after switching accounts cannot revoke anything',async()=>{
  const h=revokeSetup();h.ctx.state.user={id:'other'};await h.elements['#accessRemoveYes'].onclick();assert.equal(h.sb.log.length,0);assert.equal(h.grant.revoked_at,null);
});
test('owner and self access never open a removal dialog',()=>{
  const h=revokeSetup();h.bg.html='unchanged';h.ctx.confirmRemoveAthleteAccess({...h.grant,role:'owner'});assert.equal(h.bg.html,'unchanged');
  h.ctx.confirmRemoveAthleteAccess({...h.grant,guardian_id:'parent'});assert.equal(h.bg.html,'unchanged');
});
function alertSetup({errors={},deferred=false}={}){
  const button={},target={isConnected:true,hidden:true,innerHTML:'',querySelector:()=>button},opened=[];
  const sb=fakeSupabase({story_contributions:[{id:1,athlete_id:'athlete',status:'pending'},{id:2,athlete_id:'athlete',status:'approved'},{id:3,athlete_id:'other',status:'pending'}]},{errors});
  let finish;
  const ctx=context({document:{getElementById:()=>target},sb:deferred?{from:()=>{const q={select:()=>q,eq:()=>q,then:resolve=>{finish=resolve;}};return q;}}:sb});
  ctx.openStoryCollaboration=()=>opened.push('opened');return{ctx,target,button,opened,finish:()=>finish};
}
test('Story approval alerts count only pending submissions for the active athlete and open review',async()=>{
  const h=alertSetup();await h.ctx.refreshStoryReviewAlert();assert.equal(h.target.hidden,false);assert.match(h.target.innerHTML,/1 Story contribution needs/);
  h.button.onclick();assert.deepEqual(h.opened,['opened']);h.target.isConnected=false;h.button.onclick();assert.equal(h.opened.length,1);
});
test('a slow Story count cannot update the next account or athlete screen',async()=>{
  const h=alertSetup({deferred:true}),promise=h.ctx.refreshStoryReviewAlert();await new Promise(setImmediate);h.ctx.state.active={id:'other'};h.finish()({count:2,error:null});await promise;assert.equal(h.target.hidden,true);assert.equal(h.target.innerHTML,'');
});
test('coaches and family viewers are not offered parent approval alerts',async()=>{
  const h=alertSetup();h.ctx.state.role='coach';await h.ctx.refreshStoryReviewAlert();assert.equal(h.target.hidden,true);
  h.ctx.state.role='family_view';h.ctx.state.canEdit=false;await h.ctx.refreshStoryReviewAlert();assert.equal(h.target.hidden,true);
});
test('a failed Story count gives a review entry rather than falsely reporting zero approvals',async()=>{
  const h=alertSetup({errors:{'select:story_contributions':{message:'offline'}}});await h.ctx.refreshStoryReviewAlert();assert.equal(h.target.hidden,false);assert.match(h.target.innerHTML,/count could not load/);h.button.onclick();assert.equal(h.opened.length,1);
});
