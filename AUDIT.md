# Parent Playbook — end-to-end audit

> **Current review:** See [AUDIT-2026-09-13.md](AUDIT-2026-09-13.md) for the current FITMATCH parity, youth-scan and connected parent-product audit. The material below is the original 2026-08-11 audit and its historical fix log.
**Scope:** sign-in → account creation → admin panel → child intake → training regimen
**Date:** 2026-08-11 · **Reviewed:** all 19 modules, `index.html`, `sw.js`, `vercel.json`

---

## Status — fixed in this pass

| # | Finding | Where |
|---|---|---|
| C1 | Reference data never loaded on the login path → measurement picker threw on save, raw keys everywhere, **reversed trend arrows** | `auth.js:6`, `sheets.js` |
| A1 | `?invite=` dropped by email confirmation → invited guardians created duplicate households | `auth.js:22` |
| A2 | Deleting your last athlete minted a second family and orphaned the first | `sheets.js`, `onboarding.js:32` |
| D3 | Mon and Wed scheduled the same drill | `program.js` |
| D2 ½ | **Plan now rotates week to week** instead of repeating forever; Week counter on the focus card | `program.js`, `screen-week.js` |
| B4 | Pass/Fail silently no-opped on draft applications | `admin.js` |
| B2 | Screening decisions left no audit trail | `admin.js` |
| E2 | Marketplace claimed background/SafeSport screening that isn't performed — copy corrected, then **made true** by B1 | `marketplace.js:62` |
| **B1** | **Screening enforced in the database** — no pass without evidence, no approval until all three checks are passed and in date, lapsed checks unlist the trainer, trainers can no longer self-certify | migration `b1_screening_enforcement` + `admin.js`, `trainer-onboarding.js`, `marketplace.js` |
| C8 | Unordered goals query made the weekly focus headline change at random | `screen-week.js` |
| C9/C10 | Future-dated + non-positive measurements accepted; failed saves left a dead spinner | `sheets.js` |
| E1 | No router — Back exited the app; screens weren't linkable | `shell.js`, `init.js`, `auth.js` |
| E3 | Nav buttons had no accessible labels | `shell.js` |
| E5 | `ARCHITECTURE.md` missing 4 of 19 modules | `ARCHITECTURE.md` |
| **C5** | **Practice schedule — the plan now routes *around* team practice instead of stacking on top of it** | migration + `program.js`, `onboarding.js`, `sheets.js`, `screen-week.js`, `screen-profile.js` |
| **C3** | **Edit the athlete** — name, nickname, birthdate, hand, sport, positions, level. No more delete-and-lose-everything to fix a position | `screen-edit.js` (new), `screen-profile.js` |
| C6 | Positions showed bare codes (`ATH`, `DL`, `UTIL`) — now show the DB's full names ("Athlete / Multiple") | `onboarding.js` `posChips`, reused by the edit screen |
| — | `loadRef` cached an empty result as success — an expired session left onboarding with an empty sport list and no way forward | `reference.js` |
| **D1** *(started)* | **Content moved to a citable `drills` table**; first 6 sourced youth-football drills added. Age-6 RB pool **3 → 8** | migration + `program.js`, `reference.js` |
| **D1** *(mechanism complete)* | **Admin drill editor** — add/edit/publish content with its source, no deploy. Published rows **cannot** be uncited (CHECK constraint). Sport-agnostic curated drills now actually reach athletes. 6 more drills sourced from CDC + AAP guidance | `admin-drills.js` (new), migration + `program.js`, `screen-profile.js` |
| **D2** *(complete)* | **Session completion** — tap a day, mark it done; ✓ on the week list and an `x/y done` tally | migration + `program.js`, `screen-week.js` |
| **A2** *(complete)* | Login path fixed too — a user with no athletes but an existing household is now routed into it instead of minting a second family | `auth.js` `myFamilyId()` |

### D1 — what's done, and what deliberately isn't
A `drills` table now holds training content with `source_name` / `source_url` /
`source_note` / `reviewed_on`, RLS'd so only admins write and only published rows are
readable. `skillsFor` **merges** DB drills with the built-in library rather than replacing
it — curated drills rank first in each tier, `program.js` remains the offline fallback.

Six drills for youth football were written from **Eisenmann J & Brewer CJ, "From Flag to
Friday Night — Long-Term Athlete Development in Youth American Football," *NSCA Coach*
2019;4(5)** — covering stability and safe falling, multidirectional movement, deceleration,
bodyweight squat/hinge/push patterns, varied catching, and the two-point stance for young
linemen. Each carries a `source_note` recording exactly which part of the source it derives
from. That takes a 6-year-old RB from a 3-week loop to an 8-week non-repeating cycle.

**The 202 existing drills were NOT given citations.** Their provenance is unknown, and
stamping them with an expert source would manufacture authority the app hasn't earned.
They render with an explicit line — *"General guidance from the Parent Playbook library —
not attributed to an outside source."* Every remaining sport and age band is still in this
state; closing that is per-band sourcing work, not a code change.

### C5 — how the week is now built
`athlete_sports` gained `practice_days smallint[]` and `game_day smallint` (0=Mon..6=Sun,
range-checked). `buildProgram` takes a schedule and, when one is set, lays the week out
around it:

- practice days and game day are fixed points; the day before a game is always light
- a **weekly load budget** counts practice + games + home sessions together
  (`littles 3, youth 4, preteen 5, teen 5, older 6`) — so the more the team trains, the
  less gets added at home, down to nothing
- a hard floor of **2 full rest days**, matching the app's own published guidance
- remaining home sessions are spread as far as possible from every other hard day
- if the team's own schedule already breaks the rest floor, the plan adds nothing and
  the Week screen says so outright instead of staying quiet

With no schedule set, the original Mon/Tue/Thu + Sat template renders byte-identical, so
nothing changes for anyone who hasn't filled it in — and a prompt invites them to.

Verified in a browser: all 19 scripts execute with no console errors, rotation is
deterministic and duplicate-free across bands, back/forward restore the right tab.

### Cleanup sweep — 10 more closed
| | Finding | Fix |
|---|---|---|
| 🟠 A3 | No `<form>` anywhere — Enter never submitted | Real forms on login/signup/reset (password managers now see a login); Enter advances onboarding steps |
| 🟡 A4 | Email never validated client-side | `validEmail()` before any auth call |
| 🟡 A5 | Revoked co-parents force-marched into creating a household | `hadSharedAccess()` → a "no athletes shared with you" screen with a real choice |
| 🟡 B5 | Admin queue unbounded, no search | `limit(200)` + name/city search + an explicit "showing the oldest 200" notice |
| 🟡 B6 | Any admin error nuked the app to a reload screen | `adminError()` — inline retry, Done button still works |
| 🟡 C7 | Position-code drift failed silently | `auditPositionCodes()` console-warns on boot |
| 🟡 C8 | Goals duplicated, never completed | Existing goals shown as taken, 3-goal cap enforced, achieve (🏆) and remove on Growth |
| 🟠 D5 | Speed goals silently dropped for under-7s | Littles get "Chase & tag games"; a stated goal now ranks **above** the second skill day so a busy week can't drop it |
| 🟡 D7 | `ageBand(null)` → `'preteen'` | → `'littles'`. Unknown age gets the most conservative band, never push-ups and planks |
| 🟡 E4/E6 | Load-time code outside `init.js`; wasted cache lookup per Supabase read | `pwa.js` exports 3 functions called from `init.js`; SW returns early for cross-origin |

**Every finding in this audit is now closed.** What's left is not engineering:
- ~~**B1**~~ — decided: **the marketplace is switched off** (`MARKETPLACE_ENABLED=false`)
  until there's a screening vendor, legal review, and insurance behind it. See the end
  of this document.
- ~~**B3**~~ — done: the note reaches the trainer and a push fires on every decision
- ~~**C2**~~ — done: collected at intake, and height drives growth-spurt tempering
- ~~**C4**~~ — done: add/remove/re-prime sports, merged into one weekly load budget
- ~~**D4/D6**~~ — done: all 8 goals change the week, and level adjusts assumed team load
- **Sourcing the remaining 202 drills** in the admin editor — content work, not code.

**By design:** B7 (no UI to grant admin) · D8 (bands recompute on reload).

---

## The headline

The app is well-built for what it actually is: **a static, hand-written content library that picks 2 drills based on age + sport + position, and lays them onto a fixed Mon–Sun template.** The code quality is genuinely good — RLS-aware queries, a transactional onboarding RPC, COPPA consent capture, escaped output everywhere, real safety copy on every drill.

> ⚠️ **The paragraphs below are the original 2026-08-11 diagnosis.** Two of the three gaps have since been closed and the third is partly closed — see **Where this stands now** immediately after.

But there is a gap between that and what you described you want:

> "the app is supposed to use info it finds on the internet from experts"

**It doesn't.** There is no network call to anything except Supabase. Every drill, cue, and "when to stop" line in `js/program.js` is a hardcoded JavaScript constant (106 KB of them). There is no AI, no web search, no expert source, no citation, no update path. See **D1**.

Second gap: **the plan never changes.** Not week to week, not as your son improves. `buildProgram()` is a pure function of (age, sport, positions, one goal flag). Your 6-year-old will see the exact same Monday drill every Monday until his 7th birthday flips the age band. See **D2**.

Third: **you can't enter height or weight anywhere in the intake**, and the one screen that does accept them is **broken on page reload**. See **C1** and **C2**.

### Where this stands now

- **Gap 1 — expert sourcing:** *closed.* Content lives in a citable `drills` table, every drill shows its source to the parent, a published drill **cannot** exist without a citation, and an admin editor means adding content no longer needs a developer or a deploy. 12 drills are sourced today (CDC and AAP guidance, plus the original NSCA football set); the other 202 remain uncited, which is now **content work you can do yourself** rather than an engineering gap. See **D1**.
- **Gap 2 — the plan never changes:** *closed.* The plan rotates week to week (`weeksSince` → `buildProgram(…, week)`), sessions can be marked done, and the week routes around your team's actual practice schedule (**C5**) — the thing you originally asked for.
- **Gap 3 — height/weight:** *closed.* Recording a measurement no longer breaks on reload (**C1**), both are collected at intake, and **height now changes the plan** — a detected growth spurt takes a session out of the week and tells the parent why. Weight is recorded for the chart and deliberately drives nothing (**C2**).
- **The former blocking item, B1:** *closed.* Screening is enforced in the database — a check cannot be passed without evidence, a trainer cannot be approved until all three are passed and in date, and a lapsed check unlists them automatically. What's left is your policy call on what background-check report you accept (**B1**).

Findings are ordered by flow. ✅ = fixed · 🔴 blocking · 🟠 serious · 🟡 minor · ⚪ accepted by design.

---

## A. Sign-in & account creation
`js/auth.js`, `js/init.js`, `js/invites.js`

### ✅ A1 — Invite links are destroyed by email confirmation *(was 🔴)*
**Fixed** — `authRedirectUrl()` (`auth.js:78`) carries `?invite=` through the confirmation round-trip; only the invite token is preserved, so stale `?paid=` / `?stripe=` params don't ride along. Diagnosis below is the original.

`js/auth.js:61` sets `emailRedirectTo: location.origin + location.pathname` — **`location.search` is dropped**, and that's where `?invite=<token>` lives.

Flow that breaks:
1. You send your wife an invite link → `…/?invite=abc`
2. She taps "Create account & accept" (`js/invites.js:36`)
3. She confirms her email → returns to `…/` with **no token**
4. `boot()` finds no invite (`js/init.js:12`), sees 0 athletes, and drops her into **onboarding to create a second, separate household**

She now owns a duplicate family with a duplicate copy of your son, invisible to you. Silent, and the data is a mess to unwind.

**Fix:** carry the token through: `emailRedirectTo: location.origin + location.pathname + location.search`, or stash it in `sessionStorage` before calling `signUp` and re-read it in `boot()`.

### ✅ A2 — Deleting your last athlete orphans your household *(was 🟠)*
**Fixed, both paths** — the delete path re-enters via `addChild` on the existing `family_id` (`sheets.js:440, 457`), with a guard in `onboarding.js:32` so Back doesn't render a profile for a null athlete. The login path was closed separately: `myFamilyId()` (`auth.js:29`) is consulted in `afterLogin` (`auth.js:11`), so a user with no athletes but an existing household is routed into it instead of minting a second family.

`js/sheets.js:251` → `renderOnboarding()` → `obReset()` sets `mode:'create'` → `finishOnboarding` computes `newFamily = true` (`js/onboarding.js:237`) → **a brand-new `families` row is created**.

Your original family row, its `family_members` rows, and any co-parents you invited are orphaned. The co-parent still points at the dead household.

**Fix:** when `state.user` already has a family, route the empty state to `startAddChild()` (mode `addChild` + existing `family_id`), not `renderOnboarding()`.

### ✅ A3 — Enter key doesn't submit anything, anywhere *(was 🟠)*
**Fixed** — real `<form>` elements on login, signup, and reset (`auth.js`), so password managers now see a login and Enter submits; Enter also advances the onboarding steps.

There is no `<form>` element in the entire app (verified: 0 matches). Login, signup, password reset, and all 6 onboarding steps require a mouse/tap on the button. Typing your password and hitting Enter does nothing.

This also degrades password-manager autofill and iOS keyboard "Go".

**Fix:** wrap each auth/onboarding card in `<form onsubmit="return false">` and bind `submit` instead of `click`.

### ✅ A4 — Email is never validated before hitting the server *(was 🟡)*
**Fixed** — `validEmail()` runs before any auth call (`auth.js`).

`type="email"` only validates on native form submission — and there is no form (A3). `js/auth.js:55` checks only for non-empty. Typos go to Supabase and come back as a raw API error string via `friendlyAuthErr`'s fallthrough (`js/auth.js:93` returns `m` unchanged).

### ✅ A5 — Revoked co-parents get force-marched into creating a household *(was 🟡)*
**Fixed** — `hadSharedAccess()` (`auth.js`) routes them to a "no athletes shared with you" screen with a real choice, instead of onboarding.

`afterLogin` (`js/auth.js:3`): 0 athletes → onboarding. A grandparent whose access you revoked logs in and is told to create a child profile. There's no "you don't have access to anyone yet" state.

---

## B. Admin panel
`js/admin.js`, `js/trainer-onboarding.js`, `js/screen-profile.js:69`

### ✅ B1 — "Background check" and "SafeSport" are a checkbox with nothing behind them *(was 🔴)*
**Fixed — enforcement now lives in the database, not the client**, because this is the control that decides whether an adult is listed to other people's children.

The audit understated the problem. `tv_insert` allowed a **trainer to insert their own verification rows at any status, including `passed`** — only UPDATE was admin-gated. A trainer could self-certify their background check and the admin would see three green "Passed" pills.

Migration `b1_screening_enforcement`:

| Guard | Effect |
|---|---|
| `private.verification_evidence_ok()` | Defines what counts as evidence: identity → a document; SafeSport → certificate **and** expiry; background check → provider result (`provider`+`external_ref`, Checkr-shaped) **or** an uploaded report, plus an expiry |
| `tv_guard` trigger | Refuses `passed` without that evidence; refuses an expiry already in the past; blocks non-admins from setting any status beyond `not_started`/`pending`/`submitted`, and strips `provider`/`external_ref`/`completed_at`/`reviewed_by` from their writes |
| `tp_guard` trigger | Refuses to approve a trainer until all three checks are passed **and in date** |
| `tp_read` policy | A parent only sees an approved trainer whose screening is currently valid — expiry is enforced **live at read time**, so a lapsed check unlists the trainer with no scheduled job to fail |
| unique `(trainer_id, kind)` | The app already assumed one row per check; nothing enforced it |

Verified end-to-end against the live database inside a rolled-back transaction: trainer self-certify **blocked** · admin pass with no evidence **blocked** · admin pass with report + expiry **allowed** · approve at 1-of-3 **blocked** · approve at 3-of-3 **allowed** · listable in date `true` · listable after lapse `false`.

App layer: the admin screen now shows each check's document, expiry, and provider fields, computes `expired` the same way the database does, surfaces the database's refusal verbatim instead of a generic failure, and warns when a check was **failed on a previous submission** (resubmitting deletes and recreates the rows, so a failure would otherwise reappear as a clean "pending"). Trainers can now upload a background-check report and a SafeSport certificate with expiry dates — previously only an ID, which meant nothing could satisfy the gate.

**What this is not.** There is still no automated CRC provider integration — a human reviews a document. The `provider`/`external_ref` columns are the seam a Checkr/Sterling webhook fills; nothing else changes when you wire one up. **Decide what evidence you accept before listing anyone**; the gate is only as strong as the report an admin is willing to pass.

The original diagnosis follows. The quoted marketplace copy in it is no longer live (see E2).

`js/admin.js:100-102` renders Pass / Fail / Reset buttons for all three screening checks. But look at what evidence exists:

| Check | Evidence collected | Verification |
|---|---|---|
| Identity | ID doc upload (`trainer-onboarding.js:331`), admin views a signed URL | Human eyeball |
| **Background check** | **none** — row inserted as `status:'pending'` with no `doc_path` (`trainer-onboarding.js:332`) | **admin clicks Pass** |
| **SafeSport** | **none** — same (`trainer-onboarding.js:333`) | **admin clicks Pass** |

There is no Checkr/Sterling integration, no SafeSport registry lookup, no document upload, no expiry date, no re-screening schedule.

Meanwhile `js/marketplace.js:62` tells parents, in print, on the browse page:

> "Every listed trainer has passed identity, background, and SafeSport screening."

That statement is not backed by anything the code does. For a product that connects adults to other people's children, this is both a child-safety hole and a false-advertising exposure.

**Fix (do before any real trainer is listed):**
- Integrate an actual CRC provider (Checkr has a youth-sports tier) and store the report ID + result + expiry.
- Require a SafeSport certificate upload with an expiry date, same as `trainer_credentials`.
- Block `adminSetVerification(…,'passed')` unless the evidence row exists.
- Until then, change the marketplace copy to describe what you actually do.

### ✅ B2 — Passing/failing a screening check leaves no audit trail *(was 🟠)*
**Fixed** — `adminSetVerification` now writes `adminLog(id,'verification:'+kind+':'+status,null)` (`admin.js:224`) into `trainer_review_actions` (`admin.js:229`), with a comment recording why the row's own `reviewed_by` isn't sufficient (it's overwritten by the next admin).

`adminLog()` is called for approve, reinstate, needs_info, reject, and suspend (`js/admin.js:203, 211, 232`) — but **not** from `adminSetVerification` (`js/admin.js:186`). The only record is `reviewed_by` on the row, which is **overwritten on every change**.

So "which admin cleared this person's background check, and when" is unanswerable after a second admin touches it. That is exactly the record you'd need if something ever went wrong.

**Fix:** `await adminLog(id, 'verification_'+kind+'_'+status, null)` inside `adminSetVerification`.

### ✅ B3 — "Request more info" never reaches the trainer *(was 🟠)*
**Fixed — and a leak in the same code path was fixed with it.**

**The note reaches them.** `trainer_profiles.review_note` (trainer-readable via `tp_read`) carries what the admin asked for, and the status screen renders it above the verification checklist.

**They're told it happened.** New edge function **`notify-trainer-review`** (deployed, `verify_jwt` on) pushes on every review decision — needs_info, approved, reinstated, rejected, suspended. It mirrors `notify-booking`: verify the caller, resolve subscriptions with the service role, reap dead endpoints on 404/410. **Only an admin can fire it** — checked with the service role against `app_admins`, not trusted from the request body. Verified: 401 unauthenticated, 401 with an anon key. Calls are best-effort on the client — the decision is already committed, so a failed push must not make the admin think the update didn't save.

Push copy is deliberately vague on the negative outcomes ("There's an update on your application") — a notification lands on a lock screen other people can read, so the detail stays behind the login.

**The leak.** `adminNote` wrote `review_note` for **every** status, and the status screen rendered it regardless. So the reason typed into "Reject application" — under a dialog that states the note is *"kept internal"* — was shown to the rejected applicant under the heading **"What we need from you."** Same for suspensions, where the copy says "reach out to support for details" while displaying the internal reason directly beneath it.

Now: `review_note` is written **only** for `needs_info`, and explicitly cleared on approve, reinstate, reject, suspend, and resubmit, so a stale request can't outlive what prompted it. The status screen additionally requires `status==='needs_info'` before rendering. Rejection and suspension reasons stay where the dialog promises they stay — `trainer_review_actions` (admin-only) and `suspended_reason`. No data to clean up: zero trainers exist.

The function source now lives in the repo at `supabase/functions/notify-trainer-review/index.ts` — previously edge functions existed only in Supabase, with no copy under version control.

`adminNote(id,'needs_info',…)` (`js/admin.js:172`) requires a note (`:226`), writes it to `trainer_review_actions` — an **admin-only table** — and sets status to `needs_info`.

The trainer's status screen then shows the generic canned line (`trainer-onboarding.js:350`):
> "We need something updated before we can approve you."

They are never told *what*. No email, no push (`notifyBooking` exists for bookings; nothing equivalent fires on review status change). The applicant is stuck guessing, and the queue stalls.

**Fix:** add a trainer-readable `review_note` column on `trainer_profiles` (RLS: owner + admin), render it in `TR_STATUS_COPY.needs_info`, and fire a `notify-*` edge function on status change.

### ✅ B4 — Pass/Fail silently no-ops on draft applications *(was 🟡)*
**Fixed** — the update now asks for affected rows back and tells the admin "No screening record yet — the trainer has to submit first" (`admin.js:221`) instead of re-rendering unchanged.

`adminSetVerification` does `.update(...).eq('trainer_id',id).eq('kind',kind)` (`js/admin.js:189`). For a `draft` profile no `trainer_verifications` rows exist yet (they're only inserted at submit). The update matches **0 rows, returns no error**, and the screen re-renders unchanged. The admin clicks Pass and nothing happens, with no explanation.

**Fix:** `.upsert(..., {onConflict:'trainer_id,kind'})`, or hide the buttons when `status==='not_started'`.

### ✅ B5 — Queue has no limit, search, or pagination *(was 🟡)*
**Fixed** — `.limit(ADMIN_PAGE)` on an ordered query (`admin.js:42`), a name/city search box (`admin.js:63`), and an explicit "showing the oldest N — narrow with search" notice when the cap is hit (`admin.js:64`).

`js/admin.js:25` selects every matching row. Fine at 10 trainers; it will pull thousands of rows into one DOM list later. Also no way to find a specific applicant by name.

### ✅ B6 — Any error in the admin panel nukes the app to a reload screen *(was 🟡)*
**Fixed** — `adminError()` renders inline with a retry, and the Done button keeps working.

`js/admin.js:29` and `:77` call `bootError()`, which replaces `#root` with a full-screen "Something went wrong / Reload". A transient network blip while reviewing one trainer throws the admin out of the whole app with no back button.

**Fix:** render an inline error inside the queue with a Retry, like `screenError()` already does for tabs.

### ⚪ B7 — No admin-facing way to grant admin — **by design, accepted**
Left as-is deliberately: a manual SQL insert is the safer default until there's staff.

`app_admins` is read-only from the client (`screen-profile.js:8`). Adding an admin requires a manual SQL insert. Fine for one person; note it before you have staff.

---

## C. Child intake — age, weight, height, sport, position
`js/onboarding.js`, `js/sheets.js`, `js/screen-growth.js`

### ✅ C1 — Recording a measurement is broken for every returning user *(was 🔴)*
**Fixed** — `afterLogin` now loads reference data alongside athletes: `await Promise.all([ loadAthletes(), loadRef() ])` (`auth.js:6`). That one line closed all four symptoms below, including the reversed trend arrows. `openAddMeasure` was additionally hardened to show a real message rather than an unusable form if metrics ever fail to load, and `reference.js` no longer caches an empty result as success.

This is the height/weight path, and it throws.

`loadRef()` (which populates sports, positions, **and metrics**) is called from onboarding, marketplace, trainer onboarding, and `startAddChild` — **but never from the normal login path.** `boot()` → `afterLogin()` → `renderApp('week')` never touches it (verified across all call sites).

So the moment you log out and back in, or just reload the page, `state.ref === null`. Then:

1. Growth → **+ Record** → `openAddMeasure` reads `state.ref?.metrics || []` (`js/sheets.js:216`) → **empty array** → the `<select>` renders with **zero options**
2. Click "Save measurement" → `sel.selectedOptions[0].dataset.u` (`js/sheets.js:227`) → **`TypeError: Cannot read properties of undefined`**
3. Button is already swapped to a spinner and disabled — the sheet just sits there, dead, forever

Same root cause produces three more visible defects for returning users:
- Week/Profile/Journey show the raw sport key (`football`) instead of the display name (`Football`) — `screen-week.js:10`, `screen-profile.js:23`
- Growth shows raw metric keys instead of names — `screen-growth.js:28`
- **Trend arrows point the wrong way.** `lower_is_better` comes from `state.ref` (`screen-growth.js:30`); when it's `null`, `lower` is `undefined` → the code always uses `cur > prv`. A 40-yard dash that got **slower** displays a green **"▲ better."** For a speed/agility app that's a wrong answer, not a cosmetic bug.

**Fix (one line):** `await loadRef()` inside `afterLogin()` before `renderApp`. Guard `openAddMeasure` against an empty metric list as a belt-and-braces.

### ✅ C2 — Height and weight are never collected at intake, and feed nothing *(was 🔴)*
**Fixed, in two halves — and the second half deliberately treats the two measurements differently.**

**Collected.** The intake step takes optional height and weight (`onboarding.js` `obChild`), and `finishOnboarding` seeds them as `measurements` rows on the existing table — no new schema, and they land straight in the Growth chart.

**Height changes the plan.** `growthSignal()` (`program.js`) reads the height history and flags a growth spurt: annualised gain ≥ 3"/yr, measured across readings ≥ 60 days apart, ignoring anything older than 180 days. Typical pre-spurt growth runs ~2–2.4"/yr, so the threshold sits above ordinary growth. When it fires:

- the week gets **one fewer home session** — in the budgeted path via `LOAD_BUDGET − 1`, and in the two fixed templates by converting the last home session to recovery. **Practice and game days are never touched**; tempering can only remove work the app itself added.
- the Week screen explains why in a parent's language: bone outpacing tendon, sore knees and heels, coordination temporarily going backwards, and *see a doctor if pain lasts more than a couple of weeks or there's limping or swelling*.

Grounded in AAP guidance on overuse injury — no more than 5–6 days a week, 2–3 months off a year, and **don't add more than 10–20% to a weekly load at a time**. A spurt is the wrong week to add anything.

**Weight deliberately drives nothing.** There is no defensible way to turn a child's weight into a training decision, and this app will not compute a body-composition judgement about somebody's 6-year-old. It is recorded for the growth chart, the intake field says so in those words, and **no BMI is calculated anywhere**. That is a design decision, not an omission — it's consistent with the nutrition card that already refuses to discuss dieting with a child.

Verified by running the engine: a single reading, a 10-day noise window, normal growth, a stale reading, and a shrinking (mis-measured) reading all stay quiet; a genuine spurt flags and drops the week from 3 home sessions to 2 (or 2 to 1 alongside a practice schedule), with Tue/Thu practice and Saturday's game left alone.

You listed intake as "age, weight, height, sport, position." The onboarding flow (`OB_FLOW`, `js/onboarding.js:15`) collects: **first name, birthdate, dominant hand, sport, positions, level, parent experience, goals, consent.** No height. No weight.

They exist only as optional after-the-fact `measurements` rows, and — critically — `buildProgram()` takes **no** measurement input at all:

```js
buildProgram(age, goals, sportKey, positions)   // program.js:733
```

So height and weight are a chart on the Growth tab and nothing more. They don't affect load, drill selection, progression, or safety limits. If the intended value is "the plan adapts to my child's size," that wiring does not exist.

### ✅ C3 — Nothing about your child can ever be edited *(was 🟠)*
**Fixed** — `js/screen-edit.js` (new) makes everything onboarding captures changeable afterwards: first name, nickname, birthdate, dominant hand, sport, positions, level. It edits `athlete_sports` rows in place, and is wired from the profile screen (`screen-profile.js:121` → `openEditAthlete`). Fixing a typo'd birthdate or a changed position no longer costs you the athlete's games, milestones, photos, and measurements.

The only write to `athletes` in the whole codebase is the onboarding RPC. Verified: `js/auth.js:9` is the sole `from('athletes')` call, and it's a `select`.

You cannot change: first name, birthdate (so a typo'd birthdate permanently mis-bands the training), dominant hand, sport, **positions**, or level. The only editable field on the entire profile screen is `parent_experience` (`screen-profile.js:94`).

This matters most for exactly your case: a 6-year-old's position in tackle football will change several times a season. Today the only remedy is **delete the athlete and lose every game, milestone, photo, and measurement**, then start over.

### ✅ C4 — "You can add more sports later" is not true *(was 🟠)*
**Fixed — the promise at `onboarding.js:132` is now true**, and the hard part (what a two-sport week should look like) is answered rather than dodged.

**Managing sports.** Profile → Sports has **+ Add a sport** for the owner, with `openSportEditor` handling add and edit, `setPrimarySport` enforcing one primary at a time, and `confirmRemoveSport` taking a sport off the plan while keeping games, milestones, photos and measurements. Duplicates are caught by name (`23505` → "That sport is already set up"), and removing the primary promotes the oldest remaining sport so an athlete is never left without one.

**How the Week screen picks between two — the part that mattered.** Two sports do **not** mean two programs:

- every sport's practices and games count toward **one** weekly load budget, so the app's contribution shrinks as the teams' own demands grow
- the focus sport **rotates week to week** (`focusPool[w0 % focusPool.length]`), and the second sport supplies the other skill session, so a two-sport week stays varied instead of doubling up
- day labels name *which* sport — "Wrestling practice", not "Team practice"
- a sport counts as active if games are running **or** practices are on the calendar, so preseason camp still contributes

Verified by running the engine on a 12-year-old with football (Tue/Thu + Sat games) *and* wrestling (Mon/Wed + Sun meets) — four practices and two competition days across two teams:

```
one sport   Mon:train Tue:practice Wed:gym Thu:practice Fri:rest Sat:game Sun:rest
            → 2 home sessions added, budget 5
two sports  Mon:practice Tue:practice Wed:practice Thu:practice Fri:rest Sat:game Sun:game
            → 0 home sessions added, overloaded flag set
```

That second week is 6 hard days — but every one of them belongs to a coach, not to this app. The app adds **nothing** and raises the "that's a heavy team week … worth a conversation with the coach" card. Two sports at once is exactly how a child ends up training six days a week without anyone noticing, and the budget is what makes it visible.

`js/onboarding.js:103` promises it. There is no code path anywhere that inserts a second `athlete_sports` row — the RPC writes one, and every other reference is a `select` or a `parent_experience` update.

### ✅ C5 — No practice schedule input — which breaks your actual use case *(was 🟠)*
**Fixed — this was your original use case.** `athlete_sports` gained `practice_days smallint[]` and `game_day smallint`; `buildProgram(…, schedule)` (`program.js:851`) lays the week out around them. Practice and game days become fixed points, a weekly load budget (`LOAD_BUDGET`, `program.js:786`) counts practice + games + home sessions together so the more the team trains the less gets added at home, and a hard floor of 2 rest days (`MIN_REST_DAYS`, `program.js:787`) is enforced. With no schedule set, the original template renders byte-identical. Full detail in **C5 — how the week is now built** near the top.

You said it plainly: *"on days he doesn't have practice."*

The app has no field for practice days. `buildProgram` hardcodes the week (`program.js:743-761`): Mon skill, Tue strength, Wed recovery, Thu skill/speed, Fri light, **Sat game**, Sun rest.

If your son's team practices Tuesday and Thursday, the app schedules strength work on top of Tuesday practice and a second skill session on top of Thursday practice — while telling you on the same screen that it's *"rest-first"* and *"protects rest"* (`screen-week.js:39`). The app's central safety promise is unenforceable without knowing the practice days.

**Fix:** add a practice-days step to onboarding (multi-select Mon–Sun + game day), store on `athlete_sports`, and have `buildProgram` place rest/recovery on practice days and slot training into the gaps.

### ✅ C6 — Positions are shown as bare codes *(was 🟡)*
**Fixed** — `posChips` renders the DB's full names ("Athlete / Multiple") with the code as a subtitle, and the same helper is reused by the edit screen (`onboarding.js`, `screen-edit.js`, `sheets.js`).

`js/onboarding.js:113` renders `esc(p.code)` — so a parent picks between chips reading `ATH`, `DL`, `OL`, `UTIL`, `MB`, `DS`. A first-time football parent won't know `ATH` from `DL`. The `positions` table almost certainly has a name column (`sports` does); use it, with the code as a subtitle.

### ✅ C7 — Position codes are a silent contract with the database *(was 🟡)*
**Fixed** — `auditPositionCodes()` (`reference.js`) console-warns on boot when a DB position code has no `POSITION_SKILLS` entry, so drift surfaces instead of silently degrading to generic content.

`POSITION_SKILLS` (`program.js:230`) hardcodes codes: football `QB RB WR TE K ATH CB S LB DL OL`, volleyball `OH OPP MB S L DS`, etc. These must match `positions.code` in Supabase exactly. If a single code drifts, `posMap[code]` returns undefined (`program.js:685`), the drill is **silently skipped**, and the athlete quietly falls back to generic content with no error anywhere. Add a startup dev-assert that every DB position code has a `POSITION_SKILLS` entry.

Also: no `FB` (fullback) in the football set.

### ✅ C8 — Goals can be duplicated, never completed, and pick the weekly focus at random *(was 🟡)*
**Fixed, all three** — existing goals are shown as taken and the 3-goal cap is enforced; achieve (🏆) and remove actions were added on Growth; and the goals query is now ordered, so the "This week's focus" headline is stable between page loads.

- `openAddGoal` (`js/sheets.js:205`) doesn't dedupe against existing goals and doesn't enforce the 3-goal cap that onboarding does (`onboarding.js:192`). Add "Get faster" five times and you get five rows.
- No UI to complete, archive, or delete a goal — `from('goals')` has exactly one write, an insert.
- `screenWeek` uses `goals?.[0]?.label` as the big "This week's focus" headline (`screen-week.js:16`), but the query has **no `.order()`** (`screen-week.js:5`). Postgres row order is not guaranteed — **the headline goal can change between two page loads.**

### ✅ C9 — Measurement entry accepts nonsense *(was 🟡)*
**Fixed** — `max` on the date input and a positive-value check in `openAddMeasure` (`sheets.js`).

`openAddMeasure` (`js/sheets.js:215`): the date has no `max` (every other date input in the app does), so future measurements are allowed and will sort to the top of the trend as "latest." No range check either — a height of `-40` or `9000` saves fine.

### ✅ C10 — Failed goal/measurement saves leave a dead button *(was 🟡)*
**Fixed** — the button is restored on the error path in both the goal and measurement sheets, matching what the other sheets in the file already did.

`js/sheets.js:210` and `:232`: `if(error){toast('Could not save');return;}` — the early return skips restoring the button, which is still a disabled spinner. The user's only option is to dismiss the sheet and lose what they typed. (The other sheets in the file get this right — compare `:71` and `:121`.)

---

## D. The training regimen engine
`js/program.js` — 805 lines, 106 KB, ~95% of it static content

### ✅ D1 — Nothing is sourced from the internet or from experts *(was 🔴)*
**Fixed — the pipeline is complete end to end**, and content no longer requires a developer. Expanding coverage is ongoing content work, tracked at the end of this section rather than as an open defect.

| Piece | State |
|---|---|
| `drills` table with `source_name` / `source_url` / `source_note` / `reviewed_on` | done, RLS'd — admins write, only published rows are readable |
| Citations shown to the parent | done — `sourceHTML` (`program.js`) links the source and prints what in it the drill derives from; an uncited drill says so in plain words rather than staying silent |
| Curated content merged ahead of the built-in library | done — `skillsFor`, with `program.js` still the offline fallback |
| **Admin editor** | **done** — `js/admin-drills.js`, reachable from Profile → Admin → Drill library. Add, edit, publish, unpublish, delete, filtered by sport and age bucket. **Content changes ship without a deploy.** |
| **Published rows must be cited** | **done** — CHECK constraint `drills_published_needs_source`. Uncited work can sit as a draft while it is sourced; it cannot reach a child. |
| **Sport-agnostic curated content** | **done** — a row with no `sport_key` now applies to any athlete of that age (`dbGenericDrills`). This previously could not be selected at all, so the editor's "Any sport" option would have written content the engine ignored. |

**Sourced content added this pass** — 6 drills, written only from guidance verified against the source, not from memory:

- **CDC — Physical Activity Guidelines for School-Aged Children and Adolescents** (60 min/day; vigorous, muscle-strengthening and bone-strengthening each on ≥3 days/week) → bone-strengthening play (young), three hard days a week (mid), the 60-minute floor (old)
- **American Academy of Pediatrics, HealthyChildren.org — Strength Training** (practise lifts unweighted until form is right; 2–3 sets of 8–15; 2–3×/week for 20–30 min; 10–15 min warm-up; no 1-rep maxes, maximum weights, or ballistic movements before skeletal maturity) → bodyweight first (young), 2 sets of 8–15 (mid), adding load (old)

Each carries a `source_note` recording exactly which recommendation it derives from.

**Ranking, verified by running the engine:** curated sport-specific → the sport's built-in library → cited generic → uncited filler. A 6-year-old football RB still opens on the curated NSCA drill; an **unmapped sport now gets cited content instead of uncited filler** (6yo lacrosse went from one generic card to two cited ones), and thin buckets like gymnastics `mid` went from 1 drill to 3 — which also removes the last cases where the rotation had nothing to rotate through.

**Ongoing — content, not engineering.** The **202 built-in drills remain uncited**; their provenance is unknown and they are still the bulk of what most children see. Only football `young` has sport-specific sourcing, and there is no automated retrieval or LLM generation. None of that is a defect in the app any more — it is work you can now do yourself in Profile → Admin → Drill library, and the CHECK constraint guarantees nothing uncited reaches a child in the meantime. Read the rest of this section as the standing plan for that work.

The core premise of your product isn't implemented.

I searched every file for `fetch(`, `XMLHttpRequest`, `functions.invoke`, and any AI provider. Outside the service worker, the **only** outbound calls in the app are: Supabase queries, Supabase storage, and 4 edge functions (`notify-booking`, `stripe-checkout`, `stripe-connect`, `delete-athlete`). **None of them touch training content.**

Every drill is a literal in `program.js`:

```js
football:{ young:[{title:'Catch & carry', dur:'10 min', why:'…', how:[…], say:'…', mistake:'…', stop:'…'}] }
```

Consequences:
- **No expert attribution.** Not one drill cites a source, a coach, a governing body, or a study. The app says "age-appropriate" and "safe by design" on authority it never establishes.
- **No update path.** New guidance from USA Football, the AAP, or NSCA means a developer editing a JS constant and redeploying. Not a content update — a code change.
- **No coverage beyond 13 sports.** Pick anything else and every athlete of every age gets the same three generic cards (`GENERIC_SKILL`, `program.js:19`).
- The content itself is, to be fair, **sound** — bodyweight-first, rest-first, no-contact-at-home, real red-flag stop conditions. It reads like someone who knows youth development wrote it. But it's one author's knowledge frozen in a file, which is a different product from the one you described.

**What "expert-sourced" would actually take** — pick one:

| Approach | What it means | Trade-off |
|---|---|---|
| **Curated + cited** (recommended first step) | Move drills into a Supabase `drills` table with `source_name`, `source_url`, `reviewed_by`, `reviewed_on`. Seed from USA Football Football Development Model, AAP, NSCA youth position stand, SHAPE America. Show the citation on every drill card. | Real work to source; but defensible, auditable, editable without a deploy, and you can add sports without shipping code. |
| **LLM-generated, human-gated** | Edge function calls Claude with (age, sport, position, level, practice days, goals) → writes a candidate week into `drills` → **an admin approves before any child sees it**. | Never let raw model output reach a parent training a 6-year-old. The approval gate is non-negotiable. |
| **Live web retrieval per request** | Search + summarize at plan time. | Don't. Unreviewed internet fitness content aimed at children is the one thing you cannot ship un-gated. |

The existing `admin.js` review-queue pattern is a good template for the approval gate in option 2 — you've already built that muscle for trainers.

### ✅ D2 — The plan is identical every single week, forever *(was 🔴)*
**Fixed, both halves.** Rotation: `buildProgram` now takes a week index (`program.js:851`), computed by `weeksSince()` (`program.js:744`) — whole weeks compared on local calendar days so DST can't shift a boundary — and consumed by the Week screen (`screen-week.js:50-51`) for both the week counter and the season week. The plan advances Monday to Monday instead of repeating forever. Completion: tapping a day marks it done, with a ✓ on the week list and an `x/y done` tally. Verified deterministic and duplicate-free across bands.

`buildProgram()` is deterministic and stateless. Same inputs → byte-identical week. There is no week number, no cycle, no progression, no history, no "mark it done," no adaptation.

Concretely for your son: he does **"Ball security: high & tight" every Monday and "Start & go" every Wednesday** — the same reps, same cues, same durations — for the next **12 months**, until his birthday flips `littles` → `youth` and swaps in two different drills for the following 3 years.

There is also no completion tracking of any kind. Nothing records that a session happened. So the app cannot say "you've done this 8 times, here's the next step," and you can't tell a good week from a skipped one.

**Fix:** add a `plan_weeks` (or `sessions`) table keyed by athlete + ISO week; make `buildProgram` take a week index and rotate through the drill pool; add a one-tap "done" that writes a completion row. Progression is what turns this from a reference card into a training program.

### ✅ D3 — Monday and Wednesday are frequently the *same drill* *(was 🟠)*
**Fixed** — the second training day falls back to the age-banded speed/movement card instead of repeating Monday (`program.js:892`). It deliberately never falls back to another band's drill: a 6-year-old must not be handed the teen session. Verified — `6yo football, no position` → Mon "Catch & carry", Wed "Chase & tag games"; `6yo lacrosse (unmapped)` → Mon "Fundamentals & fun", Wed "Chase & tag games". All previously-correct cases come out byte-identical.

`program.js:740`: `const skillB = skills[1] || skills[0];`

When `skillsFor()` returns only one drill, both training days render identically. Verified by running the real engine:

```
age 6 · football · no positions  → Mon="Catch & carry"      Wed="Catch & carry"
age 6 · lacrosse (unmapped)      → Mon="Fundamentals & fun"  Wed="Fundamentals & fun"
```

This hits any athlete with no position selected, any unmapped sport, and any sport whose band bucket has a single entry — which is **most** of them: `gymnastics`, `dance`, `baseball`, `softball`, `track` define only a `mid` bucket in `SKILLS` (`program.js:31, 32, 50, 51, 52`), so every young and every teen athlete in those sports gets a duplicated week.

**Fix:** when the pool has fewer than 2 entries, top up from `GENERIC_SKILL` before falling back to a repeat.

### ✅ D4 — Half your goal options do nothing at all *(was 🟠)*
**Fixed — all 8 goals now change the week**, so onboarding's claim that "these shape the weekly playbook" is finally true for every option.

`GOAL_SESSIONS` (`program.js`) adds a real session for the dead goals — **catching**, **footwork**, **iq**, **confidence** — each written in three age variants (young / mid / old) matching the buckets `skillsFor` already uses. A 6-year-old asking for better hands gets "Hands & catching" (20 soft tosses, finish on a catch they made); a 16-year-old gets "Hands under pressure" (contested reps, catches taken while tired). The mindset goals are treated as real sessions rather than platitudes: `confidence` is process reps ending on a success, and its `old` card says outright that anxiety affecting sleep, appetite or school is beyond training and needs a professional.

**Scheduling.** Sessions are ordered `skill work → every goal the parent chose, in the order they chose it → defaults`, deduped by title, with the load budget filling from the front — so a stated goal outranks the nice-to-haves instead of falling off the end of a busy week.

Two problems this surfaced, both fixed:

- **The `littles` template ignored goals entirely.** Only the scheduled path and the default template consulted them, so under-7s — the app's core user — got nothing from their goal. Their Wednesday session now uses the goal card.
- **On the busiest weeks the budget buys exactly one home session**, and position work won it every time, so a stated goal would never actually land. The goal now **leads on alternate weeks** (`w0 % 2`). Deterministic, and over a month both the sport's own work and the thing the parent asked for get their turn.

A title collision surfaced in testing: the new mid-band catching card was named "Reliable hands", which already existed as a built-in football drill, so the two silently deduped against each other. Renamed to "Sure hands under pressure".

Verified across all 8 goals × 4 weeks — **no goal is inert**, and no week contains a duplicate session.

`buildProgram:739` is the entire use of goals:

```js
const speedy = goals.some(g => ['speed','agility','endurance'].includes(g.key));
```

That's it — one boolean, which only swaps Thursday. So of the 8 goals `GOAL_LIB` offers (`onboarding.js:156`):

- **Do something:** `speed`, `agility`, `endurance` (collectively, one bit)
- **Do literally nothing:** `catching`, `footwork`, `confidence`, `iq`, `strength`

Onboarding tells the parent *"These shape [child]'s weekly playbook"* (`onboarding.js:175`). For 5 of 8 options that isn't true. If you pick "More reliable hands" for your son, the plan is byte-identical to picking nothing.

### ✅ D5 — Speed goals are silently discarded for under-7s *(was 🟠)*
**Fixed** — littles get "Chase & tag games", and a stated goal now ranks **above** the second skill day so a busy week can't quietly drop it.

The `littles` branch (`program.js:743-751`) never reads `speedy` — there's no speed day in that template. But `screenWeek` still renders a "Speed & conditioning" section from `prog.speed`, so the parent sees speed content that the week never schedules. A 6-year-old with a "Get faster" goal gets a plan that ignores it, with no explanation.

### ✅ D6 — Level and parent-experience are collected but never reach the engine *(was 🟠)*
**Fixed — level now changes the plan, and the direction it changes it in is the whole point.**

The obvious move would be to train the travel/elite athlete *harder*. That is exactly backwards: the committed athlete is the one already most exposed to overuse, and pediatric guidance is explicit that high year-round volume is the risk factor, not the goal. So level is used the other way round — **a high-commitment level means the team is probably already taking more days, so the app adds one session fewer at home.**

`levelIsHighCommitment()` classifies the per-sport `level_vocab` strings (travel, club, AAU, elite, select, academy, varsity, all-star, optional, sectional, company, competitive, tournament, USAW…), with an explicit carve-out so **"Pre-Competitive"** and **"All-Star (Novice)"** — the entry rungs of their ladders — don't read as high-commitment on a naive substring match.

**It only applies when no practice schedule is set.** A real schedule is far better evidence than an inference from a label, and using both would double-count the same load. Verified:

```
Rec,     no schedule    → 3 home sessions   (assumeTeamLoad false)
Varsity, no schedule    → 2 home sessions   (assumeTeamLoad true)
Varsity, with schedule  → 2 home sessions   (assumeTeamLoad false — real data wins)
```

The Week screen says so rather than quietly removing work: *"At Varsity, they're probably training more with the team than a rec season — so we've added one session fewer at home rather than stack on top of a week we can't see. Tell us the actual practice days and we'll use those instead of guessing."*

`parent_experience` was already wired to Coach's Corner and is unchanged.

Onboarding requires a level and blocks you from continuing without one (`onboarding.js:150`). `buildProgram` never receives it. A 12-year-old's rec-league plan is identical to a 12-year-old's travel/elite plan.

`parent_experience` fares slightly better — it drives one static paragraph in Coach's Corner (`program.js:770`), keyed by sport only, with the level used purely as a phrase ("in high school"). All 13 notes are one sentence each.

### ✅ D7 — Missing birthdate silently trains a 6-year-old as a 12-year-old *(was 🟡)*
**Fixed** — `ageBand(null)` now returns `'littles'`. An unknown age gets the most conservative band, never push-ups and planks.

`ageBand(null)` returns `'preteen'` (`program.js:10`). Onboarding requires a birthdate, so this shouldn't fire — but if the field is ever null (a legacy row, a failed write), the child silently gets the preteen strength circuit (push-ups, planks, lunges) with no warning. Verified: `buildProgram(null, …)` returns a full preteen week.

**Fix:** return a conservative band or refuse to build a plan without an age.

### ⚪ D8 — Age bands recompute only on reload — **by design, accepted**
Harmless; noted for anyone testing band transitions.

`ageFrom()` runs at render. A birthday during an open session doesn't change anything until the next load. Harmless, but worth knowing when testing band transitions.

---

## E. Cross-cutting

### ✅ E1 — No router: the browser Back button leaves the app *(was 🟠)*
**Fixed** — a real router in `shell.js` + `init.js`. Back/forward restore the right tab, screens are linkable, and Back no longer exits an installed PWA. Verified in a browser.

Verified: zero `pushState` / `popstate` / `hashchange` in the codebase. `renderApp(tab)` swaps innerHTML and nothing else.

- Back from the Growth tab exits Parent Playbook entirely — badly wrong in an installed PWA
- The admin queue, marketplace, and trainer status screens have **no URL** — you can't bookmark or share "the review queue"
- Refresh always dumps you back on Week

**Fix:** `history.pushState({tab}, '', '/'+tab)` in `renderApp`, plus a `popstate` listener. ~15 lines.

### ✅ E2 — Marketplace claims screening the system doesn't perform *(was 🟠)*
**Fully resolved — the claim is now enforced rather than merely softened.**

This went through two stages. First the copy was corrected to describe what the review actually did. Now that **B1** enforces screening in the database, `marketplace.js:62` states what is structurally true: every listed trainer has a verified photo ID, a background check, and SafeSport training on file, all three reviewed and **currently in date**, and a trainer whose check lapses is unlisted automatically. The `tp_read` policy makes it impossible for a listed trainer to be otherwise. The meet-in-public / stay-for-sessions / check-references guidance stays — enforcement is not a substitute for a parent's own judgement.

The original overclaim, for the record: "Every listed trainer has passed identity, background, and SafeSport screening" — shown to a parent deciding whether to put an adult in a room with their child, and backed by nothing.

The original overclaim, for the record: "Every listed trainer has passed identity, background, and SafeSport screening" — shown to a parent deciding whether to put an adult in a room with their child.

### ✅ E3 — Bottom nav has no accessible labels *(was 🟡)*
**Fixed** — `aria-label` on the nav buttons (`shell.js`).

`shell.js:27` — 0 `aria-label` attributes on nav buttons. The visible text helps, but the SVG has no `aria-hidden` and the buttons have no roles. Quick a11y win.

### ✅ E4 — Load-time code lives outside `init.js` *(was 🟡)*
**Fixed** — `pwa.js` now exports three functions (`registerServiceWorker`, `handleStripeReturn`, `initInstallBanner`) called from `init.js:8-10`. The golden rule holds again.

`ARCHITECTURE.md:9` states the golden rule: definitions in feature modules, load-time code only in `init.js`. `js/pwa.js` breaks it three times — SW registration at line 1, the Stripe-return IIFE at line 25, the A2HS IIFE at line 38. Worth fixing now, while the rule is still cheap to hold.

### ✅ E5 — `ARCHITECTURE.md` is missing 4 of 19 modules *(was 🟡)*
**Fixed** — the table now documents all modules, including `screen-edit.js` added since.

The table omits `admin.js`, `marketplace.js`, `trainer-onboarding.js`, and `trainer-services.js` — ~1,000 lines, including the entire trainer marketplace and the admin panel. Anyone (or any agent) using that doc as the map won't know they exist.

### ✅ E6 — Cross-origin requests take a pointless cache round-trip *(was 🟡)*
**Fixed** — `sw.js:36` returns early for cross-origin (fonts, Supabase), passing them through untouched. Same-origin stays network-first, so deploys land immediately without a cache-version bump.

`sw.js:37` runs `caches.match(req)` for every cross-origin GET — including Supabase. Nothing cross-origin is ever `put` into the cache, so it's always a miss, but it adds a Cache API lookup to every data read. Return early for non-same-origin instead.

---

## What's left

Every finding is closed. What follows is the record of how the last few landed:

**Before any trainer is listed publicly**
1. ~~**B1**~~ — **done.** Screening is enforced in the database: no pass without evidence, no approval without all three checks in date, no listing once one lapses. What remains is a *policy* decision, not code: **what background-check report you accept**, and whether to wire an automated provider into the `provider`/`external_ref` seam.
2. ~~**B3**~~ — **done.** The needs-info note reaches the applicant and a push fires on every review decision.

**Ongoing content work (not a defect — D1 is closed)**
3. Source the other 202 drills in Profile → Admin → Drill library. Highest value first: the sports your users actually pick, and the `mid`/`old` buckets where load and contact carry real risk. If you later want generation, the LLM-behind-an-approval-gate option is the one to take — never unreviewed output to a parent training a 6-year-old.

**Awaiting a decision from you**
4. ~~**D4 / D6**~~ — **done.** All 8 goals now change the week, and level adjusts the *assumed* team load downward when no practice schedule is set.

**Accepted as-is:** B7 (no UI to grant admin) · D8 (bands recompute on reload).

---

## Where the audit closes

All 34 findings are resolved; 2 were accepted as deliberate. Nothing outstanding is a defect in the app.

### The marketplace is switched off — 2026-08-12

`MARKETPLACE_ENABLED = false` in `core.js`. **This is the answer to B1's open policy question.**

The reasoning: running a marketplace that connects adults to other people's children responsibly needs a screening vendor, FCRA-compliant consent and adverse-action handling, and insurance — none of which the database gate substitutes for. The B1 evidence gate deliberately accepts an *uploaded* background-check report so the build wouldn't be blocked on a vendor decision, and that route is the weak one: a report the applicant supplies is a document they control, may cover only one county, and may be stale. It should not be the real control.

Cost of switching off: **nothing.** Zero trainers, zero bookings, zero applications existed.

What the flag does:

- hides the Browse / My bookings and Become-a-Trainer entry points on Profile, and the Find-a-Trainer banner on Week
- `marketplaceOff()` guards **every** entry function (`openMarketplace`, `viewTrainer`, `openMyBookings`, `startTrainerOnboarding`, `trainerStatusScreen`, `openTrainerServices`) — hiding buttons is not enough now that the router (E1) made these screens linkable, so a bookmark or shared URL would otherwise still open them
- **not** gated: the admin review queue and the drill library
- **nothing is deleted** — no trainer, booking or application data is touched

Verified in both positions: `false` → blocked, toast, redirect to Profile; `true` → passes through with no side effects.

**To turn it back on**, flip the one constant — and before you do, have these in place:

1. A **youth-sports screening vendor**, not a generic one. NCSI is what USA Football uses; Sterling Volunteers is the other established option. They handle the consent and adverse-action workflow.
2. Checks covering **national criminal + sex-offender registry + county-level** search, with state requirements varying (some mandate fingerprint or child-abuse-registry checks).
3. **Annual re-screening** — `expires_at` already enforces this; a lapsed check unlists the trainer automatically.
4. **Legal and insurance review.** Commissioning background checks creates FCRA obligations (disclosure, authorization, pre-adverse/adverse action). That is a lawyer conversation, not a code change.

When the vendor exists, tighten the gate: drop `doc_path` from the `background_check` branch of `verification_evidence_ok` so only a `provider` + `external_ref` result can pass.

### Then

**Source the remaining 202 drills** in Profile → Admin → Drill library. Published content cannot be uncited, so nothing unsourced reaches a child in the meantime.

---

## What's genuinely good

Worth saying, because it's a lot and it's the reason the fixes above are cheap:

- **Security posture is right.** `esc()` on every interpolation, RLS-aware queries, no service keys client-side, signed URLs for private trainer docs, `delete-athlete` as a server function that purges storage, invite acceptance via RPC.
- **`create_athlete_onboarding` as one transactional RPC** — family + athlete + sport + goals + consent commit together. The COPPA consent record can't be orphaned. That's a deliberate, correct call.
- **The code comments explain *why*.** `core.js:9` on client-side UUIDs vs. RETURNING under RLS, `core.js:19` on local-vs-UTC date parsing, `auth.js:64` on Supabase's empty-identities enumeration guard, `sheets.js:51` on holding one game id across retries. These are the notes of someone who hit the bug and fixed it properly.
- **Error handling doesn't fake success.** `loadAthletes` throws rather than returning `[]` and misrouting to onboarding (`auth.js:12`); `loadRef` refuses to cache a failed load (`reference.js:9`).
- **The safety content is real.** Every drill carries a `stop:` condition. Cheer and gymnastics keep stunting and tumbling at the gym with mats. Swimming says "with a lifeguard" in the drill *title*. Wrestling forbids live contact at home. The nutrition card explicitly refuses to discuss dieting with a child and routes to a pediatrician. Head-injury signs are called out on game day. That's careful work, and it's the part that would be hardest to replace.
