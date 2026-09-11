const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions=new Set(['save','read','export','delete']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{name:'CompanyPersistenceError',code});};
const uuid=(value,label)=>{if(typeof value!=='string'||!UUID.test(value))fail('INVALID_SUPABASE_SCOPE',label+' must be a UUID.');return value.toLowerCase();};
const text=(value,label,max=180)=>{if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max)fail('INVALID_SUPABASE_SCOPE',label+' is invalid.');return value;};
const clone=value=>JSON.parse(JSON.stringify(value));
async function tokenFingerprint(token){
  if(typeof token!=='string'||!token)fail('AUTH_REQUIRED','An authenticated Supabase session is required.');
  if(!globalThis.crypto?.subtle)fail('CRYPTO_UNAVAILABLE','Web Crypto is required to bind the company session safely.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function dbError(operation,error){
  const message=typeof error?.message==='string'&&error.message.trim()?error.message.trim():'Supabase rejected the request.';
  fail('SUPABASE_'+operation.toUpperCase(),message);
}

/**
 * Create the persistence half of createCompanyAssessmentStore() for Supabase.
 * Row-level security remains the authoritative access boundary. teamId is the
 * organization scope and athleteId must be on that team's roster.
 */
export function createSupabaseCompanyAssessmentAdapter(client,{teamId,athleteId}={}){
  if(!client?.auth||typeof client.auth.getSession!=='function'||typeof client.from!=='function')fail('INVALID_SUPABASE_CLIENT','A Supabase client with auth and database access is required.');
  const organizationId=uuid(teamId,'teamId'),subjectId=uuid(athleteId,'athleteId');
  async function liveSession(){
    const response=await client.auth.getSession();
    if(response?.error)dbError('session',response.error);
    const current=response?.data?.session,userId=current?.user?.id;
    if(!current||!UUID.test(userId||'')||!current.access_token)return {authenticated:false};
    return {authenticated:true,actorId:userId.toLowerCase(),organizationId,sessionId:'supabase:'+userId.toLowerCase()+':'+await tokenFingerprint(current.access_token)};
  }
  const matches=(scope,session)=>UUID.test(session?.actorId||'')&&session.organizationId===organizationId&&scope?.organizationId===organizationId&&scope?.subjectId===subjectId&&actions.has(scope?.action);
  return Object.freeze({
    getSession:liveSession,
    async authorize(scope,session){return matches(scope,session);},
    async put(record,scope,session){
      if(!matches(scope,session)||record?.organizationId!==organizationId||record?.subjectId!==subjectId||record?.createdBy!==session.actorId)fail('SUPABASE_SCOPE_MISMATCH','The record is outside the configured company scope.');
      const consentId=uuid(record.consentReference,'consentReference'),retention=record.retentionUntil;
      if(typeof retention!=='string'||!Number.isFinite(Date.parse(retention)))fail('RETENTION_REQUIRED','A valid retention deadline is required for production persistence.');
      const row={assessment_id:text(record.assessmentId,'assessmentId'),team_id:organizationId,athlete_id:subjectId,consent_id:consentId,created_by:session.actorId,captured_at:record.capturedAt,saved_at:record.savedAt,retention_until:retention,record:clone(record)};
      const response=await client.from('company_body_assessments').upsert(row,{onConflict:'team_id,athlete_id,assessment_id'}).select('record').single();
      if(response?.error)dbError('write',response.error);
      if(response?.data?.record?.assessmentId!==record.assessmentId)fail('SUPABASE_WRITE','Supabase did not return the saved assessment.');
    },
    async get(scope,session){
      if(!matches(scope,session))fail('SUPABASE_SCOPE_MISMATCH','The requested record is outside the configured company scope.');
      const response=await client.from('company_body_assessments').select('record').eq('team_id',organizationId).eq('athlete_id',subjectId).eq('assessment_id',text(scope.assessmentId,'assessmentId')).maybeSingle();
      if(response?.error)dbError('read',response.error);
      return response?.data?.record?clone(response.data.record):null;
    },
    async remove(scope,session){
      if(!matches(scope,session))fail('SUPABASE_SCOPE_MISMATCH','The requested record is outside the configured company scope.');
      const response=await client.from('company_body_assessments').delete().eq('team_id',organizationId).eq('athlete_id',subjectId).eq('assessment_id',text(scope.assessmentId,'assessmentId')).select('assessment_id');
      if(response?.error)dbError('delete',response.error);
      return Array.isArray(response?.data)&&response.data.length===1;
    }
  });
}
