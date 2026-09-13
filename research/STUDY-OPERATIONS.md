# Measurement study operations tooling

`tools/study/` is the operations layer for `research/MEASUREMENT-STUDY-PROTOCOL.md`:

- participant codes
- device randomization
- double-entered reference readings
- blinding between roles
- visit tracking
- withdrawal
- de-identified export
- the agreement and repeatability analysis the protocol names

**Status: built and tested on synthetic data only. Nobody may be enrolled until the protocol's
sign-offs exist** — IRB approval, legal counsel on the biometric release, and the statistician's
pass/fail criteria. This tooling does not replace any of them.

---

## What it enforces

| Protocol rule | Where |
|---|---|
| Adults only in phase 1 (§3) | `enroll` refuses under 18 |
| Race/ethnicity only with its own consent tick (§3) | `enroll` refuses it without consent; the export includes it only with consent **and** when asked |
| Device order randomized, phone 1 first (§5) | `randomize.mjs`: Williams design, balanced by position and by which device follows which, shuffled within blocks by the recorded seed |
| Readings taken twice, a third if they differ by more than the tolerance (§5) | `reference.mjs`, `recordReading` |
| Every written value typed twice | `recordReading` refuses a mismatch and stores nothing |
| Measurers never see scans; scan operators never see readings; measurer B never sees measurer A (§5) | `blinding.mjs`; each role gets an error, not a quietly filtered answer |
| Photos and geometry are never kept (§6) | scan files pass through the product's own validator, which refuses them; only scalars are stored |
| Name and contact apart from measurements (§6) | a separate `link-key.json` |
| Withdrawal deletes data immediately (§6), even after the lock | `withdraw` removes readings, scans, visits and the link-key entry; the audit keeps counts, never values or a reason |
| Nothing new is recorded after the data lock | `lockData`; the final export refuses until the data is locked, and an interim export says so |
| No calendar dates or identifiers reach the analyst | the export uses keyed pseudonyms and day offsets |
| No pass/fail thresholds before the statistician sets them (§9) | the analysis reports statistics and applies no threshold |

**No scientific defaults.** The study configuration must supply:

- the device set
- the visit-2 window
- the tolerance for each reference measure
- the rule for combining readings
- the randomization seed

The tools refuse to run without them. The protocol leaves these in brackets for the people who
decide them.

## What it does not do

- **Authentication.** Commands take a `--role` flag, and anyone at the keyboard can type any role.
  The flag makes permitted actions explicit and stops honest mistakes; it doesn't stop someone who
  decides to look. Real blinding needs separate accounts, or separate copies of the files for each
  role with the other roles' files withheld.
- **Encryption at rest.** Study files are plain JSON. Keep the study directory on an encrypted
  disk with access limited to the study team, and keep `link-key.json` and the export key apart from
  everything else.
- **Clinical data management.** This is not a validated electronic data capture system, and it has
  no audit-trail certification.
- **A mixed model.** The analysis reports per-device agreement and an ICC across devices; the
  protocol's mixed model (§7) is for the statistician, working from the export.
- **Surface-section import.** Tape and girth reference values can be recorded, but scan section
  perimeters aren't yet imported from their report files.

---

## Configuration

`study.json` is written once, by `init`. Values in brackets are decisions from protocol §12.

```json
{
  "schema": "PP_MEASUREMENT_STUDY_CONFIG_V1",
  "studyId": "[study id]",
  "devices": [{ "id": "[phone-1-id]", "label": "[model, OS, browser]" }, { "id": "[phone-2-id]", "label": "[…]" }],
  "phone1": "[phone-1-id]",
  "randomizationSeed": "[at least 32 random characters, recorded before enrollment]",
  "visit2WindowDays": ["[earliest]", "[latest]"],
  "reference": {
    "combine": "mean_of_two_median_of_three",
    "tolerancesCm": { "stature": "[tolerance]", "arm_span": "[tolerance]" }
  }
}
```

The reference measure keys are in `tools/study/reference.mjs`, transcribed from protocol §2, along
with which scan output each is compared with. Hip joint width, ear landmark width, torso length and
ankle to heel have no standard counterpart and are descriptive only.

## Files

Everything lives in one directory that **must be outside the repository**. The tools refuse
otherwise, because this is personal data about real people.

| File | Holds |
|---|---|
| `study.json` | the configuration |
| `participants.json` | codes, sex, age, consents, device order, status: no names |
| `link-key.json` | code to name and contact, and nothing else |
| `reference.json` | every reading, by attempt and measurer |
| `scans.json` | scalar scan outputs and provenance |
| `visits.json` | visit schedule and status |
| `audit.jsonl` | what happened and when: events and counts, never values |
| `lock.json` | when the data was locked, once it is |

## Workflow

```sh
node tools/study/study.cjs init     --dir <study dir> --config <config.json>
node tools/study/study.cjs enroll   --dir <dir> --role coordinator --file <enrollment.json>
node tools/study/study.cjs reading  --dir <dir> --role measurer --code <code> --visit 1 --measure arm_span --measurer A --value 181.2 --verify 181.2
node tools/study/study.cjs scan     --dir <dir> --role scan_operator --code <code> --visit 1 --device <id> --capture 1 --file <company.json>
node tools/study/study.cjs visit    --dir <dir> --role coordinator --code <code> --visit 1 --complete 2026-10-01
node tools/study/study.cjs view     --dir <dir> --role coordinator
node tools/study/study.cjs withdraw --dir <dir> --role coordinator --code <code> --on 2026-10-02
node tools/study/study.cjs lock     --dir <dir> --role coordinator
node tools/study/study.cjs export   --dir <dir> --role analyst --key-file <key> --out <export.json>
node tools/study/study.cjs analyze  --export <export.json> --out <analysis.json>
```

- **Enrollment.** `enrollment.json` holds the name, contact, sex, age, enrollment day, and the
  three optional consents. It prints the participant code and that participant's device order.
- **Scans.** The scan file is the company assessment JSON downloaded from the scan page, as in
  `SECOND-REFERENCE-SCAN-CHECKLIST.md`.
- **Export and analysis.** Both write only outside the repository.

## Withdrawal, precisely

Withdrawing deletes the participant's readings, scans, visits and link-key entry at once, whether
or not the data is locked. What remains is the code with its enrollment position, so later device
assignments don't shift, plus an audit line with counts of what was deleted. The reason is not
stored.

Results already exported can't be recalled, and the consent outline says so. This is why the final
export waits for the lock.

## Analysis output

`analyze` reports, from the export alone:

- **Agreement with the reference**, per output and per device: bias, limits of agreement with
  approximate intervals, mean absolute error, and proportional bias, flagged where the comparison
  carries a definitional caveat.
- **Repeatability**: within-session and between-day technical error, relative error, and minimal
  detectable change.
- **Reference quality**: measurer A against measurer B, per measure.
- **Agreement between devices**: an ICC across devices.
- **Missing outputs**, by device.

Statistics that can't be computed are reported as insufficient, with the reason. Intervals use 1.96
and the large-sample standard error, and understate uncertainty in small subgroups, which the
report says beside them.

The formulas are checked against hand calculations and against Shrout and Fleiss's published ICC
example in `tests/study-analysis.test.cjs`.
