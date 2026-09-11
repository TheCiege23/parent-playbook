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

`node tools/sdk-verify.cjs` checks the package against its checksum manifest.

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
| `node tests/db/run.cjs` | Every migration applies to a throwaway cluster, then 176 cases pass as restricted roles: 159 security cases plus a 17-case restore and deletion rehearsal |
| `node tools/schema-parity.cjs --capture <f>` | The migrations alone reproduce a full schema |
| `node tools/operations-check.cjs --verify <f>` | A running database is in the expected posture |
| `node --test tests/<name>.test.cjs` | 107 contract and adapter checks against the shipped modules. The full 283-check suite covers app code that is not part of this package and runs in the source repository, not here |

The checksum manifest is unsigned. It detects accidental change, not a determined substitution, and
it can be replaced alongside modified files. Keep a separately trusted copy if you are verifying a
package that reached you over an untrusted path.

## Honest limits of this document

Standing the database up is proven, and so is a logical dump-and-restore: `tests/db/restore-deletion.cjs`
dumps this schema, restores it into an empty database, and checks that the object counts, the rows, the
set of tables with row-level security enabled, and the table privileges all come back unchanged — then
damages the restored copy on purpose to prove those last two checks can fail. **Restoring from a hosting
provider’s own backups is not proven**, and neither is point-in-time recovery or backup deletion; those
remain open in `CLAUDE-CONTINUATION-HANDOFF.md`. Deployment to
a buyer-controlled host has not been performed. Nothing here establishes any FITMATCH parity claim,
and running these commands successfully proves reproducibility, not scientific validity.
