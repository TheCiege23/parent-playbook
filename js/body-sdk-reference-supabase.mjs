const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions=new Set(['save','read','export','delete']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{name:'CompanyReferencePersistenceError',code});};
const uuid=(value,label)=>{if(typeof value!=='string'||!UUID.test(value))fail('INVALID_REFERENCE_SCOPE',label+' must be a UUID.');return value.toLowerCase();};
const text=(value,label,max=180)=>{if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('INVALID_REFERENCE_SCOPE',label+' is invalid.');return value;};
const instant=(value,label)=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('INVALID_REFERENCE_SCOPE',label+' must be an ISO date.');return new Date(value).toISOString();};
const clone=value=>JSON.parse(JSON.stringify(value));
async function tokenFingerprint(token){
  if(typeof token!=='string'||!token)fail('AUTH_REQUIRED','An authenticated Supabase session is required.');
  if(!globalThis.crypto?.subtle)fail('CRYPTO_UNAVAILABLE','Web Crypto is required to bind the company session safely.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function dbError(operation,error){
  const message=typeof error?.message==='string'&&error.message.trim()?error.message.trim():'Supabase rejected the request.';
  fail('REFERENCE_'+operation.toUpperCase(),message);
}

/**
 * Persistent adult-reference adapter for a signed-in organization administrator.
 * It deliberately uses a separate table and text subject reference, so a buyer demo
 * never needs to attach adult measurements to a child athlete row. Database RLS is
 * the authoritative team boundary.
 */
export function createSupabaseCompanyReferenceAdapter(client,{teamId,subjectReference,adultAttestedAt}={}){
  if(!client?.auth||typeof client.auth.getSession!=='function'||typeof client.from!=='function')fail('INVALID_SUPABASE_CLIENT','A Supabase client with auth and database access is required.');
  const organizationId=uuid(teamId,'teamId'),subjectId=text(subjectReference,'subjectReference');
  const attestedAt=instant(adultAttestedAt||new Date().toISOString(),'adultAttestedAt');
  async function liveSession(){
    const response=await client.auth.getSession();
    if(response?.error)dbError('session',response.error);
    const current=response?.data?.session,userId=current?.user?.id;
    if(!current||!UUID.test(userId||'')||!current.access_token)return {authenticated:false};
    return {authenticated:true,actorId:userId.toLowerCase(),organizationId,sessionId:'supabase-reference:'+userId.toLowerCase()+':'+await tokenFingerprint(current.access_token)};
  }
  const matches=(scope,session)=>UUID.test(session?.actorId||'')&&session.organizationId===organizationId&&scope?.organizationId===organizationId&&scope?.subjectId===subjectId&&actions.has(scope?.action);
  return Object.freeze({
    getSession:liveSession,
    async authorize(scope,session){return matches(scope,session);},
    async put(record,scope,session){
      if(!matches(scope,session)||record?.organizationId!==organizationId||record?.subjectId!==subjectId||record?.createdBy!==session.actorId)fail('REFERENCE_SCOPE_MISMATCH','The record is outside the configured adult-reference scope.');
      const consentReference=text(record.consentReference,'consentReference'),retention=instant(record.retentionUntil,'retentionUntil');
      const row={assessment_id:text(record.assessmentId,'assessmentId'),team_id:organizationId,subject_reference:subjectId,consent_reference:consentReference,adult_attested_at:attestedAt,
        created_by:session.actorId,captured_at:record.capturedAt,saved_at:record.savedAt,retention_until:retention,record:clone(record)};
      const response=await client.from('company_reference_assessments').upsert(row,{onConflict:'team_id,subject_reference,assessment_id'}).select('record').single();
      if(response?.error)dbError('write',response.error);
      if(response?.data?.record?.assessmentId!==record.assessmentId)fail('REFERENCE_WRITE','Supabase did not return the saved adult-reference assessment.');
    },
    async get(scope,session){
      if(!matches(scope,session))fail('REFERENCE_SCOPE_MISMATCH','The requested record is outside the configured adult-reference scope.');
      const response=await client.from('company_reference_assessments').select('record').eq('team_id',organizationId).eq('subject_reference',subjectId).eq('assessment_id',text(scope.assessmentId,'assessmentId')).maybeSingle();
      if(response?.error)dbError('read',response.error);
      return response?.data?.record?clone(response.data.record):null;
    },
    async remove(scope,session){
      if(!matches(scope,session))fail('REFERENCE_SCOPE_MISMATCH','The requested record is outside the configured adult-reference scope.');
      const response=await client.from('company_reference_assessments').delete().eq('team_id',organizationId).eq('subject_reference',subjectId).eq('assessment_id',text(scope.assessmentId,'assessmentId')).select('assessment_id');
      if(response?.error)dbError('delete',response.error);
      return Array.isArray(response?.data)&&response.data.length===1;
    }
  });
}
