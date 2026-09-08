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

## Recommended build order

1. **Part A (camps)** and **Part B (Team Connect access)** — start now, both are scoped, both reuse
   proven patterns, neither has an open judgment call.
2. **Part C (messaging)** — as soon as the three questions above are answered. The schema doesn't
   change based on the answers; the UI copy and any disclaimer/gating logic does, so building the
   table now and the UI after your answer is safe either way.
