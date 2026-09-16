# Buyer handover

What is in this package, how to stand it up, what it depends on, and what it does not include.

The acquisition constraint in `FITMATCH-PARITY-PLAN.md` is that the core must be independently
operable by an acquirer. This document is the operating half of that; `tools/schema-parity.cjs` is
the falsifiable half.

## Start here

One command, from the root of this package:

```sh
node tools/acceptance.cjs
```

It verifies the checksum manifest, scans for content that should never have been packaged,
runs the contract suite against the shipped modules, replays every migration into a throwaway
PostgreSQL cluster and runs the security suite as restricted roles, then starts the bundled
host and checks it serves modules correctly. Add `--json` for a machine-readable result.

A check that cannot run on your machine reports SKIP with the reason and is listed again at
the end under "Not run here, so not evidence" — the PostgreSQL replay is the usual one, and it
needs a local PostgreSQL installation. The run ends by stating what a clean result does **not**
establish. Read that part.

## Standing it up

**1. Database.** Apply every migration in `supabase/migrations/` in filename order to an empty
PostgreSQL 15+ database. They are ordered and must not be reordered or partially applied.

```sh
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

On a plain PostgreSQL cluster, three things Supabase provides must exist first: the roles `anon`,
`authenticated` and `service_role`; an `auth.users` table with a `uuid` primary key; and an
`auth.uid()` function returning the current user. `tests/db/00-preamble.sql` is a working reference
implementation of all three — it is test scaffolding, not production code, but it documents exactly
what the migrations assume. Two migrations need the `pg_cron` and `pg_net` extensions; without them
`20260812174514_enable_cron_and_net.sql` fails and the retention sweeps must be scheduled by other
means.

**2. Verify the database is what it should be.**

```sh
node tools/schema-parity.cjs --capture restored.json
node tools/schema-parity.cjs --compare <production-inventory.json> restored.json
```

This builds a throwaway cluster from the migrations alone and diffs every table, column, constraint,
index, policy, trigger, function, grant and event trigger. On 2026-09-10 it matched the live project
exactly across 1306 objects. See `tools/schema-evidence/README.md`.

**3. Verify operating posture.** `tests/db/posture.sql` asks eight read-only questions of a running
database; `node tools/operations-check.cjs --verify <snapshot>` asserts every answer and exits
non-zero on failure. Run it after standing up, and on a schedule thereafter.

**4. Browser SDK.** Copy `js/` to a versioned path on your own origin and serve it same-origin. See
`BODY-SDK.md` for the API, result contracts and host responsibilities.

Two servers ship, and the difference matters:

- `tools/sdk-demo.cjs` is **loopback-only by design**. It binds 127.0.0.1 and refuses any Host
  header that is not localhost, so it cannot be deployed and should not be. Use it to try the SDK
  on a workstation: `node tools/sdk-demo.cjs 8774`.
- `tools/sdk-host.cjs` is the one you can deploy. It binds `0.0.0.0`, reads `PORT`, serves only the
  allowlisted SDK modules and the demo page, sets the same headers production sets, and returns 404
  for everything else in the package — migrations, tests, manifests and these documents included.
  It exposes `/healthz` for platform health checks.

It is a reference, not a product: no TLS, no rate limiting, no access logging, no authentication.
It needs none of those, because it serves public source code. Put it behind whatever your platform
provides. What it does get right is the part that silently breaks otherwise — `.mjs` must be served
with a JavaScript content type or the browser refuses the module with no useful error.

Deployment configuration is yours to supply and is deliberately **not** in this package. On Railway,
two files beside it are enough:

```json
// railway.json
{ "build": { "builder": "RAILPACK" },
  "deploy": { "startCommand": "node tools/sdk-host.cjs", "healthcheckPath": "/healthz" } }

// package.json
{ "name": "your-sdk-host", "private": true, "scripts": { "start": "node tools/sdk-host.cjs" } }
```

This exact recipe was executed on 2026-09-10: the package was deployed to a Railway service with no
connection to the Parent Playbook repository, origin or database, given a public HTTPS domain, and
verified — all 28 SDK modules served 200 with `text/javascript`, the demo page rendered, every
module imported in a real browser, the composition gate returned `MODEL_NOT_CONFIGURED` on a host
with zero configuration, and the record contract still rejected a forbidden payload with
`CAPTURE_DATA_FORBIDDEN`. Migrations, tests, docs, the manifest and the deployment config were all
404. The service was deleted afterwards.

**After you deploy, check the deployment itself.** `node tools/sdk-host-smoke.cjs https://your-sdk-host/`
fetches every SDK module from the running host and compares it with this package's `manifest.json`,
byte for byte. It also confirms that `/healthz` answers, that the origin is HTTPS (camera capture needs
a secure context), that the rest of the package (manifest, signature, documents, tests, migrations) is
refused, and that a POST is refused. Pass `--no-demo` if you did not deploy the demo page. Verify the
manifest's signature first: the smoke check proves the host serves what the manifest describes, and the
signature proves the manifest is ours. `tools/acceptance.cjs` runs the same comparison against a local
host.

`node tools/sdk-verify.cjs` checks the package against its checksum manifest.

**5. Results API (optional).** `supabase/functions/company-results-api/` gives a server of yours read
and delete access to an organization's stored results using an organization API key instead of a
person's session. Every access rule is in the migration `20260913120000_company_results_api.sql`; the
function maps HTTP onto it and decides nothing itself.

- A team administrator creates a key:
  `select public.create_company_api_key(team_id, 'label', array['results:read'], now() + interval '90 days');`
  The secret is returned once. Only its SHA-256 hash is stored, and administrators can list their keys
  but not read hashes. Revoke with `select public.revoke_company_api_key(key_id);`.
- A key carries scopes (`results:read`, `results:delete`), an expiry of at most a year, and a per-minute
  rate limit.
- Endpoints: `GET /v1/body-assessments` and `GET /v1/reference-assessments`, paged with `limit` (1 to
  100) and `cursor`; `GET /v1/{kind}/{id}`; `DELETE /v1/{kind}/{id}`. Send
  `Authorization: Bearer ppk_...`.
- Child body assessments are served only while the athlete is on the key's roster and their biometric
  release is live. Another organization's id is answered exactly like a missing one. Every result served
  and every deletion is written to `access_log` with the key that did it.
- Deploy with `supabase functions deploy company-results-api --no-verify-jwt`. The function receives API
  keys, not Supabase JWTs. It sends no CORS headers: an organization key belongs on a server.

The access rules are tested against a disposable database (the `results-api` group in `tests/db/security-tests.cjs`)
and the HTTP mapping under Node (`tests/company-results-api.test.cjs`). The API has not been deployed to
any project, and no key has been issued against a live database.

## Dependency and license inventory

There are **zero npm dependencies**. Nothing is installed to run this. Everything below is fetched
by the browser at runtime from a third-party CDN, which means two things: the package is not
offline-capable, and each item is a supply-chain and licensing decision you inherit.

| Dependency | Version | Fetched from | Used by | Declared license |
|---|---|---|---|---|
| MediaPipe Tasks Vision | 1.0.1 (pinned) | `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@…` | `pose-measure.js`, `surface-worker.js` | Apache-2.0 |
| MediaPipe WASM runtime | ships with the above | same | same | Apache-2.0 |
| Pose Landmarker, full, float16 v1 | v1 | `storage.googleapis.com/mediapipe-models/…` | `pose-measure.js`, `surface-worker.js` | **Google model terms — not the same as the Apache-2.0 code license** |
| heic-to | 1.5.2 (pinned) | `cdn.jsdelivr.net/npm/heic-to@1.5.2/…` | `heic-decode.js` | MIT |
| libheif (bundled inside heic-to) | as shipped by heic-to 1.5.2 | same | same | **LGPL-3.0** |
| supabase-js | v2 (unpinned major) | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2/…` | demo pages only, not the SDK | MIT |

**These licenses are as declared by their publishers and have not been independently verified. Two
need a decision before commercial distribution:**

- **The pose model is licensed separately from the MediaPipe code.** Apache-2.0 covers the library;
  the model weights carry Google's own terms. Owning this repository does not convey rights to
  redistribute or commercially exploit those weights. Confirm before shipping.
- **libheif is LGPL-3.0**, reached transitively through `heic-to`. It is loaded in the browser rather
  than linked into a binary, which is the least entangling arrangement, but LGPL obligations are a
  legal question, not an engineering one. HEIC import is optional — `HEIC-IMPORT.md` describes the
  path, and removing it removes this dependency entirely.

`supabase-js` is pinned only to major version 2, so a future patch changes what the demo pages load.
Pin it exactly before relying on the demos in a regulated environment.

## What this package does NOT include

- **No body-composition model.** None exists. The composition gate validates a provider manifest and
  refuses to produce values without one; the registry ships empty and cannot be written to by an
  organization account. FM05 is at stage 0.
- **No trained reconstruction or measurement model of our own.** The 25 outputs are derived from the
  MediaPipe pose landmarker above. Owning this source does not convey rights to that model.
- **No participant data, photos, geometry or assessments.** The package is source and demos.
- **No validation dataset and no accuracy evidence.** Outputs are provisional. Anatomical accuracy,
  repeatability, DEXA equivalence and population validity are unestablished.
- **No production credentials.** The demo pages carry a Supabase *publishable* key and project URL,
  which are client-visible by design; row-level security is the access boundary, not key secrecy.

## Verification you can run yourself

| Command | Proves |
|---|---|
| `node tools/acceptance.cjs` | All of the below that can run here, with skips named |
| `node tools/package-scan.cjs .` | No images, capture geometry or credentials were packaged |
| `node tools/sdk-verify.cjs` | Package contents match the checksum manifest; no extra files, no symlinks |
| `node tests/db/run.cjs` | Every migration applies to a throwaway cluster, then 507 cases pass as restricted roles: 486 security cases plus a 21-case restore and deletion rehearsal |
| `node tools/schema-parity.cjs --capture <f>` | The migrations alone reproduce a full schema |
| `node tools/operations-check.cjs --verify <f>` | A running database is in the expected posture |
| `node tools/restore-drill.cjs` | A restored database matches its source on schema, row-level security, tenant privileges, retention jobs and row counts (connection strings in `PP_RESTORE_SOURCE` and `PP_RESTORE_TARGET`) |
| `node tools/sdk-host-smoke.cjs <url>` | A deployed host serves exactly the manifest's modules, over HTTPS, and nothing else from the package |
| `node --test tests/<name>.test.cjs` | The shipped contract and adapter suites, one file at a time. `tools/acceptance.cjs` runs all of them and reports the count. The full suite in the source repository also covers app code that is not part of this package |

The checksum manifest on its own detects accidental change, not a determined substitution: it can be
replaced alongside modified files. The package also carries a detached ed25519 signature over the
manifest (`signature.json`). Verify it with `tools/sdk-sign.cjs` against a public key you obtained
separately from the package, never one found inside it; `BODY-SDK.md` gives the route.

## Honest limits of this document

Standing the database up is proven, and so is a logical dump-and-restore: `tests/db/restore-deletion.cjs`
dumps this schema, restores it into an empty database, and checks that the object counts, the rows, the
set of tables with row-level security enabled, and the table privileges all come back unchanged — then
damages the restored copy on purpose to prove those last two checks can fail. **Restoring from a hosting
provider’s own backups is not proven**, and neither is point-in-time recovery or backup deletion; those
remain open in `CLAUDE-CONTINUATION-HANDOFF.md`. When such a restore is made, `tools/restore-drill.cjs` compares it with its
source: schema inventory, row-level security, tenant privileges, retention jobs and row counts. It is proven here only
against a logical dump and restore. Deployment to
a buyer-controlled host has not been performed. Nothing here establishes any FITMATCH parity claim,
and running these commands successfully proves reproducibility, not scientific validity.
