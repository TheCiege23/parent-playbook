# Native apps — App Store and Google Play

Parent Playbook ships to the stores as a [Capacitor](https://capacitorjs.com) app: the same HTML/JS as
playbookbp.com, bundled into an iOS and an Android project. The website is unchanged. It still has no
build step, and `package.json` exists only for the app shells.

## How it fits together

| Piece | What it does |
|---|---|
| `capacitor.config.json` | Name, splash and push options. Its `appId` (`com.brownpig.parentplaybook`) is the Android package; the iOS bundle ID is `com.playbookbp.app`, set in the Xcode project |
| `codemagic.yaml` | Cloud iOS build: builds `www/`, signs, and uploads to TestFlight. See step 5 |
| `tools/native/build-www.mjs` | Builds `www/` (gitignored): the app's files plus npm-pinned copies of Supabase, three.js, the HEIC decoder and MediaPipe, with every CDN URL rewritten to the local copy. It fails if any CDN code is left. |
| `js/native.js` | Runs in both places. It does nothing on the website. In the app it handles links, push, downloads (share sheet), Stripe in a browser sheet, and incoming Universal Links / App Links. |
| `ios/`, `android/` | The native projects. Edit freely. `cap sync` only replaces `public/` and generated config inside them. |
| `native-assets/` | Icon and splash sources. `npm run native:assets` regenerates every size. |
| `.well-known/` | The `apple-app-site-association` and `assetlinks.json` files that prove playbookbp.com belongs to the app. Served by Caddy. |
| `app-return.html` | Where Stripe sends the app after Checkout or payout setup. Its button links back into the app via `parentplaybook://return`. |
| `supabase/functions/_shared/native-push.mjs` | Sends to APNs (iOS) and FCM (Android). It needs no schema change: app devices sit in `push_subscriptions` as `apns:<token>` / `fcm:<token>` endpoints. |
| `store/` | Listing copy, privacy-form answers, review notes, icon, screenshots and feature graphic. |

## One-time setup (in this order)

### 1. Apple Developer (Brown Pig LLC)

1. **Certificates, IDs & Profiles → Identifiers → +** → App ID `com.playbookbp.app` (registered 6 Oct 2026). Turn on
   **Push Notifications** and **Associated Domains**.
2. **Keys → +** → enable **Apple Push Notifications service (APNs)**. Download the `.p8` file (you only
   get one download) and note its **Key ID**.
3. Note your **Team ID** (top right of the developer site, 10 characters).
4. `.well-known/apple-app-site-association` already carries Team ID `U52ZD3QY7V` and `com.playbookbp.app`.
5. **App Store Connect → Apps → +** → New App: iOS, name "Parent Playbook", bundle ID above, SKU
   `parentplaybook-ios`.

### 2. Firebase (Android push)

1. console.firebase.google.com → **Add project** "Parent Playbook" (Analytics off; we don't use it).
2. **Add app → Android**, package `com.brownpig.parentplaybook`. Download `google-services.json` into
   `android/app/` and commit it. It's configuration, not a secret.
3. **Project settings → Service accounts → Generate new private key.** Keep the JSON. It goes into
   Supabase in step 4, and it **is** a secret: never commit it.

### 3. Google Play Console (Brown Pig LLC)

1. **Create app** → "Parent Playbook", App, Free.
2. Upload the first build (step 6) to **Internal testing**. Play App Signing turns on automatically.
3. **Setup → App signing** → copy the **SHA-256 certificate fingerprint** of the *app signing key*.
   In `.well-known/assetlinks.json`, replace `PLAY_APP_SIGNING_SHA256_FINGERPRINT` with it.
   To test a debug build's links too, add your upload key's fingerprint as a second entry.

Deploy the site (push to `main`) once both `.well-known` files have their real values. Then check:

```
curl -sI https://playbookbp.com/.well-known/apple-app-site-association   # 200, application/json, no redirect
curl -s  https://playbookbp.com/.well-known/assetlinks.json
```

### 4. Supabase

**Edge Function secrets** (Project → Edge Functions → Secrets):

| Secret | Value |
|---|---|
| `APNS_KEY_ID` | Key ID from step 1.2 |
| `APNS_TEAM_ID` | Team ID from step 1.3 |
| `APNS_PRIVATE_KEY` | Full contents of the `.p8` file |
| `APNS_BUNDLE_ID` | `com.playbookbp.app` |
| `APNS_ENV` | `production` (TestFlight and the App Store). Use `sandbox` only while testing an Xcode debug build. |
| `FCM_SERVICE_ACCOUNT` | The whole service-account JSON from step 2.3 |

Then redeploy the functions that changed: `notify-weekly`, `notify-daily`, `notify-gameday`,
`notify-measure`, `notify-booking`, `notify-trainer-review`, `stripe-checkout`, `stripe-subscribe`,
`stripe-connect`. There's **no database migration**.

**Auth → URL Configuration:** Site URL `https://playbookbp.com` (no trailing slash). Redirect URLs
must include `https://playbookbp.com/**`.

**Auth → Email Templates** (only *after* this branch is live on playbookbp.com): paste
`emails/confirm-email.html` into "Confirm signup" and `emails/reset-password.html` into "Reset
password". Their links now go straight to `playbookbp.com/?token_hash=…` instead of through Supabase's
redirect. A phone only opens the app for a link to playbookbp.com itself. The web app verifies the
token too, so the website keeps working with the new templates.

### 5. Codemagic (iOS builds without a Mac)

iOS builds need Xcode, so they run on Codemagic's Macs. `codemagic.yaml` is the whole build.
Android builds work anywhere with Android Studio.

1. **App Store Connect → Users and Access → Integrations → App Store Connect API → +**. Name it
   "Codemagic", access **App Manager**. Download the `.p8` (one download only) and note the
   **Issuer ID** and **Key ID**.
2. **codemagic.io** → sign up with GitHub → **Add application** → `TheCiege23/parent-playbook`,
   type **Capacitor**, and pick "codemagic.yaml" as the configuration.
3. **Team settings → Integrations → Developer Portal → Connect**: give the Issuer ID, Key ID and
   `.p8`, and save the key under the name **Parent Playbook ASC**. The name must match
   `integrations.app_store_connect` in `codemagic.yaml`.
4. **Code signing identities → iOS certificates → Generate certificate** (Apple Distribution).
   Codemagic then creates the App Store profile for `com.playbookbp.app` on each build. The App ID
   must have **Push Notifications** and **Associated Domains** turned on, because the entitlements
   ask for both.
5. **Start new build** → branch → workflow **iOS → TestFlight**. It takes about 15 minutes. The
   build then shows up in App Store Connect → TestFlight after Apple's processing (another 5–30
   minutes), and you pick it under **Build** on the version page.

## Building

```
npm ci
npm run native:sync        # builds www/ and copies it into ios/ and android/
npx cap open ios           # Xcode: Signing & Capabilities → Team = Brown Pig LLC → Product → Archive
npx cap open android       # Android Studio: Build → Generate Signed App Bundle (.aab)
```

Run `npm run native:sync` after **every** web change you want in the app. The app ships the files
it was built with, so a website deploy doesn't update it. Bump the version on each upload:
`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in Xcode, and `versionName` / `versionCode` in
`android/app/build.gradle`.

## Test on a real phone before submitting

- [ ] Fresh install opens straight into setup (no marketing page). "Log in" works for an existing account.
- [ ] Sign up → the confirmation email's button opens the **app** and signs you in (needs step 4's templates).
- [ ] Forgot password → the email opens the app on "Set a new password".
- [ ] An invite link (`playbookbp.com/?invite=…`) and a team link (`?team=…`) open the app.
- [ ] Account → Notifications → allow → a test from `notify-weekly?force=1` arrives. Tapping it opens the Week.
- [ ] Log out → no more reminders on that phone.
- [ ] Privacy / Terms links open in a browser sheet, and Done returns to the app.
- [ ] Export everything, the CSV/HTML report, a highlight reel and an `.ics` all open the share sheet.
- [ ] Body scan: the camera prompt shows the purpose string, the live preview works, and measuring completes.
- [ ] Jump / sprint / speed: recording a video works (iOS shows the microphone prompt once).
- [ ] Airplane mode after one normal launch: the week still shows.
- [ ] Notch and Dynamic Island: nothing sits under the status bar. Android: nothing under the system bars.

## Known limits

- **Bluetooth equipment** (heart-rate straps, treadmills) uses Web Bluetooth, which neither app
  WebView supports. The app already hides it where it's unavailable. A native Bluetooth plugin would
  bring it back.
- **Premium** is switched off (`PREMIUM_ENABLED` in `js/core.js`). Before turning it on in the iOS
  app, it has to be sold through Apple in-app purchase, or (US only) as a link out to the website.
  See `store/REVIEW-NOTES.md`.
- The pose model's weights (9.4 MB) still download from Google on the first scan, as they do on the
  web. That's data, not code. Bundle it later if offline first scans matter.
