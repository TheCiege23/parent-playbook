/* Who may do and see what in the measurement study.
 *
 * Protocol §5: measurers never see scan outputs; whoever runs the scans never sees reference values;
 * the two are joined only at analysis, by participant code. The inter-rater subset adds one more
 * rule: measurer B must not see measurer A's readings, or the second measurement is a copy.
 *
 * These are enforced by the functions the tools call, not by asking people to look away. A role
 * that asks for something it may not have gets an error, not a filtered answer that hides the rule.
 */

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyBlindingError', code }); };

export const ROLES = Object.freeze(['coordinator', 'measurer', 'scan_operator', 'analyst']);

const PERMISSIONS = Object.freeze({
  coordinator: Object.freeze(['enroll', 'read_link_key', 'manage_visits', 'withdraw', 'read_progress', 'lock_data']),
  measurer: Object.freeze(['record_reference', 'read_own_reference']),
  scan_operator: Object.freeze(['record_scan', 'read_own_scans']),
  analyst: Object.freeze(['export_deidentified', 'analyze']),
});

export function assertAllowed(role, action) {
  if (!ROLES.includes(role)) fail('UNKNOWN_ROLE', 'Unknown study role: ' + role + '. Roles are ' + ROLES.join(', ') + '.');
  if (!PERMISSIONS[role].includes(action)) {
    fail('NOT_PERMITTED', 'The ' + role + ' role may not ' + action.replace(/_/g, ' ') + '. '
      + 'Blinding in the protocol depends on this separation.');
  }
  return true;
}

/* What one role sees of the study state.
 *
 * measurer: only their own readings, no scans, no link key.
 * scan_operator: only scans, no readings, no link key.
 * coordinator: who is enrolled, consents, visits and completeness, never a measurement value.
 * analyst: nothing raw; the de-identified export is their only door.
 */
export function viewFor(state, role, { measurer = null } = {}) {
  if (!ROLES.includes(role)) fail('UNKNOWN_ROLE', 'Unknown study role: ' + role);
  if (role === 'measurer') {
    if (!measurer) fail('MEASURER_REQUIRED', 'A measurer view needs the measurer id, so one measurer never sees another\'s readings.');
    return Object.freeze({
      participants: state.participants.filter(p => p.status === 'active').map(p => Object.freeze({ code: p.code })),
      reference: state.reference.filter(r => r.measurer === measurer),
    });
  }
  if (role === 'scan_operator') {
    return Object.freeze({
      participants: state.participants.filter(p => p.status === 'active').map(p => Object.freeze({ code: p.code, deviceOrder: p.deviceOrder })),
      scans: state.scans,
    });
  }
  if (role === 'coordinator') {
    const count = (list, code) => list.filter(item => item.code === code).length;
    return Object.freeze({
      locked: !!state.lockedAt,
      participants: state.participants.map(p => Object.freeze({
        code: p.code, status: p.status, enrolledOn: p.enrolledOn, consents: p.consents,
        referenceReadings: count(state.reference, p.code), scans: count(state.scans, p.code),
      })),
      visits: state.visits,
    });
  }
  fail('NO_RAW_VIEW', 'The analyst role has no raw view. Use the de-identified export.');
}
