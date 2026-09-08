# Team Connect — camps, school/org trainer data-sharing, and coach communication

**Date:** 2026-09-08
**Prompted by:** a request to make the trainer marketplace work for schools/organizations that
already have their own trainers — parents schedule with them *outside* the app, but the trainer
can still see relevant stats (age, height, recent measurements) to guide training, send updates
back through the app (workout recommendations, dietary needs, "what's next"), and the same channel
covers ordinary team-coach communication so parents aren't calling or texting a coach directly.

**The headline finding, before anything else:** this is not an extension of the trainer
marketplace. It's a different, genuinely simpler feature, because the trust relationship is
different. The marketplace's entire blocker (`MARKETPLACE_ENABLED = false`, see `js/core.js`) is
that Parent Playbook would be **introducing** a parent to a stranger and needs to vouch for them —
real background screening, FCRA-compliant adverse-action handling, insurance. This request is the
opposite shape: the parent already knows and chose this coach or trainer in the real world (their
kid's actual team, their kid's actual school). Parent Playbook isn't matching anyone — it's giving
an existing, already-trusted relationship a data-sharing and communication channel. That's much
closer to the co-parent invite flow already shipped than to the marketplace, and doesn't need to
wait on the same vendor/legal work.

Three genuinely separate pieces follow. Two are scoped and ready to build. One has real judgment
calls that need your answer first, not mine.

---

## Part A — Camps & programs directory (buildable now)

A browsable listing of external camps/programs — not a marketplace, not a booking flow. A parent
finds something, taps through to the organization's own signup. No payment touches Parent Playbook.

**Why this is lower-risk than the trainer marketplace, and why that still isn't zero:** a camp is
typically run by an organization with its own supervision structure, not a single adult alone with
a child the way a private trainer booking is — which is why this doesn't need the same
background-check apparatus. It still needs *some* bar, because "camp" doesn't guarantee that in
every case (a small operation could still be one person). Proposed minimum: every listing must
name a real organization and a verifiable contact (not just a phone number typed into a form), and
listings are reviewed before publishing — reusing the exact admin-review pattern `admin.js` already
runs for trainer applications, not a new system.

**Data model (new):**
```
camps
  id, org_name, contact_name, contact_email, sport_key, age_min, age_max,
  location_text, start_date, end_date, description, external_signup_url,
  status ('pending' | 'approved' | 'rejected'), created_by, reviewed_by, reviewed_at
```
**Screens:** a browse list (reuse `marketplace.js`'s card layout, swap "Book" for "Sign up →" as an
outbound link), and an admin review queue (extends `admin.js`, same three-check pattern already
used for trainers).

**Not included in this phase:** in-app registration, payment, or capacity tracking — those would
pull camps back toward marketplace-level complexity and aren't needed for a directory.

---

## Part B — Team Connect: scoped stat-sharing with an existing coach/trainer (buildable now)

The parent invites a coach or trainer they already work with — same mechanism as the co-parent
invite (`js/invites.js`, `athlete_invites` table), one new **role**, not a new system.

### The access model, concretely

`access_role` is currently a 3-value enum: `owner`, `co_parent`, `family_view` (confirmed against
the live database). This adds a fourth: **`coach`** — deliberately narrower than `family_view`,
not wider:

| | family_view | coach (new) |
|---|---|---|
| Games, milestones, journey photos | ✓ | ✕ |
| The week's training plan | ✓ | ✕ |
| Age, height, weight, sport/position | ✓ | ✓ |
| Growth & scan measurements (jump, sprint, reaction, footwork) | ✓ | ✓ |
| Can send updates via Team Connect | ✕ | ✓ |

The reasoning: a grandmother with `family_view` is family — seeing photos and milestones is the
point. A coach's legitimate need is narrower and specific — the stats that inform training — and
defaulting them into games/journey/photos would be sharing more of a child's life than the
relationship calls for. **Least privilege, not "reuse the closest existing role."**

**What this needs:**
1. Migration: add `'coach'` to the `access_role` enum (additive, reversible, no behavior change
   until the app routes it somewhere — same low-risk shape as every metric-key/enum addition made
   earlier this project).
2. RLS: coach-role rows read `measurements`, `athlete_sports`, and the athlete's core profile
   fields (name, birthdate, sport) — explicitly **not** `games`, `journey_entries`, or uploaded
   media tables.
3. App-side: `loadRole()` in `js/shell.js` already computes the best role a signed-in guardian has
   for the active athlete (`RANK={owner:3,co_parent:2,family_view:1}`) — `coach` slots in below
   `family_view` in that ranking and routes to its own restricted screen (a stats-only view,
   not a cut-down copy of the family-view app shell) rather than reusing `renderApp()`'s tab set.
4. Invite copy: extends `INVITE_ROLE` in `js/invites.js` with a `coach` entry stating the limits as
   plainly as the existing ✕ lines do — "No games, journey, or photos. Just training stats and the
   ability to send you updates."
5. Revocation: identical pattern to withdrawing scan consent or co-parent access — immediate,
   parent-controlled, already-proven UI (`confirmWithdrawScan`'s shape in `js/body-scan.js`).

This is genuinely the same size of effort as the original co-parent invite system, because it *is*
that system, minus scope.

---

## Part C — Coach updates & communication (scoped, needs your decision before building)

This is the piece that's actually new — Parent Playbook has no messaging system today.
`booking_messages` exists in the database but is scoped to a specific paid marketplace booking
(`booking_id` FK) — it doesn't fit a season-long coach relationship with no booking behind it, so
this needs its own table, not a reuse.

**Proposed data model:**
```
coach_updates
  id, athlete_id, sender_id, kind ('general' | 'workout' | 'nutrition' | 'announcement'),
  body, created_at
```
RLS: insert requires a live `coach` (or `owner`/`co_parent`) access row for that athlete; select is
every guardian with access to that athlete, plus the sender. One thread per athlete, not per
coach — if a family has both a cheer coach and a football trainer connected, each sees only their
own posts but a parent sees everything in one place, the same "one home for the record" principle
`journey.js` already uses for games and milestones.

**Three decisions that change the build, and I don't think I should guess at them:**

1. **Does "nutrition" content need its own disclaimer gate?** The app's Terms already carry a
   strong "not medical/nutritional advice" disclaimer for Parent Playbook's *own* content
   (`terms.html` §3). A coach's dietary recommendation for someone's 6-year-old is a different
   thing again — unvetted, individual, person-to-person advice flowing *through* the app rather
   than authored *by* it. My recommendation: yes, any `kind:'nutrition'` post shows an inline "this
   is your coach's personal recommendation, not medical advice — check with a pediatrician for any
   dietary change" notice every time, the same instinct as the app's existing stop-conditions
   copy — but this is your call on tone and whether it goes further (e.g., requiring the coach to
   acknowledge something before that category is even enabled).
2. **Is this ever coach-to-child, even indirectly?** My strong default: **no, never** — every
   message is coach-to-guardian(s), full stop, the same boundary the product already draws by
   giving children no accounts, no login, and no way to be contacted directly anywhere in the app.
   Worth you confirming explicitly since it's the one line I'd treat as non-negotiable rather than
   a preference.
3. **Does a household's second parent always see everything?** If a family has two guardians with
   `co_parent`/`owner` access, should a coach's message be visible to both automatically (my
   default — consistent with how every other record in this app already works, no private
   side-channel to one parent that excludes the other), or does a coach ever need to reach one
   parent privately? I'd default to "always both," but wanted to name it rather than assume.

**Also worth deciding, lower-stakes:** should general team-coach communication (practice moved,
game canceled) live in this same thread as one-to-one training updates, or does that deserve a
separate `kind:'announcement'` that's visually distinct so a parent can tell "read this now" apart
from "read when you get a chance"? Proposed above as one `kind` value — flag if you'd rather split
it into two features entirely.

---

## Part D — Organization accounts: shipped 2026-09-08

**Confirmed direction (2026-09-08):** an organization account is a real third tier above `coach` —
not a bigger coach, a different shape of access spanning two things: a roster view across *many*
athletes at once, and oversight of which coaches connect to which of those athletes. (The third
piece originally scoped — managing camps-directory listings as an org — was **not** built in this
pass; it's a Part A extension, not answered by the three questions below, and would meaningfully
grow the surface. Left as a future add, not silently dropped.)

**Answers to the three open questions (2026-09-08):**
1. **Parent invites the org** — a parent adds their own athlete to a roster by entering a code, the
   same shape as the existing coach-invite flow. Nobody lands on a roster without one; an org can
   never discover or browse athletes.
2. **Roster-wide table** — one screen shows every athlete on the roster and their latest stats at
   once, not the per-athlete coach screen reused N times.
3. **Connection only, not content** — an org admin sees *which* coaches are connected to which
   roster athletes, never a coach's sent updates.

**What actually got built, and why it's smaller than the original proposal:** mid-build, a pre-existing
`teams` / `team_memberships` schema turned up — already shipped, already used to prefill a team's
sport/schedule during onboarding via a `join_code` (`team_by_code` / `team_code_used` RPCs), but the
roster link itself (`team_memberships`) was never actually written to; onboarding only ever
pre-filled fields from it. That scaffold already has exactly the shape question 1 needed (a
parent-entered code, a roster join table), and `teams_ins` already let any guardian create their own
team (`created_by = auth.uid()`) — the DB-level capability existed, only the UI didn't. Building a
parallel `organizations` / `org_admins` / `org_athletes` schema on top of that would have duplicated
it. So: **`teams.created_by` is the org admin — no separate `organizations` table, no `org_admins`
table.** This mirrors how `coach` already works: a grant, not a distinct account type or signup path.
No multi-admin support in v1 (YAGNI — nothing in the three answers asked for it; a `team_admins`
table is a straightforward add later if a real org needs shared staff access).

### What shipped

- `private.can_org_view_athlete(ath)` — SECURITY DEFINER, mirrors `can_coach_view_athlete`'s shape:
  true if `can_edit_athlete`, or the athlete has a `team_memberships` row on a team where
  `teams.created_by = auth.uid()`.
- New SELECT policies using it on `athletes`, `athlete_sports`, `measurements` — same three tables
  `coach` reads, nothing more. Never `games`, journey, or photos.
- `aa_select_org` on `athlete_access`: visible to a roster's org admin only where `role='coach'` —
  the connection, never `coach_updates` (no org policy exists on that table at all, so RLS can't
  leak it even by mistake).
- `teams_read` tightened from `qual=true` (any authenticated user could read every team, including
  every `join_code`, directly) to creator-or-roster-member only. Verified this breaks nothing live:
  `team_by_code` / `team_code_used` are SECURITY DEFINER and already bypassed RLS.
- `team_by_code` now also returns the team's `id` (it didn't before — no way to write a
  `team_memberships` row without it).
- Unique index on `teams.join_code` (case-insensitive) — didn't exist before; `team_by_code`'s
  `limit 1` lookup would have silently resolved to the wrong team on a collision.
- Onboarding now actually inserts a `team_memberships` row when a team code was applied (previously
  it only pre-filled sport/schedule fields and never linked the child — see the removed comment in
  `js/onboarding.js`).
- `js/org.js` (new): join-with-code for any existing athlete (not just at onboarding), roster
  creation, the roster-wide table, and per-athlete stat + connected-coach detail. Reached from
  Account → "Team & organization" → "Join with a code" / "Your rosters" — visible to every guardian,
  not admin-gated, matching that team/roster creation was already ungated at the DB layer.
- `organizations.html` updated from "in design" to reflect that it's live.

Migration verified on a disposable Supabase branch before shipping (real fixtures, RLS checked by
impersonating both an org-admin uid and an unrelated uid) — caught and fixed one real bug in the
process: `aa_select_org`'s first draft queried `team_memberships` directly inside its own USING
clause, which put it back under `team_memberships`'s *own* RLS (`can_view_athlete` only), so an org
admin's check could never see the very membership row it needed. Fixed by routing through a second
SECURITY DEFINER helper, `private.is_team_admin_for_athlete()`, same fix already proven correct for
the other three policies.

### Not built in this pass

- Multi-admin per team/org (`team_admins` table) — add if a real org asks.
- Org-managed camps listings (the third original scope item) — Part A extension, separate work.
- A way for an org to remove an athlete from its own roster, or for a parent to leave one, from the
  UI (the DB allows both `athlete_access`-style, but no screen exists yet for either).

---

## Part E — League/roster system integrations: researched, groundwork laid, not built

**Prompted by** item 2 of the "10 ways to improve this long-term" list: reduce the actual onboarding
friction for an organization by importing rosters/schedules from the software a league already
runs on, instead of re-entering everything by hand into a Parent Playbook-specific roster (Part D).

**This is honestly blocked on two things, in order:** the Part D schema (there's no roster to sync
*into* until organizations exist as a real access tier), and a genuine partner relationship or OAuth
app registration with whichever platform gets targeted first — not something buildable from inside
this environment without live credentials, the same category of limit Stripe Connect for the trainer
marketplace already sits behind.

### What's actually true about each platform (researched, not assumed)

| Platform | API reality | Verdict |
|---|---|---|
| **SportsEngine** | Real, public GraphQL API with OAuth2. Existing SportsEngine customers get API credentials automatically with their account — no separate partnership needed with SportsEngine itself, just the org's own key. Full developer docs and a browser-based query explorer exist. | **The credible first target.** Self-serve for any org that's already a SportsEngine customer, which a meaningful share of youth leagues (hockey, baseball, soccer especially) already are. |
| **LeagueApps** | Has an API, but the public material reads as partner-program-gated (a "Rolls Out API to Our Partners" framing, and a structured integration-partner program built with Pandium) rather than open self-serve. | Plausible second target, but likely needs a real partnership conversation, not just an API key. |
| **TeamSnap** | No self-serve API developer path found. Their public "Partnerships and Integrations" page describes existing integrated partners, not an open developer program. | Not pursuable without a direct partnership conversation with TeamSnap — deprioritized until one exists. |

### Why nothing gets built against SportsEngine's API today, even though it's the credible option

Building and shipping an integration nobody can log into isn't real progress — it's an unverified
code path masquerading as a feature. Confirming it actually works needs a real SportsEngine
organization's credentials to test against, which means this specific piece genuinely waits on you
(register a developer app once a pilot org is identified) rather than being something to build ahead
of that.

### What's safe to do now, and has been

A small, verifiable schema addition — not a sync, not a parser, just a place for a future sync to
write to so it doesn't need a redesign later:

```sql
alter table athlete_sports add column external_source text;   -- e.g. 'sportsengine'
alter table athlete_sports add column external_ref   text;    -- the platform's own event/team id
create unique index athlete_sports_external_idx
  on athlete_sports(external_source, external_ref) where external_source is not null;
```

The unique index is what makes a future sync **idempotent** — re-running an import against the same
external event upserts instead of duplicating, which is the actual hard part of any roster sync to
get right, and cheap to guarantee now while nothing depends on it yet.

**Deliberately not built:** any CSV or text-paste import as a stand-in. Real league schedule exports
are inconsistent enough in practice that a parser built without real sample files to test against
would be a guess wearing a feature's clothes — worse than not offering one, the same reasoning that
already keeps this app from estimating body composition or fabricating a value it can't back up.

### Recommended next step

Nothing to build until Part D has a schema. When you're ready to pursue this for real: identify one
pilot organization already on SportsEngine, and the actual next action is registering a developer
app against their org — that's a founder step, not an engineering one, the same shape as the
marketplace's screening-vendor relationship.

---

## Recommended build order

1. **Part A (camps)** and **Part B (Team Connect access)** — done, shipped 2026-09-08.
2. **Part C (messaging)** — done, shipped 2026-09-08, per the confirmed answers to all three
   questions (nutrition disclaimer always shown, every guardian always sees every update,
   announcements share the thread with a visual tag).
3. **Part D (organizations)** — scoped above, landing pages live, schema/RLS work gated on answers
   to the three open questions.
4. **Part E (league/roster integrations)** — researched, schema groundwork laid (2026-09-08), gated
   on Part D shipping and a real SportsEngine pilot organization.
5. **Part F (moderation)** — done, shipped 2026-09-08. See below.

---

## Part F — Team Connect moderation: shipped

**Prompted by** item 4 of the "10 ways to improve this long-term" list: Team Connect is the one
place in this app where an adult who isn't a guardian communicates about a child, and the nutrition
disclaimer alone isn't a safety net for anything outside nutrition content.

Two independent layers, matching the two ways a concerning message could otherwise go unnoticed —
nobody happens to be looking, or somebody notices but the only recourse was revoking access
entirely rather than naming what was wrong:

**Automatic, server-side flagging.** A `BEFORE INSERT` trigger on `coach_updates`
(`private.flag_coach_update()`) checks the message body against two pattern sets: high-signal terms
with no innocent reading in this channel (self-harm/crisis language, requests for explicit images),
and phrase-combinations that are only concerning together, not as individual words (secrecy language
— "our secret," "don't tell your parents" — combined with isolation language — "meet me alone,"
"come alone"). Deliberately a trigger, not a client-side check: the same reasoning behind every RLS
policy in this project — a check the client could skip isn't a real check. Verified against real
inserts (not just the regex in isolation): an ordinary coaching message came back `auto_flagged:
false`, a scripted concerning one came back `true`, test rows removed after. False positives are
the accepted failure mode (an admin looks at an innocent message and dismisses it) — the pattern
list errs toward catching more, not fewer, and single ordinary words (secret, alone, drugs, between
us) never trigger on their own, only in the specific combined phrases that have no good-faith reading.

**A named report, separate from revoking access.** Every message a guardian can read carries a
"Report this message" action (`coach_update_reports`) — the coach who sent it cannot report or
dismiss their own message (enforced by RLS reading from `can_view_athlete()`, not
`can_coach_view_athlete()`). Reporting doesn't require also revoking the coach's access in the same
moment; a parent can flag something concerning while deciding separately whether to end the
relationship.

**One admin queue, two sources.** `openTeamConnectSafety()` (Account → Admin → "Team Connect
safety") shows both: messages the trigger flagged with no report yet, and reports a parent filed —
neither implies the other, so both need a place to land. Reviewing an auto-flag clears it
(`admin_reviewed`); a report can be marked reviewed or dismissed, both actions timestamped and
attributed to the reviewing admin.

**What this is not:** a substitute for human judgment, and not claimed to be. It's a coarse,
honest, tamper-proof first pass — the same "reject rather than guess, and say so" discipline the
scan engines use, applied to text instead of a measurement.
