# Privacy forms — Apple App Privacy and Google Play Data safety

Answers for the two store questionnaires, taken from `privacy.html` (last updated 6 October 2026) and
from what the code actually sends. If either changes, update this file and the store forms on the same
day. A mismatch between the label and the policy is a common reason apps get rejected or pulled.

Ground rules that hold for both stores:

- **No tracking.** No ad identifiers, no third-party analytics SDKs, no data brokers, no cross-app tracking.
- **Nothing is sold or shared.** Supabase, Railway, Sentry, Apple/Google push and (if switched on)
  Stripe are service providers acting for us. Both stores say processors don't count as "sharing".
- **Body-scan photos are not collected.** They're measured on the phone and discarded, and never
  uploaded. Only the resulting lengths are saved. Jump, sprint and speed videos aren't uploaded either.
- **Encrypted in transit:** yes, HTTPS everywhere.
- **Deletion:** in the app (Profile → Delete my account; per child; per measurement) and at
  https://playbookbp.com/datadeletion.

---

## Apple — App Store Connect → App Privacy

**Do you or your third-party partners collect data from this app?** Yes.
**Is any of it used for tracking?** No, for every type.

| Apple data type | Collected? | Linked to the user? | Purpose | What it is |
|---|---|---|---|---|
| Contact Info → **Name** | Yes | Linked | App Functionality | The child's first name or nickname, and the parent's display name |
| Contact Info → **Email Address** | Yes | Linked | App Functionality | Account sign-in, confirmation, password reset, invites |
| Health & Fitness → **Health** | Yes | Linked | App Functionality | Height, weight and body lengths (manual or from the on-device scan), adult body-composition imports |
| Health & Fitness → **Fitness** | Yes | Linked | App Functionality | Completed sessions, workouts, steps/heart-rate readings a parent imports into Your training |
| User Content → **Photos or Videos** | Yes | Linked | App Functionality | Only photos/videos a parent chooses to upload to the journey |
| User Content → **Other User Content** | Yes | Linked | App Functionality | Games, stats, milestones, goals, notes, coach updates |
| Identifiers → **User ID** | Yes | Linked | App Functionality | The account ID that owns the records |
| Diagnostics → **Crash Data** | Yes | Not linked | App Functionality | Sentry error reports with no user, email, IP or request bodies |
| Usage Data → **Product Interaction** | Yes | Not linked | Analytics | Daily per-feature counts with nothing attached to them |
| Other Data → **Other Data Types** | Yes | Linked | App Functionality | The child's birthdate, sport, position, practice schedule |
| Location, Contacts, Browsing/Search History, Sensitive Info, Financial Info, Purchases, Audio | **No** | | | |

If the trainer marketplace or Premium is switched on later, add **Purchases → Purchase History**
(App Functionality, Linked). Card details stay with Stripe and are never collected by the app.

---

## Google Play — Play Console → App content → Data safety

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected by your app encrypted in transit?** Yes.
**Do you provide a way for users to request that their data is deleted?** Yes. In the app, and at https://playbookbp.com/datadeletion.
**Shared with third parties?** No, for every type (service providers are exempt).

| Category → type | Collected | Required or optional | Purposes |
|---|---|---|---|
| Personal info → **Name** | Yes | Required (the child's first name) | App functionality |
| Personal info → **Email address** | Yes | Required | App functionality, Account management |
| Personal info → **User IDs** | Yes | Required | App functionality, Account management |
| Personal info → **Other info** (child's birthdate, sport, schedule) | Yes | Required | App functionality |
| Health and fitness → **Health info** | Yes | Optional | App functionality |
| Health and fitness → **Fitness info** | Yes | Optional | App functionality |
| Photos and videos → **Photos**, **Videos** | Yes | Optional | App functionality |
| App activity → **Other user-generated content** | Yes | Optional | App functionality |
| App activity → **App interactions** | Yes | Required (anonymous daily counts) | Analytics |
| App info and performance → **Crash logs**, **Diagnostics** | Yes | Required | App functionality, Analytics |
| Location, Financial info, Messages, Contacts, Calendar*, Audio, Files and docs, Web browsing, Device IDs | No | | |

\* Calendar sync writes **to** the parent's Google Calendar when they press Sync. It doesn't read
calendar events, so nothing is collected under Calendar.

Mark each "Collected" type as **processed ephemerally: No** (it's stored), except Crash logs and
Diagnostics, which are not ephemeral either. Leave that box unchecked everywhere.

---

## Other Play Console declarations

- **Target audience and content:** 18 and over (see `LISTING.md`). This keeps the app out of the
  Families program, which is correct for a parent-facing tool. If Google asks why the app mentions
  children, the answer is that parents manage their child's training, and children never use it.
- **Health apps declaration:** select "Fitness / activity tracking" and "Health and wellness". The app
  is not a medical device and makes no diagnosis or treatment claims.
- **Ads:** No ads.
- **Data deletion URL:** https://playbookbp.com/datadeletion
- **Government app / Financial features / News:** No.
- **Foreground service, exact alarms, background location:** none are used.

## Other App Store Connect answers

- **Export compliance:** the app uses only standard HTTPS. `ITSAppUsesNonExemptEncryption = NO` is
  already set in `Info.plist`, so App Store Connect won't ask on each build.
- **Sign in with Apple:** not required. The app has email and password only, with no third-party
  social login.
- **Content rights:** the app doesn't show third-party content you need rights to. Drill sources are
  cited and linked.
