# What the NHANES DXA files actually contain

Measured 2026-09-12 from the files recorded in `tools/nhanes/sources.lock.json`, using
`tools/nhanes/xport.mjs`. Every number here was counted, not recalled.

This exists because the suspicion recorded in `tools/nhanes/sources.json` — that the early DXA
files carry replicate rows per participant — turned out to be correct, and because the shape of the
correction matters more than the fact of it.

## The replicate structure is real

| File | Cycle | Rows | Participants | Rows per participant |
|---|---|---:|---:|---:|
| `DXX` | 1999–2000 | 31,175 | 6,235 | **5.00** |
| `DXX_B` | 2001–2002 | 41,210 | 8,242 | **5.00** |
| `DXX_C` | 2003–2004 | 38,280 | 7,656 | **5.00** |
| `DXX_G` | 2011–2012 | 5,692 | 5,692 | 1.00 |
| `DXX_H` | 2013–2014 | 6,033 | 6,033 | 1.00 |
| `DXX_J` | 2017–2018 | 5,114 | 5,114 | 1.00 |

Exactly five, never 4.98 or 5.02. The early files carry a variable `_MULT_`, labelled **"Imputation
Version"**, and a companion `DXITOT`, **"Overall Imputation Indicator"**. The later files have
neither and have 93 variables where the early ones have 106.

**A join on the participant identifier without accounting for this multiplies the early cohort by
five.** It would not error, would not look wrong, and would produce a training set in which one
person appears as five people who happen to agree — shrinking every standard error and making any
model fitted on it look better than it is.

## Most participants were measured; a fifth were imputed

Cross-tabulating the 1999–2000 file, per participant:

| `DXITOT` | `DXAEXSTS` | Values across the 5 rows | Has body fat | Participants |
|---|---|---|---|---:|
| 0 | 1 (complete) | **identical** | yes | **4,671** |
| 1 | 1 | varying | yes | 589 |
| 1 | 6 | varying | yes | 542 |
| 1 | 4 | varying | yes | 55 |
| 1 | 2 | varying | yes | 10 |
| 1 | 5 | varying | yes | 5 |
| 1 | 1 | identical | yes | 6 |
| null | 3 | identical | **no** | 283 |
| 2 | 6 | identical | **no** | 59 |
| null | 6 | identical | **no** | 12 |
| 2 | 4 | identical | **no** | 3 |

So for 1999–2000 the three numbers a reader might quote are:

- **31,175** — rows in the file. Not participants, and not observations.
- **6,235** — participants with a row.
- **4,671** — participants with a genuine, complete, unimputed whole-body DXA measurement.

The honest denominator for "was measured by DXA" is the last one, **75% of the participants in the
file**. Where `DXITOT = 0`, all five rows are exact duplicates and the imputation machinery is
carrying no information. Where `DXITOT = 1`, the five rows genuinely differ and represent
imputation uncertainty for a scan that was not usable.

Per-cycle unimputed counts: 1999–2000 **4,671**, 2001–2002 **6,425**, 2003–2004 **5,877**.

## What follows from this

**The five rows are not five observations and must never be treated as such.** Three defensible
handlings exist, and the choice has to be recorded rather than defaulted into:

1. **Measured only.** Keep `DXITOT = 0` participants, collapse the identical replicates to one row.
   Loses roughly a fifth of the file; what remains is measurement rather than model output. This is
   the right default for training a model whose whole purpose is to approximate a DXA measurement —
   training partly on someone else's imputation of a DXA measurement is a different exercise.
2. **Single imputation.** Take `_MULT_ = 1` for everyone. Keeps the count up and silently discards
   the imputation uncertainty, which then reappears as false confidence.
3. **All imputations, combined by Rubin's rules.** Correct if done properly and wrong if the five
   are pooled as independent rows, which is the failure mode this whole page exists to prevent.

`tools/nhanes/replicates.mjs` refuses to collapse a replicated file unless one of these is named
explicitly, and records which was used. There is no default, because the default would be chosen
once and then never thought about again.

**The later cycles are a different dataset, not the same one with fewer rows.** 93 variables versus
106, no imputation apparatus, one row per participant. Harmonising them is a real task and the
variables must be matched by meaning rather than by name.

## The four open questions, answered

All measured 2026-09-12 from the locked files. Two were fine, one is a fact worth writing down,
and one changes the study.

### 1. Body-fat percentage is defined identically across eras — checked, fine

`DXDTOPF` is the same quantity in 1999-2000, 2003-2004 and 2017-2018. Established by arithmetic
rather than by the label agreeing:

| Check | Median absolute difference |
|---|---:|
| `DXDTOPF` vs `100 x DXDTOFAT / DXDTOTOT` | **0.025 pp** (rounding) |
| `DXDTOTOT` vs `DXDTOLI + DXDTOFAT` | **0.00 g** |
| `DXDTOLI` vs `DXDTOLE + DXDTOBMC` | 0.03 g (rounding) |
| Total fat vs sum of regions **including** head | **0.0 g** |
| Total fat vs sum of regions **excluding** head | 1,106 g |

So body fat percentage is **fat / (fat + lean + bone mineral), whole body including the head** —
the denominator is total body mass, which is the same thing a scale weighs. Identical in every era
tested. The first check matters because the plausible alternative, fat over lean-plus-fat with bone
excluded, is off by about 0.9 pp: small enough to look like noise and large enough to matter against
a 3.5 pp release threshold.

### 2. Exam status means the same thing — checked, fine

`DXAEXSTS`, "Exam Status", exists with the same name and label in both eras.

### 3. Survey design variables are present — checked, with a caveat

`SDMVPSU`, `SDMVSTRA` and `WTMEC2YR` appear in every demographics file, so weighted evaluation
is possible. Two things differ and will bite whoever ignores them:

- 1999-2000 also carries `WTMEC4YR`, for combining with 2001-2002. **Weights are not poolable by
  concatenation.** Combining cycles requires constructing new weights by the published rules; using
  2-year weights across six cycles overstates the population by a factor of six.
- The race/ethnicity variable changes: `RIDRETH1` is in all files, `RIDRETH2` only in the early
  ones, `RIDRETH3` only in the later. `RIDRETH1` is the one common audit variable. Since this is
  evaluation-only and never a model input, the requirement is that subgroups be comparable across
  cycles, which `RIDRETH1` satisfies and the others do not.

### 4. DXA age coverage differs by era — **this changes the study**

| File | Cycle | Valid DXA | Age range | 18–69 | 18–59 | 60–69 |
|---|---|---:|---|---:|---:|---:|
| `DXX` | 1999–2000 | 4,671 | 8–85 | 3,002 | 2,457 | 545 |
| `DXX_B` | 2001–2002 | 6,425 | 8–85 | 3,422 | 2,921 | 501 |
| `DXX_C` | 2003–2004 | 5,877 | 8–85 | 3,151 | 2,608 | 543 |
| `DXX_G` | 2011–2012 | 4,521 | **8–59** | 2,965 | 2,965 | **0** |
| `DXX_H` | 2013–2014 | 5,056 | **8–59** | 3,397 | 3,397 | **0** |
| `DXX_J` | 2017–2018 | 3,658 | **8–59** | 2,452 | 2,452 | **0** |

DXA eligibility stopped at 59 from 2011 onward. The preregistration fixed the population at 18–69
and named the most recent cycle as the final holdout.

**The final holdout contains zero participants aged 60–69.** A model released for 18–69 on this
plan would be trained on 1,589 development participants in that band and evaluated on none of them.
Its performance there would be unmeasured, and the release criteria could all pass while saying
nothing whatsoever about the oldest tenth of the supported population.

The preregistration already answers this: when a subgroup cannot be shown to work, the supported
population narrows. Amendment 2 narrows it to **18–59**. The cost is 1,589 development participants,
about a tenth; the holdout is unchanged at 2,452 because it had nobody in that band to begin with.

Cohort after both amendments, before the remaining exclusions in §2:

| | 18–59, valid measured DXA |
|---|---:|
| Development (1999–2004, 2011–2014) | **14,348** |
| Final holdout (2017–2018) | **2,452** |

## What is still unchecked

- Pregnancy status, which §2 excludes, and which variable carries it in each cycle.
- Whether `BMXWT`, `BMXHT` and `BMXWAIST` are measured identically across eras, and their
  missingness among participants who have a valid DXA.
- Whether the 2011-2018 valid-DXA fraction (around 76%) reflects the same exclusions as the early
  cycles' `DXITOT`, or a different mechanism wearing the same shape.
