# Executable database tests

These tests **run** the composition migration. They are not source-text assertions about SQL.

```sh
node tests/db/run.cjs
```

Requires a local PostgreSQL installation (tested on 18.3). If `initdb` is not on `PATH`:

```sh
PP_PG_BIN="C:/Program Files/PostgreSQL/18/bin" node tests/db/run.cjs
```

Add `--keep` to leave the cluster up for manual `psql` inspection; the command to stop and delete it
is printed at the end.

## Why this exists

On 2026-09-10 the composition storage layer passed a full JavaScript suite in which the "migration
test" was a set of regular expressions matched against the migration file. Executing the same SQL
found two real defects that the regex tests could not see:

- `private.company_composition_payload_is_allowed()` accepted a record with **no `outputs` and no
  `provider`**. `jsonb_typeof()` of a missing key returns `NULL`, and `NULL <> 'array'` is `NULL`
  rather than true, so the whole condition chain evaluated to `NULL`, fell through, and returned
  true. The JavaScript contract rejected all of those payloads correctly — the database was the
  weaker layer.
- Audit rows carried no `assessment_id`, so a stored result could not be traced back to its
  assessment.

Both are fixed. Cases A51–A63 are the regression coverage.

## Safety

The harness **cannot be pointed at a real database**. There is no connection-string option. `run.cjs`
always calls `initdb` to create a fresh cluster in the OS temp directory, binds it to `127.0.0.1` on a
port the OS hands out, and deletes it afterwards. `replay.cjs` and `security-tests.cjs` refuse to run
unless `run.cjs` supplies `PP_DB_PSQL` and `PP_DB_CONN`, and the teardown refuses to delete anything
outside the temp root.

Every fixture in `10-fixtures.sql` is synthetic and labelled as such. The live production
adult-reference record is never referenced, read or recreated. Its identifiers are deliberately not
named in any file that ships in the buyer package.

## What runs

| File | Role |
|---|---|
| `run.cjs` | Creates the cluster, orchestrates, disposes |
| `00-preamble.sql` | Supabase-compatible emulation: `anon` / `authenticated` / `service_role` roles, `auth.users`, `auth.uid()`, storage and vault stubs, and **stubs for pg_cron and pg_net** |
| `05-post-identity-seed.sql` | Synthetic guardian row so the marketplace migration's hard-coded `app_admins` seed can replay |
| `replay.cjs` | Applies all 77 real migrations in order, each in its own transaction, recording failures rather than stopping |
| `10-fixtures.sql` | Two synthetic organizations, three synthetic accounts, three synthetic athletes, six synthetic provider registrations (active, revoked, expired, narrow, other-study), and payload builders |
| `security-tests.cjs` | 147 cases, each in its own transaction, rolled back |

Expected result: **76 of 77 migrations applied** and **147/147 tests pass**. The single migration
failure is `20260812174514_enable_cron_and_net.sql`, which needs the pg_cron and pg_net binaries that
only exist inside Supabase.

## Coverage

| Group | Cases | What it proves |
|---|---|---|
| `payload-allowlist` | 53 | Forbidden keys (photos, landmarks, masks, contours, meshes, geometry, vertices, digests, participant/scan codes, reference/estimated value pairs) at every nesting depth; unknown fields; omitted required blocks; malformed types; duplicate output keys; uncertainty field requirements per status |
| `payload-column-agreement` | 11 | Every identifier in the JSON must equal its relational column |
| `scope-separation` | 4 | An `adult_reference` row cannot carry an `athlete_id`; a `child_athlete` row must name a rostered athlete and repeat that id as its subject reference |
| `timestamps` | 2 | capture ≤ estimate ≤ save |
| `retention` | 10 | Exact 400-day upper and one-second lower boundaries; the sweep deletes only eligible rows; `authenticated` and `anon` cannot execute it |
| `rls-*` | 20 | anon, non-admin member, org A admin and org B admin across SELECT / INSERT / UPDATE / DELETE, including cross-tenant attempts and attempts to change organization, subject, scope, athlete or owner on UPDATE |
| `audit` | 8 | Insert/update/delete rows, detail keys, absence of payload content, actor identity, restricted cross-tenant reads, and that the SECURITY DEFINER trigger cannot be invoked directly |
| `function-privs` | 7 | `search_path=''` on every new function, IMMUTABLE and non-DEFINER allowlist, DEFINER `can_manage_company_composition` granted only to `authenticated`, RLS enabled, cron job registered |
| `provider-eligibility` | 10 | Invented provider, out-of-range value, inverted uncertainty, mismatched label, altered disclosure text — all refused |
| `provider-registry` | 22 | Revoked and expired registrations, undeclared outputs, manifest/registry disagreement, payload-vs-column provider disagreement, and that an organization account cannot register, amend or delete a registration |

## Provider eligibility

Cases G01–G10 and H01–H22 cover what used to be an open gap. Until 2026-09-10 the database
enforced nothing about whether a composition result came from a real, approved model: an
organization administrator writing directly to `company_composition_results` could store a
structurally valid row naming an invented provider, a 9999 kg lean mass, inverted uncertainty
bounds, a mismatched output label or altered disclosure text. Only browser-side JavaScript said
otherwise, which is the wrong side of the trust boundary.

Four things now close it:

1. **`public.company_composition_providers`** — a registry of the provider/model/version
   registrations an organization actually holds, with its validation study, rights status,
   declared outputs, expiry and revocation. `authenticated` has SELECT on its own team's rows
   and **no INSERT, UPDATE or DELETE grant and no write policy**. Registration is a platform
   operation. A registry the tenant can write to would enforce nothing.
2. **A composite foreign key** from `(team_id, provider_id, model_id, model_version)` on results
   to the registry, `on delete restrict` so a registration with results must be revoked rather
   than deleted.
3. **A BEFORE INSERT/UPDATE trigger** proving the registration was still usable when the result
   was saved — not revoked, rights not expired, manifest study and rights status matching, and
   every output inside what the registration declared. It is a trigger rather than an RLS clause
   on purpose: RLS is bypassed by the service role, and an invented value should not become
   storable by changing which key wrote it.
4. **A hardened payload allowlist** pinning each metric's label, unit and physiological bounds,
   requiring the uncertainty interval to bracket its own value inside those bounds, requiring the
   payload provider block to equal the indexed columns, and pinning both disclosure strings
   verbatim.

Running the registry immediately found one more defect of the same NULL-safety family that the
first execution pass found: `array_length()` of an empty array returns `NULL`, so
`NULL between 1 and 5` is `NULL`, which a CHECK constraint accepts — a provider could be
registered declaring **no outputs at all**. Case H21 is the regression.

What remains outside the database: nothing verifies that the registered provider is a real
company with a real DEXA-validated model. That is a commercial and legal check performed before
a row is inserted, and the audit trail records who approved it and when.

## What this does not prove

- Not that Supabase will behave identically. The roles are emulated and the migration has never been
  applied to the real project.
- **Not that the nightly retention job runs.** `cron.schedule()` here is a stub that records a job row
  and never fires. `F05` checks only that the job was registered.
- Nothing about anatomical accuracy, composition validity, provider quality or real-person
  performance. Synthetic fixtures establish arithmetic and rejection behaviour only.
