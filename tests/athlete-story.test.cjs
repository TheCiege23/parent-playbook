const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {fakeSupabase}=require('./support/fake-supabase.cjs');
function ctx(sb){const c={sb,state:{ref:{sports:[{key:'football',name:'Football'}]}},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),fmtDate:s=>s};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/athlete-story.js'),'utf8'),c);return c;}
test('story loader scopes every record to the chosen athlete',async()=>{
  const c=ctx(fakeSupabase({games:[{athlete_id:'a',season:'Fall'},{athlete_id:'b',season:'Secret'}],milestones:[],media:[],athlete_sports:[]}));
  const d=await c.storyLoad('a');assert.equal(d.games.length,1);assert.equal(d.games[0].season,'Fall');
});
test('story loader rejects partial failures instead of presenting missing achievements',async()=>{
  const c=ctx(fakeSupabase({}, {errors:{'select:milestones':{message:'offline'}}}));await assert.rejects(c.storyLoad('a'));
});
test('resume escapes entered titles and excludes notes, birthdays, measurements and media URLs',()=>{
  const c=ctx();const html=c.storyResumeHTML({first_name:'<script>alert(1)</script>',birthdate:'PRIVATE_BIRTHDAY'},
    {sports:[{sport_key:'football',positions:['RB']}],games:[{season:'Fall',notes:'PRIVATE_NOTE'}],achievements:[{title:'<img src=x>',milestone_date:'2026-09-26',note:'PRIVATE_NOTE'}],media:[{path:'SECRET_URL'}],measurements:[{value:'PRIVATE_MEASUREMENT'}]});
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/Football/);
  for(const secret of ['PRIVATE_BIRTHDAY','PRIVATE_NOTE','SECRET_URL','PRIVATE_MEASUREMENT'])assert.equal(html.includes(secret),false);
});
test('empty resume gives an actionable record without fabricated achievements',()=>{
  const html=ctx().storyResumeHTML({first_name:'QA'},{sports:[],games:[],achievements:[]});assert.match(html,/0 games/);assert.match(html,/No games logged yet/);assert.match(html,/Add a championship/);
});
