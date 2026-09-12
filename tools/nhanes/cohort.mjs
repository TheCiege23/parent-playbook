/* Building the analysis cohort from the NHANES components, under the frozen research question.
 *
 * The rules implemented here are in research/NHANES-PREREGISTRATION.md §2 and its three
 * amendments. They are not restated as intentions — each exclusion carries the test that
 * implements it, because for three of the six the obvious implementation is wrong in a way that
 * produces a plausible cohort rather than an error:
 *
 *   "valid DXA" is NOT `DXAEXSTS = 1`. In 2017-2018, 678 completed exams carry no total at all.
 *   "not pregnant" is NOT `RIDEXPRG = 2`. That question is asked only of women aged 20-44, so
 *     requiring it discards about 70% of the cohort, almost all of it men.
 *   "measured" needs the imputation filter, but only in 1999-2004, which is the only era that
 *     imputes anything.
 *
 * Every exclusion is counted in order and reported. A rule that removes an unexpectedly large
 * share is a finding, and a cohort flow that does not show it is how such a finding gets missed.
 */

import { collapseReplicates } from './replicates.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'NhanesCohortError', code }); };

/* The features the model may see. An allowlist, and the enforcement is below rather than in a
 * comment: race and ethnicity are used for EVALUATION only, and the difference between a model
 * that takes race as a feature and one that is evaluated by race is the difference between
 * encoding a population difference as a property of a person and being able to show the model does
 * not fail some people worse than others.
 */
// bmi is here because it is arithmetic on height and weight, both of which are permitted. Leaving
// it out forced any BMI-using model to be fitted on participant rows instead — rows that DO carry
// race. Those fits did not use race, but "the fit never receives it" stopped being true for them,
// and a guarantee with an exception is a guarantee nobody can rely on.
//
// armCircumferenceCm is amendment 5. Hip circumference was the input the literature suggested, and
// NHANES measured it in one cycle only — the one the first attempt spent. Arm circumference is the
// only other soft-tissue girth in every development cycle and in 2015-2016. Declaring it here makes
// it available; a model uses it only if its own feature list names it, so the first attempt's fits
// are unchanged.
export const MODEL_FEATURES = Object.freeze(['ageYears', 'sexMale', 'heightCm', 'weightKg', 'waistCm', 'armCircumferenceCm', 'bmi']);
export const MODEL_TARGETS = Object.freeze(['bodyFatPercent', 'fatMassKg', 'leanMassKg', 'totalMassKg']);

/* Keys that must never reach a model-ready row, checked by name rather than trusted.
 * Identifiers and survey design variables are here for the same reason as race: a model that can
 * see the sampling stratum can learn the sample instead of the population.
 */
const FORBIDDEN_IN_MODEL = /^(seqn|cycle|raceEthnicity|ridreth|sdmv|wtmec|wtint|pregnan|split)/i;

/* Exclusions in a fixed order. The order is part of the record: the same rules applied in a
 * different sequence attribute participants to different reasons, and a flow table is only
 * meaningful if the order it describes is the order that ran.
 */
export const EXCLUSIONS = Object.freeze([
  { id: 'no_demographics', label: 'No demographics record',
    test: p => p.demo == null },
  { id: 'age_under_18', label: 'Age under 18',
    test: p => !(p.demo.RIDAGEYR >= 18) },
  { id: 'age_over_59', label: 'Age over 59',
    test: p => p.demo.RIDAGEYR > 59,
    note: 'Amendment 2. No cycle after 2004 has a participant above 59, so the holdout cannot validate them.' },
  { id: 'pregnant_or_undetermined', label: 'Pregnant, or pregnancy undetermined',
    // Amendment 3: an exclusion, never a requirement. Asked only of women 20-44.
    test: p => p.demo.RIDEXPRG === 1 || p.demo.RIDEXPRG === 3 },
  { id: 'no_dxa_record', label: 'No DXA record',
    test: p => p.dxa == null },
  { id: 'dxa_not_usable', label: 'DXA present but no whole-body result',
    // Amendment 3: the value's presence, NOT the exam status flag.
    test: p => p.dxa.DXDTOPF == null || p.dxa.DXDTOFAT == null || p.dxa.DXDTOLI == null || p.dxa.DXDTOTOT == null },
  { id: 'dxa_imputed', label: 'DXA value imputed rather than measured',
    // Amendment 1. Only the early cycles impute; elsewhere DXITOT is absent and this never fires.
    test: p => p.dxa.DXITOT != null && p.dxa.DXITOT !== 0 },
  { id: 'no_body_measures', label: 'No body-measures record',
    test: p => p.bmx == null },
  { id: 'missing_inputs', label: 'Missing height, weight or sex',
    test: p => p.bmx.BMXHT == null || p.bmx.BMXWT == null || (p.demo.RIAGENDR !== 1 && p.demo.RIAGENDR !== 2) },
]);

/* A stable participant-level split.
 *
 * FNV-1a over the identifier, so the assignment depends on nothing but the participant and is
 * identical on every machine and every run. A random split would have to be seeded and the seed
 * recorded, and a seed that is recorded is a worse version of this.
 */
export function assignSplit(seqn, { trainPercent = 80 } = {}) {
  let hash = 0x811c9dc5;
  for (const character of String(seqn)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 100) < trainPercent ? 'train' : 'calibration';
}

const round = (value, places) => (value == null ? null : Math.round(value * 10 ** places) / 10 ** places);

/* One participant, in the shape the rest of the pipeline uses.
 *
 * Grams become kilograms here and nowhere else. A unit conversion scattered across a pipeline is
 * how a fat mass ends up a thousand times too large in one report and correct in another.
 */
function shape(participant, cycle, role) {
  const { demo, bmx, dxa } = participant;
  return Object.freeze({
    seqn: demo.SEQN,
    cycle,
    role,
    // Inputs
    ageYears: demo.RIDAGEYR,
    sexMale: demo.RIAGENDR === 1 ? 1 : 0,
    heightCm: round(bmx.BMXHT, 1),
    weightKg: round(bmx.BMXWT, 1),
    waistCm: round(bmx.BMXWAIST, 1),
    armCircumferenceCm: round(bmx.BMXARMC, 1),
    bmi: round(bmx.BMXBMI, 2),
    // Targets. DXA reports grams; the product speaks kilograms.
    bodyFatPercent: round(dxa.DXDTOPF, 2),
    fatMassKg: round(dxa.DXDTOFAT / 1000, 3),
    leanMassKg: round(dxa.DXDTOLI / 1000, 3),
    totalMassKg: round(dxa.DXDTOTOT / 1000, 3),
    // Evaluation only. Never a model input; see MODEL_FEATURES and assertModelReady.
    raceEthnicity: demo.RIDRETH1 ?? null,
    // Survey design, for weighted evaluation. Not poolable across cycles by concatenation.
    sdmvpsu: demo.SDMVPSU ?? null,
    sdmvstra: demo.SDMVSTRA ?? null,
    wtmec2yr: demo.WTMEC2YR ?? null,
  });
}

/* Build the cohort.
 *
 * `cycles` is a list of { cycle, role, demo, bmx, dxa, replicatePolicy }, where each component is
 * the rows already read from its file. Reading is the caller's job so this stays testable without
 * a filesystem and without 130 MB of survey data.
 */
export function buildCohort(cycles, { trainPercent = 80 } = {}) {
  if (!Array.isArray(cycles) || !cycles.length) fail('NO_CYCLES', 'There are no cycles to build from.');

  const flow = [], participants = [];
  const seenIds = new Map();

  for (const entry of cycles) {
    const { cycle, role, demo = [], bmx = [], dxa = [], replicatePolicy = 'measured_only' } = entry;
    if (!cycle) fail('NO_CYCLE_NAME', 'Every cycle needs a name so the flow table can attribute its counts.');
    if (role !== 'development' && role !== 'holdout') {
      fail('UNKNOWN_ROLE', 'Cycle ' + cycle + ' has role ' + role + '. A cycle is development or holdout; there is no third thing, and a cycle with no role would silently be left out.');
    }

    // Replicates first. A file with five rows per participant must be reduced before anything is
    // counted, or every count below is five times what it should be.
    const collapsed = collapseReplicates(dxa, { policy: replicatePolicy });

    const demoById = new Map(demo.map(row => [row.SEQN, row]));
    const bmxById = new Map(bmx.map(row => [row.SEQN, row]));
    const dxaById = new Map(collapsed.rows.map(row => [row.SEQN, row]));

    // Everyone with a demographics record is a candidate; the DXA and body-measures records are
    // looked up and their absence is an exclusion with its own line rather than a silent drop.
    let candidates = [...demoById.keys()].map(seqn => ({
      seqn, demo: demoById.get(seqn), bmx: bmxById.get(seqn) ?? null, dxa: dxaById.get(seqn) ?? null,
    }));

    const steps = [{ step: 'start', label: 'Participants with a demographics record', remaining: candidates.length }];
    for (const rule of EXCLUSIONS) {
      const before = candidates.length;
      candidates = candidates.filter(candidate => !rule.test(candidate));
      steps.push({ step: rule.id, label: rule.label, excluded: before - candidates.length, remaining: candidates.length, note: rule.note ?? null });
    }

    for (const candidate of candidates) {
      // SEQN is sequential and non-overlapping across the cycles in use, but that is a property of
      // the current file set rather than a guarantee. Checked, because a collision would silently
      // put one participant in two cycles and possibly on both sides of the split.
      if (seenIds.has(candidate.seqn)) {
        fail('DUPLICATE_PARTICIPANT', 'Participant ' + candidate.seqn + ' appears in both ' + seenIds.get(candidate.seqn) + ' and ' + cycle
          + '. Identifiers are assumed unique across cycles; they are not here, so the join key needs the cycle in it before this goes further.');
      }
      seenIds.set(candidate.seqn, cycle);
      const row = shape(candidate, cycle, role);
      participants.push(role === 'holdout' ? { ...row, split: 'holdout' }
        : { ...row, split: assignSplit(candidate.seqn, { trainPercent }) });
    }

    flow.push(Object.freeze({
      cycle, role,
      // collapsed.policy, not collapsed.report.policy: a file that needed no handling reports
      // 'not_replicated' on the result and carries no policy inside the report, so reading the
      // inner one printed "undefined" in the flow for every later cycle — a report that could not
      // say what it had done.
      replicatePolicy: collapsed.policy,
      replicateReport: collapsed.report,
      steps: Object.freeze(steps),
      included: candidates.length,
    }));
  }

  const counts = participants.reduce((acc, row) => { acc[row.split] = (acc[row.split] || 0) + 1; return acc; }, {});
  return Object.freeze({
    participants: Object.freeze(participants.map(Object.freeze)),
    flow: Object.freeze(flow),
    counts: Object.freeze(counts),
    total: participants.length,
  });
}

/* The model-ready export, with the race rule enforced rather than remembered.
 *
 * Built from an allowlist, then checked by name. Two mechanisms for one rule because this is the
 * single constraint in the preregistration that a careless edit could violate without anything
 * else noticing: a row with one extra field still trains, still evaluates, and still reports a
 * number.
 */
export function modelReadyExport(participants) {
  const rows = participants.map(participant => {
    const row = {};
    for (const key of [...MODEL_FEATURES, ...MODEL_TARGETS]) row[key] = participant[key] ?? null;
    return row;
  });
  assertModelReady(rows);
  return rows;
}

export function assertModelReady(rows) {
  const allowed = new Set([...MODEL_FEATURES, ...MODEL_TARGETS]);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (FORBIDDEN_IN_MODEL.test(key)) {
        fail('FORBIDDEN_MODEL_FEATURE', key + ' must never reach a model-ready row. Race and ethnicity are '
          + 'evaluation-only under the preregistration, and identifiers and survey design variables let a model '
          + 'learn the sample instead of the population.');
      }
      if (!allowed.has(key)) {
        fail('UNDECLARED_MODEL_FEATURE', key + ' is not a declared model feature or target. Add it to '
          + 'MODEL_FEATURES or MODEL_TARGETS deliberately, or leave it out; a field that arrives without being '
          + 'declared is a feature nobody chose.');
      }
    }
  }
  return true;
}

/* The evaluation export, which deliberately carries what the model may not see.
 *
 * This is the other half of the same rule. Subgroup error cannot be found in data that does not
 * record the subgroup, so the audit variable and the survey design live here — and only here.
 */
export function evaluationExport(participants) {
  return participants.map(p => ({
    seqn: p.seqn, cycle: p.cycle, split: p.split,
    ageYears: p.ageYears, sexMale: p.sexMale, bmi: p.bmi,
    bodyFatPercent: p.bodyFatPercent,
    raceEthnicity: p.raceEthnicity,
    sdmvpsu: p.sdmvpsu, sdmvstra: p.sdmvstra, wtmec2yr: p.wtmec2yr,
  }));
}

/* The cohort flow, as a table a person reads rather than a structure a program walks. */
export function formatCohortFlow(result) {
  const lines = [];
  for (const cycle of result.flow) {
    lines.push('');
    lines.push(cycle.cycle + '  (' + cycle.role + ', replicates: ' + cycle.replicatePolicy + ')');
    for (const step of cycle.steps) {
      lines.push(step.step === 'start'
        ? '  ' + String(step.remaining).padStart(6) + '  ' + step.label
        : '  ' + String(step.remaining).padStart(6) + '  after excluding ' + String(step.excluded).padStart(5) + '  ' + step.label);
    }
  }
  lines.push('');
  lines.push('TOTAL ' + result.total + '  ' + Object.entries(result.counts).map(([k, v]) => k + '=' + v).join('  '));
  return lines.join('\n');
}
