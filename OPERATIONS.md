# Operations runbook

For whoever operates the production Parent Playbook deployment: the site on Railway at playbookbp.com
and the ParentPlaybook Supabase project. Written 2026-09-13.

Every procedure says whether it has ever been carried out. A step marked **never executed** is a plan
that has been tested only as far as the section says, not a practised routine. `tests/operations-runbook.test.cjs`
fails if a path named here stops existing, if a scheduled job is missing from this page, or if the monitor
schedule stated here stops matching the workflow.

## What runs without anyone

| What | Where | Schedule | Carried out? |
| --- | --- | --- | --- |
| Continuous integration | `.github/workflows/ci.yml` runs the JavaScript suite and `tests/db/run.cjs` on GitHub's Ubuntu runners | Every pull request and every push to `main` | Added 2026-09-13; its first run was on its own pull request |
| Production smoke check | `.github/workflows/production-monitor.yml` runs `tools/deployment-smoke.cjs` against playbookbp.com | `17 */6 * * *` (every six hours, at 17 minutes past) and on demand | Merged 2026-09-13; not yet observed running on GitHub |
| Retention sweeps | `cron.job` in the live project | `biometric-retention` 03:20 UTC, `company-body-assessment-retention` 03:35, `company-reference-assessment-retention` 03:40, `company-composition-result-retention` 03:50, `external-composition-retention` 03:55 | The first four were observed succeeding on 2026-09-11. `external-composition-retention` has not been observed |
| Notification pushes | `cron.job` in the live project | `weekly-plan-push` (Sundays 22:00 UTC), `gameday-push` (nightly 23:00), `daily-nudge` (daily 20:12) and `measure-nudge` (Sundays 14:14; `notify-measure` sends only in the first week of the month), which call edge functions through `net.http_post` | Running in production; they message real families. `daily-nudge` and `measure-nudge` existed only in the live project until migration `20260913140500` |

Nothing else is scheduled. The database posture check, restore drills and key rotation are manual.

## When the production monitor fails

1. Open the failed run. The smoke check prints one JSON row per path, with the status it received.
2. If the only failures are version checks such as `/sw.js`, and something merged to `main` within the last few
   minutes, Railway may still be building. Re-run the workflow before treating it as an outage.
3. If a path marked `not-public` answered 200, a private file is being served. Treat it as a suspected
   exposure (below), and check the `COPY` allowlist in `Dockerfile`.
4. If a required page fails, check the Railway deployment. If the newest deployment is broken, redeploy the
   previous successful one from the Railway dashboard, then run the smoke check again:
   `node tools/deployment-smoke.cjs https://playbookbp.com/`.

## Database posture

Read-only, and it reads no row content. Supply the connection through `PG*` environment variables rather than
a URL on the command line.

```sh
psql -X -A -t -q -v ON_ERROR_STOP=1 -f tests/db/posture.sql > posture-snapshot.json
node tools/operations-check.cjs --verify posture-snapshot.json
```

Keep dated snapshots beside `tools/ops-evidence/posture-2026-09-10.json`. That one is the only snapshot so far,
and it predates the query counting `external_composition_records` past retention, so capture a new one before
relying on it. When a check fails, `operations-check` prints why it matters. Do not pass `--allow` without
writing down why and until when.

Carried out once, on 2026-09-10. Not scheduled.

## Deletion requests

- **A parent deletes their account** in the app. That calls `delete-account`
  (`supabase/functions/delete-account/handler.mjs`). A sole guardian's household, children's files and trainer
  documents are deleted, then the login. If another guardian shares the household, the children stay and
  ownership and consent pass to that guardian. If the response says the login could not be deleted, the data is
  already gone and the cause is usually a booking, payment or review that references the account. Those are
  financial records: decide with counsel whether they must be kept before removing the login by hand.
- **A parent deletes one child** in the app. That calls `delete-athlete`
  (`supabase/functions/delete-athlete/handler.mjs`), which deletes the row under the parent's own row-level
  security and purges the child's files afterwards. If file removal fails, the row is already gone and the
  response reports zero files removed; remove the folder by hand.
- **An organization deletes a record** from its dashboard, under its administrator's row-level security, or
  through the results API with a `results:delete` key.
- **To confirm a deletion**, look in `access_log` for `company_body_assessment_delete`,
  `company_reference_assessment_delete` or `company_results_api_delete`. Audit entries carry identifiers, never
  the deleted values.
- **Expired records** are removed by the nightly sweeps above.

The deployed functions predate the handler refactor of 2026-09-13. Redeploy both before relying on the tested
versions.

### Rehearsing organization deletion in production

With the owner's authorization:

```sh
supabase db query --linked --file tests/company-deletion-live-rls.sql
```

It saves synthetic records as an organization administrator, proves another account cannot delete them,
deletes them, checks the audit, and rolls everything back. It should print `"ok" : true`. **Never executed
live.** It passes on the disposable cluster, where it is also shown to fail when the refusal is broken.

## Results API keys

The API is defined by `supabase/migrations/20260913120000_company_results_api.sql` and
`supabase/functions/company-results-api/handler.mjs`. **Neither is deployed.**

- **Issue** a key from a signed-in administrator's session, because `create_company_api_key` checks who is
  calling; the SQL editor has no signed-in user. Store the secret in the consuming system's secret store. It is
  shown once.
- **Rotate** by issuing a new key, switching the consumer to it, confirming the old key's `last_used_at` has
  stopped moving, then calling `revoke_company_api_key` on the old one.
- **Expiry** is at most 366 days. Watch `expires_at`.
- **Revoke immediately** on any suspicion. Revocation takes effect on the next request.

## Restore drill

The purpose is to prove that a backup made by the hosting provider comes back as a usable, protected database.
**Never executed.**

1. Restore the backup, or a point-in-time recovery, into a **new** project or database. Never restore over
   production. Check which restore options the Supabase plan provides.
2. **Before the restored copy runs anything, disable its notification jobs** (`weekly-plan-push`, `gameday-push`, `daily-nudge`, `measure-nudge`).
   A restored copy keeps the schedules, and they would message real families.
3. Run the comparison, with owner-role connection strings in the environment:

   ```sh
   PP_RESTORE_SOURCE=postgresql://... PP_RESTORE_TARGET=postgresql://... node tools/restore-drill.cjs
   ```

   Add `--allow-row-drift` when restoring to an earlier moment. The drill compares the schema inventory,
   row-level security, tenant privileges, retention jobs and row counts. It is proven on the disposable cluster
   against a faithful copy and against one with row-level security removed.
4. Keep the JSON result (`--json`) as the drill's evidence.
5. Check by hand what the drill cannot: storage objects (photos and composition reports are not in the
   database), edge functions and their secrets, auth settings, and that the restored project's jobs would fire.
6. Delete the restored project afterwards. It holds a full copy of production data.

## Package signing key

The private key is at `~/.parent-playbook-signing/pp-sdk-signing-key.pem`, outside the repository. Keep an
offline backup.

- **Rotate** with `node tools/sdk-sign.cjs --generate-key --out <a directory outside the repository>`. Commit the
  new `SIGNING-KEY.pub.pem`, which the site serves, then rebuild and re-sign the current package and record the
  new fingerprint.
- **If the private key may be compromised**, rotate it and tell everyone who received a package signed with the
  old key that its signatures can no longer be trusted.

Never executed.

## Deployments

- **The site.** Merging to `main` makes Railway build the static site from `Dockerfile` and `Caddyfile`.
  Afterwards run `node tools/deployment-smoke.cjs https://playbookbp.com/`. The version it expects is
  `EXPECTED_CACHE` in that file, and it must match `sw.js`.
- **Database migrations and edge functions are not deployed by a merge.** Apply them separately, with the
  owner's authorization. After applying a migration, confirm that its row in
  `supabase_migrations.schema_migrations` carries the same version as its filename. If it does not, a later
  `supabase db push` will try to apply it again.
- **A buyer's SDK host.** Check it with `node tools/sdk-host-smoke.cjs https://their-host/`.

## Suspected exposure

1. Revoke every results API key.
2. Rotate the Supabase service-role and secret keys, and redeploy the edge functions that use them.
3. Capture a posture snapshot, and read `access_log` for the period in question.
4. If the monitor saw a private path served, check the `Dockerfile` allowlist and the deployed files.
5. Whether and whom to notify depends on the data involved and where the people affected live. Involve counsel
   early.

## Never executed, as of 2026-09-13

- A restore of a provider backup or point-in-time recovery, and `tools/restore-drill.cjs` against one.
- `tests/company-deletion-live-rls.sql` against production.
- Deploying the results API, and issuing any key.
- Deploying the refactored `delete-account` and `delete-athlete` handlers.
- Rotating the package signing key.
- A scheduled database posture check.
