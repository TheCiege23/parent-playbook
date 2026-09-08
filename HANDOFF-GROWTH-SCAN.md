# Design handoff — Growth, maturation, and the body-scan capture

**For:** Claude Design
**From:** the build side. Everything described as "built" is live on `playbook.chimaura.com` today.
**Date:** 2026-09-06, corrected 2026-09-08 — see the note immediately below.

> **Correction, 2026-09-08.** The original version of this document described the body scan as
> adult-only and said the code "refuses" to scan a minor. That was true on the date this document
> was written and stopped being true days *before* that date — the blanket under-18 refusal was
> already retired in favour of a signed, revocable release from a parent or guardian by the time
> this was drafted (`scanAllowed()` in `js/body-scan.js` gates on consent, not age). Everything
> below is rewritten to match what's actually live. The single biggest change, if you designed
> against the original: **the scan now lives ON a child's Growth screen, deliberately** — see
> Rule 0.

Two things need designing. They are related, and since 2026-09-05 they live on the **same
screen**, for the **same child** — the design job is now less about keeping them apart and more
about making sure a parent can still tell, at a glance, that they're two different kinds of
promise.

1. **The growth read** — child-facing, built, working, and currently ugly. Needs design.
2. **The body scan** — also child-facing now (consent-gated, not age-gated), built with a real
   measurement model behind it. Needs design for a capture flow a buyer will evaluate.

---

## 0. The one rule that shapes everything here

**The body scan can measure a child now, with a parent's or guardian's signed release — but it
still promises less than a body, for everyone it measures, child or adult, and that part is not
up for redesign.**

Body geometry taken from photographs is a **biometric identifier** for a minor under Illinois
BIPA (which carries a private right of action and per-violation statutory damages), Texas CUBI,
and Washington's My Health My Data Act. Parent Playbook still doesn't collect it from a child
without one — `scanAllowed()` requires a live consent record tied to the exact release wording,
the measuring engine, and a published retention date, checked once before the camera opens and
again immediately before the photos are measured (a co-parent can revoke it from another phone
mid-scan). What changed is that this is now satisfied by **a written release** — the thing the
statutes actually ask for — instead of a blanket age refusal standing in for one.

**What did not change:** the engine still refuses girths — waist, chest, hip — and anything about
body composition, for anyone, adult or child. That line isn't age-related; it's a licensing wall
(the standard parametric body model, SMPL, isn't licensed for commercial use) and a "don't
estimate what you can't back up" decision the product holds everywhere. See `js/pose-measure.js`
for the reasoning in full.

So the design constraint is not "keep the camera away from a child's profile" anymore — it's
**"make the consent step impossible to misread."** A parent giving a release for their own child
needs visibly, deliberately different wording than an adult giving one for themselves, and the
design has to carry that weight rather than softening it now that a camera is allowed somewhere
it wasn't before.

---

## PART ONE — The growth read (child-facing, built, needs design)

### What it does

Turns a tape measure into the thing a body-scanning platform sells: population-referenced growth
interpretation and maturation-aware training. No photo, no scan, no biometric.

### The four outputs, in the order they matter to a parent

Currently they render as a stack of plain cards under a `Growing` section header on the Growth
screen. All copy below is **final and verified** — it is what ships today.

#### 1. Height-for-age percentile — the lead

> **48th percentile**
> Taller than about 48 out of every 100 boys the same age, on the CDC growth chart. It is a
> description, not a score — the 20th and the 80th are both completely normal places for a child
> to be.

Source: CDC 2000 Growth Charts, STATAGE (L, M, S by sex and age-in-months, ages 2.0–20.0).
Z = ((X/M)^L − 1) / (L·S), verified by reconstructing CDC's own P3/P50/P97 across all 436 rows
to within 4×10⁻⁶.

**Design need:** this is the most valuable number on the screen and currently looks like every
other card. It wants to feel like a position on a distribution, not a score out of 100. A
percentile is a *place*, and the design should say so — consider the curve itself as the visual,
with the child's position marked, rather than a big number. **Do not use a gauge, a dial, a
progress bar, or anything with a "full" end.** There is no good end of a growth chart.

#### 2. Percentile crossing — the signal that actually matters

> **CJ Jr. has moved from the 29th to the 48th** over 12 months. Children normally track along
> roughly the same line, so a shift this size is worth mentioning at the next check-up — usually
> it is simply a growth spurt arriving.

A steady 25th is a small child. A drop from the 60th to the 25th over a year is a conversation
with a doctor. Only fires with readings 180+ days apart and a ≥12-point move.

**Design need:** this only exists when it fires, so it must not leave a hole when it doesn't.
Two readings on a curve, an arrow, a date range. It is the one place a small chart earns its
space. Keep it calm — this is information, not an alarm, and it is often good news.

#### 3. Growth spurt — the one that changes this week

> **CJ Jr. is growing fast right now**
> 3.5″ a year over the last 12 months. Bone outruns the tendons attached to it during a stretch
> like this, so knees and heels get sore and coordination can go backwards for a while — both
> normal. The week already takes a session off rather than adding one. Pain just below the
> kneecap or at the back of the heel that lasts more than a couple of weeks is worth a doctor's
> look.

Fires at ≥3″/year. Already reduces training load in `buildProgram`.

**Design need:** this is the only card here with a *consequence*, and it should read as
reassurance plus a watch-item, never as a warning. It currently uses the app's green teach card.
It contains medical guidance ("see a doctor") that must stay legible and must not be truncated
or collapsed behind a tap.

#### 4. Relative age — the one nobody else tells parents

> **CJ Jr. is one of the youngest on the field**
> Born in the last quarter before the cut-off, so teammates can be up to 11 months older — at
> this age that's a real gap in size and coordination, and it is routinely mistaken for talent.
> Kids in this quarter get less playing time, get told they're behind, and quit. They are not
> behind. Judge the effort, not the depth chart.

Pure arithmetic on a birthdate and the league's cut-off date. No model, no reference table.

**Design need:** emotionally the most important card in the product and currently the plainest.
A twelve-month band with the child's position in it would carry this instantly. There is an
inverse version for the oldest quartile — design both; they are not the same message.

#### 5. Predicted adult height — last, and folded away

Behind a tap, as a range: **5′8″ – 6′2″**, never a single figure. Tanner mid-parental. Copy
states plainly that it is not a target and not a prediction of ability.

**Design need:** keep it subordinate. It is the flashiest number and the least useful, and the
current collapsed row is correct. Do not promote it.

### Inputs (built, needs design)

One sheet asks for: sex at birth, both birth parents' heights in inches, the child's height
today, and the league age cut-off (`MM-DD`, optional). Nothing more — every field feeds a
calculation, and asking for anything else would collect a child's data for no purpose.

**Design need:** the height field is the one people will use monthly. It deserves better than a
text input — think door-frame, shoes-off, a number that is easy to get right on a phone held in
one hand.

### What was deliberately NOT built, and must not be designed in

**The early / on-time / late maturity band.** Two independent routes were researched and both
were closed by the source literature:

- **%-of-adult-height** — the papers that reach a maturity classification route through skeletal
  age (a hand X-ray), and publish no age-by-sex cut-points for banding off the percentage.
- **Moore 2015 maturity offset** — needs no weight or photos, so it looked ideal. Its validation
  study concludes in print that predictions *"should not be used to group players by maturity
  status"*. For early maturers, **0 of 39** predictions landed within ±0.5 years.

If a design shows a child labelled early, average or late, it is showing a number the research
says not to trust. Do not design it, and if a spec asks for it, that spec is out of date.

**New since the original handoff: this same card now also renders embedded under a body-scan
result** (Part Two, step 6), not just standalone on Growth. Design it to work in both contexts —
it needs to read as complete on its own on Growth, and as a natural continuation when it appears
underneath a set of scan measurements a parent just finished looking at.

---

## PART TWO — The body scan (child- and adult-facing, consent-gated, needs design)

### What exists

`js/body-scan.js` is a complete capture surface with a **real measurement model** behind it now —
`js/pose-measure.js`, registered through the same provider seam a paid vendor would use later. It
runs entirely on-device (MediaPipe, downloaded once, cached for every scan after) and returns
**lengths only**: wingspan, standing reach, shoulder width, torso length, leg length. Never a
girth, never anything about composition, for anyone. Two of those five (leg length, torso length)
are geometrically guaranteed by the four-photo capture; the other three depend on a clearly
visible arm or both shoulders and can be missing from a given scan — the consent screen and the
result screen both say so now, rather than silently shipping fewer numbers than promised.

### The flow, as built

1. **Prerequisite checks** — the subject needs a date of birth on file (asked for, not refused,
   if missing) and a real, tape-measured height already on file. The scan works out proportions;
   it needs one true number to scale them into inches, and won't invent a default for the
   child's age.
2. **Consent gate** — shown once per policy version and engine, expires on a published retention
   date (12 months), revocable anytime from Account, effective immediately. **The wording
   branches on the subject's age.** Under 18 asks for **two separate checkboxes**: that the
   signer is the child's parent or legal guardian authorising the measurement, and that they
   understand what's collected, that nothing is uploaded, and when it's deleted. 18 and over is
   **one checkbox** — the subject consenting for themselves. These need to read as visibly
   different weights of promise, not the same layout with swapped label text.
3. **Engine preload** — new since the original handoff. A brief "Getting the camera ready…" step
   loads the on-device model *before* any photo is taken, so a phone that can't run it (no
   WebGL2, a blocked connection) says so immediately rather than after four photos of a child for
   nothing. Currently a bare spinner; needs a design pass, including its own failure state
   ("can't load the on-device scan," distinct from a bad-photo failure).
4. **Setup screen** — one diagram (phone at hip height, ~8 feet back) plus five rule pills:
   braced, distance, whole body in frame, plain wall, close-fitting clothes.
5. **Four captures** — Front, Right side, Back, Left side. Each carries a pose hint, a progress
   dial, and a review-before-advancing step (see it, retake it, or use it).
6. **Result** — the lengths that were measured, a confidence read, and (new) an honest note when
   one of the three conditional measurements didn't come through this time, and why. **Also new:**
   if the family has already entered parent heights and a height reading elsewhere, the same
   growth-read card from Part One (percentile, spurt, relative age, predicted height range) now
   loads in underneath the scan result — it is not computed from the scan itself, just surfaced
   where the parent already is instead of requiring a second trip to Growth. If that data doesn't
   exist yet, nothing extra appears; the scan result stands on its own.
   On failure: the messaging now distinguishes *why*. A bad capture (out of frame, cropped feet,
   an implausible result) reads as capture advice. A technical failure (dropped connection,
   unsupported device) says so explicitly instead of also blaming the photos.

### Design needs

**The capture screens are the whole job.** Bad input is the largest error source in these
systems, so the pose guidance *is* the feature. What is needed:

- A **body outline / silhouette guide** per pose that the person aligns themselves into. Four
  variants: front, right, back, left. This is the single highest-value asset in this handoff.
- A **progress indicator** across the four shots that does not feel like a form.
- A **setup illustration** for the phone-at-hip-height, 8-feet-back arrangement. One picture
  replaces the four bullet points.
- A **review state** per shot — see it, retake it, before moving on.

**Tone.** This is a body — a child's, most of the time now. The design must be clinical and
unglamorous — no fitness-app framing, no before/after, no aspiration, no silhouette that implies
a target shape. Closer to a tailor than a gym.

**The consent screen deserves real design, more than before, not less.** A buyer evaluating this
product will look at it, and it is where the compliance posture is visible — but it now has to
carry two different weights of promise (parent-for-child vs. adult-for-self) instead of one
refusal message. Design both states of it. It should read as a deliberate, careful product
decision, not a form.

**The engine-preload and engine-unavailable states are new and currently undesigned** — a bare
spinner and a plain text screen. Low-frequency, but the alternative to designing them is a parent
sitting on a spinner with no sense of what's happening, or hitting a technical failure that reads
like the app doesn't work.

**Never design:** a body-composition or body-fat readout for **anyone**, adult or child, in any
state; a comparison between two different people; a "goal" body measurement; any progress framing
that implies a body should change. A person — adult or, with a release, a child — may see their
own trend over time, and that is all.

### Where it lives

**On Growth, on the athlete's own profile** — the child being measured, not necessarily the
signed-in adult. Visible only to whoever can edit that athlete (owner or co-parent; a grandparent
with view-only family access sees the growth read but not the scan trigger, since giving a
release for someone else's child isn't theirs to give). Not in Account & settings, not in the
bottom nav.

---

## Tokens and idiom

Everything follows the existing component sheet — pine `#0B1F1A`/`#0E3B31`, green `#17936F`,
amber `#EFA33B`, clay `#C0603F` (`#A34E30` as small text), bone `#F6F2E9`/`#F1EDE3`, ink
`#111A15`, muted `#6C6A63`, danger `#B4451F`, placeholder `#A5A296` (empty inputs only).
Archivo 800–900 display, Public Sans body, JetBrains Mono uppercase eyebrows.

Contrast is a pairing: `#6C6A63` passes on bone and fails one step darker. Body text on dark is
`rgba(246,242,233,.75)`, never below `.55`. Everything here is read outdoors, one-handed, in
daylight.

Build as 390px phone frames. The app also has a desktop layout now — sidebar at ≥768, two
columns at ≥1180, content capped at 1180 — so note anything that should reflow differently on a
wide screen.

---

## Definition of done

- [ ] The under-18 consent screen (two checkboxes) and the 18+ consent screen (one checkbox)
      read as visibly different weights of promise, not the same layout with swapped text
- [ ] The consent screen states plainly which measurements are guaranteed every scan (leg,
      torso) and which are conditional (wingspan, reach, shoulder width)
- [ ] Engine-preload and engine-unavailable states are designed, not left as a bare spinner
- [ ] No early/average/late maturity label anywhere
- [ ] No body-composition or body-fat figure for anyone, adult or child, in any state
- [ ] Percentile reads as a position on a distribution, not a score, and uses no gauge or bar
- [ ] The crossing card leaves no hole when it does not fire
- [ ] The growth-spurt card's "see a doctor" line is never truncated or collapsed
- [ ] Relative age designed in both directions — youngest and oldest quartile
- [ ] Predicted adult height stays collapsed and shows a range, never a single number
- [ ] The Part One growth card is designed to work both standalone (Growth) and embedded
      (under a scan result)
- [ ] Four pose silhouettes plus one setup illustration
- [ ] A result that's missing a conditional measurement explains why, not just shows fewer rows
- [ ] Scan tone is clinical: no aspiration, no target shape, no before/after
