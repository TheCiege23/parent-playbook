# Design handoff — Growth, maturation, and the body-scan capture

**For:** Claude Design
**From:** the build side. Everything described as "built" is live on `playbook.chimaura.com` today.
**Date:** 2026-09-06

Two things need designing. They are related and they are **not** the same feature, and the
single most important thing this document can convey is why they are kept apart.

1. **The growth read** — child-facing, built, working, and currently ugly. Needs design.
2. **The body scan** — adult-only, built as a surface with no model behind it. Needs design
   for a capture flow that a buyer will evaluate.

---

## 0. The one rule that shapes everything here

**The growth read is for children. The body scan is not, and must never look like it is.**

Body geometry taken from photographs is a **biometric identifier** for a minor under Illinois
BIPA (which carries a private right of action and per-violation statutory damages), Texas CUBI,
and Washington's My Health My Data Act. Parent Playbook does not collect it from children, and
the code refuses to — `scanAllowed()` in `js/body-scan.js` returns false below 18 no matter who
calls it.

So: **never design a screen where a child's profile and the camera appear together.** No "scan
CJ Jr." affordance, no camera icon on a child's Growth screen, no shared card that switches
subject. The two features live on different screens today (Growth vs Account & settings) and
should stay visually distinct enough that nobody has to read copy to know which is which.

If a design makes the scan look like part of the child-facing product, it fails review no matter
how good it looks.

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

---

## PART TWO — The body scan (adults only, needs design)

### What exists

`js/body-scan.js` is a complete capture surface with a documented provider adapter and **no
measurement model**. Turning photos into anthropometrics needs a children's 3D body-scan dataset
with paired ground truth; no public one exists. Rather than ship a plausible estimator, the flow
completes and then says honestly that nothing measured it.

Register a provider — one async `measure({frames, heightIn, sex, ageYears})` — and the same flow
starts producing numbers. Nothing else changes.

### The flow, as built

1. **Refusal screen** — shown when the subject is under 18 or has no date of birth. Names the
   age, explains that body geometry is a biometric identifier for a minor, and points at the
   growth read as the thing that gives the useful part from a tape measure.
2. **Consent gate** — two promises stated before anything opens the camera:
   *the photos are never saved* (in memory only, released after) and *only measurements are
   kept* (numbers a tape measure could also have produced, deletable from Growth). A registered
   provider's own notice appears here. A checkbox confirms the person is scanning themselves and
   is over 18.
3. **Four captures** — Front, Right side, Back, Left side. Each carries a pose hint. The first
   also carries the four setup rules: phone at hip height and braced, 8 feet back, plain wall and
   close-fitting clothes, same spot and light every time.
4. **Result** — measurements listed, provider confidence if given, and Save / Discard.
   Or, with no provider: *"Capture complete — nothing measured."*
   Or, on failure: framing advice, never a raw error string.

### Design needs

**The capture screens are the whole job.** Bad input is the largest error source in these
systems, so the pose guidance *is* the feature. What is needed:

- A **body outline / silhouette guide** per pose that the person aligns themselves into. Four
  variants: front, right, back, left. This is the single highest-value asset in this handoff.
- A **progress indicator** across the four shots that does not feel like a form.
- A **setup illustration** for the phone-at-hip-height, 8-feet-back arrangement. One picture
  replaces the four bullet points.
- A **review state** per shot — see it, retake it, before moving on.

**Tone.** This is a body. The design must be clinical and unglamorous — no fitness-app framing,
no before/after, no aspiration, no silhouette that implies a target shape. Closer to a tailor
than a gym.

**The refusal screen deserves real design.** A buyer evaluating this product will look at it,
and it is where the compliance posture is visible. It should read as a deliberate product
decision, not an error.

**Never design:** a body-composition or body-fat readout for anyone under 18; a comparison
between two people; a "goal" body measurement; any progress framing that implies a body should
change. Adults may compare themselves to themselves over time and that is all.

### Where it lives

Account & settings, under a **`Body scan · adults only`** section header. Not on Growth, not on
a child's profile, not in the bottom nav.

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

- [ ] No design shows a child's profile and a camera on the same screen
- [ ] No early/average/late maturity label anywhere
- [ ] No body-composition or body-fat figure for a minor, in any state
- [ ] Percentile reads as a position on a distribution, not a score, and uses no gauge or bar
- [ ] The crossing card leaves no hole when it does not fire
- [ ] The growth-spurt card's "see a doctor" line is never truncated or collapsed
- [ ] Relative age designed in both directions — youngest and oldest quartile
- [ ] Predicted adult height stays collapsed and shows a range, never a single number
- [ ] Four pose silhouettes plus one setup illustration
- [ ] The refusal screen is designed, not an error state
- [ ] Scan tone is clinical: no aspiration, no target shape, no before/after
