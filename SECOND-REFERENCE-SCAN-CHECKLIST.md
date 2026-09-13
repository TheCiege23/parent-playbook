# Second adult reference scan — checklist

**Purpose.** Save a second, independent scan of the same consenting adult as
`friday-adult-reference-001`, as a second organization record, so the deployed repeat comparison
has two real records to compare. That comparison is the missing evidence for FM09, history and
reference comparisons.

This is a **real record, made only with the adult's written permission**. It is not a test record,
and nothing here involves a child.

Prepared 2026-09-13. Facts about the first record and about production were checked read-only on
that date, and nothing was changed.

---

## Deadline: save and compare before 2026-10-10 23:59 UTC

The first record, `friday-reference-001`, is retained through **2026-10-10 23:59:59 UTC**. The
daily retention job runs at 03:40 UTC and deletes it on **2026-10-11**. After that there is
nothing to compare against.

Keeping the first record longer means changing a live real record. That needs the adult's
permission for the longer period and a separate, explicit decision. Do not do it as a side effect
of this checklist.

---

## What must match the first record

The comparison refuses to run unless every row below holds.

| | Must be | First record | Production on 2026-09-13 |
|---|---|---|---|
| Organization | the same organization | [the organization holding `friday-reference-001`] | — |
| Adult subject reference | exactly `friday-adult-reference-001` | `friday-adult-reference-001` | — |
| Assessment reference | **different** | `friday-reference-001` | use e.g. `friday-reference-002` |
| Capture time | different | 2026-09-10 04:08 UTC | automatic |
| SDK version | the same | 0.13.0 | 0.13.0 |
| Unit | the same | inches | inches |
| Engine | the same | `ondevice-pose` 1.3.0 | `ondevice-pose` 1.3.0 |
| Model | the same | `mediapipe-pose-full-float16-v1/tasks-vision-1.0.1` | the same |

These don't have to match for the comparison to run, but match them anyway, or the differences
mostly measure the change in set-up:

- **the capture set-up:** the first scan loaded four authorized full-body photos as files, in
  production Chrome on Windows
- **the height:** 74 inches was entered for the first scan
- **no 3D surface**, as in the first scan
- **the same clothing type** and phone position

---

## 1. Before the day

- [ ] **Permission.** The adult agrees to a second scan and to the record being stored. Record their
  written permission for this capture, and decide the permission reference that points to it, e.g.
  `adult-reference-permission-YYYY-MM-DD`.
- [ ] **Retention.** Choose the second record's "Retain through" date, within what the adult agreed
  to. The first record was kept one month from saving.
- [ ] **Versions.** Confirm production still matches the table:
  - `node tools/deployment-smoke.cjs` passes
  - on `main`, `SDK_VERSION` in `js/body-sdk.mjs` is still `0.13.0`
  - in `js/pose-measure.js`, the `ondevice-pose` provider is still version `1.3.0` and
    `MP_VERSION` is still `1.0.1`

  **If any of these changed, stop.** The comparison will refuse, and a new baseline pair would be
  needed.
- [ ] **Access.** Sign in with an account that is an admin of the organization holding the first
  record. Saving and comparing both require it.

## 2. Photos: new ones, never the first set

- [ ] **Take four new photos**: front, right side, back, left side. **Never reuse the first scan's
  photos or copies of them.** Identical inputs make an identical record, and the "repeat" would
  prove nothing.
- [ ] **Measure height on the day** with a stadiometer, or a flat wall and a set square, in inches.
  Enter what you measure, not 74 by default. Every output is scaled by this number, so a different
  height shows up as a change in every length.
- [ ] **Follow the scan page's set-up:**
  - phone braced vertically at hip height, about eight feet away
  - the phone position and one standing centre marked on the floor
  - the same zoom for all four photos, with the subject rotating in place
  - a plain wall behind
  - close-fitting clothes
  - the whole body in frame, with clear space above the head and below the feet; don't crop shoes
    or toes
- [ ] **Note what was worn**, and match the first scan's clothing type if it's known.

## 3. Scan — `https://playbookbp.com/company-sdk-demo`

- [ ] Tick **"I have permission to process these adult reference photos on this device."**
- [ ] Leave **"Also build an experimental 3D surface"** unticked. The first record has no surface,
  and the comparison uses lengths only.
- [ ] Load the four photos, check each preview, and review each view.
- [ ] Enter **Measured height (inches)**.
- [ ] Select **Run four-photo scan**. All four capture checks should pass. If one fails, retake that
  view with a new photo.
- [ ] Note how many of the 25 outputs came back (the first scan returned 25). An output missing
  from either record is simply left out of the comparison.
- [ ] Under **Company record lifecycle rehearsal**:
  - **Adult subject reference:** `friday-adult-reference-001`
  - **Consent reference:** the permission reference from §1
  - **Stable assessment ID:** `friday-reference-002`
  - the organization and operator references

  Then select **Save current assessment**, then **Prepare authorized export**, and download the
  company JSON file.

## 4. Save — `https://playbookbp.com/company-persistence-demo`

- [ ] Under **Parent Playbook company JSON**, import the downloaded file. Check the facts it shows,
  such as the output count.
- [ ] Select **Check signed-in organization access**. For **Organization**, choose the one that
  holds the first record.
- [ ] **Adult subject reference:** `friday-adult-reference-001`, exactly. The field starts as
  `example-subject-001`.
- [ ] **Assessment reference:** make sure it reads `friday-reference-002`. The page fills this from
  the imported file, and it must **not** be `friday-reference-001`.
- [ ] **Permission reference:** the reference for this capture. The field starts with a 2026-09-10
  value, so replace it.
- [ ] **Retain through:** the date agreed in §1.
- [ ] Tick the adult-reference confirmation, select **Save adult reference**, then **Reopen
  persistent record** to confirm it saved.

Saving sends only the derived measurements and their provenance. The photos never leave the device.

## 5. Compare — signed-in organization dashboard

- [ ] Go to **Account → your organization → Body assessment dashboard → Adult reference
  assessments**, and open `friday-adult-reference-001`.
- [ ] Under **Compare two authorized records**, pick the other assessment, then select **Compare
  authorized records**. **Export comparison CSV** saves a copy if wanted.
- [ ] Read it for what it is: second-minus-first differences between two provisional photo
  estimates. It makes no claim about accuracy, significance, growth or cause.

| If the page says | It means |
|---|---|
| "Assessments use incompatible SDK or engine versions." | Production changed between the scans. See §1 |
| "Assessments must belong to the same organization and adult reference." | The subject reference or the organization doesn't match. Check for a typo |
| "Choose two different assessments." | The second record reused `friday-reference-001` |
| "The assessments have no comparable scalar outputs." | Neither scan returned an output the other did |

## 6. Afterwards

- [ ] **Record what happened** in `CLAUDE-CONTINUATION-HANDOFF.md` and `FRIDAY-DEMO-READINESS.md`:
  - the date
  - the device and browser
  - that the height was measured on the day
  - how many outputs came back
  - that the comparison ran, and how many outputs it compared

  **No measurement values**, in keeping with how the first record is documented.
- [ ] **FM09 is a separate decision.** Whether its rubric stage moves is decided on its own. One
  repeat pair taken in desktop Chrome is not a demonstration on the intended devices.
- [ ] **Leave the first record alone.** Don't edit or delete it; it expires on its own schedule.
