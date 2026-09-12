# Attempt 2 — arm circumference, on calibration

Status: **calibration only. Nothing frozen. 2015-2016 not read.**

Run 2026-09-12 under amendment 5 of research/NHANES-PREREGISTRATION.md, which declared the inputs,
the two candidates and the freeze rule before either was fitted.

**The short version: arm circumference qualifies a model for freezing under the rule written in
advance, and barely touches the defect it was added to fix.**

## Hip circumference was never an option

The first holdout report named hip circumference as the next input. NHANES measured hip in one
cycle, 2017-2018, which that read spent. Amendment 5 has the table. Arm circumference is the only
other soft-tissue girth recorded in every development cycle and in 2015-2016.

## Nothing else moved

Development is the same five cycles with the same participant hash, so training and calibration are
identical to attempt 1's. Every attempt-1 number reproduced to the third decimal (B+ MAE 2.627,
worst subgroup bias 0.865; baseline 4 MAE 2.987), which is the check that arm circumference is the
only difference.

Train 11,417, calibration 2,878. Arm circumference is missing where waist is present for 6 training
participants and 1 calibration participant, so requiring it costs almost nothing in refusals.

## Accuracy

| Model | n | bias | MAE | RMSE | slope | refused |
|---|---:|---:|---:|---:|---:|---:|
| baseline 4: waist-enhanced | 2,868 | −0.020 | 2.987 | 3.731 | 0.997 | 10 |
| A+: spline + waist | 2,868 | −0.015 | 2.742 | 3.428 | 1.000 | 10 |
| **A++: spline + waist + arm** | 2,867 | −0.008 | 2.731 | 3.413 | 1.001 | 11 |
| B+: boosted + waist | 2,868 | −0.013 | 2.627 | 3.292 | 1.005 | 10 |
| **B++: boosted + waist + arm** | 2,867 | −0.016 | 2.595 | 3.261 | 1.005 | 11 |

Arm circumference improves both models slightly: 0.011 MAE for the spline model, 0.032 for the
boosted one.

## Subgroup bias

Signed bias by race/ethnicity audit group, limit ±1.0 (amendment 4):

| Model | RIDRETH1=1 | =2 | =3 | =4 | =5 | worst | |
|---|---:|---:|---:|---:|---:|---:|---|
| B: boosted, no waist | −0.863 | −0.340 | −0.303 | 1.584 | −0.480 | 1.584 | fails |
| A+ | −0.487 | −0.224 | −0.210 | 1.036 | −0.435 | 1.036 | fails |
| **A++** | −0.454 | −0.242 | −0.200 | 1.022 | −0.431 | 1.022 | fails |
| B+ | −0.454 | −0.224 | −0.138 | 0.865 | −0.400 | 0.865 | passes |
| **B++** | −0.485 | −0.295 | −0.091 | 0.834 | −0.439 | 0.834 | passes |

The group that failed attempt 1 is still the worst group, and arm circumference moved it very
little. Waist took the boosted model's worst group from 1.584 to 0.865, a change of 0.719. Adding
arm took it from 0.865 to 0.834, a change of 0.031 — about a twenty-third of what waist did.

Whatever the audit variable is standing in for, arm circumference is not capturing much of it.

## What the freeze rule says

Amendment 5: of A++ and B++, freeze the one with the lower calibration MAE among those whose worst
subgroup bias is within ±1.0. **B++ qualifies**: it is the only one within the limit, and it has the
lower MAE anyway.

The rule permits freezing B++. It does not require anyone to read a holdout.

## What the evidence says about reading one

B++ clears the limit by 0.166. B+ cleared it by 0.135 and then moved 0.323 on its holdout, from
0.865 to 1.188.

Applying that same shift to B++ gives about 1.16, which would fail the same criterion for the same
group. That is arithmetic on a single earlier observation, not a prediction: a different cycle can
move by more, by less, or the other way. But nothing about arm circumference gives a reason to
expect it to move less, and the reason B+ failed — a structural difference between groups that
height, weight, age, sex and girths do not represent — is still there.

## What reading 2015-2016 would and would not use up

Checked 2026-09-12, by requesting the first byte of each file only — no content was read:

| Cycle | Whole-body DXA file | |
|---|---|---|
| 2005-2006 | `DXX_D`, 28.2 MB | **exists, never on this study's source list, unread** |
| 2007-2008 | `DXX_E` not found | not found at the expected filename; not established to mean there is no DXA |
| 2021-2023 | `DXX_L` not found | not found at the filename NHANES's convention predicts; that is **not** established to mean there is no DXA |

So 2015-2016 is not the last unread whole-body DXA cycle: 2005-2006 is also untouched. Its file is
the size of the 1999-2004 files, which suggests the same imputed-replicate format, and amendment 2's
statement that "no cycle after 2004" scanned anyone over 59 was written about the cycles on the
source list at the time and has not been checked against it. Before 2005-2006 is relied on for
anything, both need confirming.

## The decision this leaves

Nothing has been frozen. Freezing has been a separate, explicit decision at every stage of this
study, and this one should be made knowing the projection above.

1. **Freeze B++ and read 2015-2016**, as amendment 5 permits. The result is informative either way,
   but a failure is the likelier outcome, and the read cannot be taken back.
2. **Do not freeze.** Keep 2015-2016 unread for an attempt that changes something more likely to
   matter: widening the uncertainty interval until it honestly covers the group-level bias (option 2
   in research/NHANES-HOLDOUT.md), or sagittal abdominal diameter with training restricted to
   2011-2014 (amendment 5 explains why that was not chosen here, and those reasons would have to be
   answered).
3. **Stop.** The not-released result from attempt 1 stands and is complete.

None of these is a release. §8's statistician review is outstanding under all three.
