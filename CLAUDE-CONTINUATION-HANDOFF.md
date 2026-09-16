# Parent Playbook continuation handoff

Updated September 16, 2026 (UTC). Verify this checkpoint against the repository before editing.

## Primary objective

Build credible capability parity with the public sports-science claims of FITMATCH.ai. Parent coaching, athlete journey, organizations, camps, trainer marketplace and movement video extend that core. Reproduce public capabilities and workflows without copying proprietary code, private APIs, branding or copyrighted assets. Never claim FITMATCH-equivalent accuracy without independent evidence.

## How work is accepted here

This is the standard. It replaces "the tests pass," which was previously satisfied by regex matches against files the same session had written.

- **A migration is not tested until it has run.** Apply it to a disposable PostgreSQL cluster with the real migration history replayed ahead of it, exercise it as the restricted `authenticated` and `anon` roles with emulated JWT claims, then drop the database. Source-text assertions about SQL are documentation, not tests.
- **A UI path is not tested until its DOM has been driven.** Click the handlers, read back `textContent` and element state, and record route plus source version. A screenshot is supporting evidence, never the evidence.
- **A UI change is not done until it has run in a browser.** `tools/adult-harness` loads the real app over an in-memory stand-in for Supabase holding only synthetic rows. The default scenario is a parent with Adult Training and no child; `?scenario=family` is a parent with one child against a database shaped like production today (every migration after the live head answers as missing), and it also stands in for Google Calendar. Serve the repository or a worktree root (`python -m http.server <port>`) and open `/tools/adult-harness/index.html`, then drive the screen, read back text and `window.__harness.db`, and check the console. It found a row-layout bug and a Week-screen crash (`offseason is not defined`) after every source-level test had passed. It is not a signed-in check against a real project.
- **A contract is not tested by the file that defines it.** Feed it malformed, missing, nested-forbidden and cross-tenant input and assert the failure code.
- **A migration claim requires `node tests/db/run.cjs`.** It needs a local PostgreSQL install; the JavaScript suite does not, and is unaffected on a machine without one. See `tests/db/README.md`.
- **Report what ran, not what was written.** Separate executed tests from source-text assertions in every summary. State exact commands and totals.

This standard exists because it found four real defects on 2026-09-10 that assertion-style tests had missed for an entire increment: a NULL-unsafe SQL allowlist that accepted a composition record with no `outputs` and no `provider`, a missing `assessment_id` in the audit detail, and two stale-status UI races. The JavaScript layer had rejected all three payload cases correctly; the database was the weaker layer, and nothing short of running it would have shown that.

## Review loop

Do **not** produce ChatGPT review packets. Keep the loop on Claude.

After each coherent increment, produce a review artifact addressed to a fresh Claude reviewer who has not seen the working session:

- Changed-file list, attributed increment-vs-pre-existing, and a concise diff summary
- Behaviour added and why
- Exact commands and results, with executed tests separated from source-text assertions
- Deployment and browser evidence, if any
- Risks and unsupported claims
- Proposed weighted score
- One recommended next task

For an adversarial pass, the user runs `/code-review ultra`. It is user-triggered and billed; Claude cannot launch it. It works against the local branch and does **not** need a push.

**Commit each increment to its own branch before review**, cut from a clean worktree of `origin/main`. A branch holding only the increment makes every review sharper, including Claude's own. The main checkout was clean on 2026-09-13, and a parallel session works in the same repository, so check the branch before staging and never commit on `main`.

## Verified checkpoint

- Production: https://playbookbp.com/
- Demo Room: https://playbookbp.com/friday-demo
- Company SDK: https://playbookbp.com/company-sdk-demo
- Adult persistence: https://playbookbp.com/company-persistence-demo
- Composition gate: https://playbookbp.com/company-composition-demo
- Git: `main` is at `54ff8de` (PR #119), 2026-09-16. Merged with the user's authorization, each with a merge commit after both CI jobs passed on it, stacked and merged in order, each retargeted to `main` just before its merge: PR #116 (`526d09d`, 15:32 UTC, the signed-in regression checklist), PR #117 (`6171312`, 15:33 UTC, coach invitations, the code in the invitation email, "You're invited"), PR #118 (`0579771`, 15:34 UTC, the `/#adult` link) and PR #119 (`54ff8de`, 15:34 UTC, account deletion). `main`'s tree is identical to `a372459`, the head of #119, where every total below was taken. CI passed again on `main` at `54ff8de` (run 35116272946, both jobs); the runs for the first three merges were cancelled by the next push. Before that, `main` was at `06a1468` (PR #115), 2026-09-16. PR #114 (`03572ef`, 01:49 UTC, this file after PR #113) and PR #115 (`06a1468`, 02:06 UTC, the dead-link wording) were merged with merge commits, and CI passed on both (runs 35045606059 and 35046674433); the production monitor passed against `06a1468` at 06:42 and 12:38 UTC. Before that, `main` was at `c3fcab1` (PR #113), 2026-09-16. Merged with the user's authorization, each with a merge commit after CI passed on it: PR #112 (`014a009`, 00:53 UTC, this file's record of the two policy migrations being applied) and PR #113 (`c3fcab1`, 01:43 UTC, a parent can revoke an invitation they sent). CI passed again on `main` at `c3fcab1` (run 35045231287): database suite 524/524, JavaScript 1035 passing with the archive test skipped, as it is on every CI run. Before that, `main` was at `3a0eb1f` (PR #111), 2026-09-16. Merged with the user's authorization, each with a merge commit after CI passed on it: PR #105 (`d364420`, 2026-09-15 18:51 UTC, consent on the onboarding reveal, so a signed-in parent can add a child again), PR #106 (`80de87a`, 18:52 UTC, Your training deletion controls), PR #107 (`aa14e6e`, 19:17 UTC, consent required in the database), PR #108 (`be43b9e`, 19:20 UTC, report files removed through the Storage API), PR #109 (`560a358`, 19:25 UTC, an athlete with organization records can be deleted), PR #110 (`3132ccc`, 2026-09-16 00:12 UTC, a signed-in parent writes only inside their own household) and PR #111 (`3a0eb1f`, 00:13 UTC, access to a child comes from an invitation, opened against #110's branch and retargeted to `main` when that merged). CI passed again on `main` at `3a0eb1f` (run 35039062872): database suite 524/524, JavaScript 1025 passing with the archive test skipped, as it is on every CI run. The run for `3132ccc` was cancelled when `3a0eb1f` was pushed thirty seconds later. `main`'s tree is identical to `8bf921d`, the head of #111. Before that, `main` was at `648faa2` (PR #103), 2026-09-15. Merged with the user's authorization, each with a merge commit after CI passed on it: PR #101 (`999b93a`, 14:23 UTC, a refresh of this file after PR #100), PR #102 (`f19abc7`, 15:05 UTC, this file's record of the Adult Training allowlist) and PR #103 (`648faa2`, 15:05 UTC, the Bluetooth harness test no longer depending on timing). CI passed again on `main` at `648faa2`; the run for `f19abc7` was cancelled when `648faa2` was pushed ten seconds later. Before that, `main` was at `eff7294` (PR #100): PR #100 (the buyer archive written with forward-slash entry names by `tools/sdk-zip.cjs`, and SDK v45) was merged at 14:12 UTC with the user's authorization, with a merge commit, after CI passed on its head `aaaa667`; CI passed again on `main` at `eff7294`. Before that, PR #98 (`772ac98`, the 2026-09-14 refresh of this file) and PR #99 (`ad154b8`: camp-listing validation, the narrowed homepage claims, `pp-v130` and SDK v44) were merged at 13:38 UTC with the user's authorization, each with a merge commit, and CI passed on both. Before that, `main` was at `28254f4` (PR #97), 2026-09-14. PRs #87 to #97 were merged in order between 16:37 and 16:39 UTC with the user's authorization, each retargeted to `main` and merged with a merge commit: #87 (Settings → Connections, and a row-layout fix every Your training list needed), #88 (`tools/adult-harness`), #89 (Google Calendar sync, off until a client id is set), #90 and #96 (refreshes of this file), #91 (the harness test builds to a temporary file, so running the suite never dirties a checkout), #92 (Your training → Progress over time), #93 (calendar sync can carry the parent's own workouts), #94 (the silhouette lab writes USDZ avatar files), #95 (Bluetooth equipment, an early web version) and #97 (fixes from a three-part review of that stack). CI on `main` at `28254f4` succeeded. Every change lands through a pull request and `.github/workflows/ci.yml` runs both suites on each. Merged branches are not deleted automatically (the repository setting is off), so the branches of #87 to #97 still exist. The repository is private.
- Service-worker release: **`pp-v138` live in production**, built by Railway from `main` after PR #119 merged on 2026-09-16 at 15:34 UTC; its deployment id is not recorded here, because the Railway connector is not authorized in this session. PRs #117 and #118 carried `pp-v136` and `pp-v137`; the four merges landed within two minutes, so only the last build was checked. Production smoke **29/29**, `ok: true`, at 15:36 UTC against `pp-v138`, and every served file the three releases changed — `sw.js`, `js/invites.js`, `js/sheets.js`, `js/landing.js`, `js/screen-coach.js` and `emails/invite.html` — is byte-identical to the repository once line endings are normalised. What they add: a parent can invite a coach to one child, an emailed invitation carries its code, an invitation from an account with no display name says "You're invited", the expired-link copy says two weeks, as links last (`pp-v136`); a signed-in parent's `/#adult` link opens Your training, where `js/landing.js` had rewritten it to `#app` (`pp-v137`; `tools/adult-harness` now takes `?landing=1&hash=<tab>` to go through that script); and the Team Connect screens keep naming senders when one sender's account has been deleted (`pp-v138`). The invitation and deletion changes also needed the database and function steps under "Next implementation targets" 1, done the same day. Before that, `pp-v135` was live, built by Railway from `main` after PR #115 merged on 2026-09-16 at 02:06 UTC; its deployment id is not recorded here, because the Railway connector is not authorized in this session. Production smoke **29/29**, `ok: true`, at 14:11 UTC against `pp-v135`, and the served `sw.js` and `js/invites.js` — the release's two changed files — are byte-identical to the repository once line endings are normalised. What it changes: on the screen a dead invite link lands on, a guardian who never set a display name came back from invite_preview() as the literal `A parent`, which read as "Ask A parent for a new one"; that now reads "Ask whoever sent it for a new one", and a real name is still used. It changes one served script, so the cache name moved. Before that, `pp-v134` was live, built by Railway from `main` after PR #113 merged on 2026-09-16 at 01:43 UTC; its deployment id is not recorded here, because the Railway connector is not authorized in this session. Production smoke **29/29**, `ok: true`, at 01:45 UTC against `pp-v134`. Verified against the deployed files rather than the cache assertion alone: `sw.js`, `js/screen-profile.js` and `js/sheets.js` — every file the release changed — are byte-identical to the repository once line endings are normalised, and the served Profile screen carries the Revoke control. What it adds for parents: a pending invitation can be called back. The row keeps its history and takes a `revoked_at`, the link and its code stop working, `invite_preview()` reports it as revoked and `accept_invite()` refuses it; access somebody already accepted is untouched. Before that, `pp-v133` was live, built by Railway from `main` after PR #108 merged on 2026-09-15 at 19:20 UTC; `e39be47` is the commit that moved the cache constant to `pp-v133`. Its deployment id is not recorded here, because the Railway connector is not authorized in this session. Production smoke **29/29**, `ok: true`, at 2026-09-16 00:15 UTC against `pp-v133`. PRs #109 to #111 change no file the `Dockerfile` copies, so their builds serve the same bytes, and identical files cannot show which build answered. Before that, `pp-v130` was live, deployed by Railway from `main` at `ad154b8` within minutes of PR #99 merging on 2026-09-15; its deployment id was not recorded, because the Railway connector was not authorized in that session. Production smoke **29/29**, `ok: true`, at 13:41 UTC. Verified against the deployed files: `js/camps.js` and `sw.js` are byte-identical to the repository once line endings are normalised, and the served homepage carries the height-only CDC sentence and the link to the privacy policy's body scanning section, with neither old claim anywhere on the page. PR #100's merge starts another Railway build, from `eff7294`, but none of that PR's files is copied into the image by the `Dockerfile`, so it serves the same files: production smoke was 29/29 against `pp-v130` at 14:13 and again at 14:17 UTC, with `js/camps.js` and `sw.js` still byte-identical to the repository. Identical files cannot show which of the two builds answered. The same holds for PRs #101 to #103: the `Dockerfile` copies none of their files, and smoke was 29/29 against `pp-v130` again at 15:15 UTC after the last of them merged. Before that, `pp-v129` was live, built from `main` at `28254f4` (PR #97), Railway deployment `cbe05a04-2f4b-4529-8bad-17772738fc6a` (SUCCESS, 2026-09-14 16:41 UTC). The ten deployments the earlier merges of the stack started were superseded (REMOVED); none failed. The live `sw.js` went through `pp-v127` and `pp-v128` to `pp-v129` by 16:41:40 UTC. Production smoke **29/29**, `ok: true`, at 16:46 UTC. Verified against the deployed files: `sw.js`, `css/app.css`, `js/calendar-sync.js`, `js/adult-progress.js`, `js/bluetooth-equipment.js`, `js/connections.js`, `js/adult-health-record.js`, `js/screen-adult.js`, `js/program.js`, `js/screen-week.js`, `js/shell.js` and `js/auth.js` are byte-identical to the repository once line endings are normalised, and `index.html` differs only where Cloudflare’s email obfuscation rewrites addresses and adds its decode script. Settings → Connections is visible; Google Calendar sync stays off (no client id) and Adult Training stays hidden (flag off, no account allowlisted and its migrations not applied on that date; on 2026-09-15 the migrations were applied and the owner's own account was allowlisted, so it now shows for that one account and no other). Before the merge, every app tab in the harness's family scenario and every Your training screen and sheet in its adult scenario rendered on the stack's tip with no console errors (recorded on PR #97). The merge changed no file the buyer package ships, so v43 below is still current. Before that, `pp-v123` was live from `295299b` (PR #86), Railway deployment `c8144c2d-b047-40f4-9df9-4fad9b82f07d` (SUCCESS, 2026-09-14 13:31 UTC), smoke 29/29 at 13:33 UTC, with `sw.js`, `js/adult-composition.js` and `js/screen-adult.js` byte-identical to the repository. Before that, `pp-v122` was live from `8bff7ca` (PR #84), Railway deployment `2f811f76-c1f6-4628-b760-a6c7ab52c1cf` (SUCCESS, 2026-09-14 13:01 UTC). Production smoke **29/29**, `ok: true`, at 13:02 UTC. Verified against the deployed files: `sw.js` declares `pp-v122`, and `sw.js`, `js/adult-health-record.js`, `js/adult-training.js`, `js/screen-adult.js`, `js/shell.js`, `js/auth.js` and `js/onboarding.js` (every served file PRs #82 and #83 changed) are byte-identical to the repository once line endings are normalised. Adult Training stays invisible in production: the flag is off, no account is allowlisted, and none of its migrations is applied. Before that, `pp-v120` was live from `92aa29c` (PR #81), Railway deployment `b58fbc8a-66ec-4005-aae5-c240e2e588f4` (SUCCESS, 02:38 UTC), smoke 29/29, with `sw.js`, `js/adult-nutrition.js`, `js/screen-adult-eating.js`, `js/screen-adult.js` and `js/account.js` byte-identical to the repository. Before that, `pp-v119` was live, built from `main` at `93fa384` (PR #78), Railway deployment `6ce8aebe-8cb1-4c1d-ab82-f840219f8841` (SUCCESS, 2026-09-14 00:27 UTC). Production smoke **29/29**, `ok: true`, re-run at 02:08 UTC. Verified against the deployed files: `sw.js` declares `pp-v119` (last modified 2026-09-14 00:13:21 UTC), and `sw.js` and all fourteen app scripts changed since `c499bef` (`js/account.js`, `js/adult-training.js`, `js/auth.js`, `js/body-scan.js`, `js/core.js`, `js/program.js`, `js/scan-record.js`, `js/screen-activity.js`, `js/screen-adult.js`, `js/screen-growth.js`, `js/screen-scan.js`, `js/screen-week.js`, `js/sheets.js`, `js/shell.js`) are byte-identical to the repository once line endings are normalised. `index.html`, `/privacy` and `/datadeletion` differ only where Cloudflare’s email obfuscation rewrites addresses and adds its decode script; with that normalised they match too. The release’s code is ahead of its database: none of the seven migrations listed first under “Next implementation targets” is applied, and each part of the app that needs one falls back or stays hidden until it is (see that list). `pp-v120` (PR #79) was not yet deployed. Before that, `pp-v114` was live, built from `main` at `c499bef` (PR #70, the parent-experience audit), Railway deployment `381a7201-da85-456c-8c29-714ce290d40e` (SUCCESS, 2026-09-13 21:50 UTC). Production smoke **29/29**, `ok: true`, at 21:52:47 UTC. Verified against the deployed files: `sw.js` declares `pp-v114` (last modified 21:50:15 UTC), and `sw.js`, `css/app.css`, `js/account.js`, `js/body-scan.js`, `js/journey.js`, `js/screen-coach.js`, `js/screen-growth.js`, `js/screen-profile.js`, `js/screen-scan.js`, `js/screen-week.js` and `js/shell.js` — every file the release changed — are byte-identical to the repository once line endings are normalised. The release carries no migration and no edge function. Its scan release version is `2026-09-13.ondevice.v5`, which makes every earlier scan consent stale, so each parent is asked again before their next scan. Before that, `pp-v113` was live, verified 2026-09-13 01:27 UTC against `main` at `ddf3ec5`. The deployment id was not recorded when it shipped and is not recorded here. Production smoke **29/29**, `ok: true`. Verified against the deployed files: `sw.js` declares `pp-v113` (last modified 2026-09-13 00:20:06 UTC), and `sw.js`, `js/invites.js`, `js/sheets.js`, `js/screen-week.js`, `js/screen-profile.js` and `emails/invite.html` are byte-identical to the repository once line endings are normalised. The release’s backend is live too: migration `20260912123000_family_wide_parent_invites` is applied to the ParentPlaybook project with a version matching its filename, and the `send-invite` (v8, 00:22:51 UTC) and `send-invite-sms` (v7, 00:23:05 UTC) edge functions were redeployed after `2178f8f`, the last commit to touch them, and carry its household-wide invite logic. No invite was sent to verify delivery, because that would email or text a real person. Before that, `pp-v112` live in production, built from `main` at `5e8b500` (deployment `e758c005-0c80-4ef4-a079-233de0a47aec`, 2026-09-12 08:16 UTC). Production smoke **29/29**, `ok: true`. Verified against the deployed files: `js/org-composition.js`, `js/composition-sharing-ui.js`, `js/composition-import-supabase.mjs`, `js/org-insights.js`, `js/body-insights.js` and `sw.js` are byte-identical to the repository once line endings are normalised; all seven app scripts load in dependency order; the service worker precaches both new scripts; the shared-measurements section is guarded so it cannot take the roster screen down; and the deployed org source still orders by athlete name, carries no sort control, and names the uses these readings are not for. Before that, `pp-v111` live in production, built from `main` at `6b8a011` (deployment `a60831e8-eb89-4df9-9283-59a9e6972d8f`, 2026-09-12 08:02 UTC). Production smoke **29/29**, `ok: true`. Verified against the deployed files rather than the cache assertion: `js/composition-import.mjs`, `js/composition-import-ui.js`, `js/composition-import-supabase.mjs`, `js/body-composition-reference.mjs`, `js/body-insights.js` and `css/body-insights.css` are all byte-identical to the repository once line endings are normalised; `index.html` loads the import screen after `dates.js` and `core.js` (it needs `localDay` and `esc` from them); the service worker precaches the three import modules; and `body-insights.js` carries the Import button and opens the sheet. Before that, `pp-v110` ran from `ecab430` (deployment `c93bac6d-f44e-48eb-8dfa-bc121c23e0f8`, 2026-09-11 19:51 UTC), smoke 29/29. Verified against the deployed file: `/js/device-evidence.js` is byte-identical to the repository once line endings are normalised, and carries the viewport guard, the `unknown` device class and the `served-sw.js` build fallback. Before that, `pp-v109` ran from `dfec45d` (deployment `2ab8fcb6`, 19:25 UTC). Before that, `pp-v108` ran from `fe495d3` (deployment `9e4515d8`, 18:59 UTC). Before that, `pp-v107` ran from `cdff443` (deployment `750e7051`, 16:52 UTC). Before that, `pp-v106` ran from `7bb5290` (deployment `d8f4498c`, 16:14 UTC). Before that, `pp-v105` ran from `e43df43` (deployment `793577ce`, 15:40 UTC). Before that, `pp-v104` ran from `720a545` (deployment `2b16a88a-0583-4df8-89e6-2a54cc1ab987`, SUCCESS 14:05 UTC). Earlier, `pp-v97` (deployment `5b3e8959-4af3-45eb-83a8-79a350fcfd78`) was verified against the deployed files rather than the cache version: `js/dates.js` byte-identical to the repository and returning the local day for a 23:30 local timestamp, the biometric consent gate in the deployed `js/body-scan.js` filtering on `todayISO()`, and no UTC-day expression left in it.
- Railway deployment: `cbe05a04-2f4b-4529-8bad-17772738fc6a` (SUCCESS, 2026-09-14 16:41 UTC), built from `28254f4` on `main`; before it, `c8144c2d-b047-40f4-9df9-4fad9b82f07d` (SUCCESS, 13:31 UTC) from `295299b`, `2f811f76-c1f6-4628-b760-a6c7ab52c1cf` (SUCCESS, 13:01 UTC) from `8bff7ca`, `b58fbc8a-66ec-4005-aae5-c240e2e588f4` (SUCCESS, 02:38 UTC) from `92aa29c`, `6ce8aebe-8cb1-4c1d-ab82-f840219f8841` (SUCCESS, 00:27 UTC) from `93fa384`, and `381a7201-da85-456c-8c29-714ce290d40e` (SUCCESS, 2026-09-13 21:50 UTC) from `c499bef`, and before that `2b16a88a-0583-4df8-89e6-2a54cc1ab987` (SUCCESS, 2026-09-11). Project `a6dca082-fbe5-4bc9-b2a6-3f6eaf92e7e2`, service `caf9bbfb-1084-422b-913a-2b90d004410f`, environment production. The service source is branch `main` with `checkSuites: false`. Pushing a feature branch still does not deploy, but **merging to `main` now does**: the PR #2 and PR #3 merges each produced a build carrying `commitHash` and `branch: main` in its metadata, where every earlier deployment carried only `reason: deploy` from a `railway up` upload.
- Production backend: **all 100 migrations on `main` at `54ff8de` are applied** to the live project, each with the user's authorization: the eight waiting since 2026-09-12 on 2026-09-15 before PR #99 merged, `20260915120000_camp_listing_validation.sql` right after, `20260915180000_child_creation_requires_consent.sql`, `20260915200000_composition_report_removal.sql` and `20260915210000_athlete_delete_audits.sql` later that day, and `20260915220000_household_write_boundaries.sql` and `20260915230000_access_grants_come_from_invites.sql` on 2026-09-16 at about 00:20 UTC, and `20260916120000_coach_invites.sql` and `20260916140000_account_deletion_leftovers.sql` on 2026-09-16 at about 15:39 UTC. Its schema matches a cluster built from all 100 object for object — 1854 objects, fingerprint `a5b7e5c18ce2fea88d5aa760af94eb13`, all nine kinds identical (`tests/db/inventory.sql` against the project, `node tests/db/run.cjs --inventory` for the other side) — and the recorded version-and-name list hashes identically to the repository's (`0bc7dd91771717ae6fe51c63fdbce473`). The 15 edge functions were deployed from `main` at `28254f4`; on 2026-09-15 the new `composition-report-retention` (v1, JWT verification on) was deployed and `delete-athlete` (v7, JWT verification on) and `delete-account` (v10, `--no-verify-jwt` as before) redeployed, from `main` at `560a358`; on 2026-09-16 `send-invite` (v10, `--no-verify-jwt` as before), `send-invite-sms` (v9, JWT verification on as before) and `delete-account` (v11, `--no-verify-jwt` as before) were redeployed from `main` at `54ff8de`. Nothing waits: no migration on `main` is unapplied, and no function on `main` is undeployed. The evidence is under "Next implementation targets" item 1.
- Full JavaScript suite: **1055/1055 passing** — `node --test "tests/*.test.cjs"` on branch `delete-account-leftovers` at `a372459`, whose tree `main` at `54ff8de` carries unchanged, in a checkout holding the current archive, nothing skipped. CI has no archive, so there the same suite reports 1054 passing and one skipped: the test that opens the archive `BODY-SDK.md` names skips rather than passes. The Info-ZIP extraction test skips likewise where `unzip` is not installed; it ran on CI's Ubuntu runner. `.github/workflows/ci.yml` also runs it, and the database suite, on every pull request and every push to `main`
- Executable database tests: **547/547 passing** (526 security cases plus a 21-case restore and deletion rehearsal) — `node tests/db/run.cjs`. It creates a throwaway PostgreSQL cluster, replays the real migration history into it, runs the suite as the restricted `authenticated` and `anon` roles, then destroys the cluster. It cannot be pointed at an existing server. It passed here on branch `delete-account-leftovers` at `82620bf` on 2026-09-16, again inside the extracted v52 package, and on CI's Ubuntu runner for `main` at `54ff8de` (run 35116272946). Left out with `--migrations-from`: without `20260916140000_account_deletion_leftovers.sql`, seven of the thirteen account deletion cases fail; without `20260916120000_coach_invites.sql` (checked on branch `invite-message-fixes` at `a626fe8`), eight of the ten coach invitation cases fail with the error production gives. Before those cases it passed 524/524 here and on CI's Ubuntu runner for `main` at `3a0eb1f` (run 35039062872). Windows Smart App Control blocked `dropdb.exe` on the workstation for about an hour on the evening of 2026-09-15, which is the only thing that stopped the rehearsal's last case there; it runs again.
- Migration replay into a disposable cluster: **99 of 100 applied**; only `20260812174514_enable_cron_and_net.sql` fails, because pg_cron and pg_net binaries are unavailable outside Supabase
- Production smoke: **29/29**, `ok: true`, re-run 2026-09-16 at 15:36 UTC against `pp-v138` — `node tools/deployment-smoke.cjs https://playbookbp.com/` (24 paths that must serve, 5 that must stay private). `.github/workflows/production-monitor.yml` runs it every six hours; its first scheduled run, at 18:28 UTC on 2026-09-13, succeeded.
- Supabase migration **committed to the live project on 2026-09-10** (`xqvqjkdxykowwpcmyudz`, Postgres 17.6), after three rollback-only rehearsals. Applied in one transaction that also recorded `supabase_migrations.schema_migrations` at version `20260910190000`, matching the repository filename, so a later `supabase db push` sees it as applied. All seven function body md5s match the local cluster byte for byte. `company_composition_providers` and `company_composition_results` both exist, both have RLS enabled, both hold **zero rows**, `anon` has no privilege on either and is denied through the public API, and `authenticated` holds exactly `SELECT` on the registry and CRUD on results. Supabase security advisors report **no new findings** attributable to this migration.
- Weighted parity: 40.75/100, reported as 40.75% or 41% rounded, under rubric version 2 (adopted 2026-09-13 at 39, when three FITMATCH-claimed categories were added; the same stages scored 42.75 under version 1). FM15 has since moved 0.25 -> 0.5 on the locally tested results API, and FM16 0 -> 0.25 on the Node-tested WebView message bridge. An internal engineering estimate, not independently verified parity.
- SDK ZIP: **current handoff build** `tools/sdk-releases/parent-playbook-sdk-0.13.0-friday-final-v52.zip`, SHA-256 `40295B2502C3E3E57AD2DCB7C630CEA6F30DD488E32DB384770F84D55922BE3E`, 675,633 bytes, 226 payload files plus `manifest.json` and `signature.json` (228 archive entries, one per file, no directory entries), payload digest `e36df99c624a0251acf0b7e8983103cf600fecb850d45ff3a8eeca920a57fa13`. Cut 2026-09-16 from branch `delete-account-leftovers` at `82620bf`, in a clean worktree, for the pull request that lets an account that made things elsewhere be deleted. Signed with key `0cc2d189c342212d23d250264f8ab71d`; public half committed as `SIGNING-KEY.pub.pem` and deliberately not bundled. The private key lives outside the repository at `~/.parent-playbook-signing/`; back it up. The archive is copied into the main checkout's `tools/sdk-releases/` (ignored by git), beside v51, which branch `invite-message-fixes` records. **What changed from v51** (`2d4f7cff6efbc62f828fce46223d35ae8435155ed9eebf634e135431ba98a5fc`): the package gained `20260916140000_account_deletion_leftovers.sql` and changed four files (`tests/db/security-tests.cjs` with cases AG01–AG13, `tools/sdk-files.cjs`, `HANDOVER.md`, `tests/db/README.md`); comparing the manifests file by file, nothing else differs but `manifest.json` and `signature.json`. v51 and earlier are stale. Verified from a copy extracted with Info-ZIP unzip (exit 0, `unzip -t` clean): `node tools/acceptance.cjs` with `PP_SDK_PUBLIC_KEY` set -> **7/7** (manifest 226/226, exclusions clean, contracts 335/335, database 547/547, on a disposable cluster built from the package’s own 100 migrations — 526 security cases plus a 21-case restore and deletion rehearsal — signature verified against the repository copy of the public key, host serving modules that match the manifest). The same files passed all 547 on CI's Ubuntu runner for `main` at `54ff8de` (run 35116272946). Windows `Expand-Archive` extracts the same 228 files. **Why v45 existed.** Every archive through v44 was zipped by hand with PowerShell's Compress-Archive, which stored entry names with backslash separators where the ZIP specification requires forward slashes; Info-ZIP unzip exits 1 on them and Python's zipfile on macOS or Linux extracts a flat pile of files. `tools/sdk-zip.cjs` writes the archive instead: one entry per file, forward-slash names in byte order, no dependency, and it refuses a name containing a backslash. **To cut the next archive:** `node tools/sdk-bundle.cjs <dir>`, then `node tools/sdk-sign.cjs --sign <dir> --key ~/.parent-playbook-signing/pp-sdk-signing-key.pem`, then `node tools/sdk-zip.cjs <dir> <dir>.zip` — never Compress-Archive — then extract the archive and run `tools/acceptance.cjs` inside the extracted copy. `tests/sdk-archive.test.cjs` fails if the archive `BODY-SDK.md` names carries a backslash in any entry name.

Read FITMATCH-PARITY-PLAN.md, FRIDAY-DEMO-READINESS.md, BODY-SDK.md, BODY-MEASUREMENT-DICTIONARY.md, ARCHITECTURE.md and any applicable AGENTS.md before editing.

## Current composition state

The project validates a provider manifest, exact provider/model estimate binding, five supported scalar outputs, uncertainty disclosure and independent coded DXA comparison rows. It computes descriptive bias, MAE, RMSE and maximum error while excluding participant and scan codes from aggregate export.

An organization-scoped composition storage and history layer is implemented: `js/body-composition-record.mjs` (record contract plus store), `js/body-composition-supabase.mjs` (adapter) and `supabase/migrations/20260910190000_company_composition_results.sql` (table, payload allowlist, RLS, audit trigger, retention sweep). Adult-reference and child-athlete scopes are structurally separate — an `adult_reference` row cannot carry an `athlete_id`, enforced by a table CHECK. Step 4 of `/company-composition-demo` lists real stored history and currently reads "No stored composition results."

Provider eligibility is enforced in the database: `public.company_composition_providers` is a platform-written registry, results carry a composite foreign key to it, and a BEFORE trigger proves the registration was unrevoked, unexpired and covered the outputs when the result was saved. An organization account cannot register its own provider.

There is no licensed body-composition model, real composition output or independent validation dataset. The UI must keep showing "Provider not configured" and generate zero composition values. FM05 remains stage 0. The schema now exists in production but **the provider registry is empty**, so no composition result can be stored by anyone until a provider is registered — and registration is a platform operation that no organization account can perform.

## Next implementation targets, in order

1. **Deploying what is merged but not live: done on 2026-09-15.** The eight
   migrations that had been waiting since 2026-09-12 were applied to the live project in filename order, and all
   fifteen edge functions were deployed from a clean detached checkout of `main` at `28254f4`. The user authorized
   it in that session; the same authorization is needed again for anything below.
   - **Preflight, read-only, before anything was applied.** None of the objects the eight migrations create
     existed, so nothing was half-applied; every helper, column and table they depend on did exist; `payments`,
     `subscriptions` and `camps` held no rows, and no `PP_SCAN_V1` measurement existed for the scan migration to
     link. Security advisors were captured first, to attribute anything new.
   - **Migrations.** Applied with `apply_migration`, one at a time, each version then corrected to its filename
     timestamp. After each, the stored statement was hashed and compared with the repository file (trailing
     whitespace trimmed): all eight matched byte for byte. `supabase_migrations.schema_migrations` now holds 92
     rows whose version-and-name list hashes identically to the repository's
     (`f9513b171c6bacd8eb4754eeac36b8a8`), so `supabase db push` has nothing to re-run. The schema matches the
     migrations object for object (fingerprint in "Verified checkpoint"). What changed for users: `week_exceptions`
     exists, so the Week screen's "Change this day" has its table; `body_scan_assessments` exists, so a new scan is
     saved as one record through `save_body_scan_assessment` (no legacy scan was linked, because production had
     none); `measure-nudge` now runs `14 14 * * 0` instead of `14 14 1-7 * 0`, and `daily-nudge` is unchanged at
     `12 20 * * *`, both still reading the service key from Vault. Adult Training's three tables exist and it stays
     hidden from every account but one: the flag is off, and later that day the owner's own account was allowlisted
     at the owner's request (see "Adult Training" below).
   - **Functions.** `npx supabase functions deploy <name> --project-ref xqvqjkdxykowwpcmyudz --use-api`, one at a
     time, with `--no-verify-jwt` for exactly the five that authenticate callers themselves: `stripe-webhook`,
     `delete-account`, `send-invite`, `notify-trainer-review` and the new `company-results-api`. There is no
     `supabase/config.toml`, so without that flag the CLI would have switched JWT verification on for them and
     broken each one. Every function's `handler.mjs` and any `_shared/` module it imports uploaded with it. The
     logs show a clean boot for all fifteen and no error since.
   - **Probes, all of which had to be refused** (nothing was sent to anybody): no credentials to `delete-account`,
     `send-invite` and `notify-trainer-review`, each 401; no signature to `stripe-webhook`, 400 "Bad signature";
     a preflight to the four push functions, 403 from their own scheduler check; `company-results-api` with no key,
     401 with its `WWW-Authenticate` challenge, and with a well-formed unknown key, 401 `invalid_key` raised by
     `private.company_api_authenticate` — which is the function, the service-role grant and the new migration
     working end to end.
   - **Afterwards.** Security advisors gained exactly two findings, both expected and by design:
     `create_company_api_key` and `revoke_company_api_key` are SECURITY DEFINER functions signed-in users may call,
     and each checks `private.is_admin_of_team` before doing anything. Production smoke 29/29 against `pp-v129`.
   - **The ninety-third.** `20260915120000_camp_listing_validation.sql` was applied right after PR #99 merged,
     the same way: stored text byte-identical to the file, version corrected. Production then recorded 93
     migrations whose list hashes identically to the repository's (`d560dc85dd2f1b96c8e5646ef87a8dfc`), and its
     schema matched a cluster built from all 93 (1851 objects, fingerprint `1238d53fca9c9dd435da4ef2d048f515`; four
     more constraints than before, nothing else). A probe in a block that aborts itself tried four inserts against
     the live table: a `javascript:` sign-up link, ages 12 to 8 and an end before the start were each refused, an
     ordinary listing was accepted, and the abort kept none of them — `camps` still held no rows. Advisors unchanged.
   - **The ninety-fourth to ninety-sixth.** After PRs #107 to #109 merged on 2026-09-15, and with the user's
     authorization, `20260915180000_child_creation_requires_consent.sql`, `20260915200000_composition_report_removal.sql`
     and `20260915210000_athlete_delete_audits.sql` were applied in that order the same way: each stored text identical
     to its file, each version corrected. Between the second and the third, at 19:32 UTC, the new
     `composition-report-retention` was deployed with JWT verification on, and `delete-athlete` and `delete-account`
     were redeployed. Checked afterwards, read-only or in blocks that abort themselves: `ath_insert` is gone and the
     deferred consent check is in place; `create_athlete_onboarding` refused a call with no consents, one with a
     malformed list and one with a single consent (22023); `external-composition-report-retention` is scheduled at
     `45 3 * * *`; all three functions refuse a call with no credentials (401), and a call made the way that job makes
     it returned 200 with nothing to remove; both replaced audit functions keep their empty search path. Production then
     recorded 96 migrations whose list hashes identically to the repository's, and its schema matched a cluster built
     from all 96 (fingerprint in "Verified checkpoint"). Of the security advisors' findings, one comes from these
     migrations, expected and by design: `can_delete_athlete` is a SECURITY DEFINER function signed-in users may call,
     and it answers only whether the caller may delete that athlete. The retention job's first scheduled run, at 03:45
     UTC on 2026-09-16, has not been read.
   - **The ninety-seventh and ninety-eighth.** Straight after PRs #110 and #111 merged, on 2026-09-16 at about 00:20
     UTC and with the user's authorization, `20260915220000_household_write_boundaries.sql` and
     `20260915230000_access_grants_come_from_invites.sql` were applied in that order the same way: each stored text
     identical to its file (md5 of the statement with trailing whitespace trimmed), each version corrected to the
     filename's timestamp. No function or client change went with either. Preflight, read-only: 96 migrations recorded
     with the expected list hash, each policy still in its old form, none of the three new helpers present. Afterwards,
     from the catalogue: `fm_insert`, `fm_update` and `aa_insert` are gone, `ath_update`, `consent_ins` and `aa_update`
     carry their new checks, `fm_select`, `fm_delete`, `aa_select`, `aa_select_org` and `aa_delete` are untouched, and
     all three helpers are SECURITY DEFINER with an empty search path, executable by `authenticated` and not by `anon`.
     One probe, in a block that aborted itself, ran as a real signed-in household owner: moving their child into another
     household, recording a consent for a child outside their household, adding another account as a member, granting
     that account access to their child and upgrading an existing live grant were each refused; editing their own child,
     recording a consent for their own child and revoking a grant were accepted. Nothing was kept — the counts came back
     unchanged, with no probe row and no revoked grant. Production then recorded 98 migrations whose list hashes
     identically to the repository's (`72136eeb522d9896fefd4baa92bcb243`), and its schema matched a cluster built from
     all 98 object for object (fingerprint in "Verified checkpoint"; three write policies fewer and three private
     helpers more than before). Security advisors were unchanged: the new helpers live in `private`, which the linter
     does not reach, and no tenant role may execute them.
   - **Still to do here.** (a) The sending path of the redeployed push functions — devices, VAPID keys, the push
     itself and the `notification_log` row — is still unexercised, because nothing has been due. Read on 2026-09-16 at
     13:56 UTC, read-only: all ten `cron.job` entries are active and none has ever failed. `daily-nudge` answered 200
     on 2026-09-15 (above). `gameday-push` fired at 23:00 UTC and `notify-gameday` answered 200 with
     `{"ok":true,"tomorrow":"2026-09-16","matches":0,"sent":0}`. `external-composition-report-retention` had its first
     scheduled run at 03:45 UTC on 2026-09-16: 200, `{"ok":true,"reports_removed":0,"records_deleted":0,"more":false}`.
     The five SQL retention sweeps succeeded at 03:20–03:55 UTC on both days. The function logs since the redeploy
     show boots, 200s and shutdowns, and no error; the only 401s are the no-credential probes of 2026-09-15.
     `weekly-plan-push` last ran on 2026-09-13, before the redeploy, and `measure-nudge` has never run; both first
     run on the new code on Sunday 2026-09-20 (14:14 and 22:00 UTC). `notification_log` holds nine sends, all from
     the earlier code, the last at 2026-09-13 22:00 UTC (weekly), and one device is subscribed (since 2026-08-12), so
     Sunday's weekly push is the likeliest first real send; read `notification_log` on Monday.
     (b) A signed-in regression against the live project has been partly run. The request logs show one signed-in
     Windows browser, on an account with no display name, on 2026-09-16 between 01:03 and 01:57 UTC, twice: add a
     child with consent, edit it and its sport, record a measurement, tick an activity, make a one-day week change,
     create an invitation link, open it, revoke it, be refused on accepting it, and delete the child through
     `delete-athlete` — each request answered as intended, including that refusal, and PR #115 came from it. Not yet run: an invitation sent by email or
     text, a second account accepting one, a scan saved and deleted, an organization reading a child's results,
     export, Your training while signed in, and deleting an account. `SIGNED-IN-REGRESSION-CHECKLIST.md` is the
     script for those, with the defects found while preparing it: a coach invitation cannot be created (the live
     `invite_role_chk` allows only `co_parent` and `family_view`); an emailed invitation carries no code although
     the recipient is told it does; a blank display name makes invitation messages read "A invited you" (these three fixed and live since 2026-09-16); `/#adult`
     is replaced by `#app` in `js/landing.js`, which the harness does not load (fixed, live since `pp-v137`); and `delete-account` cannot delete
     the login of an account that submitted a camp listing, of an invited co-parent who created an invitation, or
     of an account that withdrew another parent's scan permission (NOT NULL or unhandled `no action` references; fixed and
     live since 2026-09-16, with coach messages, rosters and organization records).
     (c) FM15 reaches 0.75 only when an issued key exercises list, get and delete and is revoked.
   - **The ninety-ninth and hundredth, and three functions: done on 2026-09-16,** with the user's authorization, after
     PRs #116 to #119 merged and `pp-v138` was live. Preflight, read-only: 98 migrations recorded with the list hash
     above, neither new version present, `invite_role_chk` still `co_parent` and `family_view` only, no coach
     invitation (5 invitations in all), the six constraints `20260916140000` names present under those names, both
     author columns still NOT NULL, no coach update or report; security advisors captured (18 findings); the served
     `emails/invite.html` carried `{{code_block}}` and `{{sent_by_line}}`. `20260916120000_coach_invites.sql` and
     `20260916140000_account_deletion_leftovers.sql` were applied in that order with `apply_migration`, each version
     corrected to its filename, each stored statement's md5 (trailing whitespace trimmed) equal to its file's
     (`bd821cd0aaf2b98d75c60474d6f6c4e1`, `26ed5afaa0f1c3e0918da435530c4a48`). Between them, a probe in a block that
     aborted itself accepted a coach invitation for one child and refused a family-scoped one
     (`athlete_invites_coach_one_child_chk`) and an `owner` one; the count stayed 5. Afterwards: 100 migrations whose
     list hashes identically to the repository's, the catalogue exactly as tests/db AG13 expects, and the schema
     fingerprint above on both sides. Then, from a clean detached checkout of `main` at `54ff8de`, with
     `npx supabase functions deploy <name> --project-ref xqvqjkdxykowwpcmyudz --use-api`: `send-invite`
     (`--no-verify-jwt`), `send-invite-sms`, and `delete-account` (`--no-verify-jwt`), each uploading its `_shared`
     imports (`invite-code.mjs` and `invite-access.mjs`; `composition-reports.mjs`). The deployed `send-invite`
     source carries the code block, the code check and the "You're invited" wording. Without credentials all three
     answer 401 (`send-invite` and `delete-account` from their own check, `send-invite-sms` from the platform).
     Security advisors unchanged: the same 18 findings. No invitation was sent and no account deleted: sending
     emails or texts a person, and those belong to `SIGNED-IN-REGRESSION-CHECKLIST.md` sections 4 and 10. The
     account deletion choices were the user's: a deleted account's camp listings go; its rosters stay with their join
     code closed; its API keys are revoked; organization records keep its id without a link to the login; coach
     messages and reports lose their author. Still left, by decision: trainer review columns, provider approvals,
     verified attachments, and bookings, payments and reviews.
   - Supabase `apply_migration` stamps its own version. Afterwards, set
     `supabase_migrations.schema_migrations.version` to the filename's timestamp, or `supabase db push` will
     try to run the migration again.
   - After each step, re-run `node tools/deployment-smoke.cjs https://playbookbp.com/`, read the function's
     logs, and for the schedules read `cron.job`.
2. **Give calendar sync a client id.** The stack is merged and live (see "Verified checkpoint"). Google Calendar sync
   (PR #89, with #93 and #97) stays hidden until `GOOGLE_CALENDAR_CLIENT_ID` in `js/calendar-sync.js` holds a web OAuth
   client id. To create one: in Google Cloud Console, make or pick a project and enable the Google Calendar API;
   configure the OAuth consent screen with an app name, a support email, the
   `https://www.googleapis.com/auth/calendar.app.created` scope, and test users while the app is in testing; then
   Credentials → Create credentials → OAuth client ID → Web application, with authorized JavaScript origins
   `https://playbookbp.com` and a localhost origin for local testing. No redirect URI and no client secret are used:
   the browser takes a token from Google's own sign-in window and keeps it only for that sync. The client id is
   public, so nothing secret enters the repository. Google may require verification before accounts outside the
   test users can grant the scope. After setting it, run one real sync signed in to a Google account.

   **A migration, or any change to a file the buyer package ships, needs a package rebuild in the same change.**
   `tests/sdk-bundle.test.cjs` requires the package to ship every migration and `tests/deck-evidence.test.cjs`
   checks the payload digest recorded in `BODY-SDK.md`, so CI fails until the package is rebuilt, signed, accepted
   and recorded. That is why PR #95 added no migration and PR #94 kept the USDZ writer in the lab. The next pieces
   that need one: a Bluetooth source kind for the health record, avatar files in the SDK and company results, and
   organization wellness sharing. When to rebuild is the user's call.
3. **Close the last grant residual.** `20260910200000` revoked TRUNCATE, TRIGGER, REFERENCES and
   MAINTAIN from anon and authenticated on all 53 public tables, and tightened default privileges
   for the `postgres` owner so new tables do not re-inherit them. `supabase_admin`'s defaults are
   **unchanged** — the migration runs as `postgres`, which is not a member of that role, so the
   statement was skipped by design rather than failing. Migrations create tables as `postgres`, so
   the practical path is covered; a table created by `supabase_admin` would still inherit the excess
   grants. Closing it needs a connection with supabase_admin membership.

   Separately, and deliberately NOT changed: `anon` still holds INSERT/UPDATE/DELETE on most public
   tables. That is Supabase's default with row-level security as the boundary, it is what the
   application relies on, and narrowing it is a much larger decision than this one.
4. **Blocked on evidence the code cannot supply.** Body composition (FM05) needs a licensed model and its
   DEXA validation. Circumference and length accuracy (FM03, FM04) need tape references at marked heights and
   a repeat capture. Mobile embedding (FM16) needs a trial in a real iOS or Android WebView on the intended
   phone. The repeat comparator (FM09) needs a second authorized real record. None of these may be filled
   with a created personal record, demonstration values or synthetic results.

Resolved, and removed from this list: observing the retention sweeps fire. As of 2026-09-13 every job in
`cron.job` has run and succeeded, including `company-composition-result-retention` (three runs, the latest at
03:50 UTC) and `external-composition-retention` (one run, 03:55 UTC). A succeeded run shows the sweep
statement executed; it does not show that anything was due for deletion.

## Adult Training (outside the rubric)

A parent's own training record, separate from every child's athlete profile. It is **not** FITMATCH parity work:
keep it out of `tools/parity-progress.json`, which stays at 40.75.

- **Milestone 1, merged (PR #77):** profile, up to three goals, a weekly gym or activity schedule with exercises
  and ticks, and weight or tape measurements typed in by the parent. The federal activity baseline (150–300
  minutes a week, strength work on two days) is shown as a reference, never filled in.
- **Milestone 2, merged (PR #79):** a Training | Eating switch with a plate guide after USDA MyPlate (proportions,
  never amounts), food preferences and the nine labeling-law allergens to avoid, the parent's own recipes, a week
  of planned meals with a warning when a recipe carries an avoided tag, a grocery list built from those recipes,
  and two eating habits logged against aims the parent sets. No nutrient values: those would need a sourced
  dataset such as USDA FoodData Central, and the user chose parent-entered recipes for now.
- **Health record, merged (PR #82):** step 4 of the device connections roadmap. One source-tracked record of the
  parent's own readings (weight, five tape measurements, steps, active and workout minutes, distance, resting heart
  rate), each saying where it came from and whether it was entered, measured by a device or estimated by one. The
  database fixes what each source may claim, refuses duplicates, and refuses body-composition values. The first
  real source is a CSV file read in the browser, previewed, saved through `save_adult_health_import()`, and
  undoable per import. Activity is summed one source per day, so a watch export and a typed number never add up.
- **No child profile, merged (PR #83):** for an Adult Training account only, a parent with no child can reach Your
  training from child setup, the no-access screen or an `#adult` link (on the site only from `pp-v137`; before it,
  `js/landing.js` rewrote the link to `#app`); the child navigation comes off, and
  "Add your child" joins their existing household.
- **Body composition measured elsewhere, merged (PR #86):** a parent imports their own DXA, clinic, smart-scale or
  health-app result through the existing provider-neutral import, stored as an adult reference about themselves
  (subject `self`, no athlete, never shared from here). Each value shows Measured or Device estimate and its
  source, and a scale's estimate is never trended against a DXA measurement. No migration.
- **Progress over time, merged (PR #92):** step 7 of the device roadmap. A sheet in Your training with the last eight
  weeks of the parent's own record, week by week: workouts ticked off with their minutes and strength days, activity
  from the health record (one source a day, one unit across the weeks), weight readings in one unit on a scale at
  least five percent of their average wide, and days meeting the parent's own protein aim. No targets, scores or
  verdicts, and every chart has a text alternative that reads all eight weeks out. No migration.
- **Your workouts in Google Calendar, merged (PR #93):** an opt-in "Include my workouts" box in the calendar sheet,
  offered only with Your training, adds each scheduled workout for four weeks as "Your training · <title>" beside the
  children's events; unticking and syncing again takes only those off. The schedule is read, filtered by guardian,
  after Google grants access and before the calendar is touched. Connections offers the sync to a parent with Your
  training and no child. No migration.
- **Bluetooth equipment, an early web version, merged (PR #95):** step 8. In Chrome on Android or a computer only,
  never Safari or iPhone, a parent connects a heart-rate strap or a treadmill, bike or rower that follows the Fitness
  Machine standard, sees live readings, and on stopping chooses whether to save whole workout minutes and the
  distance the machine added. Heart rate is shown, never saved; machine energy is never shown. A session saves
  through `save_adult_health_import` as one undoable import from a device named "<equipment> via Bluetooth", so
  its rows carry `source_kind` `file_import` until a migration, and so a package rebuild, adds a Bluetooth kind. Not
  tried on real equipment: the parsers are tested on byte strings built from the published formats, and
  `tools/adult-harness/?bluetooth=1` provides a synthetic strap and treadmill. Since PR #103 the synthetic treadmill
  reads 10.00 km/h and notifies every 360 ms, each total distance exactly one metre above the last, and the strap
  every 250 ms. Its earlier 0.7 m per quarter second rounded two frames in a row to the same whole-metre total, so the
  test reading those frames failed whenever a loaded machine delivered only those two; it now waits for the frames it
  needs instead of sleeping a fixed time. Starving the test's own event loop failed it 20 times in 20 before, and
  passes it 20 in 20 after.
- **Review fixes, merged (PR #97):** Bluetooth sessions on one day add up; Progress over time pages through every
  reading, places weight by date and checks its own gate; the Bluetooth sheet asks before discarding a workout and
  releases every connection. Calendar sync sends only children the account can edit (owner or co-parent), names no
  child in an error, sends no session note, and keeps each Parent Playbook account's events and settings apart.
- **Two locks.** `ADULT_TRAINING_ENABLED = false` in `js/core.js`, and `public.adult_training_access`, an
  allowlist only the operator writes: the database refuses every write from an account not on it, whatever the
  flag says. Reading and deleting never need it, so a tester taken off the list can still export and delete.
  The three Adult Training migrations were applied to the live project on 2026-09-15, so turning it on for a tester
  is one step: insert that account's id into `adult_training_access`. **One account is allowlisted: the owner's
  own**, added at the owner's request on 2026-09-15 at 14:40 UTC. It is the only row, and its note says whose it is:
  `select guardian_id, granted_at, note from public.adult_training_access`. Checked as that account under row-level
  security, with emulated JWT claims and nothing written: it sees its own row, which is exactly what
  `loadAdultTrainingAccess()` in `js/core.js` reads to show Your training, and `private.adult_training_allowed()` is
  true; as any other account it is false and the allowlist reads as empty. The account had not signed in afresh
  since August, so if the owner turns out to use a different account day to day, move the row rather than add a
  second. The app reads the list when it loads, so a change shows after a reload. Allowlisting another account, or
  removing this one, needs the user's authorization.
- **Privacy.** Every table is keyed by `guardian_id` with no co-parent, family-viewer, coach or organization
  policy. `delete-account` deletes all of it before the login, "Export everything" includes it, and the privacy
  and data-deletion pages describe it.
- **Rules that do not bend.** No weight-loss or body-fat goal, target or adult nutrition plan ever reaches a
  child's profile. Nothing claims body-fat percentage, muscle gain, lean mass, pounds lost or medical health.
  Weight comes only from a scale or the parent's own entry.
- **Next and deferred.** Adult scanner history can sit on the health record, but a parent scanning themselves needs
  a new self-scan release version, which is a legal document and the user's decision. Buildable next: Train Together
  family activities, which needs the user's decisions about children first. With a package rebuild: a Bluetooth
  source kind for the health record. Later: company wellness with explicit participant consent, which needs a
  migration and so a rebuild too.
- **Tried in the harness, not signed in.** `tools/adult-harness` (PR #88) drove training, eating, imports, body
  composition, Connections and the no-child path over synthetic data, with no console errors. A signed-in check
  against a real project is still the most useful check left for this feature, and nothing now stands in its way:
  the migrations are applied and the owner's account is allowlisted. It needs the owner, signed in, to drive the
  profile, goals, workouts, eating, an import, Progress over time, export and deletion, and to say what breaks. Later harness runs drove Progress over time (#92), calendar sync with the parent's
  workouts (`?scenario=family&adult=1`, #93) and Bluetooth equipment (`?bluetooth=1`, #95), and each found something
  the source tests had missed: counts that did not agree with their word and raw dates in chart text, and a distance
  shown as 0 mi above a save of 0.01 mi.

## Device connections roadmap

Added to the build list by the user on 2026-09-14. It does not move the FITMATCH rubric. Built so far, all merged and live in `pp-v129` on 2026-09-14: step 2,
Settings → Connections (PR #87), which lists every connection with its real status and states the rules for
children's device data without storing any permission; step 3, Google Calendar sync (PR #89, hidden until a
client id is set), which writes each child's next four weeks to a calendar the app creates and keeps no token; and
step 4, the normalized health record (PR #82), with typed-in readings, CSV imports and (from PR #95) Bluetooth
sessions as its sources; step 7, Adult Progress (PR #92); and an early web version of step 8, Bluetooth
equipment (PR #95, Chrome only). Calendar sync can also carry the parent's own workouts (PR #93). The
native steps (HealthKit, Health Connect, dependable Bluetooth on phones, watch companions) and step 10, organization
wellness, are not started.

- **Apple:** Apple Watch data through HealthKit (workouts, steps, heart rate, distance, energy, weight). A watch
  app only for live tracking or sending workouts to the watch (WorkoutKit).
- **Android:** Health Connect as the one connection point for watches, phones, scales and fitness apps, with
  per-category permissions.
- **Gym equipment:** Bluetooth Fitness Machine Service for treadmills, bikes and rowers, plus heart-rate monitors
  and compatible scales. Web Bluetooth is only an early Android or desktop version (PR #95); a native layer is the
  dependable path on both phone platforms.
- **Google Calendar:** a dedicated "Parent Playbook" calendar using the scope limited to calendars the app created,
  syncing practices, games, gym sessions, rest days and appointments. Today there is only a single-event download
  (`js/week-rail.js`).
- **Where imports land:** Weekly (schedule and changes), Journey (completed workouts, personal records,
  consistency), Adult Progress (weight, frequency, strength, distance, steps, scanner measurements), Growth (age-
  appropriate child metrics only), and Settings → Connections for permissions. Device-estimated body composition
  may be shown to an adult only when it is clearly labelled a device estimate.
- **Children's device data:** off by default, guardian approval and assent where appropriate, no calorie or
  weight-loss targets, never automatically visible to trainers, camps or companies. Company dashboards receive
  only explicitly shared or aggregated information.
- **The user's order:** adult profiles and goals → Settings → Connections → Google Calendar sync → a normalized
  health-record system with source tracking and duplicate prevention → native iPhone with HealthKit → native
  Android with Health Connect → Adult Progress dashboards → direct Bluetooth equipment → optional Apple Watch and
  Wear OS companions → organization wellness with separate opt-in sharing.

## Deploy and migration ordering

The site deploy and the database migration are separate steps, and on 2026-09-10 the site shipped
first, leaving production serving a history panel whose tables did not exist for about forty
minutes. Both are live now and consistent. The panel still carries the unprovisioned-environment
fallback it was given for that window: a missing-table error is rendered as "Composition storage
is not provisioned in this environment yet, so there is nothing to list." That fallback is worth
keeping for any environment where the schema has not been applied.

The default state a visitor sees is unchanged and correct: "Provider not configured" and "No
stored composition results." Nothing regressed; the smoke is 25/25.

For the next increment: apply the database migration before, or in the same window as, any deploy
that reads from it.

## Reproducibility and operating posture

Two claims are now testable rather than asserted.

**The migrations reproduce production.** `node tools/schema-parity.cjs --capture <out>` builds a
throwaway cluster from `supabase/migrations/` alone and emits a canonical inventory; the same
`tests/db/inventory.sql` runs against the live project. On 2026-09-10 all nine object kinds matched
exactly — 1306 objects. See `tools/schema-evidence/README.md`. This is the database half of the
acquisition constraint: an acquirer can stand the schema up from the repository alone.

It found one object that existed in production and in no migration: `public.rls_auto_enable()` and
its `ensure_rls` event trigger, which enables RLS on every new public table. A restore would have
silently lost that guardrail. Captured in `20260910210000`.

**Production posture is asserted, not eyeballed.** `tests/db/posture.sql` asks eight read-only
questions and `node tools/operations-check.cjs --verify <snapshot>` asserts every answer, exiting
non-zero on any failure. Latest snapshot `tools/ops-evidence/posture-2026-09-10.json`: 8/8 pass.
Each check exists because something went wrong or could have — excess TRUNCATE grants, the missing
guardrail, a retention sweep that succeeds over zero rows, the composition gate opening without a
model. `--allow <check>` records a waiver, and still prints it as a failure so a waiver cannot
quietly become normal.

## Buyer handover package

`node tools/sdk-bundle.cjs <dest>` now produces **129 files**, up from 41. The old package shipped
three `company_*` migrations that reference `public.teams`, `public.athletes`, `auth.users` and six
`private.*` helpers created by earlier migrations. **All three failed on a fresh database** — proved
on 2026-09-10 with `node tests/db/run.cjs --migrations-from <bundle>/supabase/migrations`. An
acquirer could not stand the schema up at all.

The package now ships every migration in order, the verification tooling (`schema-parity`,
`operations-check`, the `tests/db` harness) and `HANDOVER.md`: a standing-up runbook plus a
dependency and license inventory. Verified end to end — the package alone reproduces the production
schema exactly, all nine object kinds, 1306 objects.

Two license obligations in `HANDOVER.md` need a decision before commercial distribution, and neither
is an engineering question: the **MediaPipe pose model weights carry Google's own terms, separate
from the Apache-2.0 code licence**, and **libheif is LGPL-3.0**, reached transitively through
`heic-to` for optional HEIC import. There are zero npm dependencies; everything else is fetched from
a CDN at runtime, so the package is not offline-capable.

The live adult-reference record's identifiers no longer appear anywhere in the package. They were
prefilled defaults in two demo pages and are now neutral placeholders.

## Independent-host deployment

On 2026-09-10 the handover package was deployed to a Railway service with no connection to the
Parent Playbook repository, origin or database, given a public HTTPS domain, verified, and deleted.
All 28 SDK modules served 200 with a JavaScript content type; the demo page rendered; every module
imported in a real browser; the composition gate returned `MODEL_NOT_CONFIGURED` on a host with zero
configuration; the record contract still rejected a forbidden payload. Migrations, tests, docs, the
checksum manifest and the deployment config all returned 404.

Getting there found that the package had **no hostable server at all**. `tools/sdk-demo.cjs` binds
127.0.0.1 and refuses a non-localhost Host header — correct for a demo, undeployable by design — so
an acquirer had nothing to serve the SDK with. `tools/sdk-host.cjs` is the missing piece.

**This is independent-host evidence, not buyer-host acceptance.** The service ran in the same
Railway account. It proves the package runs on infrastructure that shares nothing with production;
it does not prove an acquirer ran it on theirs. FM11 stays at 0.75.

## Reference cohorts

`js/reference-cohort.mjs` generalises the CDC stature machinery to any published cohort, and
**ships with zero cohorts loaded**. That is the honest state, and `REFERENCE-COHORTS.md` records why.

The blocker for FM09's whole-body cohorts is not data. ANSUR II is public domain, free and has 93
measurements on 6,068 subjects. It cannot be wired to our 25 outputs because **definitional
equivalence has not been established** — ours are pose-landmark distances scaled by supplied height,
ANSUR II is tape and caliper anthropometry to ISO definitions, and FM03 already records that metric
equivalence is unproven. It is also adult US Army personnel, which is the wrong population for child
athletes. Running one through the other would produce a number more authoritative-looking than the
measurement it came from.

So `referencePercentile()` refuses any metric whose cohort has not declared an established
equivalence **with the evidence that established it**; `status: established` alone is an assertion.
It also refuses to extrapolate past a cohort's age range, to answer for an uncovered sex, or to
accept a mismatched unit, and every percentile it returns carries the cohort's source, citation,
version, population, sample size and method.

The statistics are verified even though nothing uses them: the normal CDF against published
standard-normal values, the LMS z-score analytically at L=1, at the L=0 log limit and at a general L,
and one real LMS row cross-checked against `js/cdc-stature.js`, which was itself verified against
CDC's published P3/P50/P97 columns across all 436 rows. When a cohort clears the gate the arithmetic
is already known to be right — it is the equivalence, not the mathematics, that is missing.

Unblocking one metric needs an agreement study: same subjects, our estimate and the reference
protocol, across the age and body range served, reporting bias and limits of agreement. That is
research, not engineering.

## Real-data boundary

The live Bergenfield Bears organization has one real adult record: subject `friday-adult-reference-001`, assessment `friday-reference-001`, 25 outputs, 74-inch supplied height, 14.4-second processing, retained through October 10, 2026. Do not read, modify or delete it without explicit user authorization in the current session. Do not upload the user's photos or create another personal record for testing. Synthetic fixtures are allowed in automated tests and must be labelled synthetic.

Note: those two identifiers used to appear as example text and default input values in `BODY-SDK.md`, `company-persistence-demo.html` and `tools/sdk-demo.html`, all of which ship in the buyer bundle. That was resolved in `a59ad28`: the SDK demo now defaults to `adult-reference-001` and `example-assessment-001`. Re-checked on 2026-09-13 against `main` at `4900dd3`: the identifiers remain only in repository-only records (this handoff, `SECOND-REFERENCE-SCAN-CHECKLIST.md`, the measurement study protocol, `tools/parity-progress.json`, one test and the scanner's own `tools/package-scan-identifiers.json`). None ships and none is served. `tests/package-acceptance.test.cjs` fails the build if any bundled file contains them, and `tests/package-scan-bundle.test.cjs` scans every freshly built package against the same list; the v35 package passed both.

The working tree contains extensive continuing work. Inspect `git status --short --untracked-files=all` first. Do not reset, clean, discard, stash or overwrite unrelated changes.

## Production deletion rehearsal — done, September 10, 2026

Authorized in-session, on the live ParentPlaybook project (`xqvqjkdxykowwpcmyudz`). A clearly
synthetic provider registration and composition result were inserted and committed, then deleted,
in a single round trip so no visible state change was ever exposed to the app.

| Observation | Value |
| --- | --- |
| Row present after the committed insert | 1 |
| Insert audit rows | 1 |
| Row present after the committed delete | 0 |
| Delete audit rows | 1 |
| Composition results remaining | 0 |
| Provider registrations remaining | 0 |

The delete audit row carries identifiers and provider metadata only — team, result, assessment,
subject reference, subject scope, provider, model, model version — and **no outputs and no values**.
That is the property that decides whether deletion means anything, and it now holds in production
as well as in the disposable-cluster rehearsal.

**Two caveats, both material.** The statements ran through the Supabase service role, so row-level
security was bypassed for the setup and the delete; the RLS-enforced delete path — an organization
admin deleting their own record, and another organization being unable to — is covered by
`tests/db/restore-deletion.cjs` as restricted roles, not by this. And `auth.uid()` is null under the
service role, so both audit rows carry a null actor. This rehearsal proves the schema, triggers,
audit trail and absence of residue in production; it does not re-prove authorization there.

Two audit rows referencing the synthetic record remain in `access_log`, deliberately. They are the
evidence, and an audit trail that can be tidied away after the fact is not one. Nothing else
remains: zero composition results, zero provider registrations, so the app still reports
*Model not configured* and still produces no composition value.

The real adult-reference record was not touched and was confirmed intact afterwards:
`friday-adult-reference-001` / `friday-reference-001`, 25 outputs, retention 2026-10-10, with
`updated_at` still equal to `created_at`.

**Still open:** an RLS-enforced production deletion. `tests/company-deletion-live-rls.sql` does it as an organization administrator in one rolled-back transaction and passes on the disposable cluster (cases D08 and D09), but has not been run live. Also restoring from Supabase’s own backups, point-in-time recovery, and backup deletion. `tools/restore-drill.cjs` is the check to run against such a restore (proven on the disposable cluster by cases R12 and R13), and `OPERATIONS.md` describes the drill; neither has been run against a real restore.
The retention jobs for adult-reference assessments (`jobid` 7, 03:40 UTC) and composition results
(`jobid` 11, 03:50 UTC) have never fired: cron is healthy and other jobs ran, but both were created
after their window on September 10. First firing is 03:40 and 03:50 UTC on September 11.

## Retention jobs observed firing — September 11, 2026

The scheduled sweeps had never been watched running in production. Both new ones fired
for the first time this morning and were read directly from `cron.job_run_details`.

| Job | Schedule (UTC) | First observed run | Status |
| --- | --- | --- | --- |
| 5 `biometric-retention` | 03:20 | 2026-09-11 03:20:00 | succeeded |
| 6 `company-body-assessment-retention` | 03:35 | 2026-09-11 03:35:00 | succeeded |
| 7 `company-reference-assessment-retention` | 03:40 | **2026-09-11 03:40:00** | succeeded |
| 11 `company-composition-result-retention` | 03:50 | **2026-09-11 03:50:00** | succeeded |

Jobs 7 and 11 had zero runs until now, which earlier looked like a fault and was not: both
were created after their firing time on September 10, so September 11 was their first
opportunity. Jobs 2, 3, 5 and 6 running normally in between is what established that the
scheduler itself was healthy while 7 and 11 sat at zero.

**All four observed on one morning.** 03:20, 03:35, 03:40 and 03:50, each succeeding within
four milliseconds. Job 11 is the composition sweep; it ran against an empty table and left it
empty, with zero provider registrations, so the app still reports *Model not configured* and
still produces no composition value. The two audit rows from the September 10 deletion
rehearsal are still present, deliberately, and no composition deletion has occurred that the
rehearsal did not cause.

**What job 7 proves, and what it does not.** It is the sweep that governs the live
adult-reference record. It ran, succeeded, and the record is untouched: one row,
`friday-adult-reference-001` / `friday-reference-001`, 25 outputs, retention 2026-10-10,
`created_at` still equal to `updated_at`, and zero reference-deletion audit rows. So the
sweep executes on schedule in production and keeps a record that is still inside its
window — which is the half of retention that had never been observed live.

It does NOT show a scheduled deletion actually removing an expired row in production,
because nothing in production is expired. That path is covered by `tests/db/restore-deletion.cjs`
cases D05 and D06, which sweep an expired record and require the deletion to be audited,
and by the September 10 production deletion rehearsal. Watching a real expiry would mean
waiting until 2026-10-10 or back-dating a live record, and neither is worth doing for it.

## Standing limitations

Automated tests prove contract behaviour, not anatomical accuracy. Synthetic fixtures prove arithmetic and rejection paths, not human performance. Deployment proves availability, not scientific validity. Executing a migration against a disposable cluster proves the SQL is correct, not that Supabase will behave identically.

The remaining parity points split into engineering work and external evidence. Engineering: deploying the authenticated results API (FM15, built and tested locally), a real WebView run, a native iOS SDK and an intended-phone trial (FM16), OBJ and USDZ avatar delivery within FM02 (the silhouette lab writes both since PR #94; neither is in the SDK or the company results contract), buyer-host deployment and the operations tooling around it. External: FM05 needs a licensing agreement and a DEXA-validated model; FM02, FM03 and FM04 need reference measurement studies against real people on intended devices; FM14 needs a reference cohort whose equivalence to our outputs is established; buyer-host acceptance needs a buyer. Review capacity alone moves none of the external items.

Keep `tools/parity-progress.json` at 40.75 unless its fixed evidence rubric genuinely supports a change. Weights change only through a documented rebaseline recorded in the file's `rebaselines` list, which `tests/deck-evidence.test.cjs` enforces. Integration scaffolding without a model does not advance FM05.
