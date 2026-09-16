# Signed-in regression — checklist

**Purpose.** Run the live app at https://playbookbp.com/ as real signed-in accounts, through the paths no
real account has been through yet: accepting an invitation from a second account, an invitation delivered
by email or text, a body scan saved and deleted, an organization reading a child's results, export, Your
training, and deleting an account. The handoff lists this as "Next implementation targets" 1(b).

Prepared 2026-09-16 against `main` at `06a1468` and the live release `pp-v135` (production smoke 29/29 at
14:11 UTC; the served `sw.js` and `js/invites.js` are byte-identical to `main`). Screen text below was
read from that commit. Production was checked read-only and nothing was changed.

---

## Ground rules

- **Two throwaway accounts**, on email addresses you control (a Gmail `+alias` works):
  - **A**, the household owner. Deleted at the end.
  - **B**, the person A invites. Deleted at the end.
- **Your own account** (the one on the Adult Training allowlist) is used only in section 9, and only for
  training records you create there. It holds real children: never delete a child or the account from it.
- **Invitations go only to addresses and numbers you own.** Email and text invitations really send.
- **Children are made up.** Use a test name such as "Testkid One" and a made-up birthdate.
- **Photos:** a scan needs four photos of one real person. Section 6 uses photos of a consenting adult
  (you) on a test child set to age 18, so no minor is photographed. The minor's three-box release is
  tested without photos.
- **Do not submit a camp listing from A or B** (known problem 7).
- **Record for every step:** the time (UTC), browser and device, pass or fail, and the exact words on
  screen when anything is unexpected. After each section, tell Claude "done with section N": Claude checks
  the database read-only and records the result.

---

## Already covered (2026-09-16, 01:03–01:57 UTC)

Read from the live request logs: one signed-in Windows browser, on an account with no display name, twice.
Every request below answered as intended, including the one refusal.

- Added a child with consent on the reveal (`create_athlete_onboarding`), edited the child and its sport,
  recorded a measurement, ticked an activity.
- Made a one-day change to the week (`week_exceptions`).
- Created an invitation link and code, opened it (`invite_preview`), revoked it, opened it again, and was
  refused on accepting (`accept_invite` 400).
- Deleted the child (`delete-athlete`: `can_delete_athlete`, then the athlete row).

No invitation was sent by email or text, and no second account accepted one. PR #115 came out of this run.

---

## Known problems — expect these

Found while preparing this checklist. Each is a bug in the live release unless noted. Problems 1 to 4 are fixed on
branch `invite-message-fixes` (release `pp-v136`) and are not live yet: the migration has to be applied and
`send-invite` and `send-invite-sms` redeployed. Until then, expect what each describes; afterwards, expect the
fixed behaviour given in section 4. Problem 5 is fixed on branch `adult-hash-link` (release `pp-v137`), not live yet.

1. **A coach invitation cannot be created.** The invite sheet offers "Team Connect (coach)", but the live
   `invite_role_chk` accepts only `co_parent` and `family_view`. Expect "Could not create the invite".
   (Live constraint and `js/sheets.js`.)
2. **An emailed invitation carries no code.** `emails/invite.html` has no code in it and `send-invite`
   never adds one, yet the recipient is told the six digits are "from the email to g•••@…". The code
   appears once, on the inviter's screen. Text invitations do include it.
3. **"A invited you…"** When the inviter has no display name, `send-invite` and `send-invite-sms` take the
   first word of the stand-in "A parent". PR #115 fixed the same stand-in on the dead-link screen only.
4. **The expiry is wrong on screen.** Links expire after 14 days; the app says "Invite links only last a
   week".
5. **`/#adult` does not open Your training on the site.** `js/landing.js` leaves `#adult` out of
   `APP_HASHES` and replaces it with `#app` before the app boots. `tools/adult-harness` leaves that script
   out, which is why the harness never saw it. (Read in code, not yet driven.)
6. **An invited co-parent sees controls the database refuses.** Accepting an invitation grants access to
   each child but not household membership, so "Add another athlete" and "Delete {name}'s profile" are
   shown to B and then refused. (Read in code; section 5 checks it.)
7. **Account deletion leaves the login behind in three cases.** Each is a NOT NULL or unhandled
   `no action` reference to the user that `delete-account` does not clear, so `auth.admin.deleteUser`
   fails after the data is removed ("Your data was removed, but the login could not be deleted
   automatically…"). (Live foreign keys and the handler; not run.)
   - the account ever submitted a camp listing (`camps.created_by`);
   - the account is an invited co-parent who created an invitation (`athlete_invites.created_by`; only
     household members' invitations are handed on);
   - the account withdrew a scan permission another parent gave (`biometric_consents.revoked_by`).
8. **A roster outlives its creator.** Deleting the account that made a roster clears `teams.created_by` and
   leaves the roster and its join code active, with no admin. Section 7 creates one; tell Claude its name so
   it can be removed afterwards, with your authorization.
9. **Smaller:** a future day can be ticked done from the Week list; the notification switches read on for
   a new account before the device is subscribed; there is no way to leave a roster except deleting the
   child.

---

## 1. Account A and the first child

1. On a computer, open https://playbookbp.com/ in a private window → **Start free**.
2. Child: first name "Testkid One", a birthdate making them **11** → **Continue**.
3. Sport: pick one, skip position and level → season **In season** → pick one goal → **Build the playbook**.
4. Reveal "Testkid One's first week is ready." → **Save Testkid One's playbook**.
5. Account: A's email, a password, tick the two required boxes → **Create account**.
   Expect "Check your email".
6. Open the confirmation email **in the same browser** and tap the link.
   Expect "Building Testkid One's playbook…", the toast "Profile created 🎉", the Week, then a sheet "One
   more thing" → **Not now**.
7. **Do not set a name yet** (section 4 needs it blank).

Claude checks: one household with A as owner, one child, both consent records, the sport row.

## 2. A second child and the schedule

1. Profile → **Add another athlete** → "Testkid Two", a birthdate making them **18**, a sport, a goal →
   tick the consent boxes on the reveal → **Save…**.
2. Profile (Testkid One) → **＋ Add a sport** → a second sport, a position and a level → **Add sport**.
   Expect "Sport added". With two sports the sports list shows ✎ 📅 ⭐ ✕.
3. 📅 on the primary sport → tick two practice days, a game day on a different day, a first-game date
   → **Save schedule**. Expect "Schedule saved 📅". Then try the same day for practice and game: expect
   "That day is already a practice day — pick a different game day."
4. **Change season** → **Offseason** → **Save**. Expect "Season updated" and the Week losing game days.
   Set it back to **In season**.
5. ✕ on the second sport → **Remove sport**. Expect "Removed".

Claude checks: two children in one household, the schedule columns, the removed sport gone.

## 3. The Week

The one-day change and a tick are already covered. Two quick checks:

1. Tap a row for today: it ticks without opening (toast "Nice work 💪"). Tap again to untick.
2. Open a home session for later this week → **Change this day** → **Take it off this week**. Expect "This
   week is updated" and the day reading "Rest instead". Open it again → **Undo this week's change** →
   "Back to the plan".

## 4. Invitations from A

1. Profile → "Who can see…" → **＋ Invite** → **Team Connect (coach)** → **Just a link** → **Create
   invite**. Before the fix: expect failure (known problem 1), and nothing created. After it: a link and a code
   for Testkid One only; then **Revoke** it from Profile.
2. **＋ Invite** → **Co-parent (edit)** → **Email** → B's address → **Create invite**.
   Expect "Invite sent to …", then **write down the six-digit code** shown under "Their code".
3. In B's inbox, record the sender, the subject and whether a code is in the email.
   Before the fix: expect sender "Parent Playbook", subject "A invited you to Parent Playbook for the whole
   family" and no code (known problems 2 and 3). After it: subject "You're invited to Parent Playbook for the whole
   family", the same six digits under "Your code", and the footer "Sent through Parent Playbook." If it never arrives, record that: it means `RESEND_API_KEY` is not set.
4. Optional, only to your own mobile: **＋ Invite** → **Family view** → **Text** → your number → **Create
   invite**. Record whether the text arrives and what it says. "sms_not_configured" in the fallback message
   means the Twilio keys are not set. Then revoke it from Profile → **Revoke** → **Revoke invitation**.
5. Settings → **Your name** → set a name. (A later invitation would now use it.)

Claude checks: the coach attempt left no row (before the fix) or one revoked coach invitation for Testkid One
(after it); one pending co-parent invitation for the household; the
revoked text invitation has `revoked_at`.

## 5. Account B accepts

1. In a **different** browser (or another private window), open the link from B's email.
   Expect "[the name A set in section 4] wants you to follow the family's sports journey." and "You'd get
   co-parent access".
2. **Create a free account** with B's address → confirm B's email → return to the invitation.
3. Enter a **wrong** code first. Expect "That code is not right. Check the message and try again."
4. Enter the code from section 4 step 2 → **Accept family invite**. Expect "You're in." →
   **See the family's week**. Both Testkids should be listed.
5. As B, tick an activity for Testkid One and untick it. Expect success.
6. As B, Profile → **Add another athlete** → complete it. Expect refusal with "not authorized for this
   family" (known problem 6). If it succeeds, stop and tell Claude before section 10: the new child's
   consent record would name B, and nothing hands it on when B is deleted.
7. As B, Settings → Danger zone → **Delete Testkid One's profile** → **Yes, delete permanently**. Expect
   the toast "Could not delete" and the child still there (known problem 6).
8. **As B, do not create an invitation and do not withdraw a scan permission** (known problem 7).
9. As A, reload Profile: the invitation no longer shows as pending.

Claude checks: two `athlete_access` rows for B, the invitation accepted, both children still present.

## 6. Body scan (as A)

Use a phone or a computer with a camera, as A, on **Testkid Two** (age 18).

1. Growth → **＋ Record** → height → **your own height in inches** → **Save measurement**.
2. Scan tab → **Measure Testkid Two from four photos**. The release sheet shows one box ("Testkid Two is 18
   and has agreed…"). Tick it → **Agree and start**.
3. Set up once → leave the 3D preview off → **Start with the front**.
4. Take or import four photos of yourself: front, right side, back, left side. Whole body, head and feet
   in frame, nobody else in the picture. For each: **Use this shot** once "Basic photo checks passed."
   - Once, re-use the front photo for the back view. Expect "This is the same photo already accepted for
     the Front view…".
5. After "Measuring…", the result "Testkid Two · measured" lists lengths only. Record whether any chest,
   waist or hip value appears (none should).
6. **Save & view Body Insights**. Expect "Saved" and Body Insights. Try **Export CSV** and **Download
   report**.
7. Scan tab → "Recent scans" shows "Body scan · today · N outputs". **Do not delete it yet** (section 7
   uses it).
8. Minor release, no photos: switch to **Testkid One** (age 11) → add a height → **Measure Testkid One
   from four photos**. Expect three boxes; **Agree and start** stays disabled until all three are ticked.
   Tick them → **Agree and start** → at "Set up once" → **Cancel**.
9. Settings → **Body scan permissions** → Testkid One → **Withdraw** → **Withdraw**. Expect "Withdrawn".

Claude checks: one `body_scan_assessments` row with its measurements for Testkid Two; the 11-year-old's
consent with `minor_assent_attested` and then `revoked_at`, withdrawn by A.

## 7. Organization (as A)

1. Settings → Team & organization → **Your rosters** → Name "PP Regression Roster", a sport → **Create
   roster**. Record the join code.
2. Settings → **Join with a code** → Which child: **Testkid Two** → the code → **Join**. Expect "Joined
   PP Regression Roster".
3. Your rosters → the roster → Testkid Two is listed → **Body assessment dashboard**.
   Testkid Two shows an assessment → **View results**: the scan's outputs appear.
4. **Save latest authorized copy**. Expect success (the permission from section 6 is live). Then **Export
   company JSON**, then **Delete company copy**.
5. **Export filtered CSV** from the dashboard.
6. Back in Scan → Recent scans → **Delete** on the Testkid Two scan → OK. Expect "Scan deleted". The
   dashboard's **Refresh records** now shows no usable assessment.

Claude checks: the team and membership, the company copy created then deleted (its audit rows), the scan
and its measurements gone.

## 8. Settings (as A)

1. **Export everything** → **Download the file**. Open the JSON: both children, their sports, goals and
   measurements are in it; pending invitations are not.
2. **Password** → **Change** → a new password twice → **Update password**. Expect "Password updated".
   Log out and back in with it.
3. Notifications: record what the switches show. Turn **The week ahead** off and on again; accept the
   browser prompt. Expect "Notifications on 🔔". (On an iPhone the app must be on the Home Screen first.)
   - Optional: to exercise the first push from the redeployed functions, keep A until Monday
     2026-09-21. The weekly push runs Sunday at 22:00 UTC; Claude can read `notification_log` on Monday.

## 9. Your training (your own allowlisted account)

Signed in as **your own account**, on a computer. Nothing here touches a child.

1. Visit `https://playbookbp.com/#adult`. Record where it lands: before `pp-v137`, the Week (known problem 5);
   from `pp-v137`, Your training.
2. Settings → **Your training** → **Your own training**.
3. **Set up** → units **lb**, the other fields as you like → **Save**.
4. **Your goals** → **＋ Add** → a kind, a sentence → **Save goal**.
5. **This week** → **＋ Add workout** → name "Regression workout", **today**, 20 minutes → **Add
   workout**. **Edit** → **Add an exercise** → 3 sets of 10 → **Add exercise**. Tick today's box.
6. **Progress** → **＋ Record** → Weight, 180, lb, today → **Save**. Expect "Recorded". Save the same
   again: expect "That reading is already recorded for that day."
7. **Import** → choose a file `regression.csv` containing:

   ```
   date,metric,value,unit
   2026-09-14,steps,8000,steps
   2026-09-15,steps,9000,steps
   2026-09-15,weight,179.5,lb
   ```

   "Where are they from?" → "Regression file", "They are" → **A device or app export** → preview shows 3
   new readings → **Import**. Expect "Imported 3 readings".
8. **Progress over time**: two weeks show activity and at least two weight readings.
9. Settings → **Export everything** → the file has an `adult_training` section.
10. Delete, in this order:
    - "Your imports (1)" → **Undo** → confirm.
    - "Readings you typed in (1)" → **Delete** → confirm. Expect "Reading deleted".
    - The workout → **Edit** → **Delete this workout** → confirm.
    - The goal → **Remove** (no confirmation).
    - Footer **Delete your training record** → type DELETE → **Delete my training record**. Expect "Your
      training record is deleted". This also removes any body composition results you imported about
      yourself; if you have real ones to keep, stop before this step.

Claude checks: every adult table empty for your account afterwards, and your allowlist row still there.

## 10. Delete B, then A

1. As **B**: Settings → **Delete my account**. Record the children the sheet lists (it lists A's children,
   which B can only see). Type DELETE → **Permanently delete everything**. Expect "Your account and all
   data have been deleted" and the signup screen. B's login should fail afterwards.
2. As **A**: Settings → Danger zone → **Delete Testkid One's profile** → **Yes, delete permanently**.
   Expect "Deleted" and the Week for Testkid Two.
3. As **A**: **Delete my account** → type DELETE → **Permanently delete everything**. Expect the same
   message and the signup screen. A's login should fail afterwards.
4. Open B's old invitation link. Expect a dead-link screen, not an error.

Claude checks: no household, child, consent, invitation, scan or access row left for either account; both
logins gone; "PP Regression Roster" left with no admin (known problem 8), to be removed with your
authorization.

---

## Results

| Section | Account | Time (UTC) | Result | Notes |
| --- | --- | --- | --- | --- |
| 1 First child | A | | | |
| 2 Second child, schedule | A | | | |
| 3 Week | A | | | |
| 4 Invitations | A | | | |
| 5 Accept | B | | | |
| 6 Scan | A | | | |
| 7 Organization | A | | | |
| 8 Settings | A | | | |
| 9 Your training | yours | | | |
| 10 Deletion | B, A | | | |

Not in this checklist: Google Calendar (needs an OAuth client id), Bluetooth equipment (needs hardware) and
the company results API (needs an issued key). Each has its own entry in the handoff.
