# Parent Playbook launch audit — September 26, 2026

Status: fixes deployed to production on September 26 as `pp-v139`. Railway deployment `2f94126a-b954-4e1e-b4ac-5971a6cb076e` reached SUCCESS; all 29 post-deployment smoke checks passed. Launch sign-off remains pending a signed-in parent and coach walkthrough.

QA account: `qa-launch-20260926-6fe76ff6@example.com`. Created through the project administration API with email marked confirmed; login credentials verified through the live authentication endpoint. Its own guardian display-name profile was created. No real family or child data was added. Credentials are in the ignored local `.env.qa-test-account.local`, never in this report or the deployed image. The reserved example email cannot receive reset or invitation messages; email-delivery testing still requires an inbox controlled by the operator.

## Fixed

- A prematurely closed CSS comment swallowed the landing link rule. Restored button/link styling and added visible keyboard focus.
- Desktop navigation crowded the tablet header. Hid section links at tablet widths and adjusted the narrow mobile header.
- Hidden install controls could still appear because CSS display rules override HTML `hidden`. Enforced hidden states on the landing page.
- The dismissed install banner remained exposed to screen readers and keyboard navigation. Hidden banners now use visibility, and the banner is a nonmodal region. Late install events cannot reopen a dismissed banner.
- Signup and onboarding inputs had visible labels without programmatic associations. Connected labels to inputs; sport, position and goal selection now expose their selected states.
- Onboarding and the new organization account screen now have bounded desktop widths.
- The coach CTA opened email to support instead of explaining how a family invites a coach. Added invitation guidance and a roster entry.
- Coach marketing said organizations were upcoming, contradicting the live organization page. Updated the copy and made the organization's sign-in CTA open Account.
- A coach or organization owner without a child could not reach Account/rosters. Added an organization account entry and signup path that requires no child profile. Confirmation-email returns preserve this destination.
- Invited coaches and family viewers were asked to attest they were the parent/legal guardian. Invitation signup now asks them to agree to the policies without that incorrect attestation. Switching from invitation login to signup now preserves the invitation flow.
- Connected coaches can reach their own roster tools without entering the parent's account settings.
- Marketing listed hockey, lacrosse and cross-country while the live selector offers 13 sports without those choices. The ticker now matches the available sports, including dance and tennis.
- Updated the presentation's regression count with the skipped check stated explicitly.

## Verification

- Chrome: production parent onboarding with synthetic name and date through sport, season, goals, plan reveal and account form; no account created or child data saved.
- Chrome: local parent required-field validation, label targeting, complete sport picker, organization sign-in/signup, install dismissal, FAQ accordion, mobile and tablet header geometry, landing link styling. No page-level errors logged during these checks.
- JavaScript regression suite: 1,060 cases declared; 1,059 pass, one skipped, no failures. Added five executable tests for organization routing, signup/confirmation, invitation preservation, account actions and install dismissal. Existing routing tests updated for the new no-child Account entry.
- Disposable local database: 526/526 security cases and 21/21 deletion/restore cases passed. The harness reports its expected unsupported local extension migration separately. The initial audit performed no production database writes; subsequent authorized test-account provisioning created only the QA login and its own guardian profile.
- Production deployment smoke: all 29 anonymous checks passed after deployment of the fixes, including private paths returning 404.

## Required before promotion

1. Sign into disposable test accounts in Chrome and exercise saved parent screens: Week completion and changes, Growth entry/edit/delete, Journey game/photo/milestone logs, Profile edits, household sharing, export and settings.
2. Accept a real invitation in a second coach/family account. Verify permissions, roster creation/joining, update delivery, revocation and confirmation-email returns. Unit/database coverage does not replace this integration check.
3. Run camera/scan capture on actual target phones with appropriate consent, then verify saved results and deletion. Physical camera quality, performance, iPhone installation and notification delivery have not been certified here.
4. Re-run the remaining browser flows against the new production release. Deployment and the post-deployment smoke checks are complete.

Evidence: `audit-test-results.txt`, `audit-db-results.txt`, `audit-live-results.txt`. Local preview: `node tools/audit-preview.cjs` at `http://127.0.0.1:8787/`; it serves only public assets, not environment files or audit notes.
# Follow-up improvements — pp-v140

## Athlete Story foundation — pp-v142, local candidate

Added a private Story dialog from Journey: milestones presented as Hall of Fame, Journey photos, individual video highlights and a text-only printable résumé. Export reloads authorized records and excludes birthdate, health measurements, notes and signed media URLs. No database migration or coach permission expansion. Synthetic local Chrome checks: empty state, achievement creation, Hall of Fame/résumé display and export success. JavaScript: 1071 passed, 1 skipped, 0 failed. Publication pending approval; uploaded-video playback and phone-device testing remain outstanding.

Signed-in Chrome verification: pp-v140 roster creation succeeds; empty names and conflicting game/practice days are rejected; copy-code reports success; roster Back returns to the list with Start another roster; body dashboard empty state and disabled export render correctly. Fictional profile setup applies the roster schedule and generates a preview. The user completed final Terms/consent and saved the fictional athlete; Week and Growth loaded successfully.

Additional pp-v141 UI cleanup prepared: remove internal company demo/validation links from the coach dashboard, explain unavailable photo body composition in plain language, and replace a hardcoded football icon in team-code prefill. Journey fixes: blank optional location normalizes to null for online/offline saves; Journey now loads current athlete sports for game logging before Profile is visited. Associated game-entry labels were added. Full JavaScript suite: 1067 passed, 1 skipped, 0 failed. QA height (60 in) and game completion saved successfully. A text-only QA game saved with Neutral selected; the live first-game categorization bug was reproduced. Pending publication approval.

Returning roster owners now reach Account from ordinary sign-in links. Starting a child profile clears coach routing markers while preserving team codes. A single roster retains the roster list and Start another roster action. Creation failures restore the submit button; schedule conflicts are rejected before saving. Partial roster query failures show Retry rather than incomplete data. Roster forms have associated labels, bounded desktop widths, and a copy-code action that explains the difference between schedule prefill and roster sharing.

Validation: JavaScript suite 1066 declared, 1065 passed, 1 skipped, 0 failed. Six additional regression cases cover routing, roster navigation, failed creation, schedule conflicts, and partial data failure. Authenticated Chrome walkthrough awaits approval to accept the sign-in screen's displayed terms. Email delivery cannot be tested with the reserved example.com QA address.


Story expansion — 2026-09-26: explicit revocable coach contributions and per-highlight sharing; pending contributions require parent approval. Browser reel trimming rendered a synthetic 1280×720 VP8/Opus download in Chrome. Approved text notes now appear in the Story. Server OpenAI frame analysis uses structured evidence and fails closed pending provider-approved Zero Data Retention; user confirmed it is not enabled. Supabase migrations and functions deployed; frontend commit fa98d4a deployed successfully through Railway deployment 81f37977-81fe-49f5-9b90-0bec48e8dcd4. Production smoke passed 31/31 for pp-v143; live QA Story and contribution panels loaded in Chrome. The deployed authenticated AI endpoint returned 503 for unconfirmed Zero Data Retention before accepting frames. JavaScript: 1076 passed, 1 skipped. Database: 531 security + 21 rehearsal = 552 passed. No real child footage sent to OpenAI.


Story reliability follow-up: sharing failures restore their checkbox rather than showing unsaved access changes; stale sessions cannot refresh a replacement athlete; tool dialogs have explicit close/cancel controls. Reel inputs freeze during rendering, all loaded videos and stream tracks are released, hidden tabs and closed dialogs abort, startup/seek gaps are excluded, duplicate orders are rejected, and seeks must reach the requested start time. Local preview now supports HTTP byte ranges, allowing a 3-second two-clip export to be decoded and verified at the requested trim times and reverse order. Escape canceled an active render without a new download. Chrome layout tested at 390 CSS pixels with no horizontal overflow; this is not physical iOS/Safari certification. AI setup errors now preserve the server retention explanation. Privacy, deletion and coach pages describe selected-highlight sharing, parent approvals, retained approved contributions, provider gating and local reel exports. AI processing remains disabled. Candidate pp-v144 validation follows.

Release verification: pp-v144 committed as c0d987bb36879b1a59b66d4521cb02e364f71620 and pushed to main. Railway deployment 3563d1d5-96b9-4b85-bc32-46639c79f420 succeeded. Production smoke: 31/31 passed. Full JavaScript suite: 1085 passed, 1 skipped, 0 failed (1086 declared). Synthetic QA contribution stayed absent from the loaded Story while pending and appeared after parent approval. No child footage was processed; AI remains disabled pending confirmed Zero Data Retention.

## Launch readiness follow-up — pp-v145

Fixed the production Profile invitation button: its duplicate ID bound the action to a hidden landing section. Profile actions and invite choices now support keyboard activation; invitation fields have associated labels, code-generation failures stop delivery, and clipboard failures remain recoverable. Coach emails explain that selected highlights and Story contributions require separate parent permission.

Fixed an invite security defect: raising an exception after incrementing failed code attempts rolled back the counter. Wrong-code attempts now commit without granting access; new invitations remain locked until a code is issued. The frontend treats a null acceptance result as an incorrect code. Production migration 20260926190000_invite_attempts_persist.sql and the updated send-invite function are deployed. Existing manual caller authentication and authorization are preserved.

Notification settings distinguish saved preferences from this device's registered subscription. Subscription status checks account ownership and the current application key. Failed preference saves preserve the prior setting, and stale screens cannot save to another account. Confirmation resend preserves the intended invitation/account return URL and recovers after request failure. Coach marketing headers have improved narrow-screen spacing and touch targets.

Verification: 1,094 JavaScript cases declared, 1,093 passed, one skipped, zero failed. Disposable database: 535 security plus 21 deletion/restore cases passed (556 total), including persistent failed-code attempts, lockout, unissued invitation rejection and successful correct-code acceptance. The database harness installs pgcrypto in the same schema used by production code. SDK candidate v54 includes the new migration; package signing/replay remain pending and are not represented as launch verification.

Production authentication Site URL corrected from the old domain to https://playbookbp.com. Email signup and confirmation remain enabled. One authorized password-reset request returned success, but the recipient reported it had not arrived; the endpoint response does not establish account existence or inbox delivery. A separate fictional-athlete coach invitation was accepted by the email provider and the user confirmed it arrived in the inbox at cjabar.henson@gmail.com. Invitation acceptance in that second account remains unverified.

Before broad promotion: complete real signup/confirmation, sign-in and password reset in the recipient account; accept and revoke the QA coach invitation in a second account; verify push delivery on target phones including installed iPhone Safari; verify real-device photo/video upload and playback. These integration checks remain distinct from automated coverage. OpenAI analysis stays disabled pending approved Zero Data Retention and is not a core launch requirement. Chrome inspection was interrupted by browser connection failures during this follow-up; production browser rechecks remain outstanding until connection recovery.
