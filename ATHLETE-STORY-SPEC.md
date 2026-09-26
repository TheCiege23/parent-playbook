# Athlete Story: Hall of Fame, highlights, résumé and coaching review

Status: first private Story view implemented locally for pp-v142; publication awaits approval. Existing production release: pp-v141. Audience and analysis preferences await the owner’s response.

Implemented foundation: Journey entry in both empty/populated states; Hall of Fame shows existing milestones; Story photos and individual video highlights reuse private Journey media; résumé shows sports/positions, achievements and seasons, with a text-only printable HTML download. Existing family permissions remain in force. No new coach grants, public sharing, categories, clip editing, rendered reels or AI analysis have shipped. Synthetic Chrome verification covered empty state, championship creation, display in the Hall of Fame/résumé and successful export. Full JavaScript suite: 1071 passed, 1 skipped, 0 failed.

## Problem

Parents can already save games, milestones and private media, but cannot curate those records into a championship shelf, highlight reel or athlete résumé. Coaches currently have stats-only access, so adding their contributions requires a new, parent-controlled permission rather than opening the entire family diary.

## Goals

- A parent can save a titled highlight, attach it to a game, and feature it in the athlete’s story.
- Championships, awards and personal achievements have a visible Hall of Fame.
- An athlete résumé combines parent-selected achievements, seasons, positions, verified-source stats and highlights.
- An invited coach can contribute to the selected athlete without gaining general access to family photos, games or other children.
- A coaching review separates visible observations, parent-entered facts and measured results.

## Example: 60-yard touchdown

1. Parent uploads a short video and selects the athlete in it (jersey number, team color, and a marked frame).
2. Parent adds title “60-yard touchdown,” game/date, position and jersey number. The distance is labeled parent-entered until separately verified.
3. Parent selects the clip’s start and end, chooses a thumbnail and features it in Highlights.
4. A parent can attach a championship photo or award to Hall of Fame and choose which items appear in the résumé.
5. An authorized coach adds timestamped comments or submits another clip for parent approval.
6. Parent optionally requests video analysis. Draft observations cite timestamps; the coach reviews and corrects them before any recommendation is treated as reviewed.

## Scope and phases

### P0 — curated private story

- Add Story within Journey: Hall of Fame, Highlights, Seasons and Résumé.
- Achievement categories: championship, award, personal best, milestone. Store title, sport, season, date, team, description, attachments and attribution.
- Highlights store title, description, linked game, sport, position, athlete identification, clip boundaries, thumbnail and featured order. Original uploads stay private.
- A reel initially plays selected clips in sequence. A downloadable edited video requires a separate transcoding/rendering job; do not label a playlist as a rendered reel.
- Résumé preview and printable PDF use parent-selected fields. Full birthdate, private family notes, medical/maturity data and contact details are excluded by default. Parent supplies any contact information intentionally.
- Reliable upload states: progress, cancellation, retry and storage failure. No success message until both object storage and metadata succeed. Support phone-recorded formats with a clear conversion path for unsupported playback.
- Attribute contributions to their author. Preserve the original fact source instead of presenting a parent-entered total as verified.

Acceptance: a parent can add an achievement with a photo, save a game-linked video highlight, reorder highlights and preview a résumé. Refresh preserves changes. Revoked or unrelated users cannot read media or metadata; unauthorized writes fail server-side. Empty states, failed uploads and unsupported codecs remain usable.

### P1 — invited coach contributions and controlled sharing

- Separate Story access from the existing stats-only Team Connect grant. Existing coaches receive no automatic expansion.
- Parent grants view selected highlights, comment, or submit contributions. Contributions enter a draft queue; only family editors approve publication.
- Coach comments are visible to the family. No child login or direct child messaging is introduced.
- Recheck access on view, comment, upload, approval and export; revoked coaches lose new reads and writes. Explain that downloaded copies cannot be recalled and short-lived media URLs have a bounded expiry.
- If the owner chooses share links, implement a parent-selected snapshot with a revocable token, optional expiry and no search indexing by default. Expose selected résumé/story content only, with separate consent and preview before publication.

Acceptance: a coach submits a clip for one invited child; the parent approves it and attribution remains intact. Revocation blocks subsequent access. A résumé link cannot expose another child’s records or unselected family content.

### P2 — video coaching review

- Identify the athlete manually; do not rely on facial recognition.
- Preserve context: sport, position, play type, camera angle, clip duration and question (for example “review ball security and cuts”).
- Job states: awaiting consent, queued, processing, needs clearer footage, draft ready, failed, coach reviewed.
- Output: timestamped visible observations, strengths, questions for a coach, and suggested practice topics. Each observation includes its source frame/time, visibility limitations and review state.
- Distinguish “observed,” “parent entered,” “coach reviewed” and “measured under a defined protocol.” Do not describe model-generated confidence as calibrated accuracy.
- Sideline game footage does not automatically establish exact speed, yardage, acceleration, biomechanics or injury risk. Measurements require known distance, adequate frame timing, camera geometry and validation against a reference.
- Poor visibility, camera cuts or uncertain athlete identity must produce an abstention instead of invented advice. AI output does not automatically change training or overwrite recorded stats.
- Before external processing, disclose the named provider, data sent and retention; request a separate parent opt-in. Keep provider credentials server-side. Store only the output needed and document how deletion reaches derived records and provider files.

Acceptance: a coach can follow each observation to the cited moment and reject/edit it. A low-quality clip yields “not enough visible detail.” A failed job leaves the original highlight usable. No clip reaches a provider without the chosen consent.

## Existing implementation and engineering dependencies

- `js/journey.js` already loads games, milestones and media; `js/sheets.js` uploads to the private `athlete-media` bucket, currently limited to 100 MB per file.
- Current media attaches to games, not achievements. Add typed story/achievement/highlight metadata rather than encoding categories inside captions.
- Current coach RLS excludes Journey and family media. Add narrowly scoped contribution/access tables and corresponding storage authorization; preserve the present household boundary.
- Use deterministic clip ordering, author attribution and stable IDs. Add an asynchronous queue for thumbnails, conversion, rendered reels and analysis; those are not suitable for a single browser request.
- Keep generated/signed URLs out of permanently exported HTML or PDFs. Shared views resolve authorized assets at request time.
- Pricing, storage quotas, retention and maximum duration must be chosen before video processing goes live. No provider or paid plan is selected yet.

## Proposed data model

`story_achievements`: athlete, category, title, date, season, sport, description, author, approval status.

`story_highlights`: athlete, media reference, game/achievement reference, title, sport, athlete identification, start/end seconds, thumbnail, featured order, author, approval status.

`story_grants`: athlete, invited guardian, explicitly granted actions, granting family editor, revocation date.

`story_comments`: authorized highlight, author, timestamp, text, parent-visible moderation state.

`story_resume_selections`: athlete, parent-selected records/fields and display order.

`video_reviews`: authorized highlight, consent reference, provider/model/version, status, source metadata, timestamped output, reviewer and review history.

## Non-goals for the first release

- A public social feed, followers or rankings: audience choice is unresolved and these are separate products.
- Automatic recruiting/eligibility scores: the story records progress, not a selection decision.
- Clinical or injury diagnoses from highlights: game film is not a validated clinical measurement.
- Automatic publication of coach or AI contributions: the family controls the child’s story.

## Success metrics

Proposed pilot targets, to be evaluated with real usage rather than asserted as current performance: 90% of attempted supported short-clip uploads finish successfully; 80% of pilot parents complete a first highlight without help; median title-and-publish time under two minutes after upload; every unauthorized-access regression passes before release. Measure weekly highlight creation, résumé previews and parent approval rate over a 30-day pilot. Set cost/storage budgets after provider and clip-duration choices.

## Open decisions

- Owner: private invited access, revocable share links, or public pages? This blocks sharing implementation.
- Owner: game-film observations, measured drill analysis, or separate workflows for both?
- Engineering/owner: provider, budget, upload duration, rendering infrastructure and supported codecs.
- Product/owner: who can approve a coach contribution, and whether coach attribution requires separate verification.
- Launch review: update policies and consent wording to match the actual chosen sharing and processing behavior before enabling either.

## Technical reference

Google’s video-understanding API documents video descriptions and timestamped answers, with configurable frame sampling: https://ai.google.dev/gemini-api/docs/video-understanding. This establishes a candidate capability, not validated youth-sport coaching accuracy or a provider selection.
