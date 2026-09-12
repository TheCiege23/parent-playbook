/* Which part each survey cycle plays, read from sources.json rather than restated in every tool.
 *
 * The first attempt kept a ROLES map in four tools, and read-holdout.cjs kept none at all: it put
 * every cycle that was not its holdout into development. Adding 2015-2016 as the next holdout would
 * have sent that cycle's DXA into read-holdout's baseline fit — the unread holdout, read by the
 * tool that exists to read holdouts once. A second copy of a constant is how that happens, so there
 * is one copy, here, and the manifest is the source of truth.
 *
 *   development              trains and calibrates
 *   candidate-final-holdout  the one unread holdout, read once at the release decision
 *   spent-holdout            already read; never a holdout again, and not development either
 *
 * An unknown role throws. A cycle whose role nobody recognised would otherwise be silently skipped,
 * or silently included, depending on which tool happened to read it.
 */

const COHORT_ROLE = Object.freeze({
  'development': 'development',
  'candidate-final-holdout': 'holdout',
  'spent-holdout': null,
});

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'NhanesRoleError', code }); };

export const MANIFEST_ROLES = Object.freeze(Object.keys(COHORT_ROLE));

/* 'development', 'holdout', or null for a cycle that takes no part. */
export function cohortRoleFor(manifestRole, cycle = '(unnamed cycle)') {
  if (!Object.hasOwn(COHORT_ROLE, manifestRole)) {
    fail('UNKNOWN_ROLE', 'Cycle ' + cycle + ' has role ' + manifestRole + '. Known roles are '
      + MANIFEST_ROLES.join(', ') + '; add a new one here deliberately rather than letting each tool guess.');
  }
  return COHORT_ROLE[manifestRole];
}

/* The single unread holdout. Zero or several is an error, not a choice to make on the fly. */
export function holdoutCycleOf(entries) {
  const cycles = [...new Set(entries
    .filter(entry => cohortRoleFor(entry.role, entry.cycle) === 'holdout')
    .map(entry => entry.cycle))];
  if (cycles.length !== 1) {
    fail('HOLDOUT_NOT_UNIQUE', 'Expected exactly one candidate-final-holdout cycle, found '
      + (cycles.length ? cycles.join(', ') : 'none') + '. A study reads one holdout at a time.');
  }
  return cycles[0];
}
