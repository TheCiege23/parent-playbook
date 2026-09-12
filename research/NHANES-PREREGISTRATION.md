# Frozen research question — owned body composition from NHANES

**Status: FROZEN.** Written 2026-09-12, before any analysis dataset was built and before any model
was fitted. Nothing in this document has been read back from a result.

This exists because of one specific failure mode. If the thresholds are chosen after the numbers
are known, every threshold is met, every subgroup that failed becomes "underpowered", and the
release criteria become a description of whatever happened. A pre-registration is worth exactly as
much as its being provably prior — so this file is committed before the pipeline that produces the
numbers it judges, and its hash is recorded in the evidence bundle. If a later commit changes it,
git says so, and the change has to be argued for in the open rather than made quietly.

**Changing this document after results exist is allowed and sometimes correct.** Hiding that it
changed is not. Any amendment appends to the Amendments section with a date, a reason, and what
was known at the time.

---

## 1. Intended use

Informational longitudinal context for **adults**, inside Parent Playbook, alongside externally
measured results a family or organization has imported.

**Youth is out of scope for this release and is a separate decision made later.** NHANES DXA covers
ages 8 and up, so the data would permit a youth model; the reason not to ship one is not a data
limitation. A body-fat estimate attached to a child is a different product with different harms,
and shipping it because the regression fit is not a reason.

### What an estimate from this model may never be used for

Diagnosis, screening, eligibility, team selection, athletic-potential ranking, weight-loss targets,
or any automatic change to a training plan. These are not disclaimers to print near the number —
they are constraints on what the product may build on top of it.

## 2. Population

**Included:** NHANES participants aged 18–69 at examination with a valid whole-body DXA result and
the required body measurements.

**Excluded, with every exclusion counted and reported in the cohort flow:**

| Rule | Reason |
|---|---|
| Age < 18 | Out of intended use for this release. |
| Age > 69 | NHANES DXA eligibility ends at 69 in the cycles used; beyond it there is no data, not a shortage of it. |
| Pregnant at examination | Body composition during pregnancy is not the quantity being modelled. |
| No valid whole-body DXA | Nothing to learn from and nothing to check against. |
| Missing height, weight or sex | These are the inputs; a row without them cannot be used and must not be imputed into existence. |
| DXA exclusion flagged by NCHS | The survey's own validity rules are authoritative over ours. |

Exclusions are applied in a fixed, recorded order, and the count surviving each step is reported.
A rule that removes an unexpectedly large share is a finding to investigate, not a number to pass
over.

## 3. Inputs

Only values the product can obtain consistently and honestly from a parent or an adult user:

- age in years
- sex as recorded by the survey
- standing height
- body weight
- waist circumference — **optional**, evaluated both with and without

### Never an inference input

**Race and ethnicity are used for evaluation only, never as a model input.** The distinction is the
whole point and is enforced in code rather than left to discipline: the model-ready export carries
no race/ethnicity column, and the evaluation export carries it precisely so that error concentrated
in a subgroup can be found. A model that takes race as a feature encodes a population difference as
a property of a person; a model evaluated by race can be shown not to fail some people worse than
others. Those are opposite things and they are easy to conflate.

Also never inputs: health outcomes, diagnoses, medications, survey identifiers, income, insurance
status, or anything else not in the list above.

## 4. Outputs

A primary prediction of **body-fat percentage**, with fat mass and lean mass derived from it and
total body mass.

Enforced at the point of production, not checked afterwards:

- fat mass is never negative and never exceeds total mass
- fat mass plus lean mass reconciles with the documented definition
- the uncertainty interval contains the point estimate and stays inside the accepted range
- unsupported or missing inputs return **no estimate**, never a default or a population mean

**Skeletal muscle mass is not derived from DXA lean mass**, here or anywhere. DXA does not resolve
skeletal muscle from lean soft tissue, and a conversion factor does not create the measurement.

## 5. Splits

Decided by rule, before results, and never revisited to improve a number:

- **Final holdout:** the most recent usable cycle, untouched until the release decision. Read once.
- **Development:** all earlier usable cycles.
- **Within development:** participant-level training and calibration partitions, split by a hash of
  the participant identifier so the assignment is deterministic and reproducible.

Tuning on the final holdout is a release blocker, not a judgement call. If the holdout is read
before the release decision, this study is over and a new cycle becomes the holdout.

## 6. Candidate models

Baselines, retained and reported whatever the outcome — a complicated model that cannot beat them
has not earned its complexity:

1. population mean by age and sex band
2. linear model on age, sex, height, weight
3. BMI-based regression
4. optional waist-enhanced regression

Candidates: regularized linear or spline regression, and one stronger tabular model. Feature count
stays small enough that every input can be explained to the person the estimate is about.

## 7. Evaluation

Reported for calibration and final holdout, on unweighted samples and with survey weights, both
stated:

- participant and observation counts
- signed bias
- MAE, RMSE, maximum absolute error
- calibration slope and intercept
- error distribution and refusal rate
- **the same, broken out by age band, sex, BMI range, and race/ethnicity audit group**
- performance with and without the optional waist input

NHANES is a complex multistage survey. Unweighted statistics describe the sample; weighted ones
estimate the population. Both are reported because a model is fitted on the sample and used on
people, and quoting only the flattering one is a way of lying with a correct number.

## 8. Release criteria

Set now, in the open, and not adjusted to fit what is found.

**A release requires all of:**

| Criterion | Threshold |
|---|---|
| Holdout MAE, body-fat percentage | ≤ 3.5 percentage points |
| Holdout signed bias | within ±1.0 percentage point |
| Calibration slope | 0.85 – 1.15 |
| Beats every baseline in §6 | on holdout MAE, not by a rounding margin |
| Worst subgroup MAE | ≤ 1.25 × overall MAE |
| Each reported subgroup | ≥ 100 participants, or it is reported as insufficient rather than summarized |
| Statistician review | thresholds and sample adequacy approved by a qualified reviewer before release |

**If a subgroup fails, the supported population narrows.** It does not get hidden, averaged away,
or explained. A model that works for most people and is quietly worse for some is not a model that
works; it is one whose failures have been arranged to be someone else's.

**If the model fails these criteria, it is not released, and the honest outcome is publishable.**
"We built it and it was not good enough to ship" is a real result. FM05 stays where it is, and the
parity rubric does not move for an unqualified model — this is written down now precisely because
it will be tempting later.

## 9. What a passing result would and would not establish

**Would:** that a model trained on public NHANES DXA data predicts DXA body-fat percentage in a
held-out NHANES cycle within the stated error, for the stated population.

**Would not:** DEXA equivalence, clinical validity, accuracy on a Parent Playbook photo scan,
accuracy on children, accuracy outside the US survey population, or FITMATCH equivalence. The
comparison is against NHANES DXA, and NHANES DXA is the thing it would be shown to approximate —
not a claim about any individual's body.

## Amendments

None. Any amendment records its date, its reason, and what was already known when it was made.
