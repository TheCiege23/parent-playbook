# Attempt 3 — an uncertainty interval, leave one cycle out

Status: **FAILED amendment 6. Nothing frozen. 2015-2016 not read.**

Run 2026-09-12 under amendment 6 of research/NHANES-PREREGISTRATION.md, which was committed before
any interval was computed. It declared the model, the interval, two width rules and the order they
are tried in, the evaluation and the criteria. Nothing below changed any of them.

**The short version:** a race-blind 90% interval does not keep its promise in a survey cycle it has
not seen. The widest gap is by **sex**, not race. A group-covering width fixes every pooled subgroup
and then misses one cycle's women by 0.1 percentage point, in a direction that does not look like
chance. By the rule written in advance, attempt 3 fails.

## What was run

- **Model:** B+ as frozen — age, sex, height, weight and waist; 300 trees, learning rate 0.05, depth
  3, minimum leaf 20.
- **Interval:** split-conformal, symmetric, nominal 90%, with one half-width for everyone, truncated
  to 1–75%.
- **Folds:** each of the five development cycles is left out in turn. B+ and baseline 1 are fitted on
  the other four cycles' training partition, the half-width is set on their calibration partition,
  and every participant of the left-out cycle gets one interval.
- **Participants:** 14,295 in the development cohort. 14,220 received an out-of-cycle interval; the
  other 75 have no waist measurement and B+ refuses them.

## The half-widths

| Left-out cycle | B+ W1 | B+ W2 | W2 set by | Baseline 1 W1 | Baseline 1 W2 |
|---|---:|---:|---|---:|---:|
| 1999-2000 | 5.34 | 5.94 | RIDRETH1=5 | 10.05 | 14.01 |
| 2001-2002 | 5.41 | 5.95 | age 50-59 | 10.15 | 13.64 |
| 2003-2004 | 5.40 | 5.90 | RIDRETH1=5 | 10.05 | 13.26 |
| 2011-2012 | 5.34 | 5.98 | RIDRETH1=5 | 10.22 | 13.77 |
| 2013-2014 | 5.33 | 6.17 | RIDRETH1=5 | 10.19 | 13.90 |

At the mean half-width across folds, an estimate of 25% would be shown as **19.6–30.4%** under W1 or
**19.0–31.0%** under W2. The model's interval is roughly half the width of the age-and-sex
average's under either rule, so the usefulness criterion passes easily. The failures are all in
coverage.

In four folds of five, the group-covering width was set by RIDRETH1=5, not by RIDRETH1=4, the
group attempt 1 failed on.

## W1, race-blind: fails three of four

Overall out-of-cycle coverage is **89.2%** against a floor of 89.5%. Across cycles, the conformal
guarantee does not survive: a width calibrated on four survey cycles under-covers the fifth. That is
the same cycle-to-cycle shift that failed attempt 1, measured a different way.

| Pooled subgroup | n | coverage | floor | misses: estimate too high / too low | |
|---|---:|---:|---:|---:|---|
| female | 6,856 | **86.0%** | 89.3% | 460 / 497 | fails |
| male | 7,364 | 92.1% | 89.3% | 240 / 341 | |
| age 40-49 | 3,308 | 88.9% | 89.0% | 176 / 190 | fails |
| age 50-59 | 2,717 | 88.0% | 88.8% | 144 / 181 | fails |
| BMI 18.5-24.9 | 5,084 | 88.6% | 89.2% | 252 / 326 | fails |
| BMI 35 and over | 1,546 | 87.9% | 88.5% | 93 / 94 | fails |
| RIDRETH1=3 | 5,825 | 88.7% | 89.2% | 266 / 394 | fails |
| RIDRETH1=4 | 3,067 | 88.9% | 88.9% | **232 / 108** | fails |
| RIDRETH1=5 | 1,425 | 87.4% | 88.4% | 65 / 114 | fails |

The other seven reported subgroups pass. In 8 of 73 per-cycle cells coverage fell below the 3·SE
floor, and five of those eight are the women's cell for a cycle — women fall below it in every one
of the five cycles.

**The largest defect is sex.** One width cannot fit both: women's errors are wider, so women are
under-covered and men over-covered. The race/ethnicity group attempt 1 failed on is under-covered
too, by less — and its misses fall more than two to one on the side amendment 4 found, with the
estimate too high. Amendment 6 projected about 87–88% for that group; it came in at 88.9%.

## W2, group-covering: fails one of four, by one cell

| Criterion | Result | |
|---|---|---|
| Overall out-of-cycle coverage | 92.5% vs floor 89.5% | pass |
| Every pooled subgroup | all 16 reported subgroups pass; women lowest at 90.0% | pass |
| Every subgroup in every left-out cycle | **1 of 73 cells below the floor** | **fail** |
| Narrower than baseline 1 in every fold | 5.90–6.17 vs 13.26–14.01 | pass |

The failing cell is **women in 1999-2000**: n 1,180, coverage **87.3%** against a floor of 87.4%.

That margin is small enough to invite the argument that it is noise. The argument is recorded here
along with why it does not decide anything.

- **For noise:** with 73 cells tested at 3·SE, a perfectly calibrated interval would have about a 9%
  chance of at least one cell falling below its floor.
- **Against noise:** that cell's misses are **120 with the estimate too low against 30 with it too
  high**, four to one. Sampling noise does not produce that. And the direction is the opposite of
  women in 2011-2014, where under W1 the misses ran two to one or more with the estimate too high.
  Women's errors change direction between survey eras, which is a cycle effect, not a coin flip.
- **Either way:** the floor was set before the result. Moving it now, because the result landed 0.1
  below it, is exactly what the preregistration exists to prevent.

W2 also only reached its pooled result by over-covering: men at 94.8%, and the overall rate at 92.5%
against a nominal 90%. Every person's interval was widened to rescue the groups the single width
fits worst.

## What this establishes

1. **A single conformal width calibrated on some survey cycles does not keep its coverage in
   another.** Overall and by subgroup, the race-blind interval under-covers the left-out cycle.
2. **The biggest coverage problem with a single width is sex, not race.** Women's errors are wider
   than men's, and their direction shifts between survey eras.
3. **Widening for everyone nearly works, and "nearly" is not the criterion.** W2 met three of four
   criteria and missed the fourth in one cell, in a way that looks like a real shift rather than
   chance.

It does not establish that no interval could work. It establishes that these two, declared in
advance, do not.

## Where this leaves the study

Three attempts, none released:

| Attempt | What changed | Result |
|---|---|---|
| 1 | B+ with waist | Holdout read, 2017-2018: failed subgroup bias, 1.188 |
| 2 | + arm circumference | Calibration only: bias 0.865 → 0.834; not taken to a holdout |
| 3 | 90% conformal interval | Leave one cycle out: W1 failed 3 of 4; W2 failed 1 of 4 |

2015-2016 is still unread. So is 2005-2006, which was never on the source list.

**Multiplicity.** Every further attempt on these five development cycles is designed by someone who
has now seen three sets of their results. The obvious next variant — separate widths for women and
men, sex being a permitted input — was suggested by this failure, not prior to it. That does not make
it wrong. It makes 2015-2016 the only test of it that would mean anything, and it means an
amendment 7 would have to say so.

The options are the user's and the §8 reviewer's, not this document's:

1. **Stop.** The not-released result stands, now with three documented attempts behind it.
2. **Attempt 4: a width per sex.** Declared in an amendment before any width is computed, evaluated
   the same way, with the multiplicity above stated.
3. **Take W2 to the reviewer as it is.** Not as a pass. It failed. Put it in front of the reviewer
   as the closest result, with the one failing cell and its four-to-one misses. Judging whether a
   3·SE per-cycle floor is the right standard is the reviewer's job, and it cannot be done here
   after the result.
