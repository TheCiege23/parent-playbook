# Parent Playbook continuation handoff

Updated September 10, 2026. Verify this checkpoint against the repository before editing.

## Primary objective

Build credible capability parity with the public sports-science claims of FITMATCH.ai. Parent coaching, athlete journey, organizations, camps, trainer marketplace and movement video extend that core. Reproduce public capabilities and workflows without copying proprietary code, private APIs, branding or copyrighted assets. Never claim FITMATCH-equivalent accuracy without independent evidence.

## How work is accepted here

This is the standard. It replaces "the tests pass," which was previously satisfied by regex matches against files the same session had written.

- **A migration is not tested until it has run.** Apply it to a disposable PostgreSQL cluster with the real migration history replayed ahead of it, exercise it as the restricted `authenticated` and `anon` roles with emulated JWT claims, then drop the database. Source-text assertions about SQL are documentation, not tests.
- **A UI path is not tested until its DOM has been driven.** Click the handlers, read back `textContent` and element state, and record route plus source version. A screenshot is supporting evidence, never the evidence.
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

For an adversarial pass, the user runs `/code-review ultra`. It is user-triggered and billed; Claude cannot launch it. It works against the local branch and does **not** need a push, which matters here because this increment is uncommitted and `main` on GitHub legitimately 404s for every new file.

**Commit each increment to its own branch before review.** The working tree currently carries 159 dirty status entries and 144 untracked files from weeks of prior work. A branch holding only the increment makes every review sharper, including Claude's own.

## Verified checkpoint

- Production: https://playbookbp.com/
- Demo Room: https://playbookbp.com/friday-demo
- Company SDK: https://playbookbp.com/company-sdk-demo
- Adult persistence: https://playbookbp.com/company-persistence-demo
- Composition gate: https://playbookbp.com/company-composition-demo
- Git HEAD: `7bb724d` on `main`. The composition increment is uncommitted and unpushed.
- Service-worker release: **`pp-v86` deployed to production on 2026-09-10** (`railway up`, service `parent-playbook`, environment `production`). Repository and production now match.
- Railway deployment: 18af9078-3b56-4503-9d21-a1b0ee8c0e35
- Full JavaScript suite: **263/263 passing** — `node --test "tests/*.test.cjs"`
- Executable database tests: **151/151 passing** — `node tests/db/run.cjs`. It creates a throwaway PostgreSQL cluster, replays the real migration history into it, runs the suite as the restricted `authenticated` and `anon` roles, then destroys the cluster. It cannot be pointed at an existing server.
- Migration replay into a disposable cluster: **76 of 77 applied**; only `20260812174514_enable_cron_and_net.sql` fails, because pg_cron and pg_net binaries are unavailable outside Supabase
- Production smoke: **25/25** — `node tools/deployment-smoke.cjs https://playbookbp.com/`.
- Rollback-only application to the live Supabase project (`xqvqjkdxykowwpcmyudz`, Postgres 17.6): **passed on 2026-09-10**. The exact repository file was applied inside `begin … rollback`, all seven function body md5s matched the local cluster byte for byte, and a post-run check confirmed both tables absent, zero new functions, no composition cron job, the two pre-existing cron jobs intact and no open transaction. Nothing was committed.
- Weighted parity: 37.75/100, reported as 37.75% or 38% rounded
- SDK ZIP: `tools/sdk-releases/parent-playbook-sdk-0.13.0-friday-final-v7.zip`, SHA-256 `62F6EDFBCFD73E8770E0BFD6054F1A041C13D74F5D41FB7C9E7713E4D881251E`. **This archive is stale by three files** and was not rebuilt. `node tools/sdk-bundle.cjs <dest>` now reproduces a 41-payload-file candidate; the archived one has 38.

Read FITMATCH-PARITY-PLAN.md, FRIDAY-DEMO-READINESS.md, BODY-SDK.md, BODY-MEASUREMENT-DICTIONARY.md, ARCHITECTURE.md and any applicable AGENTS.md before editing.

## Current composition state

The project validates a provider manifest, exact provider/model estimate binding, five supported scalar outputs, uncertainty disclosure and independent coded DXA comparison rows. It computes descriptive bias, MAE, RMSE and maximum error while excluding participant and scan codes from aggregate export.

An organization-scoped composition storage and history layer is implemented: `js/body-composition-record.mjs` (record contract plus store), `js/body-composition-supabase.mjs` (adapter) and `supabase/migrations/20260910190000_company_composition_results.sql` (table, payload allowlist, RLS, audit trigger, retention sweep). Adult-reference and child-athlete scopes are structurally separate — an `adult_reference` row cannot carry an `athlete_id`, enforced by a table CHECK. Step 4 of `/company-composition-demo` lists real stored history and currently reads "No stored composition results."

Provider eligibility is enforced in the database: `public.company_composition_providers` is a platform-written registry, results carry a composite foreign key to it, and a BEFORE trigger proves the registration was unrevoked, unexpired and covered the outputs when the result was saved. An organization account cannot register its own provider.

There is no licensed body-composition model, real composition output or independent validation dataset. The UI must keep showing "Provider not configured" and generate zero composition values. FM05 remains stage 0. The migration has never been applied to Supabase.

## Next implementation targets, in order

1. **Commit the migration to Supabase, then prove the retention cron actually fires.** The rollback-only run proved the SQL applies and is correct; it cannot prove the nightly sweep runs, because a rolled-back `cron.schedule()` leaves no job. That needs a committed schedule and an observed execution in `cron.job_run_details`.

2. **Decide what to do about the pre-existing excess table privileges.** Supabase grants `ALL` on every new `public` table to `anon` and `authenticated`, which includes `TRUNCATE`, `TRIGGER` and `REFERENCES`. `TRUNCATE` is not subject to row-level security. Verified on the live project: `company_body_assessments`, `company_reference_assessments`, `athletes`, `measurements`, `biometric_consents`, `access_log` and `teams` all carry it for both roles. PostgREST exposes no TRUNCATE verb, so this is a latent excess privilege rather than a directly reachable one through the documented API — but it defeats every RLS policy on those tables for anything that can execute arbitrary SQL as those roles. The composition migration now revokes it for its own two tables; the sibling tables were **not** changed, because that is a committing production change nobody has authorized.

## Deploy and migration ordering

The site deploy and the database migration are separate steps, and the site shipped first. As of
2026-09-10 production serves the Step 4 history panel while `company_composition_results` and
`company_composition_providers` **do not exist** in the database, because the migration was only
ever applied rollback-only. The panel handles this deliberately: a missing-table error from
PostgREST is rendered as "Composition storage is not provisioned in this environment yet, so
there is nothing to list. No stored composition results." rather than as a raw schema-cache
error. Verified in a browser against a simulated `PGRST205` before the deploy.

The default state a visitor sees is unchanged and correct: "Provider not configured" and "No
stored composition results." Nothing regressed; the smoke is 25/25.

For the next increment: apply the database migration before, or in the same window as, any deploy
that reads from it.

## Real-data boundary

The live Bergenfield Bears organization has one real adult record: subject `friday-adult-reference-001`, assessment `friday-reference-001`, 25 outputs, 74-inch supplied height, 14.4-second processing, retained through October 10, 2026. Do not read, modify or delete it without explicit user authorization in the current session. Do not upload the user's photos or create another personal record for testing. Synthetic fixtures are allowed in automated tests and must be labelled synthetic.

Note: those two identifiers appear as example text and default input values in `BODY-SDK.md`, `company-persistence-demo.html` and `tools/sdk-demo.html`, all of which ship in the buyer bundle. No measurement value is disclosed, only the identifier. This predates the composition increment and is unresolved.

The working tree contains extensive continuing work. Inspect `git status --short --untracked-files=all` first. Do not reset, clean, discard, stash or overwrite unrelated changes.

## Standing limitations

Automated tests prove contract behaviour, not anatomical accuracy. Synthetic fixtures prove arithmetic and rejection paths, not human performance. Deployment proves availability, not scientific validity. Executing a migration against a disposable cluster proves the SQL is correct, not that Supabase will behave identically.

The remaining parity points are mostly not engineering-limited. FM05 needs a licensing agreement and a DEXA-validated model. FM02, FM03 and FM04 need reference measurement studies against real people on intended devices. Buyer-host acceptance needs a buyer. No amount of review capacity moves any of them.

Keep `tools/parity-progress.json` at 37.75 unless its fixed evidence rubric genuinely supports a change. Integration scaffolding without a model does not advance FM05.
