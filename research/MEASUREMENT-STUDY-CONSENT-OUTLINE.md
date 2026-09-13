# Consent outline — measurement study

**Status: OUTLINE for legal counsel and the IRB. This is not a consent form, and it must not be
given to anyone to sign.** Prepared 2026-09-13 for `research/MEASUREMENT-STUDY-PROTOCOL.md`.

Its job is to fix *what the form has to say*, in plain language, and to keep the form consistent with
what the Parent Playbook app already promises in its scan release. Counsel supplies the legal
wording, and the IRB supplies its required elements and contact details. Items in [brackets] are
open decisions.

Writing rule for the final form: short sentences, no jargon, and every promise something the study
can actually keep.

---

## 1. Key information, first

Before anything else, a short box at the top:

- **This is a research study,** and taking part is your choice.
- **We want to find out** how close our phone body scan comes to measurements taken by hand, and how
  much it changes when you are scanned again.
- **You would:** wear close-fitting clothes we provide; have your height and some body lengths
  measured by hand; and be photographed from four sides on a few phones. About [60–90] minutes, and
  maybe a second visit of about [20] minutes.
- **Your photos are never saved.** They are measured on the phone and then discarded.
- **Your measurements are kept until [date or rule]** and then destroyed. You can withdraw at any
  time, and your records are deleted.
- **We will not** diagnose anything, estimate your body fat, or tell you anything about your health.
- **You will receive [compensation]**, even if you stop partway through.

---

## 2. Who is running this, and why

- Who: Parent Playbook ([legal entity]), and the study team [names or roles].
- Why: to test whether a phone scan measures body lengths well enough to be trusted, and to find out
  where it doesn't. The results may decide whether some features are offered, changed or withdrawn.
- IRB approval: [IRB name, approval number, date].

## 3. Who can take part

- Adults aged 18 and over who can stand still, unaided, for about two minutes.
- You can say no. Saying no changes nothing about your relationship with Parent Playbook [or with
  the recruiting organization].

## 4. What happens

Numbered steps with time estimates, matching protocol §5:

1. We go through this form with you and answer your questions.
2. You change into the study clothing [describe], in private.
3. A trained measurer measures your height, and lengths such as arm span, upper arm and thigh. This
   means **lightly touching bony points** (shoulder, elbow, wrist, hip, knee, ankle) to find them,
   and marking them with a washable pen. **You can ask for a measurer of a gender you are comfortable
   with, and for someone else to be in the room.**
4. We photograph you from the front, both sides and the back, on [number] phones. You stand still
   for each photo, and some photos may need to be retaken.
5. The measurer measures around your chest, waist and hips with a tape [over and/or under the study
   clothing; describe].
6. [If chosen] We invite you back in [7–14] days for a short repeat of the photos, which is optional
   and has its own tick-box.

## 5. Your photos: never saved

This matches the app's existing release, word for word where possible:

- The photos exist on the phone only for as long as the scan takes, and then they are discarded.
- Nothing is uploaded, and no record points at an image.
- Any 3D outline made from the photos is also discarded after processing. It is an experimental
  outline of your clothed shape, **not** a body-fat or medical measurement.

## 6. What we keep, and who can see it

List it plainly:

- the scan's measurements, as numbers
- the hand measurements, as numbers
- your age and sex
- the phone model used
- **only if you tick the box:** your self-described race or ethnicity, used only to check the scan
  works equally well for different groups, and never used to calculate your measurements

**How it is kept:**

- Your name and contact details are stored **separately** from your measurements, linked by a study
  code that only [the study coordinator] can match to you.
- Only the study team, [the statistician], [the IRB] and [anyone else required by law] can see study
  records.

**What we will never do:**

- sell your data
- use it for advertising
- share your photos (they do not exist)
- use your data to build or train a new product model without asking you separately

## 7. How long we keep it, and destroying it

- **[Retention rule, decided with counsel and the IRB.]** For example: your name and the link to your
  code are destroyed on [date, e.g. 12 months after your visit], the same schedule the app uses; your
  numbers, with no way to link them to you, are kept until [date] for audit.
- The form states the actual destruction date or rule **before** you agree, as the app does.

## 8. Withdrawing

- You can stop during the visit, or withdraw later, for any reason, without giving one.
- Withdrawing deletes your study records **immediately** [confirm the operational wording].
- **The one thing we cannot undo:** results already combined into anonymous group statistics, with
  no way to identify you, cannot be pulled back out.
- You still receive [compensation].
- How to withdraw: [contact method].

## 9. Risks and discomforts

- **Privacy:** measurements of your body are sensitive personal data. We reduce the risk as described
  in §5–§7, but no system is perfect.
- **Being touched and photographed:** some people find this uncomfortable. You can pause, ask for a
  different measurer or a chaperone, or stop.
- **Close-fitting clothing** may feel exposing. You change in private.
- **Physical:** standing still for short periods. Tell us if you feel faint or unwell.
- There is **no radiation**, no needles and no medical procedure.

## 10. Benefits

- **No direct benefit to you.** We will not assess your health or your body.
- [If decided] You may receive a copy of your own hand measurements. You will **not** receive
  scan-based chest, waist or hip measurements or any body-fat estimate.
- The results may help make the app's measurements more honest about what they can and cannot do.

## 11. Compensation and costs

- [Amount and form], paid [when], even if you stop early.
- There is no cost to you.

## 12. Questions and concerns

- About the study: [study contact].
- About your rights as a participant: [IRB contact].

## 13. Choices and signature

Separate tick-boxes, each optional unless marked:

- [ ] **Required:** I have read this form, my questions were answered, and I agree to take part.
- [ ] **Required, biometric release:** I give my written release for the scan to measure my body from
  photographs, and for the measurements to be kept and destroyed as described in §7. [Counsel wording
  for BIPA, CUBI and MHMDA.]
- [ ] Optional: I agree to the second visit.
- [ ] Optional: I agree to share my self-described race or ethnicity for the fairness check only.
- [ ] Optional: you may contact me about future studies.

Signature, printed name, date. Person obtaining consent: signature, printed name, date. **A signed
copy goes to the participant.**

---

## Consistency checks before this becomes a form

- [ ] Every promise here matches `research/MEASUREMENT-STUDY-PROTOCOL.md` §6 and §10.
- [ ] The photo wording matches the app's release in `js/body-scan.js`. If the app's release
  changes, `SCAN_POLICY_VERSION` changes and this form is re-checked.
- [ ] The destruction date or rule is filled in, and shown before signature.
- [ ] Nothing promises a result, a health insight, a girth or a body-fat number.
- [ ] Counsel has reviewed the biometric release wording, and the IRB has approved the final form.
