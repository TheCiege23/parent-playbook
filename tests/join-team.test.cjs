const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const orgSource=fs.readFileSync(path.join(__dirname,'../js/org.js'),'utf8');
const sheetsSource=fs.readFileSync(path.join(__dirname,'../js/sheets.js'),'utf8');
const html=(strings,...values)=>strings.reduce((out,part,index)=>out+part+(values[index]??''),'');

function setup({canEdit=true,readError=null,lookup=null}={}){
  const elements=new Map(),calls=[],notices=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false});
    return elements.get(id);
  };
  const bg={isConnected:true,markup:'',querySelector:element,remove(){this.isConnected=false;}};
  const state={active:{id:'child-a',first_name:'Sam'},athletes:[{id:'child-a',first_name:'Sam'},{id:'child-b',first_name:'Alex'}],user:{id:'parent-a'},canEdit};
  const sb={
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='team_by_code') return lookup||{data:[{id:'team-a',name:'Falcons'}],error:null};
      return {data:null,error:null};
    },
    from:table=>{
      assert.equal(table,'team_memberships');
      return {
        select:()=>({eq(field,value){calls.push({action:'read-filter',field,value});return this;},limit:async()=>({data:[],error:readError})}),
        insert:async row=>{calls.push({action:'insert',row});return {error:null};},
      };
    },
  };
  const context=vm.createContext({state,sb,sheet:markup=>{bg.markup=markup;return bg;},H:html,esc:String,toast:message=>notices.push(message),logUsageEvent(){},console:{error(){}}});
  vm.runInContext(orgSource,context,{filename:'org.js'});
  return {context,state,bg,element,calls,notices};
}

test('joining a roster targets the active editable child and names them in the sheet',async()=>{
  const {context,bg,element,calls,notices}=setup();
  await context.openJoinTeam();
  assert.match(bg.markup,/adds\s+<b>Sam<\/b>/);
  assert.doesNotMatch(bg.markup,/child-b|jtAthlete/);
  element('#jtCode').value='FALCONS';
  await element('#jtGo').onclick({currentTarget:element('#jtGo')});
  assert.equal(calls.find(call=>call.action==='insert').row.athlete_id,'child-a');
  assert.deepEqual(notices,['Joined Falcons']);
});

test('a viewer cannot open roster joining or write a membership',async()=>{
  const {context,bg,calls,notices}=setup({canEdit:false});
  await context.openJoinTeam();
  assert.equal(bg.markup,'');
  assert.equal(calls.length,0);
  assert.match(notices[0],/Only a parent or co-parent/);
});

test('roster lookup stops if the selected child changes while it loads',async()=>{
  let resolveLookup;
  const pending=new Promise(resolve=>{resolveLookup=resolve;});
  const {context,state,element,calls}=setup({lookup:pending});
  await context.openJoinTeam();
  element('#jtCode').value='FALCONS';
  const joining=element('#jtGo').onclick({currentTarget:element('#jtGo')});
  state.active={id:'child-b',first_name:'Alex'};
  resolveLookup({data:[{id:'team-a',name:'Falcons'}],error:null});
  await joining;
  assert.equal(calls.filter(call=>call.action==='insert').length,0);
});

test('membership read failure does not insert a duplicate roster row',async()=>{
  const {context,element,calls}=setup({readError:{message:'offline'}});
  await context.openJoinTeam();
  element('#jtCode').value='FALCONS';
  await element('#jtGo').onclick({currentTarget:element('#jtGo')});
  assert.equal(calls.filter(call=>call.action==='insert').length,0);
  assert.match(element('#jtErr').textContent,/Could not join/);
  assert.equal(element('#jtGo').disabled,false);
});

test('practice days use native toggle buttons with an announced selection state',()=>{
  const context=vm.createContext({DAY_LABELS:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']});
  vm.runInContext(sheetsSource,context,{filename:'sheets.js'});
  const markup=context.schedChips([1,3],'pd');
  assert.match(markup,/role="group" aria-label="Practice days"/);
  assert.match(markup,/<button type="button" class="chip on" aria-pressed="true" data-d="1">Mon<\/button>/);
  assert.match(markup,/<button type="button" class="chip " aria-pressed="false" data-d="2">Tue<\/button>/);
});
