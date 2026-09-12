# Candidate model results

`node tools/nhanes/run-candidates.cjs --data <dir>`, 2026-09-12. Fitted on **train** (11,417),
reported on **calibration** (2,878). **The final holdout was not read.**

Calibration is the tuning partition. Every number here is optimistic by construction, because the
candidates were chosen partly by looking at it. That is what calibration is for; it is also why
none of this is a release result.

## Accuracy

| Model | n | bias | MAE | RMSE | calib. slope | refused |
|---|---:|---:|---:|---:|---:|---:|
| baseline 2: linear | 2,878 | 0.015 | 3.130 | 3.937 | 0.999 | 0 |
| baseline 4: + waist | 2,868 | −0.020 | 2.987 | 3.731 | 0.997 | 10 |
| candidate A: spline ridge | 2,878 | −0.007 | 3.007 | 3.756 | 1.005 | 0 |
| candidate A+: spline + waist | 2,868 | −0.015 | **2.742** | 3.428 | 1.000 | 10 |
| candidate B: boosted trees | 2,878 | −0.020 | 2.954 | 3.695 | 1.006 | 0 |
| candidate B+: boosted + waist | 2,868 | −0.013 | **2.627** | 3.292 | 1.005 | 10 |

Boosted trees with waist reach 2.627 against the best baseline's 2.987 — about 12% better. Without
waist the same model manages 2.954 against 3.130, which is a real but much smaller gain. **Waist is
doing more work than model class is.**

## Subgroup bias, which is what Sprint 3 existed to test

Signed bias by race/ethnicity audit group. Amendment 4's limit is ±1.0.

| Model | =1 | =2 | =3 | =4 | =5 | worst | |
|---|---:|---:|---:|---:|---:|---:|---|
| baseline 2: linear | −0.979 | −0.513 | −0.231 | 1.718 | −0.385 | 1.718 | fails |
| baseline 4: + waist | −1.211 | −0.730 | 0.074 | 1.427 | −0.681 | 1.427 | fails |
| candidate A: spline ridge | −0.899 | −0.358 | −0.273 | 1.691 | −0.611 | 1.691 | fails |
| candidate A+: spline + waist | −0.487 | −0.224 | −0.210 | 1.036 | −0.435 | 1.036 | fails |
| candidate B: boosted trees | −0.863 | −0.340 | −0.303 | 1.584 | −0.480 | 1.584 | fails |
| candidate B+: boosted + waist | −0.454 | −0.224 | −0.138 | **0.865** | −0.400 | **0.865** | **passes** |

## A correction to what I wrote in the baselines

`research/NHANES-BASELINES.md` says the group bias is structural, and argues that no function of
age, sex, height and weight can separate groups that differ in body fat at the same values. **That
specific claim survives**: candidates A and B, which use exactly those inputs, still fail at 1.691
and 1.584 — barely better than the linear baseline's 1.718, and a stronger model class bought
almost nothing.

**But the conclusion drawn from it was too pessimistic.** That document ends by saying the model is
more likely not to be released than released. Adding waist circumference cuts the worst group bias
from 1.718 to 0.865 — below the limit — without race ever reaching a model. That is not a loophole;
it is the third option that document listed and dismissed too quickly: *find inputs that capture
what the audit variable is standing in for.* Waist circumference carries information about where
fat sits, fat distribution differs between population groups, and a model that can see it no longer
has to split the difference.

The thing that document got right is worth keeping: the fix came from **a better input, not a
better model.** Model class alone moved the worst bias from 1.718 to 1.584. Waist moved it to
0.865.

## Three reasons this is not a result yet

**The margin is thin and the number is optimistic.** 0.865 against a limit of 1.0, on the partition
the model was tuned against. The holdout is a different sample of a different survey cycle, and a
0.135 margin is well inside what that could move. Candidate A+ at 1.036 is on the other side of the
same line, which is how close this is.

**It only passes with waist, and waist is optional in the product.** The non-waist models all fail
by a wide margin, so there is no fallback: a person who does not give a waist measurement cannot be
served by the passing model, and cannot be quietly served by a failing one instead. 99.5% of the
cohort has a waist measurement, but NHANES measures it with a trained examiner and a tape at the
iliac crest, and a parent with a cloth tape in a bathroom is not that. **A released model would
have to refuse anyone without a waist measurement**, and that refusal is a supported-population
rule, not an error.

Narrowing by "provides a waist measurement" is a legitimate narrowing in a way that narrowing by
race is not: it is about what someone chooses to supply, not about who they are.

**B+ beats A+ partly because it was allowed to.** Boosted trees have more capacity and were tuned
against the same partition they are reported on. Some of the 2.742 → 2.627 gap is real and some is
optimism, and calibration cannot tell them apart. The interpretable model is within 0.115 pp of the
stronger one, which is worth remembering when choosing what to freeze.

## What happens next, and what would end this

The release decision reads the holdout **once**. On today's evidence the candidate to take there is
**B+ or A+, with waist required**, and the honest expectation is that the subgroup bias criterion is
the one that decides it, not the accuracy criterion — accuracy has margin, fairness has 0.135.

If the holdout puts the worst group bias above 1.0, the model is not released. That remains a real
and publishable outcome, and nothing in this document makes it less likely than the evidence says.
