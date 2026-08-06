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
| `js/background.js` | Rotating per-sport photo background | `BG`, `SPORT_BG`, `pickBg`, `setAppBg` |
| `js/reference.js` | Load sports/positions/metrics config | `loadRef` |
| `js/auth.js` | Session lifecycle + login/signup screen | `afterLogin`, `loadAthletes`, `renderAuth` |
| `js/onboarding.js` | First-run child/sport/goals/consent flow | `renderOnboarding`, `ob*`, `finishOnboarding` |
| `js/program.js` | Age-appropriate activity/plan engine | `ageBand`, `SKILLS`, `skillsFor`, `buildProgram` |
| `js/shell.js` | App frame: router, bottom nav, top bar | `renderApp`, `navBtn`, `topBar` |
| `js/screen-week.js` | Weekly plan screen | `screenWeek` |
| `js/screen-growth.js` | Goals + measurements screen | `screenGrowth` |
| `js/screen-profile.js` | Profile, athlete switch, sharing | `screenProfile` |
| `js/journey.js` | Athlete diary screen + sport visuals | `screenJourney`, `sportGradient` |
| `js/sheets.js` | Bottom-sheet actions (log game, milestone, media, goals, measures, invite, delete) | `openLogGame`, `openAddMilestone`, … |
| `js/invites.js` | Invite redeem flow | `renderRedeem`, `acceptAndEnter` |
| `js/pwa.js` | Install banner + service-worker registration | (runs on load) |
| `js/init.js` | **Boot** — starts the app; loaded last | `boot()`, auth-state listener |

CSS lives in `css/app.css`. Assets: `manifest.webmanifest`, `sw.js`, `icon.svg`, `og.png`.

## Adding a feature (agent playbook)
- New screen → add `js/screen-x.js`, wire a nav item in `shell.js`, add one `<script>` in `index.html` (before `init.js`).
- New modal/action → add to `sheets.js` (or split it if it grows past ~250 lines).
- Never add load-time code to a feature module; if something must run at startup, call it from `init.js`.
