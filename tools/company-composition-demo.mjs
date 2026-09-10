import {validateCompositionModelManifest,validateCompositionEstimate,compositionUnavailableReason} from '/js/body-composition-contract.mjs';
import {evaluateCompositionValidationStudy} from '/js/body-composition-validation.mjs';
import {createCompanyCompositionStore} from '/js/body-composition-record.mjs';
import {createSupabaseCompanyCompositionAdapter} from '/js/body-composition-supabase.mjs';
const $=id=>document.getElementById(id),state={manifest:null,estimate:null,report:null,downloadUrl:null,user:null,teams:[],historyRequest:0};
const SUPABASE_URL='https://xqvqjkdxykowwpcmyudz.supabase.co',SUPABASE_KEY='sb_publishable_JKSj0ngr9nwq-YmX7yncpg_8xk2i2vJ';
const db=globalThis.supabase?.createClient(SUPABASE_URL,SUPABASE_KEY)||null;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function status(id,message,ok=false){const node=$(id);node.textContent=message;node.className=ok?'success':'error';}
function resetAfterManifest(){state.estimate=null;state.report=null;$('estimateFile').value='';$('studyFile').value='';$('estimateResult').hidden=true;$('studyResult').hidden=true;clearDownload();}
function clearDownload(){if(state.downloadUrl)URL.revokeObjectURL(state.downloadUrl);state.downloadUrl=null;$('reportDownload').hidden=true;$('reportDownload').removeAttribute('href');}
async function jsonFile(input){const file=input.files?.[0];if(!file)throw Error('Choose a JSON file.');if(file.size>5_000_000)throw Error('The JSON file must be 5 MB or smaller.');let value;try{value=JSON.parse(await file.text());}catch{throw Error('The selected file is not valid JSON.');}return value;}
function facts(items){return '<div class="facts">'+items.map(([value,label])=>'<div class="fact"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>';}
$('manifestFile').onchange=async event=>{state.manifest=null;resetAfterManifest();$('manifestResult').hidden=true;$('estimateFile').disabled=true;$('studyFile').disabled=true;try{const manifest=validateCompositionModelManifest(await jsonFile(event.currentTarget));state.manifest=manifest;$('estimateFile').disabled=false;$('studyFile').disabled=false;status('manifestStatus','Manifest structure accepted. Provider evidence still requires independent buyer review.',true);$('manifestResult').innerHTML='<p class="eyebrow">Accepted model manifest</p><h2>'+esc(manifest.provider.id)+' · '+esc(manifest.provider.model)+'</h2>'+facts([[manifest.outputs.length,'declared outputs'],[manifest.trainingReference.participantCount,'declared training participants'],[manifest.validationReference.participantCount,'declared validation participants']])+'<p>'+esc(manifest.limitations)+'</p>';$('manifestResult').hidden=false;}catch(error){status('manifestStatus',error.message||'The manifest was rejected.');}};
$('estimateFile').onchange=async event=>{state.estimate=null;$('estimateResult').hidden=true;try{const estimate=validateCompositionEstimate(await jsonFile(event.currentTarget),state.manifest);state.estimate=estimate;status('estimateStatus','Estimate accepted against the loaded manifest.',true);$('estimateResult').innerHTML='<p class="eyebrow">Accepted provider estimate</p><h2>Body composition outputs</h2><table><thead><tr><th>Metric</th><th>Estimate</th><th>Uncertainty</th></tr></thead><tbody>'+estimate.outputs.map(item=>'<tr><td>'+esc(item.label)+'</td><td>'+esc(item.value)+' '+esc(item.unit)+'</td><td>'+esc(item.uncertainty.status==='provided'?(item.uncertainty.lower+'–'+item.uncertainty.upper+' '+item.unit+' · '+item.uncertainty.method):'Not provided')+'</td></tr>').join('')+'</tbody></table><p>'+esc(estimate.limitations)+'</p>';$('estimateResult').hidden=false;}catch(error){status('estimateStatus',error.message||'The estimate was rejected.');}};
$('studyFile').onchange=async event=>{state.report=null;$('studyResult').hidden=true;clearDownload();try{const observations=await jsonFile(event.currentTarget),report=evaluateCompositionValidationStudy(observations,{manifest:state.manifest});state.report=report;status('studyStatus','Descriptive DEXA comparison report created.',true);$('studyResult').innerHTML='<p class="eyebrow">Independent comparison summary</p><h2>'+esc(report.studyId)+'</h2>'+facts([[report.participantCount,'coded participants'],[report.observationCount,'observations'],[report.referenceMethod,'reference method']])+'<table><thead><tr><th>Metric</th><th>N</th><th>Bias</th><th>MAE</th><th>RMSE</th><th>Max error</th></tr></thead><tbody>'+report.metrics.map(item=>'<tr><td>'+esc(item.label)+'</td><td>'+esc(item.observationCount)+'</td><td>'+esc(item.bias)+' '+esc(item.unit)+'</td><td>'+esc(item.mae)+' '+esc(item.unit)+'</td><td>'+esc(item.rmse)+' '+esc(item.unit)+'</td><td>'+esc(item.maximumAbsoluteError)+' '+esc(item.unit)+'</td></tr>').join('')+'</tbody></table><p>'+esc(report.limitations)+'</p>';$('studyResult').hidden=false;state.downloadUrl=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));$('reportDownload').href=state.downloadUrl;$('reportDownload').download='body-composition-validation-aggregate.json';$('reportDownload').hidden=false;}catch(error){status('studyStatus',error.message||'The comparison data was rejected.');}};
const templates={
  manifest:{schema:'PP_BODY_COMPOSITION_MODEL_MANIFEST_V1',provider:{id:'REPLACE_WITH_PROVIDER_ID',version:'REPLACE_WITH_VERSION',model:'REPLACE_WITH_MODEL_ID'},intendedUse:'informational_longitudinal',diagnosticUse:false,outputs:[{key:'lean_mass_kg',unit:'kg',definition:'REPLACE_WITH_PROVIDER_DEFINITION'}],trainingReference:{method:'DXA',datasetId:'REPLACE_WITH_DATASET_ID',participantCount:0,ageRange:{min:0,max:0},completedAt:'REPLACE_WITH_ISO_DATE'},validationReference:{method:'DXA',studyId:'REPLACE_WITH_STUDY_ID',independentFromTraining:true,participantCount:0,ageRange:{min:0,max:0},completedAt:'REPLACE_WITH_ISO_DATE'},rights:{status:'REPLACE_WITH_OWNED_LICENSED_OR_BUYER_SUPPLIED',expiresAt:null}},
  estimate:{schema:'PP_BODY_COMPOSITION_ESTIMATE_V1',status:'estimated',diagnosticUse:false,assessmentId:'REPLACE_WITH_ASSESSMENT_ID',subjectId:'REPLACE_WITH_OPAQUE_SUBJECT_ID',organizationId:'REPLACE_WITH_ORGANIZATION_ID',createdAt:'REPLACE_WITH_ISO_DATE',provider:{id:'MATCH_MANIFEST',version:'MATCH_MANIFEST',model:'MATCH_MANIFEST'},outputs:[{key:'lean_mass_kg',value:null,unit:'kg',uncertainty:{status:'not_provided'}}]},
  study:[{participantCode:'CODED_PARTICIPANT',scanId:'CODED_SCAN',metricKey:'lean_mass_kg',referenceMethod:'DXA',independentFromTraining:true,unit:'kg',referenceValue:null,estimatedValue:null,referenceAt:'REPLACE_WITH_ISO_DATE',estimateAt:'REPLACE_WITH_ISO_DATE'}],
};
function template(name){const url=URL.createObjectURL(new Blob([JSON.stringify(templates[name],null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='body-composition-'+name+'-template.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
for(const [id,name] of [['manifestTemplate','manifest'],['estimateTemplate','estimate'],['studyTemplate','study']])$(id).onclick=()=>template(name);
// Step 4 — organization-scoped composition history.
// The list is read straight from the store; nothing is invented to fill the screen, so with no
// licensed provider connected the honest answer is that there are no stored composition results.
// Every load takes a ticket: a slow answer belonging to a scope the operator already changed is
// dropped instead of rendering stale rows.
function historyScope(){return {subjectId:$('historySubject').value.trim(),subjectScope:$('historyScope').value};}
function historyReady(){return !!(db&&state.user&&$('historyTeam').value&&historyScope().subjectId);}
function historyButtons(){$('historyLoad').disabled=!historyReady();}
function historyMessage(text,ok=false){$('historyStatus').textContent=text;$('historyStatus').className=ok?'success':'';}
function resetHistory(){state.historyRequest++;$('historyResult').hidden=true;$('historyResult').innerHTML='';historyMessage('No stored composition results.');historyButtons();}
function historyStore(){
  const scope=historyScope(),team=$('historyTeam').value;
  return createCompanyCompositionStore(createSupabaseCompanyCompositionAdapter(db,{teamId:team,subjectReference:scope.subjectId,
    subjectScope:scope.subjectScope,athleteId:scope.subjectScope==='child_athlete'?scope.subjectId:null}));
}
function renderHistory(history){
  if(!history.count){$('historyResult').hidden=true;$('historyResult').innerHTML='';historyMessage('No stored composition results.'+(history.expiredCount?' '+history.expiredCount+(history.expiredCount===1?' expired past retention and is not shown.':' expired past retention and are not shown.'):''),true);return;}
  const rows=history.results.map(record=>'<tr><td>'+esc(record.capturedAt)+'</td><td>'+esc(record.resultId)+'</td><td>'+esc(record.provider.id)+' · '+esc(record.provider.model)+' '+esc(record.provider.version)+'</td><td>'+
    record.outputs.map(item=>esc(item.label)+' '+esc(item.value)+' '+esc(item.unit)+(item.uncertainty.status==='provided'?' ('+esc(item.uncertainty.lower)+'–'+esc(item.uncertainty.upper)+')':' (uncertainty not provided)')).join('<br>')+
    '</td><td>'+esc(record.retentionUntil)+'</td></tr>').join('');
  $('historyResult').innerHTML='<p class="eyebrow">Stored composition results</p><h2>'+esc(history.subjectId)+' · '+esc(history.subjectScope)+'</h2>'+
    facts([[history.count,'stored results'],[history.expiredCount,'expired past retention'],[history.subjectScope==='adult_reference'?'No child profile':'Rostered athlete','subject scope']])+
    '<table><thead><tr><th>Captured</th><th>Result</th><th>Provider model</th><th>Outputs</th><th>Retained until</th></tr></thead><tbody>'+rows+'</tbody></table><p>'+esc(history.limitations)+'</p>';
  $('historyResult').hidden=false;historyMessage(history.count+' stored composition result'+(history.count===1?'':'s')+' listed newest first.',true);
}
$('historyConnect').onclick=async()=>{
  resetHistory();$('historyConnect').disabled=true;historyMessage('Checking the signed-in session and organization access…');
  try{
    if(!db)throw Error('The Supabase client did not load in this browser.');
    const {data,error}=await db.auth.getSession();if(error)throw error;
    state.user=data?.session?.user||null;if(!state.user)throw Error('Sign in to Parent Playbook in this browser, then retry.');
    const response=await db.from('teams').select('id,name').eq('created_by',state.user.id).order('name');if(response.error)throw response.error;
    state.teams=response.data||[];if(!state.teams.length)throw Error('No organization administered by this account is available.');
    $('historyTeam').innerHTML='<option value="">Choose an organization</option>'+state.teams.map(team=>'<option value="'+esc(team.id)+'">'+esc(team.name)+'</option>').join('');
    $('historyTeam').disabled=false;if(state.teams.length===1)$('historyTeam').value=state.teams[0].id;
    historyMessage('Signed in. Choose the scope and opaque subject reference, then load stored results.',true);
  }catch(error){state.user=null;state.teams=[];$('historyTeam').disabled=true;historyMessage(error.message||'The organization session could not be read.');}
  finally{$('historyConnect').disabled=false;historyButtons();}
};
$('historyLoad').onclick=async()=>{
  if(!historyReady())return;
  const ticket=++state.historyRequest;$('historyLoad').disabled=true;historyMessage('Re-authorizing this organization scope and reading stored composition results…');
  try{
    const history=await historyStore().history(historyScope());
    if(ticket!==state.historyRequest)return;
    renderHistory(history);
  }catch(error){
    if(ticket!==state.historyRequest)return;
    $('historyResult').hidden=true;
    const message=error?.message||'';
    // The storage tables are provisioned by a migration that is applied separately from the
    // site deploy. Until that lands, say so in plain words rather than showing the operator a
    // raw PostgREST schema-cache error and leaving them to guess whether anything is stored.
    historyMessage(/does not exist|schema cache|PGRST205|42P01/i.test(message)
      ? 'Composition storage is not provisioned in this environment yet, so there is nothing to list. No stored composition results.'
      : (message||'The stored composition results could not be read.'));
  }
  finally{if(ticket===state.historyRequest)historyButtons();}
};
for(const id of ['historyTeam','historyScope','historySubject']){$(id).addEventListener('input',resetHistory);$(id).addEventListener('change',resetHistory);}
historyButtons();
const unavailable=compositionUnavailableReason(null);$('manifestStatus').textContent=unavailable.message;$('manifestStatus').className='';addEventListener('pagehide',clearDownload);
