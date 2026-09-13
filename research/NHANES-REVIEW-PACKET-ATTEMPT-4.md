# Review packet: NHANES body-fat model, attempt 4

For the qualified reviewer that research/NHANES-PREREGISTRATION.md §8 requires before any release.
Prepared 2026-09-13 from the repository at `main` `7e1ece8`.

**Status: nothing is frozen, nothing is released, and the 2015–2016 holdout has not been read.**
Attempt 4's uncertainty interval met every criterion it was held to on the development cycles. §8
gives the next decision — whether that result may go any further — to a qualified reviewer, and
this packet is written for that reviewer.

**What we ask for:** a written opinion on the questions in §2. Each can be answered on its own. We
are not asking anyone to endorse DEXA equivalence, clinical validity, accuracy in children, or
anything about a Parent Playbook photo scan; §9 of the preregistration rules those claims out
whatever the result.

**Two departures from the protocol, found while preparing this packet, stated first:**

1. **No survey-weighted result has been computed at any stage.** §7 requires weighted and
   unweighted results side by side. Every number in this packet is unweighted.
2. **In 1999–2004 only measured DXA scans were kept** (amendment 1). NCHS states that missingness
   in those files is "clearly NOT missing at random" and that it "does not recommend analysis based
   on only complete cases with original sampling weights". The rule removed 1,700 of 9,686 eligible
   early-cycle adults (17.6%). The cohort flow then counted them under "no DXA record" rather than
   as imputed, so the exclusion was not visible where §2 says it must be. That reporting gap has
   since been fixed (§4). The selection itself has not changed.

---

## 1. The study on one page

| | |
|---|---|
| Quantity | NHANES whole-body DXA body-fat percentage: fat over total mass, including bone mineral and the head |
| Population | Adults 18–59, not pregnant or possibly pregnant, with a measured whole-body DXA result |
| Inputs | Age, sex, height, weight, waist circumference, all required |
| Never inputs | Race/ethnicity (evaluation only, enforced in code), identifiers, survey design variables |
| Model | "B+": gradient-boosted regression trees; 300 trees, learning rate 0.05, depth 3, minimum leaf 20 |
| Development cycles | 1999–2000, 2001–2002, 2003–2004, 2011–2012, 2013–2014: **14,295 participants** |
| Spent holdout | 2017–2018, read once, for attempt 1 |
| Unread holdout | 2015–2016. Its documentation pages have been read; no data has been opened. |
| Also unread | 2005–2006 whole-body DXA, which was never on the source list |

| Attempt | What changed | Judged on | Result |
|---|---|---|---|
| 1 | B+ point estimate | 2017–2018 holdout, read once | 5 of 6 criteria. Failed subgroup bias: RIDRETH1=4 at +1.188 percentage points against ±1.0. **Not released.** |
| 2 | Arm circumference added | Calibration partition | Worst subgroup bias moved 0.865 → 0.834. Not taken further. |
| 3 | 90% conformal interval, one half-width for everyone | Leave one cycle out | W1 failed 3 of 4 criteria; W2 failed 1 of 4, by one cell |
| 4 | 90% conformal interval, one half-width per sex | Leave one cycle out | S1 failed 3 of 4 criteria; **S2 met all 4** |

Full reports: `research/NHANES-HOLDOUT.md`, `research/NHANES-ATTEMPT-2.md`,
`research/NHANES-INTERVALS.md`, `research/NHANES-INTERVALS-BY-SEX.md`.

---

## 2. Questions for the reviewer

### A. Whether an interval product may proceed at all

**Q1. A range whose centre fails.** The point estimate at the centre of attempt 4's interval is
attempt 1's model, and it failed amendment 4's subgroup bias limit. Amendments 6 and 7 referred,
rather than decided, whether a range may be released when its centre fails. Is that acceptable in
principle, and if so, under what conditions?

**Q2. The midpoint.** If a range is acceptable, may the estimate at its centre be shown, or only
the range?

**Q3. The audit variable setting the width.** S2 widens each sex's half-width until every
reportable subgroup — age band, BMI band and race/ethnicity audit group, each with at least 100
conformal participants within that sex — reaches its conformal coverage. In **7 of the 10**
sex-by-fold widths, the subgroup that set the width was a race/ethnicity audit group, almost always
RIDRETH1=5, the smallest. Race never makes one person's interval differ from another's within a
sex, but it largely sets the number everyone sees. §3 does not contemplate this use. Is it
acceptable?

**Q4. The label.** S2 is labelled 90%. It covered 93.5% overall and 91.6–95.0% across pooled
subgroups. Should the label change, the width change, or neither? Neither has been changed: doing
either now would be a rule chosen after the result.

### B. Thresholds and sample adequacy (the review §8 names)

**Q5. Coverage floors.** Pooled floors are nominal − 2·SE(n); per-cycle floors are nominal −
3·SE(n), with SE(n) = √(0.9 × 0.1 / n). Subgroups under 100 are not reported. Up to 75 per-cycle
cells are tested, and the looser per-cycle floor is the multiplicity allowance. Are these floors
appropriate?

**Q6. Sample adequacy.** Each fold's conformal set is the calibration partition of four cycles,
split by sex: 1,044–1,200 people per sex per fold, counting only those with a waist measurement. A subgroup needs 100 within a sex to
set a width. Is that adequate for a 90% conformal quantile and for the group-covering extension?
Appendix A.4 lists every per-cycle cell, including those too small to report.

**Q7. The standing point-estimate criteria.** §8 requires, for any point release: holdout MAE ≤
3.5; overall and per-subgroup signed bias within ±1.0; calibration slope 0.85–1.15; beating every
baseline; worst subgroup MAE ≤ 1.25 × overall. All were set before any result except the
per-subgroup bias limit (amendment 4), which was added with baseline results in hand and makes
release harder. Does the reviewer approve these as the standard?

### C. The two departures from the protocol

**Q8. No survey weights.** Every result is unweighted. `SDMVPSU`, `SDMVSTRA` and `WTMEC2YR` are
present on all 14,295 development rows and have never been used. Pooling cycles needs constructed
weights: 1999–2000 also carries `WTMEC4YR`, and 2-year weights are not poolable by concatenation.
In 1999–2004 the published weights are also not adjusted for DXA non-response. What weighted
analysis, if any, is required before a freeze or a holdout read, and how should weights be built,
given the measured-only selection in Q9?

**Q9. Measured-only DXA in 1999–2004.** Among non-pregnant adults aged 18–59 with an early-cycle DXA
record:

| Cycle | With a DXA record | Measured, kept | Imputed, excluded | Excluded with an imputed body-fat value | Excluded with no body-fat value |
|---|---:|---:|---:|---:|---:|
| 1999–2000 | 2,977 | 2,457 | 520 | 506 | 14 |
| 2001–2002 | 3,515 | 2,921 | 594 | 520 | 74 |
| 2003–2004 | 3,194 | 2,608 | 586 | 564 | 22 |
| **Total** | **9,686** | **7,986** | **1,700 (17.6%)** | 1,590 | 110 |

NCHS, in its FAQ on these files: "because the missingness is directly related to the outcome, you
should expect the cases with complete data to differ from the cases with imputed values". Its
preferred approach is to "analyze EACH OF THE FIVE datasets separately using methods and software
that are appropriate for survey data".

How serious is this selection for (a) the population the model represents, and (b) the cross-era
comparison that leave-one-cycle-out depends on? Should the early cycles move to the five-imputation
approach, which amendment 1 considered and rejected, before anything else happens?

### D. Evidential weight and the holdout

**Q10. Forking paths.** Attempt 4 was designed after seeing attempt 3 under-cover women, and it was
evaluated on the same five cycles. It is the fourth width rule declared (W1, W2, S1, S2), and the
last one passed. Each rule was committed before its own result (§3), but the set of rules grew in
response to results. How much weight does the leave-one-cycle-out pass carry, and what should a
confirmatory test look like?

**Q11. The holdout design.** 2015–2016 is the only unread cycle on the source list. Read once, it
reduces the per-cycle criterion to that one cycle's subgroups, the same shape of test that failed
attempt 1. According to NCHS documentation, it used the same scanner and software as 2011–2014 (§4),
so it tests transfer within the later era, not across eras. Is one cycle adequate? Should
2005–2006, unread and from the early era, have a role, and if so, which?

### E. Scope

**Q12. Supported input ranges.** The frozen attempt-1 artifact accepts weight 30–300 kg, height
120–220 cm and waist 50–200 cm. The development cohort spans weight 32.8–188.5 kg, height
133.0–195.1 cm and waist 55.5–176.0 cm. Early cycles reach only 141.8 kg (§4). Should the supported
ranges be narrowed to the training data, and should the upper weight range count as supported for
early-era-style populations at all?

**Q13. Pooling across scanner eras.** The development cycles span two scanner generations (§4).
Under S1, women's misses in 1999–2000 fell mostly on the estimate-too-low side, while in 2011–2014
they fell mostly on the estimate-too-high side. Is pooling across eras appropriate for a single
model, or should era be treated as a shift the interval must be shown to survive?

---

## 3. The record: every rule before its result

Commit order in `main`'s history is the evidence. The reviewer can check it with
`git log --format='%h %cI %s' -- research/`.

| Stage | Commit | Time (2026-09-12, −04:00) | What |
|---|---|---|---|
| Research question frozen | `cf03412` | 14:04 | Preregistration committed before any analysis dataset existed |
| Amendment 1 | `cf16252` | 14:12 | Imputation replicates: measured only |
| Amendment 2 | `70498bf` | 14:28 | Population narrowed to 18–59 (no DXA above 59 after 2004) |
| Amendment 3 | `4289ecb` | 14:39 | How "valid DXA" and "pregnant" are tested |
| Cohort built | `7fa5556` | — | 14,295 development participants |
| Amendment 4 | `985d0a1` | 15:03 | Per-subgroup bias limit, **added with baseline results in hand** (it says so, and it tightens) |
| Candidates | `e38fec6` | 15:32 | Calibration-partition comparison |
| B+ frozen | `e5765bc` | 15:56 | Artifact frozen before the holdout read |
| Holdout read | `15c59e6` | 16:16 | Attempt 1: not released |
| Amendment 5 | `b6f2ac0` | 16:56 | Attempt 2 declared before fitting |
| Attempt 2 | `c0eecbe` | 17:11 | Calibration only |
| Amendment 6 | `e44ab90` | 17:41 | Attempt 3 declared before any interval existed |
| Attempt 3 | `4d918ab` | 17:50 | Leave one cycle out: failed |
| Amendment 7 | `d2bb277` | 17:53 | Attempt 4 declared before any per-sex width existed |
| Attempt 4 | `6f25600` | 18:20 | Leave one cycle out: S2 met every criterion |

A commit shows when a rule was written down, not when an analysis first ran. Every run in this
study was executed after the commit that declared it. The reviewer has that on our account, and
the commit order is consistent with it.

---

## 4. Data and cohort

### Cycles and scanners

| Era | Cycles | Scanner and software | DXA table limit | Unusable scans | Source |
|---|---|---|---|---|---|
| Early | 1999–2000, 2001–2002, 2003–2004 (development); 2005–2006 (unread) | Hologic QDR-4500A fan-beam, as reported; software version not confirmed | 136 kg or 196 cm, as reported | Multiply imputed, five versions | A search summary of NCHS pages. The primary technical documentation is an image-only PDF that could not be read here. **To confirm against NCHS documentation.** |
| Later | 2011–2012, 2013–2014 (development); 2015–2016 (unread holdout); 2017–2018 (spent) | Hologic Discovery model A; acquisition software Apex 3.2; analysis with APEX 4.0 and the NHANES BCA option | Self-reported weight over 450 lb (204 kg) or height over 6′5″ | The region is set to missing; nothing is imputed | Quoted from the NCHS `DXX_H`, `DXX_I` and `DXX_J` documentation pages. The `DXX_J` page also contains a sentence naming the `DXX_I` file. |

The data agree with the early limit, though they don't prove it: the heaviest development
participant in each early cycle weighed 138.1, 137.2 and 141.8 kg, against 188.5 and 187.8 kg in the
later cycles.

None of the NCHS pages read for this packet say anything about comparability between the two eras.

### Cohort flow

As produced by the current code (`tools/nhanes/cohort.mjs`, measured-only policy):

| Cycle | Start | Under 18 | Over 59 | Pregnant or undetermined | No DXA record¹ | DXA unusable | Missing inputs | **Included** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1999–2000 | 9,965 | 4,517 | 1,834 | 519 | 638 | 0 | 7 | **2,450** |
| 2001–2002 | 11,039 | 5,046 | 1,872 | 535 | 665 | 0 | 11 | **2,910** |
| 2003–2004 | 10,122 | 4,502 | 1,901 | 445 | 666 | 0 | 15 | **2,593** |
| 2011–2012 | 9,756 | 3,892 | 1,791 | 142 | 104 | 862 | 9 | **2,956** |
| 2013–2014 | 10,175 | 4,062 | 1,841 | 159 | 86 | 630 | 11 | **3,386** |
| **Development** | | | | | | | | **14,295** |

¹ In 1999–2004 this column includes the 520, 594 and 586 participants removed by the measured-only
rule (Q9). The imputation step runs before the exclusions, so the flow's own "imputed" step always
reads zero.

**A record that disagrees with the code:** the cohort table in `research/NHANES-DATA-STRUCTURE.md`
gives different intermediate counts for 1999–2000 — under 18 4,409; over 59 1,668; pregnant 480; no
DXA 601; imputed 350 — while agreeing on the 2,450 included. The table above is what the code
produces today. The 2001–2004 rows agree exactly.

> **Update, 2026-09-13, after this packet was prepared.** Both record-keeping problems in this
> section are fixed. The flow now counts early-cycle exclusions by reason:
>
> | Cycle | No DXA record | DXA unusable | Imputed |
> |---|---:|---:|---:|
> | 1999–2000 | 118 | 14 | 506 |
> | 2001–2002 | 71 | 74 | 520 |
> | 2003–2004 | 80 | 22 | 564 |
>
> `research/NHANES-DATA-STRUCTURE.md` now matches the code. Included participants, partitions and
> every result in this packet are unchanged: the cohort was fingerprinted before and after the change
> and is identical. The tables above are left as prepared, so the record shows what the reviewer
> was originally sent.

### Who is in it

| | Women | Men |
|---|---:|---:|
| 1999–2000 | 1,183 | 1,267 |
| 2001–2002 | 1,381 | 1,529 |
| 2003–2004 | 1,234 | 1,359 |
| 2011–2012 | 1,395 | 1,561 |
| 2013–2014 | 1,714 | 1,672 |

Race/ethnicity audit group (`RIDRETH1`, evaluation only): 1 = 2,925; 2 = 992; 3 = 5,857; 4 = 3,084;
5 = 1,437.

| | Min | 1st pct | Median | 99th pct | Max | Missing |
|---|---:|---:|---:|---:|---:|---:|
| Age (years) | 18 | 18 | 36 | 59 | 59 | 0 |
| Height (cm) | 133.0 | 147.7 | 168.4 | 189.2 | 195.1 | 0 |
| Weight (kg) | 32.8 | 45.5 | 76.3 | 133.3 | 188.5 | 0 |
| Waist (cm) | 55.5 | 66.4 | 92.3 | 135.8 | 176.0 | 75 |
| BMI | 13.6 | 17.51 | 26.65 | 45.9 | 69.0 | 0 |
| DXA body fat (%) | 11.5 | 14.1 | 31.7 | 50.4 | 55.5 | 0 |

| Cycle | Over 136 kg | BMI ≥ 40 (women) | Median body fat, women | Median body fat, men |
|---|---:|---:|---:|---:|
| 1999–2000 | 1 | 37 (31) | 39.6 | 26.0 |
| 2001–2002 | 1 | 38 (30) | 38.4 | 25.8 |
| 2003–2004 | 1 | 58 (52) | 39.0 | 26.4 |
| 2011–2012 | 60 | 188 (123) | 39.1 | 26.1 |
| 2013–2014 | 56 | 224 (151) | 39.0 | 27.0 |

The partitions are fixed by a hash of the participant identifier: 11,417 train, 2,878 calibration.
The 75 participants without a waist measurement are refused by B+ and receive no interval.

---

## 5. The interval (amendments 6 and 7)

- **Estimate:** B+ as frozen in attempt 1, refitted within each fold on that fold's training rows.
  Fits receive only model-ready rows, which physically contain no race, identifier or design
  variable; a test holds every fit call to that.
- **Residuals:** |DXA − estimate| on a conformal set the fold's model was not fitted on.
- **Half-width:** the ⌈(n+1)·0.9⌉-th smallest residual, unbounded if n is too small. The interval
  is the estimate ± the half-width, truncated to 1–75%. An estimate outside 1–75% is refused.
- **Leave one cycle out:** for each development cycle, fit on the other four cycles' training
  partition, set the half-width on their calibration partition, and give every participant of the
  left-out cycle one interval. No participant appears in the fold that evaluates them.
- **Rules, declared in order:**
  - **W1:** one half-width, from all conformal residuals.
  - **W2:** one half-width, the largest of the pooled and each reportable subgroup's own.
  - **S1:** one half-width per sex, from that sex's residuals.
  - **S2:** per sex, the largest of that sex's pooled and each reportable within-sex subgroup's
    own.

  A group-covering rule was considered only if its race-blind counterpart failed.
- **Criteria:**
  - overall out-of-cycle coverage ≥ 90% − 2·SE
  - every reported pooled subgroup ≥ 90% − 2·SE
  - every reported subgroup in every left-out cycle ≥ 90% − 3·SE
  - B+'s half-width narrower than baseline 1's (mean by age band and sex) in every fold, and under
    amendment 7, for each sex
- **Regression check:** before any per-sex half-width was computed, the extended runner reproduced
  attempt 3 exactly. For this packet, both attempts were rerun from the locked sources, and the
  appendices are generated from those runs.

What was evaluated is not what would be frozen. Each fold's model and widths came from four cycles.
A frozen attempt-4 product would fit on all five training partitions and set its widths on all five
calibration partitions. That exact object has not been evaluated anywhere; a holdout read would be
its first evaluation.

---

## 6. Results

| Rule | Half-width (pp) | Overall coverage | Pooled subgroups below floor | Per-cycle cells below floor | Narrower than baseline 1 | |
|---|---|---|---|---|---|---|
| W1 | 5.33–5.41 | 89.2% (floor 89.5%) | 8 of 16 | 8 of 73 | yes | fail |
| W2 | 5.90–6.17 | 92.5% | 0 of 16 | 1 of 73 | yes | fail |
| S1 | women 5.56–5.67, men 4.82–5.12 | 88.9% (floor 89.5%) | 7 of 16 | 7 of 73 | yes | fail |
| **S2** | **women 6.26–6.76, men 5.56–6.17** | **93.5%** | **0 of 16** | **0 of 73** | **yes** | **meets all** |

At S2's mean half-width, an estimate of 25% would be shown as 18.5–31.5% for a woman and 19.2–30.8%
for a man.

**The bias is covered, not removed.** Under S2, RIDRETH1=4 is covered 93.2%, but its misses still
fall two to one on the estimate-too-high side: the direction attempt 1 failed on.

Full tables: Appendix A (attempt 4) and Appendix B (attempt 3).

---

## 7. Weaknesses we already know about

1. **Designed after the failure it fixes**, on the same cycles (Q10).
2. **The fourth width rule tried** (Q10).
3. **Coverage above the label**: 93.5% under "90%" (Q4).
4. **The audit variable sets most widths** (Q3).
5. **Unweighted throughout**, against §7 (Q8).
6. **Measured-only selection** in 1999–2004, against NCHS guidance (Q9). It was also hidden in the
   cohort flow; that is now fixed (§4).
7. **Era shift.** Scanner generation, the imputation regime and the body-size range all change
   between eras; women's miss direction reverses (Q13).
8. **The conformal guarantee assumes exchangeability,** and cycles are not exchangeable. W1's
   under-coverage in left-out cycles is direct evidence of that.
9. **Per-sex conformal sets are half the size**, and within-sex subgroups reach the 100 minimum less
   often (Q6).
10. **The frozen object differs from the evaluated folds** (§5).
11. **A single-cycle holdout from the same era** as two of the development cycles (Q11).
12. **Input ranges wider than the training data** (Q12).
13. **One documentation row disagreed with the code** (§4). Now fixed.

---

## 8. Reproducing everything

The NHANES files are not in the repository. `tools/nhanes/sources.lock.json` records a SHA-256 for
every file, and each tool refuses to run on bytes that do not match.

```sh
node tools/nhanes/acquire.cjs --download <dir>        # fetch from CDC and verify; or --verify <dir>
node tools/nhanes/build-cohort.cjs --data <dir>       # cohort flow; participant-level output stays in <dir>
node tools/nhanes/run-baselines.cjs --data <dir>
node tools/nhanes/run-candidates.cjs --data <dir>
node tools/nhanes/run-intervals.cjs --data <dir> --attempt 3
node tools/nhanes/run-intervals.cjs --data <dir> --attempt 4
node --test "tests/nhanes-*.test.cjs"
```

- **Determinism:** every fit is deterministic: no subsampling, no random initialisation, no seed.
  Runs used Node 24.18.0.
- **The holdout stays unread:** none of the commands above loads 2015–2016. `build-cohort.cjs`
  builds the holdout only when given `--include-holdout`, a flag reserved for the release decision.
  Cycle roles come from `sources.json` through `tools/nhanes/roles.mjs`, and tests hold every tool
  to that.
- **Runtime:** each leave-one-cycle-out run fits ten models, and on the machine used here took from
  several minutes to over half an hour.

---

## 9. What each answer leads to

- **The reviewer rejects an interval product in principle (Q1)** → the study stops. Attempt 1's
  not-released result stands, with three documented attempts after it.
- **The reviewer requires weighting or five-imputation handling (Q8, Q9)** → those analyses are
  declared in an amendment before they run. Attempts 3 and 4 are re-evaluated under them, and
  nothing is frozen until they are.
- **The reviewer accepts the product and the thresholds** → S2 is frozen on the full development
  data. 2015–2016 is read once against amendment 7's criteria, with the holdout design settled by Q11.
- **Any release still carries §9's limits:** approximation of NHANES DXA in adults 18–59, and
  nothing about DEXA equivalence, clinical validity, children or a photo scan.

## Appendix A — Attempt 4 (amendment 7), full results

Regenerated for this packet with `node tools/nhanes/run-intervals.cjs --data <dir> --attempt 4`. Every table below is built from that run's JSON output, not retyped.

### A.1 Half-widths by fold (percentage points)

| Left-out cycle | B+ S1 female | B+ S1 male | B+ S2 female | B+ S2 male | baseline 1 S1 female | baseline 1 S1 male | baseline 1 S2 female | baseline 1 S2 male |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1999-2000 | 5.57 | 5.06 | 6.76 | 5.82 | 10.24 | 9.95 | 12.51 | 10.54 |
| 2001-2002 | 5.67 | 5.11 | 6.73 | 5.83 | 10.15 | 10.15 | 12.54 | 10.94 |
| 2003-2004 | 5.64 | 5.07 | 6.60 | 5.73 | 10.14 | 9.99 | 12.46 | 15.53 |
| 2011-2012 | 5.56 | 5.12 | 6.30 | 5.56 | 10.54 | 9.93 | 12.74 | 10.51 |
| 2013-2014 | 5.64 | 4.82 | 6.26 | 6.17 | 10.53 | 10.09 | 12.60 | 10.99 |

Width set by (group-covering rules):

- S2, 1999-2000: female: raceEthnicityAudit RIDRETH1=5; male: raceEthnicityAudit RIDRETH1=5
- S2, 2001-2002: female: raceEthnicityAudit RIDRETH1=5; male: raceEthnicityAudit RIDRETH1=5
- S2, 2003-2004: female: raceEthnicityAudit RIDRETH1=5; male: ageBand 50-59
- S2, 2011-2012: female: raceEthnicityAudit RIDRETH1=5; male: ageBand 50-59
- S2, 2013-2014: female: bmiBand 18.5-24.9; male: raceEthnicityAudit RIDRETH1=5

### A.2 Criteria

| Rule | Criterion | Result | |
|---|---|---|---|
| S1 | Overall out-of-cycle coverage ≥ 90% − 2·SE | 88.9% vs 89.5% | **fail** |
| S1 | Each reported subgroup, pooled, ≥ 90% − 2·SE | ageBand 50-59 87.9%; sex female 87.7%; bmiBand 18.5-24.9 88.5%; bmiBand 35 and over 87.6%; raceEthnicityAudit RIDRETH1=3 88.4%; raceEthnicityAudit RIDRETH1=4 88.4%; raceEthnicityAudit RIDRETH1=5 87.0% | **fail** |
| S1 | Each subgroup in each left-out cycle ≥ 90% − 3·SE | 7 of 73 cells below | **fail** |
| S1 | Narrower than baseline 1 in every fold, per sex | female 5.57 vs 10.24 / male 5.06 vs 9.95, female 5.67 vs 10.15 / male 5.11 vs 10.15, female 5.64 vs 10.14 / male 5.07 vs 9.99, female 5.56 vs 10.54 / male 5.12 vs 9.93, female 5.64 vs 10.53 / male 4.82 vs 10.09 | pass |
| S2 | Overall out-of-cycle coverage ≥ 90% − 2·SE | 93.5% vs 89.5% | pass |
| S2 | Each reported subgroup, pooled, ≥ 90% − 2·SE | all pass | pass |
| S2 | Each subgroup in each left-out cycle ≥ 90% − 3·SE | 0 of 73 cells below | pass |
| S2 | Narrower than baseline 1 in every fold, per sex | female 6.76 vs 12.51 / male 5.82 vs 10.54, female 6.73 vs 12.54 / male 5.83 vs 10.94, female 6.60 vs 12.46 / male 5.73 vs 15.53, female 6.30 vs 12.74 / male 5.56 vs 10.51, female 6.26 vs 12.60 / male 6.17 vs 10.99 | pass |

Decision recorded by the runner: S2 meets every criterion.

### A.3 S2 — per sex, group-covering: pooled out-of-cycle coverage

Overall: n 14220, coverage 93.5%, floor 89.5%, misses too high / too low 435 / 496 — pass

| Subgroup | n | Coverage | Floor (2·SE) | Estimate too high | Estimate too low | |
|---|---:|---:|---:|---:|---:|---|
| ageBand 18-29 | 5068 | 93.8% | 89.2% | 133 | 179 | pass |
| ageBand 30-39 | 3127 | 93.5% | 88.9% | 95 | 107 | pass |
| ageBand 40-49 | 3308 | 93.3% | 89.0% | 111 | 110 | pass |
| ageBand 50-59 | 2717 | 92.8% | 88.8% | 96 | 100 | pass |
| sex female | 6856 | 92.7% | 89.3% | 254 | 244 | pass |
| sex male | 7364 | 94.1% | 89.3% | 181 | 252 | pass |
| bmiBand 18.5-24.9 | 5084 | 93.0% | 89.2% | 157 | 198 | pass |
| bmiBand 25.0-29.9 | 4668 | 94.2% | 89.1% | 123 | 149 | pass |
| bmiBand 30.0-34.9 | 2585 | 93.2% | 88.8% | 83 | 93 | pass |
| bmiBand 35 and over | 1546 | 93.1% | 88.5% | 59 | 48 | pass |
| bmiBand under 18.5 | 337 | 93.8% | 86.7% | 13 | 8 | pass |
| raceEthnicityAudit RIDRETH1=1 | 2913 | 95.0% | 88.9% | 50 | 97 | pass |
| raceEthnicityAudit RIDRETH1=2 | 990 | 94.0% | 88.1% | 32 | 27 | pass |
| raceEthnicityAudit RIDRETH1=3 | 5825 | 93.2% | 89.2% | 163 | 234 | pass |
| raceEthnicityAudit RIDRETH1=4 | 3067 | 93.2% | 88.9% | 145 | 63 | pass |
| raceEthnicityAudit RIDRETH1=5 | 1425 | 91.6% | 88.4% | 45 | 75 | pass |

### A.4 S2 — per sex, group-covering: every subgroup in every left-out cycle, closest to its floor first

73 cells reported, 0 below the 3·SE floor; 7 cells under 100 and not reported (1999-2000 bmiBand under 18.5 n 53; 2001-2002 bmiBand under 18.5 n 82; 2003-2004 bmiBand under 18.5 n 66; 2011-2012 bmiBand under 18.5 n 72; 2013-2014 bmiBand under 18.5 n 64; 1999-2000 raceEthnicityAudit RIDRETH1=5 n 92; 2003-2004 raceEthnicityAudit RIDRETH1=2 n 95).

| Cycle | Subgroup | n | Coverage | Floor (3·SE) | Too high | Too low | |
|---|---|---:|---:|---:|---:|---:|---|
| 2011-2012 | raceEthnicityAudit RIDRETH1=4 | 767 | 89.8% | 86.8% | 64 | 14 | pass |
| 2011-2012 | sex male | 1556 | 91.4% | 87.7% | 85 | 49 | pass |
| 2011-2012 | bmiBand 30.0-34.9 | 544 | 90.3% | 86.1% | 42 | 11 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=5 | 536 | 90.3% | 86.1% | 25 | 27 | pass |
| 2011-2012 | ageBand 18-29 | 977 | 91.4% | 87.1% | 52 | 32 | pass |
| 1999-2000 | sex female | 1180 | 92.0% | 87.4% | 16 | 78 | pass |
| 2011-2012 | bmiBand 18.5-24.9 | 968 | 91.8% | 87.1% | 45 | 34 | pass |
| 2013-2014 | sex female | 1692 | 92.6% | 87.8% | 97 | 29 | pass |
| 2011-2012 | sex female | 1380 | 92.3% | 87.6% | 73 | 33 | pass |
| 2013-2014 | bmiBand 18.5-24.9 | 1087 | 92.2% | 87.3% | 46 | 39 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=3 | 1335 | 92.6% | 87.5% | 55 | 44 | pass |
| 2011-2012 | ageBand 50-59 | 660 | 91.7% | 86.5% | 36 | 19 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=3 | 1027 | 92.7% | 87.2% | 44 | 31 | pass |
| 2011-2012 | ageBand 40-49 | 627 | 92.0% | 86.4% | 35 | 15 | pass |
| 2011-2012 | bmiBand 25.0-29.9 | 928 | 92.7% | 87.0% | 46 | 22 | pass |
| 2011-2012 | bmiBand 35 and over | 424 | 91.3% | 85.6% | 25 | 12 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=3 | 1214 | 93.2% | 87.4% | 24 | 59 | pass |
| 2003-2004 | sex female | 1227 | 93.2% | 87.4% | 29 | 54 | pass |
| 2013-2014 | ageBand 30-39 | 770 | 92.6% | 86.8% | 38 | 19 | pass |
| 2013-2014 | ageBand 18-29 | 1022 | 93.1% | 87.2% | 34 | 37 | pass |
| 2011-2012 | ageBand 30-39 | 672 | 92.4% | 86.5% | 35 | 16 | pass |
| 1999-2000 | ageBand 50-59 | 409 | 91.4% | 85.5% | 7 | 28 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=3 | 928 | 93.0% | 87.0% | 12 | 53 | pass |
| 2001-2002 | sex female | 1377 | 93.5% | 87.6% | 39 | 50 | pass |
| 2003-2004 | ageBand 40-49 | 589 | 92.4% | 86.3% | 12 | 33 | pass |
| 1999-2000 | bmiBand 25.0-29.9 | 826 | 93.0% | 86.9% | 13 | 45 | pass |
| 2003-2004 | bmiBand 18.5-24.9 | 950 | 93.3% | 87.1% | 23 | 41 | pass |
| 2001-2002 | ageBand 40-49 | 696 | 93.0% | 86.6% | 18 | 31 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=1 | 788 | 93.3% | 86.8% | 3 | 50 | pass |
| 2013-2014 | sex male | 1663 | 94.3% | 87.8% | 46 | 49 | pass |
| 1999-2000 | ageBand 18-29 | 949 | 93.7% | 87.1% | 11 | 49 | pass |
| 1999-2000 | bmiBand 18.5-24.9 | 952 | 93.7% | 87.1% | 13 | 47 | pass |
| 2001-2002 | bmiBand 18.5-24.9 | 1127 | 94.1% | 87.3% | 30 | 37 | pass |
| 2003-2004 | ageBand 50-59 | 419 | 92.4% | 85.6% | 7 | 25 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=3 | 1321 | 94.3% | 87.5% | 28 | 47 | pass |
| 2013-2014 | ageBand 50-59 | 715 | 93.6% | 86.6% | 32 | 14 | pass |
| 2003-2004 | sex male | 1354 | 94.5% | 87.6% | 17 | 57 | pass |
| 2003-2004 | bmiBand 30.0-34.9 | 496 | 92.9% | 86.0% | 5 | 30 | pass |
| 1999-2000 | ageBand 30-39 | 539 | 93.1% | 86.1% | 7 | 30 | pass |
| 2013-2014 | bmiBand 35 and over | 519 | 93.1% | 86.0% | 29 | 7 | pass |
| 1999-2000 | sex male | 1265 | 94.6% | 87.5% | 16 | 52 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=4 | 622 | 93.7% | 86.4% | 35 | 4 | pass |
| 2013-2014 | bmiBand 30.0-34.9 | 648 | 93.8% | 86.5% | 32 | 8 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=5 | 565 | 93.6% | 86.2% | 18 | 18 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=5 | 123 | 89.4% | 81.9% | 0 | 13 | pass |
| 2013-2014 | ageBand 40-49 | 848 | 94.5% | 86.9% | 39 | 8 | pass |
| 2003-2004 | ageBand 18-29 | 1028 | 94.7% | 87.2% | 20 | 34 | pass |
| 2001-2002 | bmiBand 25.0-29.9 | 1028 | 94.7% | 87.2% | 19 | 35 | pass |
| 2013-2014 | bmiBand 25.0-29.9 | 1037 | 94.8% | 87.2% | 31 | 23 | pass |
| 1999-2000 | bmiBand 30.0-34.9 | 420 | 93.6% | 85.6% | 2 | 25 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=2 | 323 | 93.2% | 85.0% | 16 | 6 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=4 | 608 | 94.6% | 86.4% | 14 | 19 | pass |
| 2001-2002 | sex male | 1526 | 95.9% | 87.7% | 17 | 45 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=4 | 599 | 94.7% | 86.3% | 17 | 15 | pass |
| 1999-2000 | ageBand 40-49 | 548 | 94.5% | 86.2% | 7 | 23 | pass |
| 2001-2002 | ageBand 30-39 | 601 | 94.8% | 86.3% | 8 | 23 | pass |
| 2001-2002 | ageBand 50-59 | 514 | 94.6% | 86.0% | 14 | 14 | pass |
| 2003-2004 | bmiBand 25.0-29.9 | 849 | 95.5% | 86.9% | 14 | 24 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=4 | 471 | 94.5% | 85.9% | 15 | 11 | pass |
| 2001-2002 | ageBand 18-29 | 1092 | 96.1% | 87.3% | 16 | 27 | pass |
| 2003-2004 | bmiBand 35 and over | 220 | 92.7% | 83.9% | 1 | 15 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=1 | 332 | 94.0% | 85.1% | 15 | 5 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=1 | 510 | 95.1% | 86.0% | 19 | 6 | pass |
| 2003-2004 | ageBand 30-39 | 545 | 95.2% | 86.1% | 7 | 19 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=5 | 109 | 90.8% | 81.4% | 2 | 8 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=1 | 742 | 96.4% | 86.7% | 7 | 20 | pass |
| 2001-2002 | bmiBand 30.0-34.9 | 477 | 95.6% | 85.9% | 2 | 19 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=1 | 541 | 95.9% | 86.1% | 6 | 16 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=2 | 274 | 94.5% | 84.6% | 10 | 5 | pass |
| 1999-2000 | bmiBand 35 and over | 194 | 94.3% | 83.5% | 1 | 10 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=2 | 166 | 94.6% | 83.0% | 2 | 7 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=2 | 132 | 94.7% | 82.2% | 2 | 5 | pass |
| 2001-2002 | bmiBand 35 and over | 189 | 96.3% | 83.5% | 3 | 4 | pass |

### A.5 S1 — per sex, race-blind: pooled out-of-cycle coverage

Overall: n 14220, coverage 88.9%, floor 89.5%, misses too high / too low 717 / 862 — **fail**

| Subgroup | n | Coverage | Floor (2·SE) | Estimate too high | Estimate too low | |
|---|---:|---:|---:|---:|---:|---|
| ageBand 18-29 | 5068 | 89.2% | 89.2% | 231 | 317 | pass |
| ageBand 30-39 | 3127 | 89.1% | 88.9% | 159 | 181 | pass |
| ageBand 40-49 | 3308 | 89.1% | 89.0% | 179 | 183 | pass |
| ageBand 50-59 | 2717 | 87.9% | 88.8% | 148 | 181 | **fail** |
| sex female | 6856 | 87.7% | 89.3% | 406 | 435 | **fail** |
| sex male | 7364 | 90.0% | 89.3% | 311 | 427 | pass |
| bmiBand 18.5-24.9 | 5084 | 88.5% | 89.2% | 250 | 336 | **fail** |
| bmiBand 25.0-29.9 | 4668 | 89.6% | 89.1% | 214 | 270 | pass |
| bmiBand 30.0-34.9 | 2585 | 89.1% | 88.8% | 138 | 144 | pass |
| bmiBand 35 and over | 1546 | 87.6% | 88.5% | 97 | 95 | **fail** |
| bmiBand under 18.5 | 337 | 89.6% | 86.7% | 18 | 17 | pass |
| raceEthnicityAudit RIDRETH1=1 | 2913 | 90.9% | 88.9% | 83 | 182 | pass |
| raceEthnicityAudit RIDRETH1=2 | 990 | 90.0% | 88.1% | 53 | 46 | pass |
| raceEthnicityAudit RIDRETH1=3 | 5825 | 88.4% | 89.2% | 275 | 399 | **fail** |
| raceEthnicityAudit RIDRETH1=4 | 3067 | 88.4% | 88.9% | 244 | 112 | **fail** |
| raceEthnicityAudit RIDRETH1=5 | 1425 | 87.0% | 88.4% | 62 | 123 | **fail** |

### A.6 S1 — per sex, race-blind: every subgroup in every left-out cycle, closest to its floor first

73 cells reported, 7 below the 3·SE floor; 7 cells under 100 and not reported (1999-2000 bmiBand under 18.5 n 53; 2001-2002 bmiBand under 18.5 n 82; 2003-2004 bmiBand under 18.5 n 66; 2011-2012 bmiBand under 18.5 n 72; 2013-2014 bmiBand under 18.5 n 64; 1999-2000 raceEthnicityAudit RIDRETH1=5 n 92; 2003-2004 raceEthnicityAudit RIDRETH1=2 n 95).

| Cycle | Subgroup | n | Coverage | Floor (3·SE) | Too high | Too low | |
|---|---|---:|---:|---:|---:|---:|---|
| 1999-2000 | sex female | 1180 | 85.1% | 87.4% | 35 | 141 | **fail** |
| 2011-2012 | raceEthnicityAudit RIDRETH1=4 | 767 | 85.3% | 86.8% | 91 | 22 | **fail** |
| 2013-2014 | sex male | 1663 | 87.0% | 87.8% | 109 | 108 | **fail** |
| 2013-2014 | bmiBand 18.5-24.9 | 1087 | 86.8% | 87.3% | 69 | 75 | **fail** |
| 2013-2014 | raceEthnicityAudit RIDRETH1=3 | 1335 | 87.0% | 87.5% | 99 | 74 | **fail** |
| 1999-2000 | ageBand 50-59 | 409 | 85.1% | 85.5% | 10 | 51 | **fail** |
| 2013-2014 | ageBand 30-39 | 770 | 86.5% | 86.8% | 72 | 32 | **fail** |
| 2001-2002 | sex female | 1377 | 87.7% | 87.6% | 69 | 101 | pass |
| 2013-2014 | ageBand 18-29 | 1022 | 87.4% | 87.2% | 55 | 74 | pass |
| 2011-2012 | bmiBand 35 and over | 424 | 86.1% | 85.6% | 40 | 19 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=3 | 928 | 87.7% | 87.0% | 23 | 91 | pass |
| 2003-2004 | sex female | 1227 | 88.1% | 87.4% | 53 | 93 | pass |
| 2011-2012 | sex female | 1380 | 88.3% | 87.6% | 109 | 52 | pass |
| 2011-2012 | bmiBand 30.0-34.9 | 544 | 86.9% | 86.1% | 57 | 14 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=5 | 536 | 86.9% | 86.1% | 29 | 41 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=3 | 1321 | 88.4% | 87.5% | 53 | 100 | pass |
| 2011-2012 | ageBand 18-29 | 977 | 88.0% | 87.1% | 67 | 50 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=4 | 622 | 87.3% | 86.4% | 67 | 12 | pass |
| 2011-2012 | sex male | 1556 | 88.7% | 87.7% | 105 | 71 | pass |
| 2003-2004 | ageBand 40-49 | 589 | 87.3% | 86.3% | 23 | 52 | pass |
| 1999-2000 | bmiBand 25.0-29.9 | 826 | 87.9% | 86.9% | 24 | 76 | pass |
| 2003-2004 | ageBand 50-59 | 419 | 86.6% | 85.6% | 13 | 43 | pass |
| 2013-2014 | sex female | 1692 | 88.9% | 87.8% | 140 | 48 | pass |
| 1999-2000 | ageBand 18-29 | 949 | 88.3% | 87.1% | 27 | 84 | pass |
| 1999-2000 | bmiBand 18.5-24.9 | 952 | 88.3% | 87.1% | 30 | 81 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=5 | 565 | 87.6% | 86.2% | 28 | 42 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=1 | 788 | 88.2% | 86.8% | 5 | 88 | pass |
| 2011-2012 | bmiBand 18.5-24.9 | 968 | 88.6% | 87.1% | 57 | 53 | pass |
| 1999-2000 | ageBand 30-39 | 539 | 87.8% | 86.1% | 15 | 51 | pass |
| 2013-2014 | bmiBand 30.0-34.9 | 648 | 88.1% | 86.5% | 61 | 16 | pass |
| 2003-2004 | bmiBand 18.5-24.9 | 950 | 88.8% | 87.1% | 42 | 64 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=3 | 1214 | 89.2% | 87.4% | 39 | 92 | pass |
| 2013-2014 | bmiBand 25.0-29.9 | 1037 | 89.1% | 87.2% | 62 | 51 | pass |
| 2011-2012 | ageBand 50-59 | 660 | 88.5% | 86.5% | 54 | 22 | pass |
| 2013-2014 | ageBand 40-49 | 848 | 88.9% | 86.9% | 70 | 24 | pass |
| 2011-2012 | ageBand 30-39 | 672 | 88.7% | 86.5% | 47 | 29 | pass |
| 2013-2014 | bmiBand 35 and over | 519 | 88.2% | 86.0% | 50 | 11 | pass |
| 2001-2002 | bmiBand 25.0-29.9 | 1028 | 89.6% | 87.2% | 40 | 67 | pass |
| 2013-2014 | ageBand 50-59 | 715 | 89.1% | 86.6% | 52 | 26 | pass |
| 2001-2002 | bmiBand 18.5-24.9 | 1127 | 89.8% | 87.3% | 52 | 63 | pass |
| 2001-2002 | ageBand 40-49 | 696 | 89.2% | 86.6% | 28 | 47 | pass |
| 2001-2002 | ageBand 50-59 | 514 | 88.7% | 86.0% | 19 | 39 | pass |
| 2011-2012 | ageBand 40-49 | 627 | 89.2% | 86.4% | 46 | 22 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=3 | 1027 | 90.0% | 87.2% | 61 | 42 | pass |
| 2011-2012 | bmiBand 25.0-29.9 | 928 | 90.2% | 87.0% | 60 | 31 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=2 | 323 | 88.2% | 85.0% | 25 | 13 | pass |
| 2003-2004 | bmiBand 35 and over | 220 | 87.3% | 83.9% | 2 | 26 | pass |
| 1999-2000 | bmiBand 30.0-34.9 | 420 | 89.0% | 85.6% | 5 | 41 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=5 | 123 | 85.4% | 81.9% | 1 | 17 | pass |
| 2003-2004 | ageBand 18-29 | 1028 | 90.8% | 87.2% | 42 | 53 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=4 | 608 | 90.0% | 86.4% | 28 | 33 | pass |
| 1999-2000 | sex male | 1265 | 91.1% | 87.5% | 29 | 83 | pass |
| 2003-2004 | sex male | 1354 | 91.4% | 87.6% | 32 | 84 | pass |
| 2001-2002 | ageBand 18-29 | 1092 | 91.2% | 87.3% | 40 | 56 | pass |
| 2001-2002 | ageBand 30-39 | 601 | 90.3% | 86.3% | 18 | 40 | pass |
| 2003-2004 | bmiBand 30.0-34.9 | 496 | 90.1% | 86.0% | 10 | 39 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=4 | 471 | 90.0% | 85.9% | 27 | 20 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=4 | 599 | 90.7% | 86.3% | 31 | 25 | pass |
| 2003-2004 | bmiBand 25.0-29.9 | 849 | 91.4% | 86.9% | 28 | 45 | pass |
| 1999-2000 | bmiBand 35 and over | 194 | 88.1% | 83.5% | 1 | 22 | pass |
| 2001-2002 | sex male | 1526 | 92.3% | 87.7% | 36 | 81 | pass |
| 1999-2000 | ageBand 40-49 | 548 | 90.9% | 86.2% | 12 | 38 | pass |
| 2013-2014 | raceEthnicityAudit RIDRETH1=1 | 510 | 91.2% | 86.0% | 30 | 15 | pass |
| 2001-2002 | bmiBand 35 and over | 189 | 88.9% | 83.5% | 4 | 17 | pass |
| 1999-2000 | raceEthnicityAudit RIDRETH1=2 | 166 | 88.6% | 83.0% | 8 | 11 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=1 | 332 | 90.7% | 85.1% | 22 | 9 | pass |
| 2003-2004 | raceEthnicityAudit RIDRETH1=1 | 541 | 91.9% | 86.1% | 13 | 31 | pass |
| 2001-2002 | bmiBand 30.0-34.9 | 477 | 91.8% | 85.9% | 5 | 34 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=1 | 742 | 93.0% | 86.7% | 13 | 39 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=2 | 132 | 89.4% | 82.2% | 5 | 9 | pass |
| 2003-2004 | ageBand 30-39 | 545 | 93.4% | 86.1% | 7 | 29 | pass |
| 2001-2002 | raceEthnicityAudit RIDRETH1=5 | 109 | 89.0% | 81.4% | 3 | 9 | pass |
| 2011-2012 | raceEthnicityAudit RIDRETH1=2 | 274 | 92.7% | 84.6% | 11 | 9 | pass |

## Appendix B — Attempt 3 (amendment 6), for comparison

Regenerated with `--attempt 3`.

### B.1 Half-widths by fold (percentage points)

| Left-out cycle | B+ W1 | B+ W2 | baseline 1 W1 | baseline 1 W2 |
|---|---:|---:|---:|---:|
| 1999-2000 | 5.34 | 5.94 | 10.05 | 14.01 |
| 2001-2002 | 5.41 | 5.95 | 10.15 | 13.64 |
| 2003-2004 | 5.40 | 5.90 | 10.05 | 13.26 |
| 2011-2012 | 5.34 | 5.98 | 10.22 | 13.77 |
| 2013-2014 | 5.33 | 6.17 | 10.19 | 13.90 |

Width set by (group-covering rules):

- W2, 1999-2000: raceEthnicityAudit RIDRETH1=5
- W2, 2001-2002: ageBand 50-59
- W2, 2003-2004: raceEthnicityAudit RIDRETH1=5
- W2, 2011-2012: raceEthnicityAudit RIDRETH1=5
- W2, 2013-2014: raceEthnicityAudit RIDRETH1=5

### B.2 Criteria

| Rule | Criterion | Result | |
|---|---|---|---|
| W1 | Overall out-of-cycle coverage ≥ 90% − 2·SE | 89.2% vs 89.5% | **fail** |
| W1 | Each reported subgroup, pooled, ≥ 90% − 2·SE | ageBand 40-49 88.9%; ageBand 50-59 88.0%; sex female 86.0%; bmiBand 18.5-24.9 88.6%; bmiBand 35 and over 87.9%; raceEthnicityAudit RIDRETH1=3 88.7%; raceEthnicityAudit RIDRETH1=4 88.9%; raceEthnicityAudit RIDRETH1=5 87.4% | **fail** |
| W1 | Each subgroup in each left-out cycle ≥ 90% − 3·SE | 8 of 73 cells below | **fail** |
| W1 | Narrower than baseline 1 in every fold | 5.34 vs 10.05, 5.41 vs 10.15, 5.40 vs 10.05, 5.34 vs 10.22, 5.33 vs 10.19 | pass |
| W2 | Overall out-of-cycle coverage ≥ 90% − 2·SE | 92.5% vs 89.5% | pass |
| W2 | Each reported subgroup, pooled, ≥ 90% − 2·SE | all pass | pass |
| W2 | Each subgroup in each left-out cycle ≥ 90% − 3·SE | 1 of 73 cells below | **fail** |
| W2 | Narrower than baseline 1 in every fold | 5.94 vs 14.01, 5.95 vs 13.64, 5.90 vs 13.26, 5.98 vs 13.77, 6.17 vs 13.90 | pass |

Decision recorded by the runner: no rule meets every criterion.

### B.3 W2 — one width, group-covering: pooled out-of-cycle coverage

Overall: n 14220, coverage 92.5%, floor 89.5%, misses too high / too low 475 / 593 — pass

| Subgroup | n | Coverage | Floor (2·SE) | Estimate too high | Estimate too low | |
|---|---:|---:|---:|---:|---:|---|
| ageBand 18-29 | 5068 | 92.9% | 89.2% | 155 | 206 | pass |
| ageBand 30-39 | 3127 | 92.8% | 88.9% | 100 | 124 | pass |
| ageBand 40-49 | 3308 | 92.4% | 89.0% | 118 | 134 | pass |
| ageBand 50-59 | 2717 | 91.5% | 88.8% | 102 | 129 | pass |
| sex female | 6856 | 90.0% | 89.3% | 322 | 362 | pass |
| sex male | 7364 | 94.8% | 89.3% | 153 | 231 | pass |
| bmiBand 18.5-24.9 | 5084 | 91.8% | 89.2% | 182 | 234 | pass |
| bmiBand 25.0-29.9 | 4668 | 93.4% | 89.1% | 130 | 179 | pass |
| bmiBand 30.0-34.9 | 2585 | 92.6% | 88.8% | 85 | 105 | pass |
| bmiBand 35 and over | 1546 | 91.8% | 88.5% | 61 | 65 | pass |
| bmiBand under 18.5 | 337 | 92.0% | 86.7% | 17 | 10 | pass |
| raceEthnicityAudit RIDRETH1=1 | 2913 | 93.6% | 88.9% | 58 | 129 | pass |
| raceEthnicityAudit RIDRETH1=2 | 990 | 93.6% | 88.1% | 32 | 31 | pass |
| raceEthnicityAudit RIDRETH1=3 | 5825 | 92.1% | 89.2% | 179 | 280 | pass |
| raceEthnicityAudit RIDRETH1=4 | 3067 | 92.3% | 88.9% | 160 | 75 | pass |
| raceEthnicityAudit RIDRETH1=5 | 1425 | 91.3% | 88.4% | 46 | 78 | pass |

### B.4 W1 — one width, race-blind: pooled out-of-cycle coverage

Overall: n 14220, coverage 89.2%, floor 89.5%, misses too high / too low 700 / 838 — **fail**

| Subgroup | n | Coverage | Floor (2·SE) | Estimate too high | Estimate too low | |
|---|---:|---:|---:|---:|---:|---|
| ageBand 18-29 | 5068 | 89.7% | 89.2% | 228 | 295 | pass |
| ageBand 30-39 | 3127 | 89.6% | 88.9% | 152 | 172 | pass |
| ageBand 40-49 | 3308 | 88.9% | 89.0% | 176 | 190 | **fail** |
| ageBand 50-59 | 2717 | 88.0% | 88.8% | 144 | 181 | **fail** |
| sex female | 6856 | 86.0% | 89.3% | 460 | 497 | **fail** |
| sex male | 7364 | 92.1% | 89.3% | 240 | 341 | pass |
| bmiBand 18.5-24.9 | 5084 | 88.6% | 89.2% | 252 | 326 | **fail** |
| bmiBand 25.0-29.9 | 4668 | 90.1% | 89.1% | 205 | 257 | pass |
| bmiBand 30.0-34.9 | 2585 | 89.3% | 88.8% | 132 | 144 | pass |
| bmiBand 35 and over | 1546 | 87.9% | 88.5% | 93 | 94 | **fail** |
| bmiBand under 18.5 | 337 | 89.6% | 86.7% | 18 | 17 | pass |
| raceEthnicityAudit RIDRETH1=1 | 2913 | 91.1% | 88.9% | 85 | 175 | pass |
| raceEthnicityAudit RIDRETH1=2 | 990 | 90.0% | 88.1% | 52 | 47 | pass |
| raceEthnicityAudit RIDRETH1=3 | 5825 | 88.7% | 89.2% | 266 | 394 | **fail** |
| raceEthnicityAudit RIDRETH1=4 | 3067 | 88.9% | 88.9% | 232 | 108 | **fail** |
| raceEthnicityAudit RIDRETH1=5 | 1425 | 87.4% | 88.4% | 65 | 114 | **fail** |

