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

## The last three questions, answered

### 5. Pregnancy status is only asked of some people — and the obvious rule drops 70% of the cohort

`RIDEXPRG` exists in every cycle, labelled "Pregnancy Status at Exam". Among adults 18–59 in
2017–2018:

| | count |
|---|---:|
| female, `RIDEXPRG = 1` (pregnant) | 55 |
| female, `RIDEXPRG = 2` (not pregnant) | 966 |
| female, `RIDEXPRG = 3` (cannot determine) | 89 |
| female, **null** | 845 |
| male, **null** | 1,751 |

The variable is populated only for women aged **20–44** — 1,110 of 1,955 women in the band. Every
man is null, and so is every woman outside those ages.

**So the exclusion has to be written as "exclude where `RIDEXPRG = 1`", never as "keep where
`RIDEXPRG = 2`".** The second reading drops 2,596 of 3,706 adults — about 70% of the cohort — for
not answering a question they were never asked. It would not error. It would produce a smaller
cohort that still looks reasonable, made almost entirely of women aged 20 to 44.

`RIDEXPRG = 3` is "cannot determine", which is not "not pregnant". Those 89 are excluded too: the
quantity being modelled is body composition outside pregnancy, and possibly-pregnant is not a
category this study can use.

### 6. Body measures are consistent and nearly complete — checked, fine

`BMXWT`, `BMXHT`, `BMXBMI` and `BMXWAIST` carry identical names and labels in 1999–2000,
2003–2004 and 2017–2018. Among adults 18–59 with a valid measured DXA:

| | 1999–2000 | 2017–2018 |
|---|---:|---:|
| no body-measures row at all | 0 | 0 |
| missing weight | 6 | 8 |
| missing height | 7 | 9 |
| missing waist | 11 (0.4%) | 23 (0.9%) |
| **have both height and weight** | **2,450 (99.7%)** | **2,442 (99.6%)** |

The "missing height, weight or sex" exclusion costs almost nothing, and the optional waist input is
available for about 99% — so the with-and-without-waist comparison the preregistration requires is
well powered rather than a footnote.

### 7. DXA validity works in opposite ways in the two eras — **and one filter cannot serve both**

This is the important one.

| | 1999–2004 | 2011–2018 |
|---|---|---|
| Unusable scan is… | **imputed** | **left blank** |
| Flagged by | `DXITOT` | per-region tissue invalidity codes |
| Imputation apparatus | `_MULT_`, 5 replicates | **none at all** |
| Everyone has a value? | yes — a fifth of them are model output | no — a blank is a blank |

In 2017–2018, **678 of the 4,336 rows with `DXAEXSTS = 1` — exam status complete — have no total
body fat value.** The scan happened and finished; one or more regions carried a tissue invalidity
code (most often 1 or 5), and NCHS suppressed the total rather than imputing it. Fifty rows have no
invalidity code set and still no total.

**So `DXAEXSTS = 1` is not a validity criterion.** It is the obvious one to reach for, and it is
what "DXA exclusion flagged by NCHS" in the preregistration sounds like it means. Using it alone
would admit 678 rows with no data in the later cycles, and 1,201 imputed rows in the early ones.

The rule that works for both eras is stated in amendment 3: the total body fat value must be
**present**, and in the early cycles the participant must additionally be **unimputed**. Neither
half is redundant — the first does nothing in 1999–2004, where everyone has a value, and the second
has nothing to act on after 2004, where nothing is imputed.

## The cohort, built

`node tools/nhanes/build-cohort.cjs --data <dir>`, 2026-09-12, after verifying all eighteen source
files against `sources.lock.json`. The final holdout is **not** built by default — the
preregistration says it is read once, at the release decision, and a command that produces it on
every iteration is how "read once" quietly becomes "read forty times".

| Cycle | Start | Under 18 | Over 59 | Pregnant | No DXA | DXA unusable | Imputed | Missing inputs | **Included** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1999–2000 | 9,965 | 4,409 | 1,668 | 480 | 601 | 0 | 350 | 7 | **2,450** |
| 2001–2002 | 11,039 | 5,046 | 1,872 | 535 | 665 | 0 | 0 | 11 | **2,910** |
| 2003–2004 | 10,122 | 4,502 | 1,901 | 445 | 666 | 0 | 0 | 15 | **2,593** |
| 2011–2012 | 9,756 | 3,892 | 1,791 | 142 | 104 | 862 | 0 | 9 | **2,956** |
| 2013–2014 | 10,175 | 4,062 | 1,841 | 159 | 86 | 630 | 0 | 11 | **3,386** |
| **Development total** | | | | | | | | | **14,295** |

Split by a stable hash of the participant identifier: **11,417 train, 2,878 calibration.**

Two things the flow shows that a single total would not:

**The imputed and the unusable trade places between eras.** In 1999–2000 the "DXA unusable"
column is zero and 350 are excluded as imputed; from 2011 the imputation column is zero and 862
then 630 are excluded as unusable. Same participants in substance — a scan that could not be
used — reached by opposite mechanisms. A pipeline with one filter would have kept one group or the
other, and the cohort would have looked fine either way.

**The pregnancy exclusion costs nothing, and is still right to have.** Checked directly: of the
445 pregnant-or-undetermined adults in 2003–2004 and the 159 in 2013–2014, **zero** have a usable
DXA. NHANES does not scan them, so they were never in the usable set. The rule stays because
"NHANES would not have scanned them anyway" is an undocumented assumption about someone else's
protocol, and a cohort that depends on it silently is one that breaks silently if it changes.

The outputs — `cohort-flow.txt`, `cohort-flow.json`, `model-ready.csv`, `evaluation.csv` — are
participant-level survey data and stay outside the repository with the sources. The flow above is
the part that belongs in the record.
