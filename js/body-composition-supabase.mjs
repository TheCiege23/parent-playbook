import {COMPOSITION_SUBJECT_SCOPES} from './body-composition-record.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE='company_composition_results',actions=new Set(['save','read','export','delete','history']),MAX_ROWS=200;
const fail=(code,message)=>{throw Object.assign(new Error(message),{name:'CompanyCompositionPersistenceError',code});};
const uuid=(value,label)=>{if(typeof value!=='string'||!UUID.test(value))fail('INVALID_COMPOSITION_SCOPE',label+' must be a UUID.');return value.toLowerCase();};
const text=(value,label,max=180)=>{if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('INVALID_COMPOSITION_SCOPE',label+' is invalid.');return value;};
const clone=value=>JSON.parse(JSON.stringify(value));
async function tokenFingerprint(token){
  if(typeof token!=='string'||!token)fail('AUTH_REQUIRED','An authenticated Supabase session is required.');
  if(!globalThis.crypto?.subtle)fail('CRYPTO_UNAVAILABLE','Web Crypto is required to bind the company session safely.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function dbError(operation,error){
  const message=typeof error?.message==='string'&&error.message.trim()?error.message.trim():'Supabase rejected the request.';
  fail('COMPOSITION_'+operation.toUpperCase(),message);
}

/**
 * Persistence half of createCompanyCompositionStore() for Supabase.
 *
 * The subject scope is fixed when the adapter is built and is never taken from a record or a caller
 * pointer, so an adult reference cannot be written against a child athlete row: adult_reference rows
 * always carry a null athlete_id, and child_athlete rows must name the rostered athlete whose UUID is
 * also the opaque subject reference. Row-level security remains the authoritative team boundary.
 */
export function createSupabaseCompanyCompositionAdapter(client,{teamId,subjectReference,subjectScope,athleteId=null}={}){
  if(!client?.auth||typeof client.auth.getSession!=='function'||typeof client.from!=='function')fail('INVALID_SUPABASE_CLIENT','A Supabase client with auth and database access is required.');
  if(!COMPOSITION_SUBJECT_SCOPES.includes(subjectScope))fail('INVALID_COMPOSITION_SCOPE','subjectScope must be adult_reference or child_athlete.');
  const organizationId=uuid(teamId,'teamId'),scope=subjectScope;
  let subjectId,athlete;
  if(scope==='child_athlete'){
    athlete=uuid(athleteId,'athleteId');
    subjectId=uuid(subjectReference,'subjectReference');
    if(subjectId!==athlete)fail('INVALID_COMPOSITION_SCOPE','A child-athlete composition subject reference must be that athlete id.');
  }else{
    if(athleteId!=null)fail('INVALID_COMPOSITION_SCOPE','An adult reference must never name a child athlete row.');
    athlete=null;
    subjectId=text(subjectReference,'subjectReference');
  }
  async function liveSession(){
    const response=await client.auth.getSession();
    if(response?.error)dbError('session',response.error);
    const current=response?.data?.session,userId=current?.user?.id;
    if(!current||!UUID.test(userId||'')||!current.access_token)return {authenticated:false};
    return {authenticated:true,actorId:userId.toLowerCase(),organizationId,sessionId:'supabase-composition:'+userId.toLowerCase()+':'+await tokenFingerprint(current.access_token)};
  }
  const matches=(request,session)=>UUID.test(session?.actorId||'')&&session.organizationId===organizationId&&request?.organizationId===organizationId
    &&request?.subjectId===subjectId&&request?.subjectScope===scope&&actions.has(request?.action);
  const base=query=>{const scoped=query.eq('team_id',organizationId).eq('subject_reference',subjectId).eq('subject_scope',scope);return athlete==null?scoped.is('athlete_id',null):scoped.eq('athlete_id',athlete);};
  return Object.freeze({
    getSession:liveSession,
    async authorize(request,session){return matches(request,session);},
    async put(record,request,session){
      if(!matches(request,session)||record?.organizationId!==organizationId||record?.subjectId!==subjectId||record?.subjectScope!==scope||record?.createdBy!==session.actorId)fail('COMPOSITION_SCOPE_MISMATCH','The record is outside the configured composition scope.');
      const row={result_id:text(record.resultId,'resultId'),assessment_id:text(record.assessmentId,'assessmentId'),team_id:organizationId,subject_reference:subjectId,
        subject_scope:scope,athlete_id:athlete,consent_reference:text(record.consentReference,'consentReference'),created_by:session.actorId,
        provider_id:text(record.provider?.id,'provider.id',100),model_id:text(record.provider?.model,'provider.model',300),model_version:text(record.provider?.version,'provider.version',100),
        captured_at:record.capturedAt,created_at_source:record.createdAt,saved_at:record.savedAt,retention_until:record.retentionUntil,record:clone(record)};
      const response=await client.from(TABLE).upsert(row,{onConflict:'team_id,subject_reference,result_id'}).select('record').single();
      if(response?.error)dbError('write',response.error);
      if(response?.data?.record?.resultId!==record.resultId)fail('COMPOSITION_WRITE','Supabase did not return the saved composition result.');
    },
    async get(request,session){
      if(!matches(request,session))fail('COMPOSITION_SCOPE_MISMATCH','The requested result is outside the configured composition scope.');
      const response=await base(client.from(TABLE).select('record')).eq('result_id',text(request.resultId,'resultId')).maybeSingle();
      if(response?.error)dbError('read',response.error);
      return response?.data?.record?clone(response.data.record):null;
    },
    async list(request,session){
      if(!matches(request,session))fail('COMPOSITION_SCOPE_MISMATCH','The requested history is outside the configured composition scope.');
      const response=await base(client.from(TABLE).select('record')).order('captured_at',{ascending:false}).limit(MAX_ROWS);
      if(response?.error)dbError('list',response.error);
      const rows=response?.data;
      if(rows==null)return [];
      if(!Array.isArray(rows))fail('COMPOSITION_LIST','Supabase returned an unusable composition history.');
      return rows.map(item=>item?.record?clone(item.record):fail('COMPOSITION_LIST','Supabase returned a composition row without its record.'));
    },
    async remove(request,session){
      if(!matches(request,session))fail('COMPOSITION_SCOPE_MISMATCH','The requested result is outside the configured composition scope.');
      const response=await base(client.from(TABLE).delete()).eq('result_id',text(request.resultId,'resultId')).select('result_id');
      if(response?.error)dbError('delete',response.error);
      return Array.isArray(response?.data)&&response.data.length===1;
    },
  });
}
