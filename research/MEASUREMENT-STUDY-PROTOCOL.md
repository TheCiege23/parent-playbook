# Measurement study protocol — scan accuracy, repeatability and device behaviour

**Status: DRAFT for review. Nothing here is approved, and no one may be enrolled under it.**
Prepared 2026-09-13. Before anyone is enrolled, it needs three sign-offs: an institutional review board (IRB), legal counsel
for the written biometric release, and the qualified statistician who fixes the pass/fail criteria
in §9. The consent outline is `research/MEASUREMENT-STUDY-CONSENT-OUTLINE.md`.

Items in [brackets] are decisions or details for the team to fill in. They are left open on
purpose, not forgotten.

---

## 1. Why this study exists

The parity rubric (`tools/parity-progress.json`) scores 31.5 of the remaining 57.25 points in five
categories whose missing evidence is the same thing: comparison against real, independently
measured bodies, repeated, on the phones people will actually use.

| Category | Weight | Stage now | What the rubric records as unproven |
|---|---:|---:|---|
| FM02 Personalized 3D body | 20 | 0.5 | "Anatomical accuracy, repeatability across separate real captures, intended-device performance and population validation remain unproven" (its ground truth so far is synthetic) |
| FM03 25+ anthropometrics | 15 | 0.5 | Metric equivalence, physical accuracy, repeatability, population validation |
| FM04 Circumferences | 10 | 0.25 | "Tape accuracy, repeatability, intended-device and population validation remain untested" (the perimeters are experimental clothed-surface sections, not anatomical circumferences) |
| FM01 Guided four-view capture | 10 | 0.5 | Physical-device performance; capture thresholds unvalidated |
| FM08 Static asymmetry | 3 | 0.5 | Anatomical accuracy, side orientation and repeatability unvalidated |

**What the study can establish:** how far the scan's outputs sit from standard hand measurements of
the nearest comparable quantity, how much the scan varies when a person is scanned again, how much
it varies between phones, and how often capture succeeds.

**What it cannot establish**, and must never be reported as having established: that a scan output
*is* a clinical measurement; anything about body fat or body composition (no DXA is used); anything
about children (phase 1 is adults only, §3); or accuracy for populations the sample does not cover.

**The rubric does not move on enrollment or on data.** It moves only if the results meet criteria
fixed in advance (§9) and the qualified reviewer accepts them.

---

## 2. What is being measured, and against what

The scan (`ondevice-pose` provider, dictionary `body-outputs-v2`) returns up to **25 outputs**:

- **7 overall estimates:** wingspan, standing reach, shoulder width, hip joint width, ear landmark
  width, torso length and leg length.
- **9 left/right pairs:** upper arm, forearm, thigh, lower leg, arm joint path, leg joint path,
  shoulder to hip, ankle to heel and foot landmark length.

Every output is a **predicted joint or landmark distance, scaled by a height the user supplies**.
The dictionary's own definitions say several are *not* the clinical quantity with a similar name.
"Shoulder width" is "not a palpated biacromial breadth", "leg length" is "not inseam or clinical leg
length", and "thigh" is "not a measured femur length".

So the study compares each output with the **closest standard hand measurement** and reports the
difference. It does not claim the two are the same quantity. `REFERENCE-COHORTS.md` explains why
that distinction is enforced in code, and this study does not relax it.

| Scan output | Reference measurement (closest standard; [confirm with measurement lead]) | Used in accuracy criteria? |
|---|---|---|
| Wingspan | Arm span, fingertip to fingertip, arms horizontal against a wall | Yes |
| Standing reach | Standing reach height, flat-footed, dominant arm | Yes |
| Shoulder width | Biacromial breadth (anthropometer) | Yes, with the definitional caveat |
| Hip joint width | No standard counterpart (joint centres are not palpable) | No: descriptive only |
| Ear landmark width | No standard counterpart | No: descriptive only |
| Torso length | No standard counterpart (sitting height is explicitly not it) | No: descriptive only |
| Leg length | Trochanterion height | Yes, with the definitional caveat |
| Upper arm, L/R | Acromiale–radiale length | Yes |
| Forearm, L/R | Radiale–stylion length | Yes |
| Arm joint path, L/R | Sum of the two arm segment lengths | Yes |
| Thigh, L/R | Trochanterion–tibiale laterale length | Yes |
| Lower leg, L/R | Tibiale laterale–sphyrion length [confirm landmark choice] | Yes |
| Leg joint path, L/R | Sum of the two leg segment lengths | Yes |
| Shoulder to hip, L/R | Acromiale–trochanterion vertical distance | Yes, with the definitional caveat |
| Ankle to heel, L/R | No standard counterpart | No: descriptive only |
| Foot landmark length, L/R | Foot length, heel to longest toe | Yes, with the definitional caveat |

**Height.** Every output is scaled by the height the scan is given, so a wrong height makes every
number wrong. The study measures stadiometer height twice (three times if the first two differ by
more than [tolerance, e.g. 0.5 cm]) and gives the scan the mean.

**Surface sections (FM04, FM02).** The experimental 3D surface yields clothed-surface perimeters at
three pose-derived plane heights (shoulder, torso midpoint, hip). At each plane height the study
records:

- a **tape perimeter over the study garment**, at the same height, which is the like-for-like
  comparison
- an **anatomical girth**, measured by the ISAK method under or without the garment [decide], to
  measure the gap between a clothed surface and the body

**These perimeters are research data only.** Participants are not shown them, and nothing in the
product displays a girth. The standing refusal of girths stays in force unless it is separately and
explicitly lifted after the results are reviewed.

**Asymmetry (FM08).** For each left/right pair, the scan's left–right difference is compared with
the reference left–right difference from the same hand measurements. The study also records whether
the scan's sides are assigned correctly.

**Capture (FM01).** For each phone, the study records:

- capture-check pass and fail counts, with their reasons
- the number of retakes
- time from the first photo to a result
- the rate of surfaces generated, rejected and unavailable
- processing time

---

## 3. Participants

**Phase 1 is adults only (18 and over).** Scanning under-18s is legally cleared behind the consent
gate. But a validation study in children is a different protocol, with parental permission, the
child's own assent and different measurement burdens, and it should follow a successful adult phase
rather than run alongside it. Girths and body composition remain refused for minors in any phase.

| | |
|---|---|
| Target size | **[100]** adults; see §8 for why, and for the statistician's confirmation |
| Balance | About equal numbers by sex; a spread of height and BMI, recruited deliberately, not by convenience, with quotas per [height tertile / BMI band] |
| Inclusion | Aged 18 or over; able to stand unaided for 2 minutes; willing to wear the close-fitting study garment; gives written consent |
| Exclusion | Cannot hold the scan stance; a limb difference, cast or brace that prevents the reference measurements [decide whether to include descriptively]; employees of Parent Playbook [decide] |
| Optional | Self-reported race/ethnicity, **for evaluation only**, collected only with a separate consent tick and never an input to anything, the same rule as the NHANES study |

Recruitment: [channels]. Compensation: **[amount and form]**, paid in full even if someone
withdraws partway through.

---

## 4. Devices and conditions

The repository names no intended phone models, and records no real-person scan on a physical phone.
The recorded real-person runs that name a browser used Chrome on Windows. **[The team must choose the device set before enrollment.]** A defensible minimum is two
recent iPhone models on Safari and two mid-range Android models on Chrome, recorded with exact model
and OS and browser versions. The chosen set defines the population of devices the results can
speak for.

Capture follows the app's own instructions, so the study tests the product as shipped:

- phone at hip height, about 8 feet (2.4 m) back, on a tripod [or held by an assistant; decide, and
  record which]
- plain wall behind; whole body in frame from head to feet
- close-fitting clothing: the **study garment** [specify], identical for everyone
- four views (front, right, back, left), each with the app's pose hint
- the app's own capture checks decide acceptance; retakes are counted, not hidden

**Home-conditions arm [optional, decide].** A subset repeats capture in ordinary home lighting and
background, to see how far results move outside controlled conditions.

---

## 5. Visits and procedure

**Visit 1 (about [60–90] minutes).**

1. Consent (§11). Participants get time to read, ask questions and decline.
2. Change into the study garment.
3. **Reference measurements by measurer A:** stadiometer height, then every landmark-based
   measurement in §2, each taken twice (three times if the first two differ by more than [tolerance
   per measurement]). Landmarks are marked on the skin or garment with a washable marker.
4. **Inter-rater subset:** measurer B repeats the reference measurements on [30] participants,
   blinded to A's values.
5. **Scans on phone 1:** two full captures, with the participant stepping out of position and
   back between them.
6. **Scans on the other phones:** one capture each, in a randomized device order.
7. Tape perimeter over the garment, and anatomical girth, at the plane heights recorded from the
   phone-1 surface.

**Visit 2, [7–14] days later, for a subset of [30–50] (about [20] minutes).** Stadiometer height,
then two captures on phone 1, for between-day repeatability.

**Blinding.** Measurers never see scan outputs. Whoever runs the scans never sees reference values.
Outputs and reference measurements are joined only at analysis, by study ID.

**Stopping a session.** A participant can stop at any point, for any reason, and keeps their full
compensation.

---

## 6. Data handling

The study uses the product as it is built. It does not add a way to keep images.

| Data | Kept? | Where and how |
|---|---|---|
| Photos | **Never kept** | As in the product: processed in the browser and discarded; nothing uploaded, no record points at an image |
| Silhouettes and 3D surface | **Never kept** | Discarded after processing, as in the product |
| Scan outputs (scalars) | Yes | The existing scalar adult-reference record format (at most 25 measurements, capture summaries, engine and version), stored under a **study organization** separate from every real organization and real user |
| Section perimeters (scalars) | Yes | Scalar section reports only; no contour geometry |
| Reference measurements | Yes | Study dataset, keyed by study ID |
| Device, OS, browser | Yes | Study dataset |
| Age, sex; optional race/ethnicity | Yes | Study dataset; race/ethnicity only with its own consent tick |
| Name and contact details | Separately | A link key held apart from the measurements, [accessible only to the study coordinator] |

**Retention: [decide with counsel and the IRB].** The product keeps biometric measurements for 12
months and then destroys them. Illinois BIPA, Texas CUBI and Washington's My Health My Data Act do
not set that period, but they do require a published retention schedule that is honoured, and 12
months is the schedule the product publishes. Research records often have to be kept longer for
audit. Those two requirements conflict, and the
resolution must be decided before enrollment and written into the consent. One option: destroy the
identifiable link key on the product schedule, and keep only de-identified measurements for the
audit period.

**Separation from real users.** Study records never enter a real organization, and never touch the
existing real reference record (`friday-adult-reference-001`) or any family's data.

**Withdrawal.** Withdrawing deletes the participant's study records, except results already
reported in aggregate without identifiers. The consent says so plainly.

---

## 7. Analysis

The analysis plan is registered (§9) before the first participant is enrolled. The methods:

**Agreement with the reference**, for each output with a counterpart in §2:

- mean difference (bias) and 95% limits of agreement, in centimetres and as a percentage of the
  reference
- a check for proportional bias, where the difference grows with the size of the measurement
- mean absolute error
- the same, broken out by sex, height tertile and BMI band, with race/ethnicity group as an
  evaluation-only audit, as in the NHANES study

**Repeatability:**

- within-session: the two phone-1 captures on visit 1
- between-day: phone 1 on visit 1 against visit 2
- reported as technical error of measurement, intraclass correlation and minimal detectable change

**Reference quality.** Measurer A's own repeatability, and A against B on the inter-rater subset.
If the reference is noisy, part of the scan's apparent error belongs to the reference, and the
analysis has to separate the two.

**Devices.** A mixed model with device as a fixed effect and participant as a random effect, plus
agreement per device.

**Asymmetry.** Agreement between scan and reference left–right differences, and how often the scan
assigns sides wrongly.

**Capture.** Pass rate at first attempt, retakes, reasons for failure, time to result, and surface
outcomes, all per device.

**Surface sections.** Agreement between the clothed-surface perimeter and tape over the garment,
reported separately from agreement with anatomical girth. The two are never pooled.

**Missing data.** Every output a scan did not return is counted and reported by output and device,
never silently dropped.

---

## 8. Sample size — an approximation for the statistician to confirm

For limits of agreement, the 95% confidence interval on each limit is roughly ±1.96 × √(3/n) × SD
of the differences:

| n | Approximate CI on each limit of agreement |
|---:|---|
| 50 | ±0.48 × SD |
| 100 | ±0.34 × SD |
| 150 | ±0.28 × SD |

A study of [100] pins each limit to about a third of the spread of the differences. Subgroup
estimates will be far less precise than that. Intraclass correlation and device-effect precision
need a proper calculation, and **the statistician decides the final numbers**, including how many
return for visit 2 and how many get the inter-rater measurements.

---

## 9. Pass/fail criteria: fixed before enrollment

This study follows the NHANES study's discipline: criteria are written down and committed **before
any data exists**, and any later change is a dated amendment that says what was already known.

**[To be set with the statistician before enrollment]:**

- the acceptable bias and limits of agreement for each output, in cm and in %
- the acceptable within-session and between-day repeatability
- the maximum acceptable device effect
- the minimum first-attempt capture pass rate
- subgroup rules, including what happens when a subgroup fails: as in the NHANES study, a failing
  subgroup narrows the supported population and is never averaged away
- what counts as enough evidence to move each rubric category to 0.75 or to 1

No number is proposed here on purpose. A threshold chosen by the people who built the scan, before
a statistician has seen the design, is the wrong way round.

---

## 10. Ethics and legal

- **IRB:** approval by [an independent IRB] before any recruitment.
- **Biometric law:** counsel signs off the written release for Illinois BIPA, Texas CUBI and
  Washington's My Health My Data Act [and any state of recruitment]. That means a written release
  before capture, a published retention schedule, destruction on that schedule, and a withdrawal
  that takes effect immediately.
- **No health assessment:** no diagnosis, screening or health advice. Measurers are not clinicians,
  and the study makes no body-fat, composition or medical claim.
- **Physical contact:** reference measurement means locating bony landmarks by light touch. Each
  participant can ask for a measurer of a gender they are comfortable with, and a chaperone [policy].
- **What participants receive:** [decide] whether to offer them their own hand measurements. They
  are **not** given scan-derived girths, and nothing is presented as an assessment of their body.
- **Data use:** study data is never sold, never used for advertising, and never used to train a
  model without a separate consent and protocol.

---

## 11. Consent

See `research/MEASUREMENT-STUDY-CONSENT-OUTLINE.md`. It is an outline for counsel and the IRB to turn
into the actual form, and it deliberately matches what the app already promises: photos never
saved, what is measured, the retention date shown before agreeing, and immediate withdrawal.

---

## 12. Open decisions, in one place

1. Device set (§4)
2. Tripod or assistant capture; whether to run a home-conditions arm (§4)
3. The study garment (§4)
4. Sample size and the visit-2 and inter-rater subsets, with the statistician (§5, §8)
5. Reference landmark choices, with the measurement lead (§2)
6. Anatomical girth under or without the garment (§2)
7. Retention period, with counsel and the IRB (§6)
8. Compensation (§3)
9. Whether participants receive their hand measurements (§10)
10. Pass/fail criteria, with the statistician (§9)
11. Whether employees may take part (§3)
12. IRB, recruitment channels and states of recruitment (§3, §10)
