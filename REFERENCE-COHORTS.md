# Reference cohorts

**No cohort is loaded.** `js/reference-cohort.mjs` can validate one, and `referencePercentile()`
will compute against one, but the repository ships zero cohort data and the parent app shows no
whole-body percentiles. This document is why.

## The blocker is not data

FM09 lists "whole-body reference cohorts" as remaining, and it is easy to read that as *we have not
got around to finding the data yet*. That is not the situation. Suitable published data exists and
is free:

- **ANSUR II (2012)** — US Army Anthropometric Survey, 6,068 subjects, 93 measurements, released by
  the US Army Natick Soldier Research Center. A US Government work, so public domain.
- **CDC / NHANES** — stature, weight, BMI and a handful of circumferences, already used for stature
  in `js/cdc-stature.js`.

Neither can be wired to our 25 outputs today, and adding them anyway would make the product worse,
not better.

## What actually blocks it: definitional equivalence

A percentile is only meaningful if the cohort measured **the same quantity the same way**.

Our 25 outputs are landmark-to-landmark distances derived from a pose model and scaled by a supplied
height. ANSUR II's measurements are tape and caliper anthropometry taken to ISO definitions by
trained operators against palpated bony landmarks. Those are different measurement procedures over
differently-defined quantities. `FITMATCH-PARITY-PLAN.md` says so directly for FM03: *metric
equivalence, physical accuracy, repeatability and population validation remain unproven.*

Run a pose-derived "wingspan" through ANSUR II's span distribution and you get a number to two
decimal places that describes nothing. It would look more authoritative than the measurement it came
from, which is the wrong direction for a number to move.

Two further mismatches, either of which is disqualifying on its own:

- **Population.** ANSUR II is serving US Army personnel, roughly ages 17–58. Parent Playbook's
  subjects are children and adolescents. There is no defensible mapping from a military adult
  distribution to a twelve-year-old.
- **Scaling.** Our outputs are already normalised by supplied height. Comparing a height-scaled
  estimate against an absolute-measurement distribution compares two different things.

## What the code does about it

`referencePercentile()` refuses any metric whose cohort has not declared an **established**
definitional equivalence, and an equivalence claim is only accepted when it names what it was
compared against and what evidence established it. `status: 'established'` on its own is an
assertion, and the gate exists to refuse assertions.

A cohort can be loaded, inspected and audited while being unusable. `usableMetrics(cohort)` returns
only the metrics that cleared the gate — for every cohort we currently know of, that is an empty
list.

It also refuses to extrapolate outside the cohort's age range, to answer for a sex the cohort does
not cover, or to accept a mismatched unit. Every percentile it does return carries the cohort's
source, citation, version, population, sample size and measurement method, so a reader six months
later can judge it instead of trusting it.

## What would unblock a cohort

For each metric, in this order:

1. **Pin the definition.** State exactly what our output measures — which landmarks, which path,
   what the scaling does. `BODY-MEASUREMENT-DICTIONARY.md` is where that belongs.
2. **Find the matching published definition**, or establish there isn't one. A near-match is not a
   match; document the difference rather than rounding it away.
3. **Run an agreement study.** Same subjects, our estimate and the reference protocol, enough of
   them, across the age and body range the product actually serves. Report bias, limits of
   agreement and failure rate — not a correlation coefficient, which can be high while the two
   measurements disagree systematically.
4. **Record the result** in the cohort's `equivalence` block: what it was compared against, what
   established it, and the maximum absolute bias observed.
5. **Only then** does that metric produce a percentile, and only for subjects the cohort represents.

Step 3 is the expensive one. It needs subjects, a trained measurer and a protocol — it is a research
activity, not an engineering task, and no amount of code substitutes for it.

## What the parent actually sees

Body Insights reads the registry rather than hard-coding a state that can go stale
(`js/reference-cohorts.js`, loaded before `js/body-insights.js`).

With the registry empty, the Body measurements section carries one explanatory line — not a
warning, because nothing is wrong — and the Growth context gains a **Population reference** card
showing an em dash and the reason. Body-length cards show their value and nothing else. The
**Height reference** card continues to show a real CDC stature percentile beside it, which is the
contrast worth having: one number has an established reference and says so, the others do not and
say that too.

The wiring is live, not a fixed message. Adding a cohort whose metric has an established
equivalence makes the card show a count, removes the explanatory line, and surfaces only the
metrics that cleared the gate — verified in a browser by pushing a probe cohort into the registry
and re-rendering: a metric marked `established` surfaced, one marked `not_established` in the same
cohort did not.

## Cross-check on the statistics

The machinery itself is verified even though nothing uses it yet. `tests/reference-cohort.test.cjs`
checks the normal CDF against published standard-normal values, checks the LMS z-score analytically
at `L=1`, at the `L=0` log limit and at a general `L`, and cross-checks one real LMS row against
`js/cdc-stature.js` — an implementation independently verified against CDC's own published P3/P50/P97
columns across all 436 rows to within 4e-6.

So when a cohort does clear the gate, the arithmetic underneath it is already known to be right. It
is the equivalence, not the mathematics, that is missing.
