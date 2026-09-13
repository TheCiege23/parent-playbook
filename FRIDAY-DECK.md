# Friday deck — source of truth

Six slides for the buyer meeting, week of September 14, 2026. This file is the content;
`friday-deck.html` renders it as a presentable deck. Rebuild the rendered deck from this file
rather than editing a presentation binary, so the evidence has one place to be wrong.

**Every number on a slide must be reproducible by a command in the speaker notes.** If a claim
cannot be re-derived on the day, it does not belong on a slide. The previous draft
(`Parent-Playbook-Friday-Draft-v21.pptx`) is stale and no longer on this machine; it cited a
36.75% score, a superseded deployment and a superseded archive.

Evidence baseline for this revision, all re-run on September 10, 2026:

| Claim | Command | Result |
| --- | --- | --- |
| Deployed build | `node tools/deployment-smoke.cjs https://playbookbp.com/` | service worker `pp-v113`, 29/29 checks, `ok: true` |
| JavaScript suite | `node --test "tests/*.test.cjs"` | 779/779 |
| Database suite | `node tests/db/run.cjs` | 321/321 on a disposable cluster built from the real migrations: 304 security cases plus a 17-case restore and deletion rehearsal |
| Buyer package | `node tools/acceptance.cjs` inside the extracted package | 7/7 checks: manifest 207/207, exclusions clean, contracts 324/324, database 321/321, signature verified, host serving |
| Archive exclusions | `node tools/package-scan.cjs <package>` | no excluded content |
| Weighted parity | `node tools/parity-progress.cjs` | 39%, 0 of 16 categories fully accepted |

---

## Slide 1 — What this is

**Body intelligence that stays attached to the athlete's journey.**

- A parent-facing four-view photo scan producing 25 provisional length and proportion outputs.
- A growth and maturity view: stature percentile against CDC 2000, PHV and maturity offset,
  predicted adult height.
- An organization side: rostered athletes, consent, an organization-scoped record with audit and
  retention, and an SDK a company can host itself.
- Deployed and reachable today at playbookbp.com on build `pp-v113`.

*Speaker notes.* Lead with the journey, not the measurement — the measurement is a feature of a
product parents already use for training, rest and schedule. Do not open on parity percentages.
If asked what is live right now, the honest answer is: capture, outputs, insights, organization
records and the SDK are live; composition is gated off and produces nothing.

---

## Slide 2 — Capability against FIT:MATCH, stated plainly

Sixteen weighted categories, scored on a fixed rubric in `tools/parity-progress.json` and rebaselined
on September 13 against FIT:MATCH's current public pages (`FITMATCH-CLAIM-MAP.md`).
**39% weighted, 39 of 100 points. Zero of sixteen categories are fully accepted.**

| Stage | Meaning | Categories |
| --- | --- | --- |
| 0.75 — deployed and demonstrated | Body-insights portal, integration and portable results, data protection and operation | FM10, FM11, FM12 |
| 0.5 — core workflow with automated checks | Guided capture, personalized 3D body, 25+ anthropometrics, PHV/maturity, predicted adult height, static asymmetry, history and repeat comparisons, presentation | FM01, FM02, FM03, FM06, FM07, FM08, FM09, FM13 |
| 0.25 — partial | Circumferences, population benchmarking, authenticated results API | FM04, FM14, FM15 |
| 0 — nothing shipped | **Body composition**, iOS and mobile embedding | FM05, FM16 |

*Speaker notes.* The weights matter more than the total. The September 13 rebaseline added three
things FIT:MATCH claims and the first rubric did not score — population benchmarking, an
authenticated results API and iOS and mobile embedding — and the total fell from 42.75% to 39% with
no stage changed. Body composition (15), circumferences (10), benchmarking (4), the results API (4)
and iOS embedding (3) are the weakest: 36 of 100 points, with 4.5 earned. Personalized 3D body is
the heaviest category (16), is only halfway and has no USDZ export. Say this before they find it.
Some of what moves the score is code — the results API, mobile embedding and avatar files — and
some is not: composition needs a licensed, DEXA-validated model, and the measurement categories need
reference studies. Rubric stages are engineering judgments, not measured accuracy, and the total is
not independently verified parity.

---

## Slide 3 — The live sequence

1. Consent check, then four guided views — front, right, back, left.
2. Automatic per-photo review: person detection, landmark visibility, frame-edge and coverage
   checks, exact-duplicate rejection.
3. On-device pose measurement returning 25 of 25 provisional outputs, with recorded wall-clock
   processing time.
4. Body Insights: outputs, bilateral pairs and differences, growth context, printable report,
   CSV and JSON export.
5. Organization view: the same record saved under an organization, reopened, exported and deleted,
   with every mutation audited and a scheduled retention date.

*Speaker notes.* Rehearse on the presentation device and browser beforehand; also rehearse a
rejected scan so a failure on the day looks like a designed path rather than a crash. Processing
time is client-recorded and includes model load on a cold run — do not present it as a benchmark
against anyone.

---

## Slide 4 — Data operation, which is the part that is actually finished

- **Tenant isolation is enforced in the database, not only in the app.** Row-level security,
  organization-admin policies, a scalar-only payload allowlist, and privileges that deny
  `TRUNCATE` to every tenant role.
- **204 executable database tests**, run against a disposable PostgreSQL cluster built by replaying
  the real 81 migrations — not assertions about SQL source text.
- **Deletion is rehearsed, not asserted**: the row goes, the deletion is audited, the audit row keeps
  no copy of the values, the scheduled sweep removes expired records, and another organization cannot
  delete yours.
- **Restore is rehearsed**: the schema dumps and restores with row-level security and table privileges
  intact — and the rehearsal damages the restored copy on purpose to prove it would notice if they
  were not.
- **Every mutation is audited**; every record carries a bounded retention date and a scheduled
  deletion sweep.
- **The buyer archive stands alone**: 207 files, checksummed, one command to verify it, and its own
  bundled migrations rebuild the schema and pass all 321 cases on a clean database.

*Speaker notes.* This is the strongest slide — it is the one claim backed by executed tests rather
than judgment. Three defects worth admitting if pressed, because finding them is the point: the
SQL payload allowlist accepted a record with a missing outputs key (NULL comparison), a provider
could register declaring zero outputs, and 51 production tables granted `TRUNCATE` to tenant roles,
which bypasses row-level security. All three were found by executing the tests and all three are
fixed and covered.

---

## Slide 5 — Real-person surface evidence, and what it is not

- One authorized adult reference set completed the full SDK flow: 25 of 25 provisional outputs and
  a rotatable experimental surface.
- Strict reconstruction found 4,770 connected body voxels plus a detached 14-voxel artifact; the
  opt-in bounded removal took out that 0.29% fragment without filling or joining geometry, and
  recorded exact counts.
- Three pose-guided plane sections were measured, with view spread recorded. At the hip plane three
  contours were found and only the unique contour containing the reconstruction axis was measured.

**What this is not:** these are clothed-surface perimeters, not validated anatomical girths.
Anatomical accuracy, repeatability, intended-phone behavior and buyer-host deployment are
unverified. No composition value has ever been produced — the provider gate reports
*Model not configured* and generates nothing.

*Speaker notes.* Say the limits out loud rather than putting them only in small type; a buyer who
discovers a limit themselves discounts everything else on the slide. Body composition requires an
owned, licensed or buyer-supplied model with DEXA training provenance and independent validation
evidence. We built the gate that would accept one and the evaluator that would score it. We have
not claimed, and will not claim, DEXA equivalence or clinical validity.

---

## Slide 6 — Where this goes, and what it needs

- **Now:** capture, 25 outputs, growth and maturity, organization records, portable SDK, deployed.
- **Next, and blocked on inputs rather than engineering:**
  - a licensed composition model plus its independent DEXA evidence — unlocks FM05, the single
    heaviest gap at 15 points;
  - an agreement study against a reference protocol — unlocks percentiles and circumference claims;
  - buyer-host acceptance and a physical-device rehearsal.
- **The product around it:** movement video, trainer and camp discovery, organization analytics.

*Speaker notes.* Close on what the buyer supplies rather than what we still owe. Population
reference comparisons are deliberately switched off: the app shows a plain explanation instead of a
percentile, because pose-derived estimates have not been shown to measure the same quantity as
tape-and-caliper anthropometry. `REFERENCE-COHORTS.md` is the long version and is worth handing over
— it demonstrates the standard being applied rather than merely described.

---

## Material limits to disclose on the day

- No validated anatomical circumference, no body-composition output, no claim of FIT:MATCH
  accuracy equivalence, no DEXA equivalence, no clinical validity.
- PHV and maturity offset are manual anthropometric estimates with real population and individual
  limits.
- Measurement dates are not scan-session identifiers; historical records lack complete provenance.
- The trainer marketplace exists in code but is disabled pending vendor and legal review.
- Assessment captures are discarded; no retained training dataset is implied.
- Intended-phone capture, buyer-host deployment, backup restore and production deletion rehearsals
  are still outstanding.
