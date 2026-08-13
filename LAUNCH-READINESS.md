# Parent Playbook — is it ready for parents?

**Date:** 2026-08-12 · **Scope:** production (`playbook.chimaura.com`) + live Supabase project
**This is a different question from `AUDIT.md`.** That one asked "is the code correct." This one asks "can a stranger who is not you put their child's data in it."

---

## Verdict

> **Updated 2026-08-12, later the same day: all four blockers are now closed.**
> Privacy policy and terms are written and live. A support address exists. A real signup completed end to end — inbox, not spam, confirmed in 25 seconds. Error monitoring is wired, scrubbed for a children's app, and replay is never even downloaded.
> **Remaining: not blockers, but do them.** `[STATE]` in the terms · a lawyer's read of both documents · leaked-password protection · account deletion · deploy and confirm the first Sentry event arrives.

*The original verdict follows.*

**Not yet — but the gap is small, and almost none of it is code.**

The application itself is in good shape. The security posture is genuinely strong, the training product works, and the riskiest surface (the trainer marketplace) is switched off. What's missing is the paperwork and plumbing that turns a working app into one a stranger can safely rely on: **you have no privacy policy, no terms, no way for a parent to contact you, and no idea whether your emails arrive.**

Four blockers. Two are an afternoon of writing, one is a config change, one is a 20-minute integration.

---

## 🔴 Blockers — fix before one parent who isn't you signs up

### 1. ~~No privacy policy and no terms of service exist~~ — **DRAFTED 2026-08-12**
`privacy.html` and `terms.html` now exist, served at `/privacy` and `/terms` (`cleanUrls` enabled in `vercel.json`), linked from the consent step where the promise is made and from Profile → Help & legal. Both precached by the service worker.

**Two things you must fill in before this counts as done:**
1. **`[STATE]`** in section 12 of the Terms — governing law. I don't know where you're incorporated or resident, and guessing would be worse than a placeholder.
2. **`support@chimaura.com`** must exist and be monitored. Both documents commit you to answering it, and it's already the VAPID contact in your push function.

**And have a lawyer read them.** They describe your actual data handling accurately and cover the safety disclaimers a youth-training app needs, but I am not a lawyer and this is a children's product — the review is worth the money.

*Original finding follows.*
`/privacy`, `/terms`, `/legal` all return **404**, and neither word appears anywhere in the app.

Meanwhile the COPPA consent checkbox a parent must tick reads:

> "I agree to the **Terms** and understand I can delete this profile and its data at any time."

You are asking parents to agree to a document that does not exist, as the legal basis for collecting data about their children. That is the single thing I would not launch without.

A children's app needs a privacy notice that states plainly: what you collect about the child (name, birthdate, height, weight, sport, position, photos), why, who can see it, that it is never sold or used for advertising, how a parent reviews or deletes it, and how they reach you to do that. Your data handling is already better than most apps' — the policy just has to describe what you already do.

### 2. ~~A parent who gets stuck has no way to reach you~~ — **ADDRESSED 2026-08-12**
Profile now carries a **Help & legal** card with an `Email support` button, plus links to both documents. Contingent on `support@chimaura.com` actually existing and being monitored — see #1.

*Original finding follows.*
No support email, no contact link, no help text anywhere in the app or the page. Grep returns zero `mailto:`, zero "contact", zero "support".

This is both a product problem and a compliance one: a privacy notice for a children's service has to give parents a way to exercise their rights, and that means a monitored address.

### 3. ~~Email delivery has never been tested with a real user~~ — **FIXED AND VERIFIED 2026-08-12**
Custom SMTP now runs through Resend on the verified sending subdomain `send.chimaura.com`. **A real signup completed end to end:** account created 15:07:23, confirmation sent the same second, confirmed **25 seconds later**, and the message landed in the **inbox — not spam** — correctly branded as `Parent Playbook <noreply@send.chimaura.com>`. DKIM and DMARC alignment held on the first send.

**Two real bugs were caught by running this test**, which is the argument for running it:

1. **SMTP host was set to the sending domain.** `send.chimaura.com` is a mail *identity* with DKIM/SPF but deliberately no A record, so Supabase had nothing to connect to: `dial tcp: lookup send.chimaura.com … no such host`. GoTrue rolls a signup back when the confirmation email fails, so the account was silently never created. Corrected to `smtp.resend.com`.
2. **The app reported that failure as success.** Supabase phrases it as *"Error sending confirmation email"* — which contains the word "confirm", so `friendlyAuthErr` matched its `/not confirmed|confirm/` branch **first** and told the parent to check their inbox and spam for a message that was never sent. It then offered a *Resend* button that returns `200` for an unknown address and does nothing. A 500 looked like success. Every parent would have hit it. The mail-failure branch is now checked first, states plainly that the account was not created, points at `support@chimaura.com`, and suppresses the useless Resend button — with signup and password-reset wording kept distinct.

*Original finding follows.*
`auth.users` contains **exactly one account — yours**, created 2026-07-31. No stranger has ever signed up.

Every critical path depends on email arriving: signup confirmation, password reset, and co-parent invites. If the project is still on Supabase's built-in SMTP, it is rate-limited to a handful of messages per hour and frequently lands in spam — and signups will fail silently, looking to you like nobody wanted the app.

Check whether custom SMTP is configured in the Supabase dashboard (Auth → Emails). If not, wire a real sender (Resend, Postmark, SES) and then **test a signup from an address you don't control**, on a phone, from a different network.

### 4. ~~Nothing tells you when the app breaks~~ — **DONE 2026-08-12**
Sentry is wired via the **Loader Script** (the recommended setup for an app with no build step), project `all-fantasy/parent-playbook`. `js/monitoring.js` defines `window.sentryOnLoad` and **must load before the loader** — that callback is the only place this app's privacy settings are applied, so the script order in `index.html` is load-bearing, not cosmetic.

**Replay is not merely disabled — it is never downloaded.** The loader's server-side options were set to Replay/Performance/Debug/Feedback **off**, so the loader pulls `bundle.min.js` (errors-only) rather than a replay build. Verified by fetching the loader and inspecting which bundle URL it references. That matters because the runtime config could be edited by mistake; the bundle simply doesn't contain the code.

**Configured deliberately narrowly, because this app holds data about children:**

| Setting | Why |
|---|---|
| **No session replay** (`replaysSessionSampleRate: 0`, integration removed) | Replay records the screen. That screen shows a child's name, birthdate and photographs. Non-negotiable. |
| **No PII** (`sendDefaultPii: false`, `delete event.user`) | Reports are never tagged with the parent's account or the child. |
| **Console breadcrumbs dropped** | This codebase has 75 `console.error` sites that log raw error objects containing database rows. |
| **UI breadcrumbs dropped** | A button or field can be labelled with the child's name. |
| **URLs trimmed to path** | Query strings carry ids and grant types. |
| **`httpBodies: []`** | Defaults to collecting **all four** of incoming/outgoing request and response bodies. The onboarding POST body *is* the child's name and birthdate. |
| **`stackFrameVariables: false`** | Defaults to **true** — captures local variables into stack frames. An error inside `finishOnboarding` would have carried the whole athlete object. |
| **Final scrub** | Anything still matching an email or bearer/apikey pattern is redacted before send. |
| No tracing, no profiling | Not needed for this, and it burns quota. |

**Verified against a real event.** `myUndefinedFunction()` was fired in production and the resulting issue inspected: no request body, no local variables, no cookies or headers, URL trimmed to the bare path, and **Users Impacted: 0** — Sentry normally attributes an event to a user by IP, so a zero there is `userInfo: false` doing its job. Live SDK config confirmed in the browser, including `hasReplayIntegration: false`.

**⚠️ One thing the client cannot control — action required.** The event still carried `user.geo: US, Paterson`. Sentry derives coarse, city-level location from the sender's IP **server-side, after the event leaves the browser**, so no client setting prevents it. Fix it in the dashboard:

> **Sentry → Project Settings (parent-playbook) → Security & Privacy → "Prevent Storing of IP Addresses"** → on.
> There is an organization-wide equivalent under Organization Settings → Security & Privacy if you want it to apply to every project.

The privacy policy has been updated to state that IP addresses are not stored — **so flip that toggle before deploying the policy**, or the document will be claiming something that isn't yet true.

**Every `dataCollection` sub-option defaults to ON.** Three were initially missed and later corrected: `httpBodies` and `stackFrameVariables` were left at their permissive defaults, and the query-param control was written as `queryParams` rather than the real key `urlQueryParams` — an unknown key is silently ignored, so that setting was doing nothing at all. Worth remembering as a general hazard: a typo in an SDK option name fails open, quietly.

Verified against realistic leak vectors — a console crumb containing `first_name:"Ezra"` and a birthdate is **dropped**; a `ui.click` on `button[aria-label="Ezra"]` is **dropped**; `…/athletes?select=*&id=eq.9f1c` becomes `…/athletes`; an ordinary `TypeError` passes through untouched.

**The privacy policy was updated in the same change** — it previously said "no third-party analytics," which adding Sentry would have made untrue. It now discloses Sentry as a processor and explains, in plain language, exactly what a report does and does not contain.

*Original finding follows.*
There are **75 `console.error` call sites** and not one reports anywhere. No Sentry, no `window.onerror`, no logging.

You are a solo developer with no QA. When a parent hits an error, the app shows a friendly message, the detail goes to a console nobody is reading, and the parent quietly leaves. You will not find out. A free Sentry project is about twenty minutes and turns silent churn into a stack trace.

---

## 🟠 Fix this week — not launch-blocking, but soon

### 5. Leaked-password protection is disabled
Supabase can reject passwords found in known breach corpora (HaveIBeenPwned). It's off. One toggle in Auth settings, and it meaningfully raises the floor on account security for an audience that reuses passwords.
→ https://supabase.com/docs/guides/auth/password-security

### 6. A parent can delete a child, but not their own account
`delete-athlete` properly removes an athlete and purges their storage. There's no equivalent for the guardian account itself — no "delete my account" anywhere. The consent text's promise ("I can delete this profile and its data at any time") is satisfied for the *child* profile, which is the COPPA-relevant one, but a parent who wants out entirely has to email you — and there's no address to email (see #2).

### 7. `trainer-verification-docs` bucket has no size or MIME limit
`athlete-media` is correctly restricted (100 MB, images and video only). The verification bucket accepts any file of any size. Low urgency — the marketplace is off and only applicants can write to their own folder — but tighten it before that flag flips.

---

## ✅ Verified strong — things you do *not* need to worry about

I checked these directly against the live database and the deployed files, not from memory:

| Area | Finding |
|---|---|
| **Row-level security** | Enabled on **all 40 tables**, every one carrying policies. No table is unprotected. |
| **Children's photos** | `athlete-media` is private, MIME-restricted, and scoped per athlete via `can_view_athlete` / `can_edit_athlete` — with a UUID regex guard that **fails closed** on a malformed path. |
| **Invite links** | Tokens are two concatenated UUIDs (**256 bits** — not guessable). `invite_preview` is `search_path`-pinned and discloses only a first name, inviter name, role and status. Expiry and revocation are handled. |
| **COPPA consent** | Captured in the same transaction as the athlete via `create_athlete_onboarding`, so a consent record can never be orphaned from the child it covers. |
| **Password reset** | Present, and correctly returns success whether or not the account exists — no account enumeration. |
| **Secrets** | Only the publishable key is client-side. Service-role work is confined to edge functions. |
| **Offline** | Service worker is network-first with a cache fallback and an `index.html` fallback for navigations. Deploys land immediately. |
| **Trainer screening** | Re-verified *after* this audit's hardening: a trainer still cannot self-certify, and an unscreened trainer still cannot be approved. |
| **Marketplace** | Off, and guarded at every entry point — not just hidden buttons. |

### Hardened during this audit
Supabase's security linter flagged that my own B1 guard triggers (`tv_guard`, `tp_guard`) had a **role-mutable `search_path`** — the classic way a security check gets bypassed, and these two are what stand between an unscreened adult and a listed trainer profile. Pinned to `''` and re-tested; both still block. The linter no longer reports them.

### The remaining linter warnings are intentional — don't "fix" them
Running the Supabase security advisor will still show three `SECURITY DEFINER` notices. All three are correct as designed:

- **`invite_preview`** and **`accept_invite`** are callable by `anon` **on purpose** — a co-parent clicks an invite link before they have an account. Both are `search_path`-pinned, both take a 256-bit token, and `invite_preview` returns only a first name, inviter name, role and status.
- **`create_athlete_onboarding`** needs `SECURITY DEFINER` to write family + athlete + sport + goals + consent in one transaction. That property is what guarantees a COPPA consent record can't be orphaned.

The only advisor item worth acting on is **leaked-password protection** (#5).

---

## Browser verification — 2026-08-12

Once Claude for Chrome was connected, I loaded production directly:

- **App loads clean.** Login screen renders correctly, PWA install banner appears, **zero console errors**.
- **`/privacy` and `/terms` render correctly in production**, and `/privacy.html` → `/privacy` redirects (308) as intended.
- **Found and fixed one gap by looking rather than reading:** the login screen says *"By continuing you agree that you are the parent or legal guardian…"* and linked to **nothing**. That's the first place a new parent agrees to anything, so both documents are now linked there — with an explicit link colour, since that text sits on a dark photo where default link blue is unreadable.

### What I still cannot do — and you must

**I cannot create an account or enter a password.** That's a hard limit on me, not a technical one, so the real signup test remains yours:

> Sign up as a brand-new parent, **on a phone**, using an email address you do not control. Confirm the email, complete onboarding for a test child, view the week, record a measurement, and invite a co-parent.

This is still the single most valuable thirty minutes available to you. Exactly one account has ever existed on this app and it is yours — the path a stranger takes has never been run. It is also the only way to prove blocker #3 (email delivery) is actually fixed.

---

## Order I'd do it in

1. ~~Write the privacy policy and terms~~ — **drafted.** Now: fill in `[STATE]`, create and monitor `support@chimaura.com`, get a lawyer to read both.
2. ~~Add a support email path~~ — **done in the app.** Now: make the mailbox real.
3. **Confirm custom SMTP**, then do the real-signup test below. *(Blocker.)*
4. **Add Sentry.** *(Blocker for a solo dev — otherwise you're flying blind.)*
5. Toggle leaked-password protection.
6. Add account deletion.
7. Constrain the verification-docs bucket before the marketplace ever goes back on.

None of 1–4 is a code problem, which is the good news: the app is ready before the business around it is.
