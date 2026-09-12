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

**Included:** NHANES participants aged **18–59** at examination with a valid **measured** whole-body
DXA result and the required body measurements.

> Both of those bounds were amended after the source files were counted and before any model was
> fitted. As originally written this said 18–69 and "a valid whole-body DXA result". Amendment 1
> narrowed "valid" to "measured", excluding imputed scans; amendment 2 narrowed the age range,
> because no cycle after 2004 has a participant over 59 and the final holdout therefore contains
> nobody aged 60–69. Both are recorded in full at the end of this document with what was known at
> the time. The original wording is left visible here rather than quietly replaced.

**Excluded, with every exclusion counted and reported in the cohort flow:**

Each rule names the test that implements it, because for three of them the obvious implementation
is wrong in a way that yields a plausible cohort rather than an error.

| Rule | How it is tested | Reason |
|---|---|---|
| Age < 18 | `RIDAGEYR < 18` | Out of intended use for this release. |
| Age > 59 | `RIDAGEYR > 59` | DXA eligibility stops at 59 from the 2011 cycle onward, so the final holdout has nobody above it. Amendment 2. |
| No usable whole-body DXA | `DXDTOPF` is null | Nothing to learn from and nothing to check against. **Not** `DXAEXSTS ≠ 1`: 678 completed 2017–2018 exams carry no total at all. Amendment 3. |
| DXA value imputed rather than measured | `DXITOT ≠ 0`, early cycles only | A model meant to approximate a DXA measurement should not be trained on somebody else's imputation of one. Amendment 1. |
| Pregnant, or possibly pregnant | `RIDEXPRG` is 1 or 3 | Body composition during pregnancy is not the quantity being modelled. **Not** "keep where `RIDEXPRG = 2`": the question is asked only of women aged 20–44, so that reading discards about 70% of the cohort. Amendment 3. |
| Missing height, weight or sex | `BMXHT`, `BMXWT` or `RIAGENDR` is null | These are the inputs; a row without them cannot be used and must not be imputed into existence. Costs about 0.4%. |

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
| Signed bias, each reported subgroup | within ±1.0 percentage point, the same limit as overall. Amendment 4, added with results in hand; it tightens. |
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

### 1 — 2026-09-12 — how imputation replicates are handled

**What was known when this was made:** the source files had been downloaded and their structure
counted (research/NHANES-DATA-STRUCTURE.md). **No analysis dataset had been built, no model had
been fitted, and no outcome of any kind had been computed.** Nothing in this amendment was chosen
with knowledge of a result.

**What prompted it:** the 1999-2004 whole-body DXA files carry exactly five rows per participant,
a variable `_MULT_` labelled "Imputation Version". The original text said the cohort requires "a
valid whole-body DXA result" and did not anticipate that a fifth of the participants would have an
imputed one rather than a measured one, or that the file would present five versions of it.

**The rule, added to §2:** the cohort uses **measured DXA only**. A participant is included from
the early cycles when the overall imputation indicator says nothing was imputed, at which point the
five replicates are exact duplicates and collapse to one row. Participants with imputed values are
excluded and counted in the cohort flow as their own exclusion line.

**Why this and not the alternatives:** the model's purpose is to approximate a DXA measurement.
Training it partly on somebody else's model's imputation of a DXA measurement is a different
exercise, and the error it would report would not be the error anyone cares about. Taking a single
imputation for everyone keeps the count up and converts imputation uncertainty into confidence the
study has not earned. Using all five under Rubin's rules is defensible and is not being ruled out
for a later analysis, but it is not the primary.

**What it costs, stated before it is convenient to forget:** roughly a fifth of the early-cycle
participants. For 1999-2000 the cohort goes from 6,235 participants with a row to **4,671** with a
measurement. That is a real reduction in sample size, and if it turns out to make a subgroup fall
below the 100-participant reporting floor in §8, the answer is that the subgroup is reported as
insufficient — not that the rule gets revisited.

**Enforcement:** `tools/nhanes/replicates.mjs` refuses to collapse a replicated file unless a
policy is named, and records which was used. There is no default.

---

### 2 — 2026-09-12 — the supported population narrows to 18-59

**What was known when this was made:** the four open questions in
research/NHANES-DATA-STRUCTURE.md had been answered by counting the locked files. **Still no
analysis dataset, no model, no outcome of any kind.**

**What prompted it:** DXA eligibility stopped at age 59 from the 2011 cycle onward. §5 names the
most recent usable cycle as the final holdout, and that cycle — like every cycle after 2004 —
**contains no participant aged 60-69 at all.**

| | 18-69 | 18-59 | 60-69 |
|---|---:|---:|---:|
| Development (1999-2004, 2011-2014) | 15,937 | 14,348 | 1,589 |
| Final holdout (2017-2018) | 2,452 | 2,452 | **0** |

**The rule, replacing the age bounds in §2:** the population is **18-59**. Participants aged 60 and
over are excluded and counted in the cohort flow.

**Why:** a release for 18-69 under the original plan would train on 1,589 participants aged 60-69
and evaluate on none. Every criterion in §8 could pass while saying nothing whatsoever about the
oldest tenth of the supported population — which is not a gap in the evidence, it is the absence of
evidence presented as a passing result. §8 already says that when a subgroup cannot be shown to
work the supported population narrows, and this is that rule applying to itself.

**Alternatives considered and rejected:** holding out an early cycle instead, so the holdout would
contain 60-69. Rejected because it makes the holdout the oldest data rather than the newest, and a
model validated only on 1999-2004 scanners and evaluated nowhere recent is a worse claim than a
narrower one. Reporting 60-69 as "insufficient" while still supporting it. Rejected because zero is
not insufficient, it is nothing, and an estimate offered to a 65-year-old would be unbacked by any
measurement whatsoever.

**What it costs:** 1,589 development participants, about a tenth. The holdout is unchanged at 2,452,
because it never had anyone in that band. Cohort after both amendments, before the remaining §2
exclusions: **14,348 development, 2,452 holdout.** After every exclusion in §2 the built development
cohort is **14,295** (11,417 train, 2,878 calibration); see research/NHANES-DATA-STRUCTURE.md.

**Consequence for the product:** the owned model, if it is ever released, refuses rather than
estimates for anyone aged 60 or over. That refusal is a supported-population rule under §4, not an
error, and it must be visible to the person asking rather than returned as a default.

---

### 3 — 2026-09-12 — how "valid DXA" and "pregnant" are actually tested

**What was known when this was made:** the last three open questions in
research/NHANES-DATA-STRUCTURE.md had been answered by counting. **Still no analysis dataset, no
model, no outcome.**

**What prompted it:** §2 excludes "no valid whole-body DXA" and "pregnant at examination". Both
phrases turn out to name something the data does not offer directly, and the obvious implementation
of each is wrong in a way that produces a plausible cohort rather than an error.

**Rule A — validity is era-specific, and exam status is not it.**

A scan counts only when the **total body fat value is present**, and additionally, in 1999-2004,
when the participant is **unimputed**.

`DXAEXSTS = 1` ("exam status complete") is not a validity test and must not be used as one. In
2017-2018, 678 of the 4,336 rows with that status carry no total body fat at all — the exam
finished, a region was flagged invalid, and NCHS suppressed the total rather than imputing it.
Using exam status alone would admit those 678 empty rows, and in the early cycles it would admit
1,201 imputed ones.

The two halves each do nothing in the other era, and both are required: in 1999-2004 everyone has a
value so presence tests nothing, and after 2004 nothing is imputed so the imputation filter has
nothing to act on. The eras handle an unusable scan in opposite ways — the early one imputes it,
the later one leaves it blank — and a single simple filter cannot express that.

**Rule B — pregnancy is an exclusion, not a requirement.**

Exclude participants where `RIDEXPRG = 1` (pregnant) or `RIDEXPRG = 3` (cannot determine).
**Do not require `RIDEXPRG = 2`.**

The variable is asked only of women aged 20-44. Every man is null, as is every woman outside that
range: 2,596 of 3,706 adults 18-59 in the 2017-2018 cycle. Requiring "not pregnant" rather than
excluding "pregnant" would discard about 70% of the cohort for not answering a question they were
never asked, and would leave a study population made almost entirely of women aged 20 to 44. It
would not error, and the resulting cohort would look reasonable.

"Cannot determine" is excluded as well as "pregnant", because the quantity being modelled is body
composition outside pregnancy and possibly-pregnant is not a category this study can use. Cost: 89
participants in that cycle.

**What this costs overall:** nothing beyond what §2 already intended. These are corrections to how
two existing exclusions are tested, not new exclusions. The body measures they interact with are
essentially complete — 99.6% of eligible participants have both height and weight, and 99% have
waist — so the input-completeness exclusion remains negligible and the with-and-without-waist
comparison is well powered.

---

### 4 — 2026-09-12 — a subgroup BIAS criterion, written with results in hand

**What was known when this was made — and this one is different from the first three.** The
baselines had been fitted and reported on the calibration partition
(research/NHANES-BASELINES.md). **Results existed and were known.** The final holdout was not read
and still has not been.

This document says changing it after results exist is allowed and sometimes correct, and that
hiding the change is not. This is that case, recorded accordingly.

**What prompted it:** §8 judges subgroups by MAE only. On the best baseline every subgroup passes
that ceiling comfortably — the worst is 1.15x against a limit of 1.25x. But the signed bias by
race/ethnicity audit group runs from **-1.211 to +1.427 percentage points**, against an *overall*
bias limit of +/- 1.0. The overall bias is -0.020 because the groups cancel each other out.

The pattern holds across all four baselines with the same sign, and for one group the more
sophisticated models are worse than the population mean. It is structural: body fat at a given
height, weight and age differs between population groups, and a model built from those inputs
cannot represent the difference, so it splits it.

**The rule, added to §8:**

| Criterion | Threshold |
|---|---|
| Signed bias, each reported subgroup | within +/- 1.0 percentage point, the same limit as overall |

A subgroup that exceeds it fails, whatever its MAE.

**Why this is not moving the goalposts:** it makes release strictly harder. The best baseline
passes every criterion as originally written and fails this one. An after-the-fact criterion can
only be defended when it tightens, and this tightens.

**What it does NOT do:** it does not tell anyone how to pass. §8's existing remedy — narrow the
supported population — cannot apply to a race/ethnicity subgroup. Narrowing by race would mean
shipping a product that declares itself accurate for some races and not others and restricting
access accordingly, which is not a remedy. The honest responses are: do not release; widen the
uncertainty interval until it covers the group-level bias, at a cost to everyone; or find inputs
that capture what the audit variable is standing in for. The third must not become "add race as a
feature" -- §3 forbids it, and it would encode a population difference as a property of a person.

**Consequence, stated now:** on today's evidence the owned model is more likely not to be released
than to be released. That is a real outcome and this document already says it is publishable.

---

Any further amendment records its date, its reason, and what was already known when it was made.
