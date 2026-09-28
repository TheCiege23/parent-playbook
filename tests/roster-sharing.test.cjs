const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../js/org.js'),'utf8');

test('leaving roster sharing removes only the current athlete from the selected team',async()=>{
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',disabled:false,onclick:null});
    return elements.get(id);
  };
  const list=element('#rosterSharingList');
  list.querySelector=element;
  list.querySelectorAll=selector=>selector==='[data-leave-roster]'?[Object.assign(element('leave'),{dataset:{leaveRoster:'0'}})]:[];
  const bg={isConnected:true,querySelector:selector=>selector==='#rosterSharingList'?list:element(selector),remove(){this.isConnected=false;}};
  const calls=[],notices=[];
  const athlete={id:'athlete-a',first_name:'Sam'};
  const state={active:athlete,user:{id:'parent-a'},canEdit:true};
  const context=vm.createContext({
    state,sheet:()=>bg,H:(strings,...values)=>strings.reduce((out,s,i)=>out+s+(values[i]??''),''),esc:String,
    toast:message=>notices.push(message),console,
    sb:{from:table=>{
      assert.equal(table,'team_memberships');
      return {
        select:()=>({eq:(field,value)=>{
          calls.push({action:'read',field,value});
          return Promise.resolve({data:[{id:'membership-a',team_id:'team-a',teams:{name:'Falcons'}}],error:null});
        }}),
        delete:()=>{
          const filters=[];
          return {eq(field,value){filters.push([field,value]);return this;},select:async()=>{
            calls.push({action:'delete',filters});return {data:[{id:'membership-a'}],error:null};
          }};
        },
      };
    }},
  });
  vm.runInContext(source,context,{filename:'org.js'});
  vm.runInContext('openAthleteRosterMemberships()',context);
  await new Promise(setImmediate);
  assert.match(list.innerHTML,/Falcons/);
  element('leave').onclick();
  assert.match(list.innerHTML,/Leave <b>Falcons<\/b>/);
  state.active={id:'athlete-b',first_name:'Alex'};
  await element('#rosterLeaveConfirm').onclick({currentTarget:element('#rosterLeaveConfirm')});
  assert.equal(calls.filter(call=>call.action==='delete').length,0,'a stale sheet cannot remove a different athlete');
  state.active=athlete;
  await element('#rosterLeaveConfirm').onclick({currentTarget:element('#rosterLeaveConfirm')});
  assert.deepEqual(calls.find(call=>call.action==='delete').filters,[['athlete_id','athlete-a'],['team_id','team-a']]);
  assert.deepEqual(notices,['Left Falcons']);
});
