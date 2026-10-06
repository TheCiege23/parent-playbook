# App Review — age rating, review notes, demo account

## Demo account (both stores require one)

Create it on production before submitting. Apple and Google sign in and click around for real.

1. Sign up at https://playbookbp.com as `appreview@playbookbp.com` with a long random password.
   Confirm the email.
2. Add one child: first name `Sam`, age 9, Football, running back, two practice days and a Saturday game.
3. Mark two sessions done, log one game with a photo, and add one milestone. That way Week,
   Journey and Growth all have something on them.
4. Leave notifications **off**, so the reviewer sees the permission prompt when they turn it on.

Put the email and password in App Store Connect → App Review Information → Sign-in required, and in
Play Console → App content → App access → "All or some functionality is restricted".

## Notes for the reviewer (paste into both stores)

> Parent Playbook is for parents and guardians of young athletes. The parent creates the account and
> a private profile for their child. Children never sign in. The demo account already has one child
> profile with a week of sessions, a logged game and a milestone.
>
> Things to try:
> • Week: today's session is at the top. Tap "How to do it", then "Mark done".
> • Journey: logged games, milestones and photos.
> • Account → Notifications: turn on reminders (system permission prompt).
> • Scan tab: an optional on-device measurement. It asks for written consent before the
>   camera opens. Photos are processed on the phone and never uploaded.
> • Account → Export everything: opens the share sheet with a JSON copy of the account's data.
> • Account deletion: Account → Delete my account. It removes the account and all child data immediately.
>
> The app has no in-app purchases. Paid features and the trainer marketplace are switched off.
> Privacy policy: https://playbookbp.com/privacy

## Apple age rating questionnaire

Answer "None" to every content question: violence, sexual content, profanity, horror, drugs and
alcohol, gambling, contests, mature themes and medical treatment information. The
plans are training sessions, not medical advice.

The capability questions:

| Question | Answer | Why |
|---|---|---|
| Unrestricted web access | No | Links open specific pages (our legal pages, a drill's cited source, a camp's site) in a browser sheet. There's no address bar or browsing. |
| User-generated content | Yes | Coaches a parent has connected can post updates and contribute photos to a child's Story. Nothing shows until the parent approves it, it's visible only to that family, and parents can remove a coach at any time. |
| Messaging or chat | No | There's no free-form messaging between users while the marketplace is off. |
| Parental controls / Age assurance | No | The account holder **is** the parent, so there's no child mode to control. |
| Advertising | No | |

Expected result: **4+**, or **9+** if Apple weighs the moderated coach contributions. Either is
fine. Do **not** choose the Kids category: it's for apps children use themselves, and it brings
restrictions this app doesn't need.

## Google Play content rating (IARC)

Category: **Reference, News, or Educational** is closest; "Utility" is the alternative. Answer No
to violence, sexuality, language, controlled substances and gambling. For "Does the app allow users to
interact or exchange content?" answer **Yes**: connected coaches share updates with a family, and
parents approve them. Users can't share their location, and there are no digital purchases.
Expected rating: **Everyone** / PEGI 3.

## Things App Review commonly flags, and where this app stands

| Guideline | Risk | Status |
|---|---|---|
| 4.2 Minimum functionality ("just a website") | Medium | Native push through APNs, share sheet exports, camera measurement, Universal Links, offline week cache, and no marketing page inside the app. Mention push and the share sheet in the review notes. |
| 5.1.1(v) Account deletion in the app | — | Done: Profile → Delete my account. |
| 5.1.1 Purpose strings | — | Camera, photo library, save-to-photos and microphone strings name the feature and say what happens to the data. |
| 2.5.2 Downloading code | — | Supabase, three.js, the HEIC decoder and MediaPipe are bundled in the app. The only downloads are the pose model's weights (data) and Sentry's error reporter. |
| 3.1.1 In-app purchase | Later | No purchases at launch. Before switching Premium on in the iOS app, it has to be sold through Apple's in-app purchase (US apps may also link out to the website). Trainer sessions are real-world services, so Stripe is allowed for them. |
| 1.3 / 5.1.4 Kids | — | The app is for parents and stays out of the Kids category. The COPPA section in the privacy policy covers the data about children. |
