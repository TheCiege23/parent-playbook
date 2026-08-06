async function loadRef(){
  if(state.ref) return state.ref;
  const [sports,positions,metrics] = await Promise.all([
    sb.from('sports').select('*').eq('selectable',true).order('sort'),
    sb.from('positions').select('*').order('sort'),
    sb.from('metrics').select('*').order('sort'),
  ]);
  state.ref = { sports:sports.data||[], positions:positions.data||[], metrics:metrics.data||[] };
  return state.ref;
}

