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
| `js/onboarding.js` | First-run child/sport/goals/consent flow | `renderOnboarding`, `ob*`, `finishOnboarding` |
| `js/program.js` | Age-appropriate activity/plan engine | `ageBand`, `SKILLS`, `POSITION_SKILLS`, `skillsFor`, `weeksSince`, `buildProgram`, `SEASON_STATE`, `rebalanceWeek`, `weekStreak` |
| `js/shell.js` | App frame: router, bottom nav, top bar | `APP_TABS`, `renderApp`, `navBtn`, `topBar` |
| `js/screen-week.js` | Weekly plan screen | `screenWeek` |
| `js/screen-growth.js` | Goals + measurements screen | `screenGrowth` |
| `js/screen-profile.js` | Profile, athlete switch, sharing | `screenProfile` |
| `js/screen-edit.js` | Edit the athlete (name, birthdate, hand, sport, positions, level) | `openEditAthlete`, `edSave` |
| `js/trainer-onboarding.js` | Pro Trainer application + post-submit status | `startTrainerOnboarding`, `trainerStatusScreen`, `tr*` |
| `js/monitoring.js` | Sentry error reporting, scrubbed hard for a children's app (no replay, no PII, no console/UI breadcrumbs) | `reportError` |
| `js/admin.js` | Admin-only trainer review queue + decisions | `openAdminQueue`, `adminReviewTrainer`, `adminSetVerification` |
| `js/admin-drills.js` | Admin-only drill library editor — training content, its source, and step images | `openAdminDrills`, `adminEditDrill`, `adminSaveDrill`, `adRenderImages` |
| `js/marketplace.js` | Parent-side browse / book / message / pay | `openMarketplace`, `viewTrainer`, `openMyBookings`, `payBooking` |
| `js/trainer-services.js` | Trainer-side services + booking requests | `openTrainerServices`, `openTrainerBookings` |
| `js/journey.js` | Athlete diary screen + sport visuals | `screenJourney`, `sportGradient`, `MEDIA_MAX`, `fmtDate` |
| `js/sheets.js` | Bottom-sheet actions (log game, milestone, media, goals, measures, invite, delete) | `sheet`, `openLogGame`, `openAddMilestone`, … |
| `js/invites.js` | Invite redeem flow | `renderRedeem`, `acceptAndEnter` |
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

## Three rules the Week screen encodes (design handoff, app screens §2)

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

`rebalanceWeek` is a view transform, not a write — the plan regenerates every render, so
there is nothing to persist and nothing that can drift out of sync.

## `season_state` — where the athlete is in the year

`athlete_sports.season_state` is `in_season | offseason | between_sports`, or NULL when
never asked (every row predating the column). `deriveSeasonState()` falls back to reading
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
