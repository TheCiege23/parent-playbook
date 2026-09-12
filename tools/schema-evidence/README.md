# Schema parity evidence

**Claim:** a database built from `supabase/migrations/` alone is object-for-object identical to the
live Supabase project.

This is the database half of the acquisition constraint in `FITMATCH-PARITY-PLAN.md` — the engine
must be independently operable by an acquirer. If the repository cannot reproduce production, an
acquirer cannot stand it up, and no amount of application code changes that.

## Reproducing it

```sh
node tools/schema-parity.cjs --capture tools/schema-evidence/restored-from-migrations.json
```

Builds a throwaway PostgreSQL cluster, replays every migration into it, emits the canonical
inventory from `tests/db/inventory.sql`, and destroys the cluster. Then run the *same*
`tests/db/inventory.sql` against the live project and compare:

```sh
node tools/schema-parity.cjs --compare <production.json> tools/schema-evidence/restored-from-migrations.json
```

## Result — 2026-09-12

Re-verified after the external body composition tables landed. Same claim, larger schema.

| Kind | Objects | Match |
|---|---|---|
| column | 558 | yes |
| constraint | 277 | yes |
| event_trigger | 1 | yes |
| function | 61 | yes |
| grant | 110 | yes |
| index | 169 | yes |
| policy | 175 | yes |
| table | 55 | yes |
| trigger | 14 | yes |
| **total** | **1420** | **all nine kinds identical** |

One fingerprint, the same `inventory.sql` aggregate on both sides, live project
`xqvqjkdxykowwpcmyudz` (PostgreSQL 17.6) and a restored cluster (PostgreSQL 18.3):

```
40e9b796e5fe46faa24d2c28c1d1f325
```

### What this run found

**The check was broken on Windows, and said so as a schema difference.** A first comparison
reported 33 function bodies differing. None of them did. `prosrc` keeps whatever line endings the
migration file had, and with `core.autocrlf` a Windows checkout holds CRLF in 11 of the migration
files — so every multi-line `create function` replayed locally landed with `` in its body, while
live (applied over the wire, LF) had none. Live carries zero carriage returns in all 61 bodies.

The functions behaved identically; only the comparison was wrong. That is the worst possible
shape for this check: an acquirer runs it on a Windows machine, sees 33 differences, and concludes
the repository does not reproduce production. `tests/db/replay.cjs` now normalizes each migration
to LF before replaying it, so the inventory is a function of the commit rather than of the
checkout. This is the same defect class as the archive fingerprint in `tools/sdk-sign.cjs`, found
independently, in a second place.

**A second false alarm, this one self-inflicted.** Chasing the first, a hand-typed copy of the
aggregate produced a different hash from the same schema. The separators in `inventory.sql` are
the bytes 0x01 and 0x02, and they were typed in literally — invisible in an editor, so the
expression reads as `kind||''||identity` and the hand-typed copy used empty separators. Two
different hash functions over identical data look exactly like drift. The separators are now
written as `E'\x01'` escapes: same bytes, same fingerprint (verified before and after), and the
file is no longer binary to git and grep.

## Result — 2026-09-10

| Kind | Objects | Match |
|---|---|---|
| column | 526 | yes |
| constraint | 240 | yes |
| event_trigger | 1 | yes |
| function | 47 | yes |
| grant | 106 | yes |
| index | 155 | yes |
| policy | 168 | yes |
| table | 53 | yes |
| trigger | 10 | yes |
| **total** | **1306** | **all nine kinds identical** |

Per-kind fingerprints, live project `xqvqjkdxykowwpcmyudz` (PostgreSQL 17.6):

```
column         190282babdd8cd57ec9141a3c3476701
constraint     ce9d997343f0676b1d3d7f155004952c
event_trigger  84f4d688f29ec9aae8b6b43f80bbeb00
function       b22b6941239f586635e8bb9d426f034f
grant          f0ad0e749b59f2024dd7c9bab685abfc
index          fe229372004cb1902e49ad7487603b22
policy         e31c260d7ca2172fe657586b54e14825
table          032ba3d0a25a66bef2975781be0b6abd
trigger        da1a942e19a5f97579cf705bee410080
```

The restored cluster (PostgreSQL 18.3) reproduces all nine.

## What it found

**One object existed in production and in no migration:** `public.rls_auto_enable()` and its
`ensure_rls` event trigger. That is not cosmetic — the trigger fires on `ddl_command_end` and enables
row level security on every new `public` table, which is why all 53 have RLS on. An acquirer
restoring from this repository would have got a database without that guardrail, and the next table
created there would silently have had no RLS.

Captured in `supabase/migrations/20260910210000_capture_rls_auto_enable_event_trigger.sql`.

**Two lessons the comparison taught, both now encoded:**

1. **Capture bytes, not a tidied version.** The first draft of that migration reformatted the body to
   lowercase. Behaviour identical, `md5(prosrc)` different, parity broken. The migration now carries
   production's exact 953 bytes, verified `99be20677b456ea8d3be47bdd44fb369`.
2. **Event triggers are cluster-scoped, so a schema-only inventory misses them** — which is exactly
   how `ensure_rls` stayed invisible. `tests/db/inventory.sql` now covers them.

## Deliberate exclusions

These differ legitimately between a fresh restore and a live project, and are not this repository's
to reproduce:

- **Schemas other than `public` and `private`.** Supabase owns `auth`, `storage`, `realtime`,
  `graphql`, `extensions`, `cron`.
- **Extension-owned functions.** `pgcrypto` lands in `public` on a plain cluster and in `extensions`
  on Supabase. Excluded via `pg_depend … deptype='e'`; before that exclusion it produced 36 phantom
  differences.
- **`NOT NULL` catalog constraints.** PostgreSQL 18 records them in `pg_constraint`, 17.6 does not.
  The property is already compared per column as `notnull=`, so excluding them loses no signal and
  removed 295 phantom differences.
- **Row data, OIDs, sizes and statistics.** Never compared.

## What this does NOT prove

- Not that a *data* restore works. This compares structure only. Backup deletion and point-in-time
  restore remain unverified, and are still listed as open in the handoff.
- Not that the application behaves correctly against a restored database — only that the schema it
  would run on is the same one.
- Nothing about anatomical accuracy, composition validity or any FITMATCH parity claim.
