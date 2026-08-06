async function loadRef(){
  if(state.ref) return state.ref;
  const [sports,positions,metrics] = await Promise.all([
    sb.from('sports').select('*').eq('selectable',true).order('sort'),
    sb.from('positions').select('*').order('sort'),
    sb.from('metrics').select('*').order('sort'),
  ]);
  const err = sports.error||positions.error||metrics.error;
  if(err){ console.error(err); throw err; }   // don't cache a failed load — allow a retry this session
  state.ref = { sports:sports.data||[], positions:positions.data||[], metrics:metrics.data||[] };
  return state.ref;
}

