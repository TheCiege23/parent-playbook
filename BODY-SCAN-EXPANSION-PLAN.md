# Body scan expansion — vendor evaluation, biomechanics scope, cohort roadmap

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

## Summary for the business plan

| Feature | Path | Cost/timeline | Ready to build now? |
|---|---|---|---|
| Body composition | License AHI (or similar), budget ~$3/scan at volume | Vendor negotiation + integration; pediatric-validation question goes to counsel first | No — legal question first |
| Biomechanics (jump height + symmetry) | Build in-house, reuses existing MediaPipe integration | Comparable to the original scan build — a real multi-session engineering effort | **Yes, once you confirm scope** |
| Cohort benchmarking | Product/legal decision, then (maybe) a phased build | Gated on counsel's answer, then gated on user scale | No — not an engineering task yet |
