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

## What has not been checked yet

- Whether `DXAEXSTS = 1` means the same thing in the later cycles, which use a different variable set.
- The actual DXA-eligible age range per cycle, which the preregistration assumes but has not confirmed.
- Whether body-fat percentage is defined identically across cycles, including whether the head is
  included in the total.
- Survey design variables for weighted evaluation, which live in the demographics files and have
  not been read.

Each of these is a way to build a cohort that looks right and is not. None of them is resolved by
this page.
