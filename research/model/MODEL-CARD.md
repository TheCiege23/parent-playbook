# Model card — `parent-playbook-nhanes-bodyfat` v0.1.0

**Status: NOT RELEASED. The holdout was read on 2026-09-12 and the model failed one of six
release criteria.**

Five criteria passed, including every accuracy criterion: holdout MAE 2.726 against a limit of 3.5,
beating the best baseline's 3.098. It failed the subgroup bias criterion — systematically **1.19
percentage points high** for one race/ethnicity audit group, against a limit of 1.0.

It is not a released model and must not be presented to anyone as an estimate. The runtime enforces
that: `estimateBodyComposition` refuses by default. See `research/NHANES-HOLDOUT.md`.

| | |
|---|---|
| Artifact | `research/model/bodyfat-candidate-v0.1.0.json` (448 KB) |
| SHA-256 | recorded in `bodyfat-candidate-v0.1.0.sha256` |
| Frozen | 2026-09-12, **before** the holdout was read |
| Reproduce | `node tools/nhanes/freeze-model.cjs --data <dir> --verify` |

## What it does

Predicts **NHANES whole-body DXA body-fat percentage** for US survey participants aged 18–59, from
four body measurements. Fat mass and lean mass are derived from the prediction and total body mass.

Body fat percentage means fat over total body mass, **including bone mineral and including the
head** — established by arithmetic on the source files, not by reading a label. See
`research/NHANES-DATA-STRUCTURE.md`.

## Inputs — all five required

| Input | Unit | Accepted range |
|---|---|---|
| age | years | 18–59 |
| sex | indicator | 0 or 1 |
| height | cm | 120–220 |
| weight | kg | 30–300 |
| **waist circumference** | cm | 50–200 |

**Waist is required, not optional.** Every model in this family that does not use waist fails the
subgroup bias criterion by a wide margin, so there is no weaker version to fall back to. A person
who cannot supply a waist measurement is refused. That refusal is a supported-population rule, not
an error — and it is a legitimate narrowing in a way that narrowing by race would not be, because
it is about what someone chooses to supply rather than who they are.

The waist measurement NHANES used was taken by a trained examiner with a tape at the iliac crest. A
parent with a cloth tape in a bathroom is not that, and no part of this work measures the gap.

## Never inputs

Race, ethnicity, participant identifiers, survey design variables, health outcomes, diagnoses,
medications. These are absent **by construction**: the model was fitted on rows produced by
`modelReadyExport`, which do not contain them, so the fit could not have used them.

Race and ethnicity are used for **evaluation** — precisely so that error concentrated in one group
can be found. That is the opposite of using them as a feature, and the distinction is the point.

## Training

| | |
|---|---|
| Data | NHANES 1999–2004 and 2011–2014, public use |
| Development cohort | 14,295 participants |
| Train partition | 11,417 |
| Fitted on | **11,352** (train, minus 65 without a waist measurement) |
| Method | gradient-boosted regression trees, 300 trees, depth 3, learning rate 0.05, minimum leaf 20 |
| Replicate policy | measured only — imputed DXA values excluded |

The fit is fully deterministic: no subsampling, no random initialisation, no seed. Two fits from
the same sources are byte-identical, which is why `--verify` can reproduce the artifact rather than
take its word for it.

## Performance — holdout

Read once, against this frozen artifact, on the 2017-2018 cycle (2,442 participants, 2,426 scored,
16 refused for a missing waist measurement).

| Metric | Holdout | Limit | |
|---|---:|---|---|
| MAE | 2.726 | ≤ 3.5 | pass |
| Signed bias | 0.348 | ±1.0 | pass |
| Calibration slope | 0.974 | 0.85–1.15 | pass |
| Best baseline MAE | 3.098 | must beat | pass |
| Worst subgroup MAE ratio | 1.086 | ≤ 1.25 | pass |
| **Worst subgroup bias** | **1.188** | **±1.0** | **fail** |

The failure is not imprecision. For the affected group the MAE is 1.03x overall — the model is as
precise for them as for anyone, and consistently wrong in one direction.

## Performance — calibration, and optimistic

| Metric | Value |
|---|---|
| n | 2,868 |
| MAE | 2.627 pp |
| RMSE | 3.292 |
| Signed bias | −0.013 |
| Calibration slope | 1.005 |
| Worst subgroup bias | **0.865** (limit 1.0) |

**These numbers are optimistic by construction.** Calibration is the tuning partition; this model
was chosen partly by looking at it. They are recorded because a frozen artifact should carry what
was known when it was frozen — not because they are a result.

For scale, the best simple baseline reaches MAE 2.987 on the same partition. The gain from this
model is about 0.36 pp.

## Known limitations

- **Failed its release criteria.** One of six, on subgroup bias. Recorded in full in
  research/NHANES-HOLDOUT.md.
- **The fairness margin is thin.** 0.865 against a limit of 1.0, on the partition it was tuned
  against. A different survey cycle could move it past the line, and the interpretable alternative
  sits at 1.036 — the wrong side of the same line.
- **Lean mass is not skeletal muscle mass.** It is everything that is not fat, including bone
  mineral. DXA does not resolve skeletal muscle from lean soft tissue and no conversion factor
  creates that measurement.
- Establishes nothing about DEXA equivalence, clinical validity, children, non-US populations, or
  any Parent Playbook photo scan.

## What it may never be used for

Diagnosis, screening, eligibility, team selection, athletic-potential ranking, weight-loss targets,
or any automatic change to a training plan. These are constraints on what may be built on top of
the number, not disclaimers to print beside it.

## Ownership

Trained by Parent Playbook on NHANES public-use data published by the US National Center for Health
Statistics, which is in the public domain. The trained model and this artifact are owned by Parent
Playbook. **NCHS does not endorse this work.**

## What would change this card

Nothing about this artifact. Its holdout is read, its decision is recorded, and 2017-2018 is spent
— reading it again against a revised model would measure the revision against data that shaped it.

A second attempt would be a new model with a new holdout. NHANES 2015-2016 is untouched by this
work, though by omission rather than by foresight. What it would have to address is the bias
itself: either by widening the uncertainty interval until it honestly covers the group-level error,
or by finding further inputs that capture what the audit variable stands in for. Not by relaxing
the criterion, which was set before the number was known.
