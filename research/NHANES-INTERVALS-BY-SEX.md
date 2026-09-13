# Attempt 4 — a half-width per sex, leave one cycle out

Status: **S2 met every amendment 7 criterion. Not released. Nothing frozen. 2015-2016 not read.**

Run 2026-09-12 under amendment 7 of research/NHANES-PREREGISTRATION.md, committed before any per-sex
half-width was computed. The runner reproduced attempt 3 exactly before any attempt-4 number was
produced — every half-width in every fold, which subgroup set each W2 width, 89.2% and 8 of 73 for
W1, 92.5% and 1 of 73 for W2 — so the extension changed nothing it was not meant to.

**The short version: the race-blind per-sex interval fails, and the group-covering per-sex interval
passes every criterion.** It is the first result in this study to meet the criteria it was held to.
It is also the weakest kind of pass there is, and the reasons are below the result rather than
buried after it.

## What was run

Everything exactly as attempt 3 — B+ as frozen, split-conformal, symmetric, nominal 90%, truncated
to 1–75%, each development cycle left out in turn, 14,220 out-of-cycle intervals — except that each
sex's half-width is set from that sex's residuals.

## The half-widths

| Left-out cycle | S1 women | S1 men | S2 women | S2 men | S2 set by (women; men) |
|---|---:|---:|---:|---:|---|
| 1999-2000 | 5.57 | 5.06 | 6.76 | 5.82 | RIDRETH1=5; RIDRETH1=5 |
| 2001-2002 | 5.67 | 5.11 | 6.73 | 5.83 | RIDRETH1=5; RIDRETH1=5 |
| 2003-2004 | 5.64 | 5.07 | 6.60 | 5.73 | RIDRETH1=5; age 50-59 |
| 2011-2012 | 5.56 | 5.12 | 6.30 | 5.56 | RIDRETH1=5; age 50-59 |
| 2013-2014 | 5.64 | 4.82 | 6.26 | 6.17 | BMI 18.5-24.9; RIDRETH1=5 |

For comparison, attempt 3's single widths were 5.33–5.41 (W1) and 5.90–6.17 (W2).

At the mean S2 half-width, an estimate of 25% would be shown as **18.5–31.5% for a woman** and
**19.2–30.8% for a man**. Baseline 1's S2 half-widths were 12.46–12.74 for women and 10.51–15.53 for
men, so usefulness passes by a wide margin.

## S1, per sex, race-blind: fails three of four

| Criterion | Result | |
|---|---|---|
| Overall out-of-cycle coverage | 88.9% vs floor 89.5% | fail |
| Every pooled subgroup | 7 of 16 below | fail |
| Every subgroup in every left-out cycle | 7 of 73 below | fail |
| Narrower than baseline 1, per sex, every fold | | pass |

**A width per sex did not fix the coverage problem on its own.** Women rose from 86.0% to 87.7%,
still below their floor. Men fell from 92.1% to 90.0%. Overall coverage fell from attempt 3's 89.2%
to 88.9%. Men's half-width shrank, and the cross-cycle under-coverage that failed W1 was still
there.

The risk amendment 7 named is exactly what happened. Women in 1999-2000 were covered 85.1%, with 141
misses where the estimate was too low against 35 too high. A per-sex width fixed part of the
difference in spread and none of the shift.

RIDRETH1=4 was covered 88.4%, with misses of 244 too high against 112 too low.

## S2, per sex, group-covering: passes all four

| Criterion | Result | |
|---|---|---|
| Overall out-of-cycle coverage | 93.5% vs floor 89.5% | pass |
| Every pooled subgroup | all 16 pass; lowest RIDRETH1=5 at 91.6%, women 92.7% | pass |
| Every subgroup in every left-out cycle | **0 of 73 below** | pass |
| Narrower than baseline 1, per sex, every fold | women 6.26–6.76 vs 12.46–12.74; men 5.56–6.17 vs 10.51–15.53 | pass |

Under amendment 7's rule order, S1 failed and S2 met every criterion, so **S2 is the attempt-4
result.**

## What kind of pass this is

Each of these is a reason the pass is weak. None of them is a reason to discard it.

**It was designed after seeing the failure it fixes.** Amendment 7 was written after attempt 3
under-covered women on these same five cycles, and it said so at the time. A leave-one-cycle-out
pass on data that shaped the design is evidence the idea is worth testing, not evidence it works.

**It is the fourth width rule tried.** Across attempts 3 and 4, four rules were declared in order
(W1, W2, S1, S2), and the last one passed. Each was declared before its own result, but the set of
rules grew in response to results. Stated plainly: after enough variants, one passing is less
surprising than it looks.

**It passes by covering more than it claims.** Overall coverage is 93.5% for an interval that would
be labelled 90%, and every pooled subgroup sits between 91.6% and 95.0%. Nobody is under-covered.
That is the point of widening, and it is conservative. But "90%" understates what the range does,
and a reviewer may reasonably ask whether the label or the width should change. Changing either now
would be a new rule chosen after the result, so neither is changed here.

**Much of the pass is simply more width.** S2's women's widths (6.26–6.76) are wider than attempt
3's W2 (5.90–6.17), which missed by one cell. Separating the sexes let men's width stay near W2's
while women's grew. That is a legitimate use of an input the model already has. It is also a
narrower improvement than "a width per sex fixed it" would suggest.

**The audit variable does real work in setting the widths.** In 7 of the 10 sex-and-fold widths, the
binding subgroup was a race/ethnicity audit group — almost always RIDRETH1=5, the smallest.
Amendments 6 and 7 flagged this rule as a use of the audit variable the preregistration did not
contemplate. Here that concern stops being hypothetical: the widths people would see are largely
set by how the model does for one audit group. Race still never makes one person's interval differ
from another's within a sex.

**The bias is covered, not removed.** Under S2, RIDRETH1=4 is covered 93.2%, but its misses still
run 145 with the estimate too high against 63 too low. The number at the centre of each range still
fails amendment 4, exactly as it did.

## What this does and does not establish

**Does:** on the development cycles, with each cycle held out in turn, a 90% interval with one
half-width per sex, each widened until every reportable subgroup reaches coverage, meets every
criterion amendment 7 set: overall, for every pooled subgroup, for every subgroup within every
left-out cycle, and narrower than the population average.

**Does not:** that it holds on a cycle whose result has not been seen; that an interval product may
be released; that the midpoint may be shown; that the label "90%" is the right one; or anything about
DEXA equivalence, clinical validity, children, or any Parent Playbook scan.

## The decisions this leaves

In the order amendment 7 set, each separate, none taken here:

1. **The §8 reviewer:** whether a range may be released when its centre fails amendment 4; whether the
   audit variable may set a width, given that it set 7 of these 10; whether the label should say 90%
   when coverage is about 93%; and whether the midpoint may be shown at all.
2. **Only then, freezing:** B+ with the S2 widths, set from the full development calibration
   partition, not from any single fold.
3. **Only then, reading 2015-2016** against amendment 7's criteria, once. It is the only test of this
   attempt whose result has not already been seen, and its per-cycle criterion collapses to a single
   cycle — the same shape of test that failed attempt 1.

Skipping step 1 and going straight to a holdout read is possible, but it would spend the last clean
test on a product the reviewer may not accept in principle.
