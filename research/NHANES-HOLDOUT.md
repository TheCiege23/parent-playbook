# Final holdout result — NOT RELEASED

Read once, 2026-09-12, against the frozen artifact `bodyfat-candidate-v0.1.0`
(sha-256 `7034bf9d…`, frozen before this was run). 2,442 participants from the 2017–2018 cycle, a
cycle no earlier stage of this work had opened.

**Five of six criteria passed. The sixth is the one that decides it.**

| Criterion | Value | |
|---|---:|---|
| Holdout MAE ≤ 3.5 | 2.726 | pass |
| Holdout signed bias within ±1.0 | 0.348 | pass |
| Calibration slope 0.85–1.15 | 0.974 | pass |
| Beats every baseline on holdout MAE | 2.726 vs 3.098 | pass |
| Worst subgroup MAE ≤ 1.25× overall | 1.086 | pass |
| **Each subgroup bias within ±1.0** | **1.188** | **fail** |

**Decision: not released.**

## The model was accurate

| | holdout | calibration |
|---|---:|---:|
| MAE | 2.726 | 2.627 |
| RMSE | 3.504 | 3.292 |
| bias | 0.348 | −0.013 |
| slope | 0.974 | 1.005 |

It held up. The degradation from calibration to holdout — 2.627 to 2.726 — is the optimism that
was predicted and stated in advance, and it is small. It beat every baseline on the holdout by a
wider margin than it did on calibration:

| Baseline | holdout MAE |
|---|---:|
| mean by age and sex band | 5.170 |
| linear: age, sex, height, weight | 3.288 |
| BMI regression | 3.312 |
| waist-enhanced | 3.098 |
| **the model** | **2.726** |

Refusals: 16 of 2,442, all for a missing waist measurement — 0.7%, the rule working as designed.

## And it is still not good enough

Signed bias by race/ethnicity audit group:

| Group | n | MAE | ×overall | bias |
|---|---:|---:|---:|---:|
| RIDRETH1=1 | 390 | 2.476 | 0.91 | 0.381 |
| RIDRETH1=2 | 241 | 2.924 | 1.07 | 0.841 |
| RIDRETH1=3 | 745 | 2.731 | 1.00 | 0.434 |
| RIDRETH1=4 | 466 | 2.811 | 1.03 | **1.188** |
| RIDRETH1=5 | 584 | 2.738 | 1.00 | −0.656 |

On one group the model is systematically **1.19 percentage points high**. Its precision for that
group is fine — MAE 1.03× overall, well inside the ceiling. It is simply wrong in a consistent
direction, for 466 people out of 2,426, and it would be wrong in that direction for everyone like
them.

Every other subgroup dimension passed cleanly: no age band, sex or BMI band exceeded either limit.

## The criterion that caught it was added after seeing results

Amendment 4 added the subgroup bias limit on 2026-09-12, **with calibration results already in
hand**. That is recorded in the preregistration, along with the argument that an after-the-fact
criterion is defensible only when it tightens.

It tightened, and this is what it caught. Without it:

- every criterion in the preregistration as originally written passes
- the model is released
- it carries a 1.19 pp systematic over-prediction for one population group
- nothing in the release report mentions it, because nothing was looking

The calibration reading for that group was 0.865 against a limit of 1.0 — inside, with 0.135 to
spare. `research/NHANES-CANDIDATES.md` said that margin was thin, that the holdout was a different
cycle, and that 0.135 was well inside what it could move. It moved 0.32.

## What this does not mean

**Not that the approach fails.** The accuracy is real and the margin over the best simple baseline
is real. A model that predicts DXA body fat to 2.7 pp from four tape-measure inputs is a working
model; it is a working model with a fairness defect.

**Not that waist was a mistake.** Waist is what brought the worst group bias from 1.718 down to
1.188 in the first place. Without it this would have failed by a much wider margin.

**Not a reason to remove the criterion.** The obvious next move is to argue that ±1.0 was too
strict, and it should be resisted: the threshold was set before the number was known, and the only
reason to revisit it now is that it came back inconvenient.

## What a next attempt would need

**A different holdout.** 2017–2018 is spent. It has been read and its result is recorded; reading
it again against a revised model would be measuring the revision against data that shaped it.

NHANES 2015–2016 (`DXX_I`) exists and this work never touched it. That was not foresight — it was
omitted from the candidate source list by oversight, and noticing it now is luck rather than
planning. It is nonetheless untouched, and it is the obvious holdout for a second attempt.

**Something that addresses the bias rather than obscures it.** The three honest options from
`research/NHANES-BASELINES.md` still stand, and the middle one is now the interesting one:

1. Do not release. This is where the work currently sits, and it is a complete answer.
2. Widen the uncertainty interval until it honestly covers the group-level bias. Every estimate
   becomes less useful for everyone — which is the real price of not being able to say whose
   estimate is off — but nobody is told a number more precise than the evidence supports.
3. Find further inputs that capture what the audit variable stands in for. Waist worked. Hip
   circumference and a second skinfold-free anthropometric are the standard next candidates in
   this literature. This must not become "add race as a feature": §3 forbids it, and it would
   encode a population difference as a property of a person.

   **Correction, 2026-09-12 (amendment 5).** Hip circumference was named here from the literature
   without checking the data. NHANES measured it in one cycle only — 2017-2018, the one this read
   spent — so no hip model can be trained or validated on NHANES. Attempt 2 used arm circumference
   instead; see research/NHANES-ATTEMPT-2.md.

**A statistician.** §8 requires a qualified reviewer to approve thresholds and sample adequacy
before any release. That was outstanding before this read and remains outstanding; no tool here
can satisfy it, and nothing should be released on the strength of an automated pass.

## Status

`research/model/bodyfat-candidate-v0.1.0.json` now carries `holdoutRead: true`,
`releaseDecision: "not_released"` and the full report. `read-holdout.cjs` refuses to run against it
again.

The parity rubric does not move. FM05 stays where it is. The preregistration said in advance that a
failed model is a publishable result, and this is that result.
