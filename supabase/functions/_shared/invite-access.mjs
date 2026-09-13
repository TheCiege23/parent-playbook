// Who may send an invite for an athlete: an owner or co-parent, through athlete_access or through family
// membership. Shared by send-invite and send-invite-sms. It must run with the CALLER's client, so row-level
// security scopes every read to what that person can see; both functions read the invite itself with the
// service role, which is exactly why this gate exists.
export async function callerCanEditAthlete(caller, athleteId, userId) {
  const { data: access } = await caller.from('athlete_access')
    .select('role').eq('athlete_id', athleteId).eq('guardian_id', userId).is('revoked_at', null).limit(1);
  const role = access && access[0] ? access[0].role : null;
  if (role === 'owner' || role === 'co_parent') return true;
  const { data: athlete } = await caller.from('athletes').select('family_id').eq('id', athleteId).maybeSingle();
  if (!athlete) return false;
  const { data: membership } = await caller.from('family_members')
    .select('role').eq('family_id', athlete.family_id).eq('guardian_id', userId).limit(1);
  const memberRole = membership && membership[0] ? membership[0].role : null;
  return memberRole === 'owner' || memberRole === 'co_parent';
}
