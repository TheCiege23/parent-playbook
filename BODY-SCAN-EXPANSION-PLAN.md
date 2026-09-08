# Body scan expansion — vendor evaluation, biomechanics scope, cohort roadmap, speed/footwork scope

**Date:** 2026-09-08
**Context:** fitmatch.ai's sports-science tier (body composition, biomechanics/asymmetry, cohort
benchmarking) was proposed as a feature-parity target. This document evaluates what's actually
achievable, at what cost, and on what timeline — excluding fitmatch itself as a licensing option,
since the stated goal is to compete for a contract where fitmatch is a rival bidder, not a partner.

**⚠️ Before using this for planning: `HANDOFF-GROWTH-SCAN.md` (2026-09-06) is stale.** It states
the body scan is "adult-only" and that `scanAllowed()` "returns false below 18 no matter who
calls it." That block was retired — the live code gates on a signed release, not age (see
`js/body-scan.js`, `scanAllowed()`). Anyone briefing design or business decisions from that
document is working from out-of-date information about who the product actually serves. Worth
a follow-up pass to correct it; flagged here so it isn't compounded by this document.

---

## Part 1 — Body composition: vendor evaluation (fitmatch excluded)

### The finding that overrides everything else in this table

**Every vendor checked — including the most credible, publicly-traded one — has zero published
pediatric validation.** Their accuracy claims (DXA-equivalence, ±2–3%) are adult studies. None of
this is a "which vendor is best" problem; it's a "this whole product category has not proven
itself on a child's body" problem, and that doesn't go away by picking a different logo. Anything
built or claimed on top of an unvalidated-for-minors composition number carries real liability
regardless of whose model produced it — worth putting in front of counsel as its own question
before any licensing conversation starts, not after.

### Vendors evaluated

| Vendor | What it is | Capture | Output | Pricing (publicly found) | Pediatric validation |
|---|---|---|---|---|---|
| **Advanced Human Imaging (AHI) / BodyScan** | Publicly traded (ticker AHI), licensed SDK for iOS/Android, real MSA/licensing paperwork | Front + side photo | Lean mass, fat mass, circumferences; claims DXA-equivalence | **~€2.87/scan**, disclosed in an SEC exhibit for a bulk deal (4,000 FaceScans + 4,000 BodyScans, €22,960) — the only vendor here with a real, citable number | **Adult studies only.** No published pediatric validation found anywhere in indexed literature. |
| **Bodygram** | Established B2B platform, developer docs, primarily apparel-sizing (Body2Fit) | Front + side photo, <1 min | Measurements + a composition estimate | Not public — enterprise "contact sales" | Not found. Product framing (retail sizing) suggests it was never built or tested for this. |
| **WorkoutX** | Small/startup, self-serve credit packs, no MSA needed | Single front photo (side photo is a higher-tier add-on) | Fat %, lean mass, BMI, 14 circumferences, muscle/symmetry scores | **Published, self-serve:** $2.90/scan (trial) down to $1.50/scan (1,000-scan pack) | **None, and explicitly so.** Methodology is stated as classic adult formulas (US Navy Method, Deurenberg, Gallagher) with AI-estimated circumference inputs — the exact adult-only equations flagged as invalid for children in the earlier conversation, now confirmed as the actual method behind a real shipping product. |

### What this means for the business plan

- **If the plan needs a number today:** AHI is the defensible choice to cite — publicly traded, real disclosed pricing, adult DXA-equivalence claims from a company with SEC filings behind it, not marketing copy. Budget around **€3/scan (~$3.05) at bulk volume**, with the caveat that real enterprise pricing will involve a negotiated MSA, likely with minimums.
- **What no amount of vendor selection buys you:** a claim that's true for a child. Shipping any of these under Parent Playbook's brand without either (a) commissioning a real pediatric validation study first, or (b) carrying an explicit "not validated for users under 18" disclaimer, moves the product's actual risk position backward, not forward — for a company whose entire current differentiation is "we don't estimate what we can't back up."
- **Recommendation for counsel:** frame the ask precisely as *"can we license and ship an adult-validated body-composition SDK to a userbase that is majority minors, with what disclosure,"* not *"can we get body composition like fitmatch."* Those are different legal questions with different answers, and the first one is answerable now; the second isn't, because fitmatch's own pediatric validation status (if any) isn't publicly disclosed either.

---

## Part 2 — Biomechanics: scoped, not built

Unlike composition, this doesn't hit a data-licensing wall — it hits a **capture-modality** wall,
and the fix is architecturally straightforward because it reuses infrastructure already shipped.

### Why this one is actually buildable honestly

Vertical jump height and left/right landing symmetry are **physics and geometry**, not estimated
tissue composition:

- **Jump height** — standard flight-time method (`height = g·t² / 8`, or peak vertical
  displacement of the hip midpoint from a standing baseline). This is the same method combine
  testing and force-plate-free sports science already uses; it's published, uncontested, and
  needs no proprietary model.
- **Landing symmetry** — compare left vs. right knee flexion angle at landing, or left vs. right
  ground-contact timing. Knee angle is the angle between the hip→knee and knee→ankle vectors —
  pure geometry from the same landmark set already in use.

Both are computable from **MediaPipe Pose Landmarker in `VIDEO` running mode** — the identical,
already-integrated, already-licensed (Apache 2.0, no SMPL-style restriction) model currently
running in `IMAGE` mode for the four-photo scan. No new vendor, no new license, no new data
dependency. The gap is capture (video instead of stills) and a new analysis path, not a missing
model.

### Proposed MVP scope

**Capture:** record ~5 seconds of video while the athlete performs 3 vertical jumps, phone braced
at the same hip-height setup already used for the body scan. Same on-device promise: video is
processed and discarded, never uploaded, exactly like the existing frame handling in
`body-scan.js`.

**Consent:** this is body-movement data, not chest/waist geometry, but it's still biometric under
the same statutes (BIPA etc.) that already gate the four-photo scan — extend the existing
`biometric_consents` flow to cover a `movement_video` engine rather than building a parallel
consent system.

**Analysis (new file, e.g. `jump-measure.js`, same seam as `pose-measure.js`):**
1. Run `PoseLandmarker` in `VIDEO` mode across the recorded frames, timestamped.
2. Track hip-midpoint Y-position per frame to find takeoff and landing.
3. Flight-time → jump height.
4. Per-jump left/right knee-angle-at-landing → symmetry score (a ratio, same "ratios over
   absolutes" philosophy already used for wingspan/leg-share).
5. Same reject-rather-than-guess discipline as the existing engine: a jump the model can't track
   cleanly is dropped, not estimated.

**Result screen:** jump height (best of 3, and the trend across scans — this is a real youth
combine metric, coaches already know how to read it), plus the symmetry ratio with the same
non-alarmist framing used everywhere else in this app (a description, not a red flag).

### What's explicitly out of scope for the MVP

- Anything requiring equipment the phone can't see (cones, timing gates — rules out shuttle/agility
  drills for now).
- "Asymmetry identification" as a general diagnostic claim — landing symmetry specifically, framed
  as one data point, not an injury-risk verdict. That line matters for the same liability reasons
  as Part 1.
- Any composition or fat/muscle claim riding along with this — jump mechanics stay in the
  geometry-only lane the rest of this engine already lives in.

### Effort estimate

Comparable in size to the original body-scan build (multi-commit, the `d12b1b2` / `4b9824d`-scale
of effort): new capture UI, a new analysis file, consent-flow extension, and a result screen.
Not a quick add — worth scoping as its own multi-session build once you confirm you want to start.

---

## Part 3 — Cohort benchmarking: roadmap, not a build

This is the one item that stays a **product/legal decision**, not an engineering task, because the
blocker is data that doesn't exist yet, and building it means deliberately deciding to collect
children's data for cross-child comparison — a materially different purpose than the app's current
one-family-at-a-time architecture.

### What would actually be required, phased

| Phase | What it needs | Status |
|---|---|---|
| **0 — today** | Nothing available | This is where the product is now. Height percentile uses CDC's public dataset; nothing else has an equivalent. |
| **1 — opt-in pool** | A *new, separate* consent flow (distinct purpose from the scan/growth consent — comparison, not individual tracking), a minimum-cohort-size gate before ever showing a comparison (e.g., no percentile shown until 30+ same age/sport/position contributors exist, to avoid re-identifying a specific child in a small pool), and **explicit counsel sign-off before writing a line of code** — COPPA's treatment of aggregated/de-identified minors' data still needs a real answer, not an assumption. | Not started. Genuinely a decision, not a backlog item. |
| **2 — statistical usefulness** | Real scale — thousands of contributing families per age/sport/position band before a percentile means anything. This is gated on user growth, not engineering effort. | Not reachable by building alone. |

### The honest recommendation

Don't scope this as a build right now. If it's a genuine priority, the next step is a scoped
**legal question to counsel** — specifically: *"under what consent and de-identification model, if
any, could Parent Playbook collect and compare children's biometric measurements across families,
consistent with COPPA and the state biometric statutes already driving the rest of this product's
design?"* Whatever comes back from that determines whether Phase 1 is buildable at all, and on
what terms — building ahead of that answer risks having to unwind it.

---

---

## Part 4 — Speed & footwork: scoped, not built

Prompted by: *"can we also do video for increasing speed, catches, shooting in basketball,
defense, footwork, etc?"* This part covers only **speed and footwork** — catches, shooting and
defense are addressed separately below, because they hit a different wall than anything built so
far.

### The line that separates "buildable honestly" from "not yet"

Everything shipped in this app's movement engines (`pose-measure.js`, `jump-measure.js`) measures
**the athlete's own body against itself or against a clock** — a joint angle, a flight time, a
proportion. Nothing has ever needed to track anything *other than* the athlete. Speed and footwork
split cleanly along that same line:

- **No object to track, no real-world distance needed** → same effort tier as vertical jump.
  Buildable now.
- **A real-world distance, held to a stationary, calibrated camera** → same *category* of honest as
  vertical jump, but a materially bigger build with more ways for a parent's setup to invalidate
  the result.
- **Catches, shot makes, defensive grading** → needs the system to see and track a *ball* (and for
  basketball, a hoop), which is a different model entirely, not an extension of pose tracking. See
  below — this is not scoped here.

### Phase 1 — buildable now, same tier as vertical jump (no distance, no calibration)

Both reuse the exact pipeline `jump-measure.js` already proved out: `PoseLandmarker` in `VIDEO`
mode, sampled on a clock, landmark visibility gating, reject-rather-than-guess. New analysis file
only — no new capture UI beyond "record N seconds," no new consent category beyond extending
`biometric_consents` to another `scan_engine` value the same way `jump` was added.

- **First-step / reaction quickness.** Time from a stationary "set" position to the first frame
  hip or ankle displacement crosses a movement threshold (the same kind of threshold-crossing
  `findJumps()` already does for liftoff, applied to a horizontal or any-direction displacement
  instead of a vertical one). A duration, not a score — comparable to the athlete's own past
  sessions, not to a population.
- **Footwork cadence.** Steps (foot-strike events) per second across a fixed-duration drill —
  ladder work, quick feet in place. A rate, no distance required, same threshold-crossing method
  applied to ankle up/down cycles instead of a single liftoff/landing pair.

Neither of these needs the athlete to cover a measured distance, so neither needs the parent to do
anything beyond point the phone and record — the same "no equipment the phone can't see" bar the
jump MVP already holds itself to.

### Phase 2 — real sprint speed, bigger lift, worth naming honestly — **shipped 2026-09-08**

> One design decision changed from the original scope below, worth flagging: calibration was
> planned as tapping the start/finish line in a live preview *before* recording. That turned out to
> assume a live camera preview this app has never had — every capture here hands the screen to the
> native camera app, which owns it entirely until the recording is done. What actually shipped taps
> the two marks on the *already-recorded* clip, played back in an ordinary `<video>` element, after
> the fact. Same distance-measured-by-a-parent input, same crossing-time math, no live-preview
> overlay ever needed. See `js/sprint-measure.js` and the "CALIBRATED VIDEO" section of
> `js/sprint-scan.js`.

A true speed number (yards/sec, a 10-yard-split-style time) needs **distance ÷ time**, and time-of-
flight tricks don't apply to a body translating across the ground — there's no formula that
recovers distance from time alone the way `height = g·t²/8` recovers height. Distance has to come
from somewhere real, the same way the body scan's inch values come from a height someone measured
with a tape rather than being invented. That means:

- A **stationary** camera (panning to follow the athlete destroys the calibration).
- A **known real-world distance** between two points in frame — a parent measures it once (tape
  measure or a measuring wheel, same act as entering height for the scan) and enters the number.
- A one-time **calibration tap**: the parent marks the start and finish line's on-screen position
  in a preview frame before recording.
- Crossing-time detection: the hip midpoint's horizontal position interpolated frame-to-frame
  against the two marked lines, same sampling cadence as jump/footwork.

This is real and honest — it's the same smartphone-radar-gun pattern several consumer speed-timing
apps already use — but it is a **bigger build than Phase 1**: a new calibration step in the capture
UI, a new geometry path (pixel-distance → real-distance via the two marked points, distinct from
the height-anchored scaling `pose-measure.js` uses), and meaningfully more failure modes to design
honest rejection messaging for — camera moved mid-recording, phone not level/perpendicular to the
running line, the athlete drifting off-axis. Comparable in size to the original body-scan build,
not the smaller jump/footwork add-ons above.

### Catches, shot makes, defense — not scoped here, different capability

These all require detecting and tracking an **object** (a ball, a hoop) in addition to the
athlete's body. `PoseLandmarker` has no opinion about a ball — it isn't built to see one. Getting
this right needs a *separate* object-detection model, evaluated the same way body composition was
in Part 1: what's licensable, at what accuracy, at what cost, and — the question that mattered most
there — whether it's actually validated for the fast, low-quality, single-camera video a phone on a
sideline produces, versus the broadcast-camera conditions most sports-analytics vendors are built
and tested against. Nothing here should be assumed buildable until that evaluation happens; it's a
research question before it's an engineering one, same shape as Part 1.

### Recommendation

Build **Phase 1** (reaction time + footwork cadence) next — it's honest, it reuses everything
already shipped, and it's the same size of effort as the vertical jump build. Treat **Phase 2**
(calibrated sprint speed) as its own scoped decision once Phase 1 is live and you've seen how
parents actually use it. Treat **catches/shooting/defense** as a Part-1-style vendor/capability
evaluation, not a build, until that evaluation happens.

**Status:** Phase 1 shipped 2026-09-08. Phase 2 shipped 2026-09-08, as item 5 of the "improve this
long-term" list — offered as a second method alongside the stopwatch (sprint-scan.js), not a
replacement for it, since both save to the same metric and the same trend line. Catches/shooting/
defense remain unstarted, unchanged from the evaluation above.

---

## Summary for the business plan

| Feature | Path | Cost/timeline | Ready to build now? |
|---|---|---|---|
| Body composition | License AHI (or similar), budget ~$3/scan at volume | Vendor negotiation + integration; pediatric-validation question goes to counsel first | No — legal question first |
| Biomechanics (jump height + symmetry) | Build in-house, reuses existing MediaPipe integration | Comparable to the original scan build — a real multi-session engineering effort | **Yes, once you confirm scope** |
| Cohort benchmarking | Product/legal decision, then (maybe) a phased build | Gated on counsel's answer, then gated on user scale | No — not an engineering task yet |
| Speed/footwork — reaction time + cadence | Build in-house, reuses jump-measure pipeline, no calibration | Same tier as the jump build | **Yes, once you confirm scope** |
| Speed/footwork — calibrated sprint speed | Build in-house, new calibration step + new geometry path | Comparable to the original scan build | Not yet — scope again after Phase 1 ships |
| Catches / shooting / defense | Needs a ball/hoop object-detection model — separate capability evaluation | Unknown until that evaluation happens | No — research question first |
