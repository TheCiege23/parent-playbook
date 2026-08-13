# Parent Playbook — click-through audit

**Date:** 2026-08-12 · **Method:** driven in the user's own Chrome against production, as a real signed-in parent
**Account:** `allfantasysportsapp@gmail.com` (0 athletes — a genuinely fresh account)

This is the audit that could not be done before: not reading the code, not querying the database, but **using the app**.

---

## 🔴 Blocking — the privacy policy currently states something untrue

`privacy.html` is deployed and says:

> **No IP address stored.** …We have turned that off, so error reports are not tied to where you are.

**It has not been turned off.** A second test error fired after deployment (`PARENT-PLAYBOOK-2`) still carries:

```
user.geo: US, Paterson, United States
```

Sentry derives city-level location from the sender's IP **server-side**, so no client change can fix it. Until the toggle is flipped, a live privacy policy on a children's app makes a false statement about location data.

**Fix (30 seconds):**
> Sentry → **Project Settings → parent-playbook → Security & Privacy → "Prevent Storing of IP Addresses"** → on

Then fire one more test error and confirm `user.geo` is gone. If you would rather not toggle it, tell me and I will reword the policy instead — but one of the two must happen.

---

## ✅ What the walkthrough proved

Six onboarding steps driven end to end. **Zero application errors in the console across the entire flow.**

| Step | Result |
|---|---|
| Welcome | renders, PWA install banner offered |
| Household | accepts input, advances |
| Child details | name, birthdate, hand, height, weight all accept input |
| Sport & position | **positions show full names** — "RB / Running Back", "ATH / Athlete / Multiple" (C6 verified live) |
| Level | per-sport vocabulary correct — Flag, Pee Wee, Junior, Senior, Freshman, JV, Varsity |
| **Practice schedule** | present and working — the step that fixes your original problem (C5) |
| Goals | all 8 offered, grouped Skill / Physical |
| Consent | **Privacy Policy and Terms now linked** (verified live) |

Also confirmed in the running app: `MARKETPLACE_ENABLED = false`, and the Sentry client initialising with `hasReplayIntegration: false`.

**Nothing was written to the database.** Athlete and family counts are unchanged; both pre-existing rows belong to the original account.

---

## 🟡 Findings

### 1. The height/weight explanation appears three times on one screen
The child-details step now shows, stacked:
- under Height — *"Update it every few months and we'll spot a growth spurt…"*
- under Weight — *"Kept for the growth chart only… we don't calculate BMI."*
- then a third paragraph — *"Starting points for the growth chart. They're never used to make training harder…"*

The third pre-dated my two and says the same thing again. Three explanations of one optional field is noise on the most important screen in the flow. Keep the two per-field notes (they sit where the question is asked) and drop the trailing paragraph.

### 2. A confirmed user with no `guardians` row
`allfantasysportsapp@gmail.com` is confirmed and signed in but has **no `guardians` row** and belongs to no family — that row is only created by `create_athlete_onboarding` at the end of the flow.

This is fine for the parent path, which is why it has never bitten. It is worth knowing because `trainer_profiles.id` has a foreign key to `guardians(id)`: an account that signed up but abandoned onboarding cannot become a trainer without that row existing. Currently unreachable — the marketplace is off — but it would surface the day it goes back on.

### 3. The PWA install banner overlaps the form controls
At a narrow viewport the "Add Parent Playbook to your phone" banner sits over the bottom of the page and covered the **Continue** button on the sport step; I had to dismiss it to proceed. On a phone — the primary target — this is directly in the way of the main action. It needs bottom padding on the scroll container equal to the banner height, or the banner should not appear mid-onboarding.

---

---

# Part 2 — driving the app after the profile was created

## 🔴 Every height and weight entered at intake has been silently discarded — FIXED

`measurements.source` is an enum accepting exactly **`manual | guided | photo | import`**. `finishOnboarding` was inserting **`source:'onboarding'`** — not a member — so Postgres rejected every seed row.

It was invisible because of a second bug in the same line:

```js
try{ await sb.from('measurements').insert(seed); }catch(e){ console.error(e); }
```

**supabase-js returns `{error}`; it does not throw.** The `catch` never fired. The insert failed on every signup and nothing — not even the console — ever said so.

Proven against the live database: `source='onboarding'` → *invalid input value for enum measure_source*; `source='manual'` → accepted.

**Impact.** `ZZTest` was created with height 46 and weight 48 and has **0 measurements**. So does **`CJ Jr.`** — your son's real profile. This has never worked for anyone. It also silently defeats **C2**: growth-spurt detection needs a height history, and intake is where the first reading was supposed to come from.

**Fixed:** `source:'manual'`, and the returned error is now captured, logged, and reported to Sentry.

### The same swallowed-error pattern existed in two more places — both fixed
- `onboarding.js` — the `athlete_sports` update carrying **practice days, game day and season start**. It happens to work today, but a failure would have silently dropped the practice schedule the whole week is built around.
- `admin.js` `adminLog()` — the **B2 audit trail** recording who cleared a child-safety screening check. A silent failure there is worse than no log at all, because you would believe a record existed. It now warns the admin outright: *"Warning: this decision was not logged."*

## ✅ Verified working by driving it

| Feature | Result |
|---|---|
| **Week plan (C5)** | 6-year-old, RB, Tue/Thu practice + Sat game → **Mon rest · Tue practice · Wed rest · Thu practice · Fri rest · Sat game · Sun rest**. 3 hard days, **4 rest days**, `homeDays: 0` — the app added nothing on top of a full team week, and said so. |
| Day labels | "Football practice", "Football game day" — named by sport |
| **Session completion (D2)** | Tapped Tuesday → sheet with why / how / what to say / when to stop → **Mark done** → ✓ appears, counter 0/3 → 1/3, logged to the correct date (Aug 11) |
| Goal headline | "WEEK 1 · THIS WEEK'S FOCUS — More reliable hands" — the goal chosen at intake |
| Growth tab (C1) | Loads correctly, streak and session history render, goal shows achieve/remove controls (C8) |
| Provenance | Drill sheet footer: *"General guidance from the Parent Playbook library — not attributed to an outside source"* — the honest uncited label |
| Medical disclaimer | Present at the foot of the week |

## 🟡 Further findings

### 4. "0/3 done" counts the coach's sessions, not the app's
`screen-week.js:69` builds the tally from every day where `t !== 'rest'` — which includes **practice and game days**. On this week the app added nothing at home, yet the header reads "0/3 done", implying three outstanding tasks.

Logging practice is clearly deliberate — the sheet offers *"Mark cancelled (rain, called off)"* — so this is not a defect. But the tally, and therefore the **streak on the Growth tab**, measures team attendance rather than the plan this app produced. A parent who never does a single suggested session can still reach 3/3 and hold a streak. Consider labelling it "3 logged" rather than "done", or separating team days from home sessions.

### 5. A stated goal can vanish entirely on a full week
"More reliable hands" drives the headline, but with `homeDays: 0` there is no catching session anywhere — and the sections below still show *Animal movements* and *Chase & tag games*, which are strength and speed. The parent sees their chosen goal named at the top and unrelated content beneath it. Correct on safety grounds; confusing on its face. The "Built around practice" card carries the explanation, so this is presentation, not logic.

## What still could not be tested

Still unverified: **recording a measurement by hand** (the "+ Record" sheet — the code path is separate from the broken seed and already uses `source:'manual'`, so it should work), the **Journey** tab, the **invite a co-parent** flow, and **athlete deletion**.

## Do this next

1. **Deploy** — the measurement fix is not live yet.
2. **Flip the Sentry IP toggle** (top of this document). Your deployed privacy policy currently claims something untrue.
3. **Re-enter CJ Jr.'s height and weight** from his profile → they were silently discarded when you created him, and C2's growth-spurt detection cannot work without at least two height readings over time.
4. Delete the `ZZTest` profile.
