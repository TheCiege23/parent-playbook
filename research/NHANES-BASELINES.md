# Baseline results

`node tools/nhanes/run-baselines.cjs --data <dir>`, 2026-09-12. Fitted on the **training**
partition (11,417), reported on **calibration** (2,878). **The final holdout was not read**, and
the command that produced this cannot read it.

These are not a release result. They establish what a candidate model has to beat.

## The four baselines

| Model | n | bias | MAE | RMSE | max error | calib. slope | refused |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1. mean by age and sex band | 2,878 | −0.085 | **4.893** | 6.122 | 25.51 | 1.021 | 0 |
| 2. linear: age, sex, height, weight | 2,878 | 0.015 | **3.130** | 3.937 | 18.36 | 0.999 | 0 |
| 3. BMI regression: bmi, age, sex | 2,878 | 0.004 | **3.149** | 3.954 | 15.66 | 1.000 | 0 |
| 4. waist-enhanced: + waist | 2,868 | −0.020 | **2.987** | 3.731 | 13.82 | 0.997 | 10 |

Three things worth saying plainly.

**A four-feature linear regression already meets the accuracy threshold.** The preregistered
release criterion is MAE ≤ 3.5 percentage points, and baseline 4 reaches 2.987 on calibration.
Anything more complicated now has to beat **2.987**, not 3.5, to have earned its complexity. That
bar was set by the data, not by ambition.

**BMI adds nothing over height and weight.** Baselines 2 and 3 are within 0.02 pp of each other,
which is what should happen: BMI is arithmetic on the two of them, so a model given both learns the
same thing either way. Reporting both is how that gets shown rather than assumed.

**Waist earns about 0.14 pp**, and costs 10 refusals where the measurement is absent. The refusals
are the system working — §4 requires no estimate rather than a substitute — but a released model
using waist has to answer for the people who do not have one.

## Subgroup results for the best baseline

Overall MAE 2.987. The §8 ceiling is a worst-subgroup MAE within 1.25× overall.

| Group | n | MAE | ×overall | bias |
|---|---:|---:|---:|---:|
| age 18–29 | 1,054 | 3.042 | 1.02 | −0.182 |
| age 30–39 | 619 | 2.955 | 0.99 | 0.093 |
| age 40–49 | 637 | 2.861 | 0.96 | 0.345 |
| age 50–59 | 558 | 3.061 | 1.02 | −0.256 |
| female | 1,407 | 3.158 | 1.06 | −0.096 |
| male | 1,461 | 2.822 | 0.94 | 0.053 |
| BMI 18.5–24.9 | 1,065 | 3.000 | 1.00 | 0.424 |
| BMI 25.0–29.9 | 902 | 2.871 | 0.96 | −0.970 |
| BMI 30.0–34.9 | 511 | 2.875 | 0.96 | −0.340 |
| BMI 35+ | 333 | 3.420 | 1.15 | **1.313** |
| BMI under 18.5 | 57 | — | — | insufficient to report |
| RIDRETH1=1 | 586 | 2.991 | 1.00 | **−1.211** |
| RIDRETH1=2 | 180 | 2.830 | 0.95 | −0.730 |
| RIDRETH1=3 | 1,152 | 2.915 | 0.98 | 0.074 |
| RIDRETH1=4 | 638 | 3.162 | 1.06 | **1.427** |
| RIDRETH1=5 | 312 | 2.976 | 1.00 | −0.681 |

**Every subgroup passes the MAE ceiling. Every one.** The worst is 1.15×, comfortably inside 1.25.

## The finding: MAE is uniform and bias is not

The MAE column says the model is equally *precise* for everyone. The bias column says it is not
equally *right* for everyone — and the preregistration's subgroup criterion only looks at the first
one.

The pattern is not an artefact of the winning model. Signed bias by audit group, across all four
baselines:

| Group | band mean | linear | BMI | waist |
|---|---:|---:|---:|---:|
| RIDRETH1=1 | −1.624 | −0.979 | −1.153 | −1.211 |
| RIDRETH1=2 | −1.098 | −0.513 | −0.606 | −0.730 |
| RIDRETH1=3 | 0.040 | −0.231 | −0.153 | 0.074 |
| RIDRETH1=4 | 0.870 | 1.718 | 1.819 | **1.427** |
| RIDRETH1=5 | 0.972 | −0.385 | −0.598 | −0.681 |

Same sign, every model, for groups 1 and 4 — and for group 4 the *more sophisticated* models are
**worse** than the population mean. That is structural. Body fat at a given height, weight and age
differs systematically between population groups, and a model built from height, weight, age and
sex cannot represent that difference, so it splits it down the middle: over-predicting one group by
about 1.4 pp and under-predicting another by about 1.2 pp.

For scale: the preregistration's **overall** bias limit is ±1.0 pp. Two groups exceed it, in
opposite directions, while the overall bias is −0.020 because they cancel.

### Why the preregistration's own remedy does not apply here

§8 says that when a subgroup fails, the supported population narrows. That works for an age band.
**It cannot work here.** Narrowing a supported population by race would mean shipping a product
that declares itself accurate for some races and not others, and restricting access accordingly.
That is not a remedy; it is a worse product and a worse thing to do.

The available responses, none of them free:

1. **Do not release.** Always available, and the preregistration already says a failed model is a
   publishable result.
2. **Widen the uncertainty interval so it honestly covers the group-level bias.** Makes every
   estimate less useful for everyone, which is the honest price of not being able to tell whose
   estimate is off.
3. **Find inputs that capture what the audit variable is standing in for.** This is what the
   published literature does. It is also where a project like this can go badly wrong, because the
   easy version is to add race as a feature — which §3 forbids, and which would encode a population
   difference as a property of a person.

Amendment 4 adds a subgroup **bias** criterion so this cannot pass by satisfying a criterion that
was never watching for it. The amendment was written with these results in hand, which is recorded
in it: it makes release harder rather than easier, which is the only direction an after-the-fact
criterion can honestly move.

## What these numbers do not establish

Nothing about a Parent Playbook photo scan, nothing about children, nothing about anyone outside
the US survey population, and no release. This is one held-back partition of the development data,
which exists to be iterated against. The holdout is unread and stays that way until there is
something worth deciding.
