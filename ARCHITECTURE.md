# Parent Playbook — module map (built for agent development)

Single-page app, **no build step**. `index.html` loads the Supabase client, then
each module as a plain `<script>` in dependency order. All modules share one global
scope (classic scripts), so functions/consts defined in one file are callable from
any other — exactly like the original single file, just split so agents can own one
file at a time without merge conflicts.

**Golden rule:** put *definitions* (functions, data consts) in feature modules;
put *code that runs on load* only in `init.js`, which is loaded **last** (browsers
don't hoist across separate `<script>` tags).

| Module | Responsibility (one thing) | Key things it defines |
|---|---|---|
| `js/core.js` | Client + primitives + shared state | `sb`, `$`, `root`, `esc`, `H`, `uuid`, `toast`, `ageFrom`, `state` |
| `js/background.js` | Rotating per-sport photo background | `BG`, `SPORT_BG`, `pickBg`, `setAppBg`, `inviteTokenFromUrl` |
| `js/reference.js` | Load sports/positions/metrics config **+ the `drills` content library** | `loadRef` |
| `js/auth.js` | Session lifecycle + login/signup screen | `afterLogin`, `loadAthletes`, `renderAuth`, `authRedirectUrl` |
| `js/onboarding.js` | Six-step account-LAST flow + the reveal | `renderOnboarding`, `ob*`, `obCreateAccount`, `obStash`, `finishOnboarding` |
| `js/program.js` | Age-appropriate activity/plan engine | `ageBand`, `SKILLS`, `POSITION_SKILLS`, `skillsFor`, `weeksSince`, `buildProgram`, `SEASON_STATE`, `rebalanceWeek`, `weekStreak` |
| `js/shell.js` | App frame: router, bottom nav, top bar | `APP_TABS`, `renderApp`, `navBtn`, `topBar` |
| `js/screen-week.js` | Weekly plan screen | `screenWeek` |
| `js/screen-growth.js` | The active goal, its evidencing metric, trend bars | `screenGrowth`, `GOAL_METRIC`, `SUGGEST_METRICS`, `trendBars` |
| `js/body-insights.js` | Measurement snapshots, method-aware comparison, growth context and JSON export; route `#insights` under Scan | `screenBodyInsights`, `biSnapshot`, `biComparison`, `biMarkup` |
| `js/scan-record.js` | Body assessment provenance serialized into existing measurement notes, stable retry IDs, consent check on save | `buildScanRecord`, `readScanRecord`, `saveScanRecord`, `scanCompatibility` |
| `js/assessment-report.js` | Self-contained printable HTML report and CSV export, with selected-date and method-aware comparisons | `assessmentReport`, `assessmentCSV`, `assessmentDownload` |
| `js/photo-quality.js` | Provisional photo review heuristics and a provider review hook; no landmarks persisted | `checkPhotoPose`, `reviewPosePhoto`, `photoCheckSummary` |
| `js/scan-camera.js` | Optional live body-capture preview, full-frame JPEG capture and camera lifecycle cleanup | `createScanCamera`, `stopScanCameras` |
| `js/photo-identity.js` | Transient exact-file reuse checks before review and final four-view measurement; no digests persisted | `duplicatePhotoView`, `requireDistinctPhotos` |
| `js/body-outputs.js` | Versioned photo-output definitions, eight front-view bilateral joint estimates and same-assessment side comparisons | `BODY_OUTPUTS`, `estimateFrontSegments`, `compareBodySides` |
| `js/screen-profile.js` | The athlete, Coach's Corner, who can see them | `screenProfile` |
| `js/account.js` | Account & settings route + its sheets | `screenAccount`, `openSeasonState`, `openExportEverything`, `openChangePassword`, `openRenameHousehold` |
| `js/screen-activity.js` | Activity as a route + the three media states | `openActivity`, `screenActivity` |
| `js/screen-edit.js` | Edit the athlete (name, birthdate, hand, sport, positions, level) | `openEditAthlete`, `edSave` |
| `js/trainer-onboarding.js` | Pro Trainer application + post-submit status | `startTrainerOnboarding`, `trainerStatusScreen`, `tr*` |
| `js/monitoring.js` | Sentry error reporting, scrubbed hard for a children's app (no replay, no PII, no console/UI breadcrumbs) | `reportError` |
| `js/admin.js` | Admin-only trainer review queue + decisions | `openAdminQueue`, `adminReviewTrainer`, `adminSetVerification` |
| `js/admin-drills.js` | Admin-only drill library editor — training content, its source, and step images | `openAdminDrills`, `adminEditDrill`, `adminSaveDrill`, `adRenderImages` |
| `js/marketplace.js` | Parent-side browse / book / message / pay | `openMarketplace`, `viewTrainer`, `openMyBookings`, `payBooking` |
| `js/trainer-services.js` | Trainer-side services + booking requests | `openTrainerServices`, `openTrainerBookings` |
| `js/journey.js` | Athlete diary screen + sport visuals | `screenJourney`, `sportGradient`, `MEDIA_MAX`, `fmtDate` |
| `js/log-game.js` | Log a game: two steps, commits at the end of step 1 | `openLogGame`, `STAT_PRESETS`, `lgCommit` |
| `js/sheets.js` | Bottom-sheet actions (log game, milestone, media, goals, measures, invite, delete) | `sheet`, `openLogGame`, `openAddMilestone`, … |
| `js/invites.js` | Invite redeem: the invite, accepted, expired | `renderRedeem`, `acceptAndEnter`, `INVITE_ROLE` |
| `js/pwa.js` | Install banner + push + service-worker registration | `enablePush`, `initInstallBanner`, `registerServiceWorker` |
| `js/init.js` | Defines **`boot()`**; auth-state listener; `popstate` router | `boot()`, `bootError` |
| `js/landing.js` | **Entry point** — decides marketing page vs. app, then calls `boot()`; loaded last | `enterApp` |

CSS: `css/landing.css` (loaded first) + `css/app.css`.
Assets: `manifest.webmanifest`, `sw.js`, `icon.svg`, `og.png`, `sitemap.xml`, `llms.txt`, `img/brownpig-logo-*.png`.

## The landing page and the app share one URL

`/` serves `index.html`, which ships **both**: the static marketing markup in `#landing`,
and the empty SPA mount `#root` (`hidden`). Nothing above the fold needs JavaScript or
Supabase — the app modules stay at the end of the body.

`js/landing.js` runs last and calls `enterApp()`, which hides the landing markup, adds
`body.in-app`, pushes `#app`, and calls `boot()`. It fires immediately for anyone who is
installed, already signed in, or arriving on an app link (`#app`, `?invite=`, a recovery
hash, `?source=pwa`, a Stripe return); otherwise it waits for a CTA. A tiny inline script
in `<head>` makes the same call synchronously so a returning parent never sees a flash of
marketing.

**Do not move the app to `/app`.** Installed phones cached `start_url:"/"` at install
time; moving it would make every existing home-screen icon open the marketing page.
`start_url` and `scope` in the manifest are load-bearing — leave them alone.

`css/landing.css` loads **before** `app.css` and hides `#appbg` / `#appveil` / `#a2hs`
under `body:not(.in-app)`; the app's fixed sport photo would otherwise show through the
marketing page. Note that `#landing a` must **not** set `color` — an ID selector there beats
every `.lp-b*` button rule and leaves the buttons with inherited text.

## Known deviations
- `js/pwa.js` still registers the service worker from `init.js` at load (correct — the
  install prompt depends on it). `handleStripeReturn` and `initInstallBanner` now run
  from `enterApp()` instead, so they never fire on the marketing page.
- `beforeinstallprompt` fires once and early — usually while the landing page is still
  up. `landing.js` stashes it on `window.__ppInstallPrompt`; `initInstallBanner` seeds
  itself from that. Drop either half and the in-app Install button silently does nothing.
- Routing is hash-based (`#week`, `#growth`, …) because this deploys as static files
  with no rewrites — `/growth` would 404 on refresh. `renderApp(tab, fromPop)` owns the
  history entry; only the `popstate` listener in `init.js` passes `fromPop`.
- `POSITION_SKILLS` in `program.js` hardcodes position codes that must match
  `positions.code` in Supabase. A drifted code is skipped **silently** — the athlete
  quietly falls back to generic drills with no error.
- Training content has **two sources on purpose**: the `drills` table (curated, citable,
  editable without a deploy) and the constants in `program.js` (the offline fallback and
  the bulk of the library). `skillsFor` merges them, DB first within each tier. Migrating
  a sport out of `program.js` and into the table is safe to do one band at a time.
- **Never populate `drills.source_name` for content whose origin you can't verify.** The
  UI shows a citation only when one exists, so a NULL source correctly reads as "uncited".
  A fabricated citation would be worse than none at all.

## Four rules the Week screen encodes (design handoff, app screens §2; the fourth added 2026-09-13)

These look like styling choices and are not. Each one is load-bearing:

1. **The streak counts WEEKS, never days** (`weekStreak`). A day-level streak makes a
   rest day read as a broken run, which contradicts everything else the app says. Rest
   days count automatically; a week counts when every non-rest day was done or moved.
   Past plans aren't stored, so each week is regenerated — `buildProgram` is pure and
   deterministic, so week N always rebuilds identically. It rebuilds against *today's*
   schedule and goals, so a mid-season change can judge an old week against the wrong
   plan. Acceptable for a streak counter and nowhere else.
2. **A missed day rebalances, it never fails** (`rebalanceWeek`). The session moves to
   the next open day in the same week; the original reads "Moved to Fri". Load is
   conserved — it swaps with a rest day, never stacks. If the swap would take the week
   below `MIN_REST_DAYS`, or there is no open day, it drops silently. **Nothing ever
   carries into next week.**
3. **No red anywhere.** A missed day is grey and dashed. Clay is reserved for game day.
   `rebalanceWeek` returns `t:'moved'`, which maps to the grey `.t-moved` tag.
4. **A parent can change one day a week, and only toward rest** (`applyWeekChange`, table
   `week_exceptions`). Skip a home session, move it to a rest day later in the week, or swap it for
   a card of the same kind. A skip adds rest; a move or a swap leaves the rest and work counts
   unchanged. Nothing moves onto a practice, a game, another session, a cancelled team day or the
   evening before a game, and a change made against a plan that has since changed is ignored rather
   than forced. The streak rebuilds each past week with its own cancellations and its own change.

`rebalanceWeek` is a view transform, not a write — the plan regenerates every render, so
there is nothing to persist and nothing that can drift out of sync.

## Onboarding puts the account LAST

Six steps: child → sport → season → goals → **reveal** → account. The first five run with
**no session at all**, which is why `sports`/`positions`/`metrics`/`drills` carry anon
SELECT policies. `buildProgram` is pure, so the reveal shows a real generated week before
anyone is asked for an email.

**The catch, and how it is handled.** Email confirmation is ON, so `signUp()` returns no
session — and the RPC that saves the profile needs one. So `obStash()` writes the answers
to `localStorage` (`pp_pending_profile`, 7-day TTL) and `afterLogin()` replays them the
moment a session appears. Consequences worth knowing:

- **Nothing about the child touches the network before the account exists.** Verified:
  zero DB calls between the first screen and `signUp()`. That is the handoff's
  consent-timing requirement, not an implementation detail.
- Confirming on a **different device** loses the stash — they land back in onboarding and
  re-enter it. Annoying, not broken, and better than writing a child's name to a server
  before consent has been captured.
- `finishOnboarding()` is now reachable from three places (the reveal for siblings, the
  account step, and the `afterLogin` replay). Only two have a visible button, so every
  DOM lookup in it is null-guarded.

`obSteps()` drops the account step whenever `state.user` exists — siblings and
half-finished signups both end at the reveal.

The anon SELECT policies are the one piece of this that is a product decision rather than
a mechanic: the catalogue and the published drill library became readable without an
account. Nothing there is personal, and anyone could read all of it by signing up free —
but to reverse it, drop the four `*_read_anon` policies and the reveal falls back to the
`program.js` constants.

## Growth, Profile and Account

`screenProfile` was doing eight jobs. It is now **two routes**: Profile (the athlete,
Coach's Corner, who can see them) and `account` (household, password, notifications,
export, legal, deletion, log out). `account` is in `APP_TABS` so the hash router and
Back handle it, but it has no nav button — `bindNav` lights Profile while you're in it.

Three rules on these screens that look cosmetic and are not:

1. **Trend bars: taller always means better.** `trendBars(list, lowerIsBetter)` inverts
   the scale for time-based metrics. Without it a 40-yard dash going 8.6 → 7.9 draws the
   best time as the shortest bar — the screen reading backwards.
2. **No weight suggested under 13.** `SUGGEST_METRICS` omits it for every band and the
   empty state points at a pediatrician. Weight stays available under "+ Record"; it is
   simply never *suggested*. A deliberate safeguarding call, not an oversight.
3. **Coach's Corner lives on Profile.** It is the parent-experience question removed
   from onboarding. Delete it here and `state.coach` never gets set, and the feature
   silently dies.

**Contrast tokens** (`--muted` `#6C6A63`, `--clay-ink` `#A34E30` for text ≤13px,
`--danger` `#B4451F`, `--pp-placeholder` `#A5A296` for empty inputs only). Contrast is
a pairing, not a colour — `--clay` `#C0603F` is fine as a border or a fill and fails as
a 10px label.

## Notifications are two named toggles

`notification_prefs(guardian_id, weekly, game_day)`. **A missing row means both are on**
— the table records preference, not permission; permission lives in the browser and in
`push_subscriptions`. Turning a switch on calls `enablePush()` first, so we never store
"yes please" against a device that can never receive anything.

Both types actually send, which is the point — the design's argument for splitting the
ask is that nobody grants push to a vague request but will for a game-day reminder, so
a dead toggle would defeat it:

| Function | Cron | What it does |
|---|---|---|
| `notify-weekly` | `0 22 * * 0` | Sunday, "your week is ready" |
| `notify-gameday` | `0 23 * * *` | Nightly; sends only if TOMORROW is a game day for someone in season and not cancelled |
| `notify-daily` | `12 20 * * *` | 4:12pm Eastern in daylight saving; only for a child whose published plan has something today and nothing done yet |
| `notify-measure` | `14 14 * * 0` | Sunday morning; sends only in the first seven days of the month (New York time), for a child whose last height is over 30 days old |

All four are scheduled in `supabase/migrations`, and `tests/notify-schedules.test.cjs` holds them to these times.
A cron line cannot express "the first Sunday of the month": when both day fields are set, cron runs the job when
either matches. So `measure-nudge` runs every Sunday and `notify-measure` itself skips the other Sundays.

`notify-gameday` takes `?dry=1` and `?for=YYYY-MM-DD` so it can be tested on a day that
isn't a game day. It uses Mon=0 indexing to match `DAY_LABELS` — `getUTCDay()` is Sun=0
and mixing them shifts every game by a day.

## `season_state` — where the athlete is in the year

`athlete_sports.season_state` is `in_season | offseason | between_sports`, or NULL when
never asked (every row predating the column). It is set in Profile via `openSeasonState()`. `deriveSeasonState()` falls back to reading
`season_start`/`season_end` — but **only when the family gave real dates**, so a null
column can never silently change an existing plan.

It does three things in `buildProgram`:

| State | Budget | Games | Session order |
|---|---|---|---|
| `in_season` | −1 | yes | skill first (unchanged) |
| `offseason` | +1 *(preteen and up only)* | **no** | skill first |
| `between_sports` | 0 | **no** | strength + speed first — general athletic base |

Two things to keep in mind if you touch it:
- The offseason bonus is withheld from `littles` and `youth` on purpose. For a
  six- or nine-year-old the answer to spare capacity is unstructured play, not a fifth
  session. See `SEASON_STATE[].bonusBands`.
- `games:false` gates the weekly game day. Without it, a parent selecting "offseason"
  still got "Game day" printed on every Saturday from a `game_day` set last season.
- `MIN_REST_DAYS` outranks the offseason bonus in both code paths. Verified across every
  age band and every day-of-week the rebalance can fire on.

## Adding a feature (agent playbook)
- New screen → add `js/screen-x.js`, wire a nav item in `shell.js`, add one `<script>` in `index.html` (before `init.js`, which is before `landing.js`).
- New modal/action → add to `sheets.js` (or split it if it grows past ~250 lines).
- Never add load-time code to a feature module; if something must run at startup, call it from `init.js`.
# Organization body assessments (local September 9 increment)

`js/org-insights.js` is a separate read-only organization screen mounted from `openOrgRoster`. It does not change `state.active` or enter the parent editing shell. All queries use the signed-in Supabase client, explicitly check `teams.created_by`, page memberships and measurement records, and restrict measurement batches to visible roster athletes. Root-mount and actor guards prevent stale results/exports after navigation or account changes. Exports reload access and omit raw measurement notes and family/media fields. Snapshots select one latest assessment per athlete; metadata/value conflicts reject the assessment rather than mixing values.

`20260909120000_allow_org_admin_membership_reads.sql` adds a team-scoped SELECT policy via a private, stable SECURITY DEFINER helper with an empty search path. It avoids recursion through `teams_read` and does not use an athlete-wide admin predicate, which would reveal memberships in other teams. Existing family write policies remain unchanged. `tests/org-membership-rls.sql` runs only in an empty disposable PostgreSQL database, rolls back its fixtures, and tests both read boundaries and denied admin writes. It has passed locally; full-schema staging and deployment remain outstanding.

## Main scan: temporary 3D surface

`js/body-scan.js` optionally invokes `js/surface-review.mjs` after successful length inference and before clearing captured frames. The v3 release covers temporary processing; the per-scan option defaults off. A dedicated `js/surface-worker.js` segments the four photos and intersects their manually reviewed silhouettes with canonical `js/visual-hull.js`. The research lab extends the same worker rather than maintaining a separate geometry algorithm. No surface data enters `buildScanRecord` or Supabase. The result viewer clears geometry on dismissal/save/account change; review termination clears masks, canvases and worker resources. See `MAIN-SCAN-3D.md` for scope and verification limits.

## ADR: Portable company assessment storage boundary

**Status:** Accepted for the 0.9.0 local SDK preview. Production company integration remains pending.

**Context and constraints:** Parent Playbook already saves photo-derived scalar measurements as versioned rows in `measurements`, protected by its Supabase authentication, consent refresh, row-level security and retention behavior. A buyer may use a different identity provider and database. The portable SDK must not embed Parent Playbook credentials, assume the buyer's schema, store captures automatically or create a second application data silo. Friday's live demonstration still needs a reviewable save/reopen/export/delete lifecycle.

**Options considered:** Reusing Parent Playbook's Supabase client in the package would create a fast working database demo, but would couple the buyer to this project's credentials and schema. Adding a second public Supabase table would make the demo look persistent, but would leave ownership and authorization design unresolved. A host adapter with a strict portable record takes slightly more integration work while keeping the data contract independent of the eventual company stack.

**Decision:** `js/body-sdk-record.mjs` owns scalar record preparation and client lifecycle guards. The host supplies authenticated session, authorization, write, read and delete callbacks. Every action is scoped to exact organization, subject and assessment IDs; returned data is revalidated and allowlisted before release. Stable caller-supplied assessment IDs support retry-safe upserts. Parent Playbook continues using its existing measurement-row path. The SDK demo uses a clearly labeled in-memory adapter only to rehearse the contract.

**Consequences:** Buyers can map one record contract to their own authorized API without receiving Parent Playbook database credentials. The package cannot claim production persistence or real company authentication until a host adapter is implemented and tested against that environment. Server-side authorization, audit logs, retention jobs, backup deletion and data-subject workflows remain the host's responsibility.

**Next actions:** Implement the first production adapter after the buyer identifies its identity provider, subject identifier and storage API. Verify tenant isolation, retry behavior, export logging, retention and deletion in staging. Keep surface geometry out of this scalar record unless a separate explicit geometry policy and store are approved.
