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
- Git: branch `composition-storage-and-provider-registry` pushed to origin at `32c1c29`, on top of baseline `54a19fe` which finally tracks the 139 previously-uncommitted files production was already serving. `main` is unmoved at `7bb724d`. The repository is private.
- Service-worker release: **`pp-v94` deployed to production on 2026-09-11** (`railway up`, deployment `a38a835c-ead2-4aba-afe7-2279b5a71e7d`). Production smoke 27/27, `ok: true`, confirmed on two consecutive runs. Verified against the deployed file: `js/camps.js` is byte-identical to the repository, hides finished camps, and renders a cross-year range as "Jan 5 – Jan 9, 2027". Note: a smoke run taken DURING a rollout reported 26/27 and passed on every run afterwards — give a deploy a few seconds to settle before reading the smoke as a result.
- Railway deployment: 22d90350-50d4-4d43-bd96-5025661ce110 (SUCCESS, 2026-09-10). Project a6dca082-fbe5-4bc9-b2a6-3f6eaf92e7e2, service caf9bbfb-1084-422b-913a-2b90d004410f, environment production. The service source is pinned to branch `main`, so pushing a feature branch does not deploy; the live site was published with `railway up` from the working directory.
- Full JavaScript suite: **276/276 passing** — `node --test "tests/*.test.cjs"`
- Executable database tests: **154/154 passing** — `node tests/db/run.cjs`. It creates a throwaway PostgreSQL cluster, replays the real migration history into it, runs the suite as the restricted `authenticated` and `anon` roles, then destroys the cluster. It cannot be pointed at an existing server.
- Migration replay into a disposable cluster: **76 of 77 applied**; only `20260812174514_enable_cron_and_net.sql` fails, because pg_cron and pg_net binaries are unavailable outside Supabase
- Production smoke: **27/27** — `node tools/deployment-smoke.cjs https://playbookbp.com/`.
- Supabase migration **committed to the live project on 2026-09-10** (`xqvqjkdxykowwpcmyudz`, Postgres 17.6), after three rollback-only rehearsals. Applied in one transaction that also recorded `supabase_migrations.schema_migrations` at version `20260910190000`, matching the repository filename, so a later `supabase db push` sees it as applied. All seven function body md5s match the local cluster byte for byte. `company_composition_providers` and `company_composition_results` both exist, both have RLS enabled, both hold **zero rows**, `anon` has no privilege on either and is denied through the public API, and `authenticated` holds exactly `SELECT` on the registry and CRUD on results. Supabase security advisors report **no new findings** attributable to this migration.
- Weighted parity: 37.75/100, reported as 37.75% or 38% rounded
- SDK ZIP: `tools/sdk-releases/parent-playbook-sdk-0.13.0-friday-final-v11.zip`, SHA-256 `920AD7F122564785E42509C62E041729C593938083C699717D0C70119FB95B14`, 322,551 bytes, 152 payload files plus `manifest.json` (153 entries), payload digest `2d63b47a009d5b67cbe57dd950d368d32d96cfe0fab90d03ab5d35f3cf58e23e`. Rebuilt September 11, 2026 because v10’s recorded checksum had gone stale: `tools/acceptance.cjs`, `tools/package-scan.cjs` and `tools/schema-parity.cjs` all changed after it was built, and nothing flagged the published hash as wrong. `bundleDigest()` in `tools/sdk-bundle.cjs` now answers that question without rebuilding, and `tests/deck-evidence.test.cjs` fails when the payload moves on from the recorded digest. Verified from the extracted copy: `node tools/acceptance.cjs` -> 6/6 (manifest 152/152, exclusions clean, contracts 107/107, database 176/176, host serving). `tools/sdk-releases/` is gitignored, so the archive is not committed — the record here and in `BODY-SDK.md` is the evidence.

Read FITMATCH-PARITY-PLAN.md, FRIDAY-DEMO-READINESS.md, BODY-SDK.md, BODY-MEASUREMENT-DICTIONARY.md, ARCHITECTURE.md and any applicable AGENTS.md before editing.

## Current composition state

The project validates a provider manifest, exact provider/model estimate binding, five supported scalar outputs, uncertainty disclosure and independent coded DXA comparison rows. It computes descriptive bias, MAE, RMSE and maximum error while excluding participant and scan codes from aggregate export.

An organization-scoped composition storage and history layer is implemented: `js/body-composition-record.mjs` (record contract plus store), `js/body-composition-supabase.mjs` (adapter) and `supabase/migrations/20260910190000_company_composition_results.sql` (table, payload allowlist, RLS, audit trigger, retention sweep). Adult-reference and child-athlete scopes are structurally separate — an `adult_reference` row cannot carry an `athlete_id`, enforced by a table CHECK. Step 4 of `/company-composition-demo` lists real stored history and currently reads "No stored composition results."

Provider eligibility is enforced in the database: `public.company_composition_providers` is a platform-written registry, results carry a composite foreign key to it, and a BEFORE trigger proves the registration was unrevoked, unexpired and covered the outputs when the result was saved. An organization account cannot register its own provider.

There is no licensed body-composition model, real composition output or independent validation dataset. The UI must keep showing "Provider not configured" and generate zero composition values. FM05 remains stage 0. The schema now exists in production but **the provider registry is empty**, so no composition result can be stored by anyone until a provider is registered — and registration is a platform operation that no organization account can perform.

## Next implementation targets, in order

1. **Observe the retention cron actually firing.** The job is registered and active (`jobid` 11,
   `50 3 * * *`, `select private.sweep_company_composition_retention();`) but has never run: it was
   created at 17:34 UTC and is first due at 03:50 UTC. pg_cron demonstrably works in this project —
   `company-body-assessment-retention` ran at 03:35 UTC on 2026-09-10 — but that is evidence about
   the mechanism, not about this job. Check `cron.job_run_details` for `jobid` 11 after 03:50 UTC and
   confirm a `succeeded` row. Note that `company-reference-assessment-retention` has also never run,
   for the same benign reason: it was scheduled after its own daily slot had already passed.
2. **Close the last grant residual.** `20260910200000` revoked TRUNCATE, TRIGGER, REFERENCES and
   MAINTAIN from anon and authenticated on all 53 public tables, and tightened default privileges
   for the `postgres` owner so new tables do not re-inherit them. `supabase_admin`'s defaults are
   **unchanged** — the migration runs as `postgres`, which is not a member of that role, so the
   statement was skipped by design rather than failing. Migrations create tables as `postgres`, so
   the practical path is covered; a table created by `supabase_admin` would still inherit the excess
   grants. Closing it needs a connection with supabase_admin membership.

   Separately, and deliberately NOT changed: `anon` still holds INSERT/UPDATE/DELETE on most public
   tables. That is Supabase's default with row-level security as the boundary, it is what the
   application relies on, and narrowing it is a much larger decision than this one.

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

Note: those two identifiers appear as example text and default input values in `BODY-SDK.md`, `company-persistence-demo.html` and `tools/sdk-demo.html`, all of which ship in the buyer bundle. No measurement value is disclosed, only the identifier. This predates the composition increment and is unresolved.

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

**Still open:** restoring from Supabase’s own backups, point-in-time recovery, and backup deletion.
The retention jobs for adult-reference assessments (`jobid` 7, 03:40 UTC) and composition results
(`jobid` 11, 03:50 UTC) have never fired: cron is healthy and other jobs ran, but both were created
after their window on September 10. First firing is 03:40 and 03:50 UTC on September 11.

## Standing limitations

Automated tests prove contract behaviour, not anatomical accuracy. Synthetic fixtures prove arithmetic and rejection paths, not human performance. Deployment proves availability, not scientific validity. Executing a migration against a disposable cluster proves the SQL is correct, not that Supabase will behave identically.

The remaining parity points are mostly not engineering-limited. FM05 needs a licensing agreement and a DEXA-validated model. FM02, FM03 and FM04 need reference measurement studies against real people on intended devices. Buyer-host acceptance needs a buyer. No amount of review capacity moves any of them.

Keep `tools/parity-progress.json` at 37.75 unless its fixed evidence rubric genuinely supports a change. Integration scaffolding without a model does not advance FM05.
