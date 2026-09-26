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

Returning roster owners now reach Account from ordinary sign-in links. Starting a child profile clears coach routing markers while preserving team codes. A single roster retains the roster list and Start another roster action. Creation failures restore the submit button; schedule conflicts are rejected before saving. Partial roster query failures show Retry rather than incomplete data. Roster forms have associated labels, bounded desktop widths, and a copy-code action that explains the difference between schedule prefill and roster sharing.

Validation: JavaScript suite 1066 declared, 1065 passed, 1 skipped, 0 failed. Six additional regression cases cover routing, roster navigation, failed creation, schedule conflicts, and partial data failure. Authenticated Chrome walkthrough awaits approval to accept the sign-in screen's displayed terms. Email delivery cannot be tested with the reserved example.com QA address.
