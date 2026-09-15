# FIT:MATCH parity execution plan

Updated: 2026-09-13

## Priority and scope

User direction: match FIT:MATCH and substantiate the corresponding claims FIRST. Parent coaching, marketplace, organization and camp expansion are secondary. Preserve those existing capabilities while developing the assessment product.

Primary target: QuadraScan / sports-science body intelligence and its presentation. Track the wider website's retail and healthcare verticals separately; completing this sports scope is not full company-wide parity. Match functionality and demonstrated outcomes, using Parent Playbook branding, rather than copying proprietary assets or presenting another company's evidence as ours.

Acquisition constraint: the core engine must be independently operable by an acquirer, or have documented transferable commercial rights that meet the buyer's requirements. FIT:MATCH integration is not the default solution. Database control, model rights, source ownership, and permission to reuse participant data are separate deliverables.

This plan takes precedence over earlier roadmap prioritization, including BODY-SCAN-EXPANSION-PLAN.md. That document contains historical vendor conclusions and marks some now-implemented video features as unbuilt; reverify its facts before use. It is not current evidence of licensing, accuracy or legal requirements.

## Reference baseline

Public pages reviewed September 9, 2026, and again on September 13, 2026, for rubric version 2. The claim-by-claim map and the rebaseline it caused are in `FITMATCH-CLAIM-MAP.md`.

- https://www.fitmatch.ai/sports-science — four-photo reconstruction; 25+ anthropometrics; DEXA-trained composition; maturation; asymmetry; developmental risk factors.
- https://www.fitmatch.ai/sdk — iOS 17+ and web SDKs; guided scan with secure upload and results via API; avatar as a USDZ or OBJ file; circumferences and anthropometrics; lean mass and bone mineral content; maturation analytics in higher tiers; no webhooks at present.
- https://graupel.github.io/web-sdk-documentation/ — hosted capture flow; results returned to the page through a completion callback; client-visible licence key checked against origin; WebView embedding for iOS, Android and Flutter.
- https://www.fitmatch.ai/ — marketing presentation; population-norm comparison and tracking over time; cross-industry scope.

These are vendor descriptions, not independently verified performance results. Their public timing language varies between approximately 3 seconds and under 10 seconds; measure capture, processing, and complete workflow separately. Public pages do not expose enough evidence to establish equivalent accuracy.

## Claim-to-build register

Status is from local source inspection, not production or device validation. No complete-parity item is certified yet.

| ID | Target | Current evidence | Required implementation and acceptance evidence |
| --- | --- | --- | --- |
| FM01 | Guided four-view phone capture | Optional live preview/static guide and full-frame shutter; camera-app fallback; per-photo review, final four-view enforcement, exact-file reuse rejection and measured processing-time provenance, tested locally | Real-device camera/framing trials, threshold calibration, edited-copy/exact-direction checks and complete-workflow timing. Pose checks still run after capture; the live overlay is a static guide. |
| FM02 | Subject-specific 3D digital twin, delivered as OBJ and USDZ files | Main app and SDK include experimental four-silhouette intersection with manual review. SDK 0.13.0 generated one accepted real-person clothed surface after a disclosed 14-voxel (0.29%) lower-artifact removal | Independent repeat scans and surface/reference comparisons; intended-device trials; experimental clothed surfaces do not establish anatomical twin accuracy; OBJ and USDZ avatar delivery through the company results contract (experimental OBJ and USDZ writers exist only in the silhouette lab, outside the SDK) |
| FM03 | 25+ anthropometrics and ratios | pose-measure.js: 25 versioned length and landmark-distance estimates with height scaling, including 18 bilateral proxies; one adult set returned all 25 | Establish comparable definitions and physical reference/repeatability evidence per metric; these are not FITMATCH's proprietary dictionary; the three descriptive proportions (wingspan, leg length and shoulder width over height) need the same definition and reference work |
| FM04 | Circumferences | SDK 0.13.0 derives three four-view pose plane guides. One authorized adult replay produced shoulder, torso-midpoint and hip clothed-surface perimeters. At the three-contour hip plane, it measured only the unique contour containing the reconstruction axis. A scalar-only three-plane repeat comparison is implemented but has no second real capture. Marker, contour-selection and geometry provenance are retained without landmarks | Establish actual anatomical chest/waist/hip definitions; record matched tape references; run the independent repeat capture; quantify per-metric error on intended devices and populations |
| FM05 | Body composition | No active composition engine | Reference-trained model or suitable licensed engine; distinct outputs/units; held-out evaluation for intended populations; DEXA-trained and DEXA-validated require different evidence |
| FM06 | PHV and maturity offset | `maturity.js`: Mirwald 2002 combined-sample maturity-offset workflow from one versioned manual height/sitting-height/body-mass session; parent and authorized individual organization views; ±1-year minimum uncertainty | Real intended-device input rehearsal, independent reference review and buyer acceptance; never infer this from photos or use it for ranking/training prescription |
| FM07 | Predicted adult height | maturity.js: Tanner mid-parental range | Traceable method/version and uncertainty; evaluate prediction quality; existing formula does not establish equivalence to competitor |
| FM08 | Asymmetry and structural comparison | Four provisional left/right segment pairs with same-assessment absolute differences; movement symmetry remains separate | Validate anatomical accuracy, orientation and repeatability; injury prediction requires separate outcome evidence |
| FM09 | Longitudinal body tracking and repeat comparisons | Growth trends; CDC stature references; new Body Insights date snapshots and compatible-method comparisons | Live repeat-record rehearsal with a second real capture. Population benchmarking moved to FM14 on 2026-09-13; do not substitute stature percentiles for whole-body norms |
| FM10 | Body-insights portal | New unified Body Insights, measurement groups, history, assessment details and report/CSV/JSON exports implemented locally | Generated avatar when available, production rehearsal, expanded measurement types and enterprise portal integration |
| FM11 | Integration and independently accessible results | Provider interface, typed scan rows, versioned provenance, stable retry IDs and exports; standalone browser SDK, portable source/demo package with checksums, separate-directory rehearsal and complete real four-photo SDK results. The pp-v75 production demo returned 25/25 outputs from the authorized adult set in Windows Chrome, saved the scalar company record and produced a freshly authorized JSON download with zero forbidden capture/geometry keys. Supabase persistence and the connected organization athlete UI are deployed; a real signed-in organization session and the rollback-only authenticated-role lifecycle passed | Verify a buyer-host deployment, an RLS-enforced production deletion (the 2026-09-10 production rehearsal used the service role; `tests/company-deletion-live-rls.sql` is the rollback-only RLS version, not yet run live), intended phones and full environment restore; model runtime assets are external; a server-to-server results API is FM15 and iOS and mobile embedding is FM16 |
| FM12 | Data protection and operational assurances | Consent/revocation code, deployed tenant RLS and retention job, payload allowlisting, mutation audits, cross-account denial and rollback-only live lifecycle evidence | Verify backup deletion and restore; document operating evidence and buyer handover; do not copy competitor compliance badges; third-party attestations a buyer requires (for example a SOC 2 report or a signed BAA) must be obtained independently, never self-asserted |
| FM13 | Website/product presentation | Different parent-oriented marketing and navigation | Body-intelligence presentation using original assets and accurately labeled feature states; visual resemblance is separate from engine parity |
| FM14 | Population benchmarking (split from FM09, 2026-09-13) | CDC 2000 stature-for-age integrated; `reference-cohort.mjs` contract refuses metrics without established equivalence; `reference-cohorts.js` loads zero cohorts | A cohort whose protocol matches our outputs, per-metric equivalence evidence and intended-population review before any body-scan percentile is shown |
| FM15 | Authenticated results API (added 2026-09-13) | Organization API keys (hashed, scoped, expiring, rate-limited, revocable) and service_role-only list, get and delete database functions with paging, live-consent filtering and audit; 23 disposable-database cases and Node tests of the edge-function handler; shipped in the v34 package. Migration applied and function deployed to the live project on 2026-09-15; the entry point boots and refuses a request with no key and one with a well-formed unknown key, and no key has been issued | Issue a limited key, exercise list, get and delete, then revoke it; then a buyer-shaped host |
| FM16 | iOS and mobile embedding (added 2026-09-13) | `js/body-sdk-embed.mjs` page-side message bridge for WKWebView and Android WebView (allowlisted summary only; refuses geometry and capture keys), Node-tested with stand-in handlers; native-side guide in `BODY-SDK.md` with never-compiled Swift and Kotlin. No WebView or intended-phone run; no native iOS SDK | Load the SDK in a real WKWebView and Android WebView through the documented bridge and file chooser, then a native Swift package with automated tests, then an intended-iPhone trial |

## First milestone: prove the engine route

The critical path is FM02/FM03/FM04/FM05. A results dashboard alone cannot remove these gaps.

1. Define the target output dictionary: anatomical name, identifier, unit, acquisition method, prerequisites, population limits, and evidence required. Exact competitor output coverage remains to be confirmed from public documentation or an authorized demonstration.
2. Evaluate a small set of independently runnable reconstruction approaches and acquisition-compatible providers using primary technical documentation and licenses. Record model-weight, dataset, commercial, distribution, transfer and hosting restrictions; unknown rights remain unknown.
3. Select a technical spike that converts an authorized four-view capture into a subject-specific mesh and a small set of reference-checkable dimensions. Use authorized test data; never silently retain real children's assessment images for model development.
4. Run repeated captures against reference measurements. Report missing/rejected outputs as well as successful cases; agree numerical error thresholds before evaluating the final holdout set.
5. Produce an engine decision record: runnable proof, measured errors/latency, operating requirements, rights/dependencies and remaining composition/maturation gaps.

Exit gate: an identified, executable engine path with inspectable outputs and documented operating rights. A mock response, vendor promise or generic model is not a pass. Composition may require a different model and reference dataset from surface reconstruction.

## Build sequence after the spike

1. Persist scan sessions and typed measurement results with engine/version/input/quality provenance; keep prior measurements readable.
2. Integrate the selected reconstruction path behind the existing provider boundary, extending its contract where needed. Define pending, failed, rejected and completed states for asynchronous inference.
3. Deliver the body-insights view with real generated geometry, measurement sections and repeat-scan comparison.
4. Expand validated anthropometrics, then maturation and composition as their methods/data become available. Run research for the latter while engineering the earlier capabilities.
5. Validate reference comparisons and supported devices; implement export/import and independent-environment restore.
6. Build the presentation against verified capabilities. Preserve explicit implemented/unvalidated/planned distinctions.
7. Resume parent-plan, marketplace and camp integrations after the core parity milestone; existing video tools remain differentiators, not substitutes for missing body-analysis outputs.

## First engineering contract

Target result envelope (broader design; current local scan-record.js implements a subset using existing measurement rows and versioned notes):

```text
assessment_id, athlete_id, captured_at
engine: { id, version, model_version }
method: photo | video | manual | imported
status: pending | completed | rejected | failed
inputs: measured height + units + source/date; other required inputs
metrics[]: { key, value, unit, method, quality, uncertainty? }
quality: { accepted_views, rejected_views, reasons, protocol_version }
assets[]: { type, format, private_reference, retention_until }
consent_reference, organization_reference?, reference_dataset_version?
```

Do not assume all metrics are inches. Do not label external processing on-device. Treat a quality score as a heuristic unless calibrated. Save against a captured athlete/session identity rather than mutable global scan state. Scope access and deletion to the assessment and its assets.

## Evidence required for presentation

- Feature demo linked to a reproducible code version.
- Reference evaluation with sample population, devices, protocol, failure rate and per-output errors.
- Clear separation of source-implemented, runtime-verified and scientifically validated.
- Dependency/license inventory and export/restore demonstration.
- Raw assessment captures are currently transient; ownership of software does not imply an existing retained training dataset.

## Open inputs (do not block initial research)

- Buyer presentation was moved to the week of September 14; the exact date remains to be confirmed. The plan still assumes a live app plus slides.
- Buyer's mandatory outputs and intended age groups.
- Independently hosted engine requirement versus acceptable transferable vendor licensing.
- Available development resources and access to authorized reference scans/measurements.

## Progress

User requested a total percentage with each completed increment. Current **engineering completion estimate: 40.75%** (41% rounded; 40.75 weighted points out of 100, under rubric version 2). The rubric was rebaselined on September 13, 2026, when three categories FITMATCH publicly claims were added; the same stages scored 42.75% under version 1. It then scored 39%; the results API has since moved FM15 to 0.5, and a tested WebView message bridge moved FM16 to 0.25. The dated history in `tools/parity-progress.json` records each increment since this paragraph was written at 37.75%; the evidence below describes that earlier stage. The ParentPlaybook Supabase schema is deployed and passed rollback-only scoped-consent, save/read/delete, cross-account denial and audit checks, advancing FM12 to deployed-infrastructure evidence. The organization athlete UI ran under a real signed-in account on the user's Windows Chrome. The pp-v75 SDK demo processed the authorized adult set, returned 25/25 outputs in 14.4 seconds, saved the scalar company record and produced a freshly authorized JSON download verified to contain zero forbidden capture/geometry keys. The pp-v85 company dashboard lists organization-owned adult reference history separately from the child roster and links to a deployed body-composition provider gate. That gate validates model rights, DEXA provenance, exact provider estimates and independent DEXA comparisons while producing zero values without a licensed model. This is integration readiness and does not advance FM05. Buyer-host deployment, a real composition provider, an RLS-enforced production deletion, intended-phone, native slide rehearsal and restore acceptance remain. This is a planning estimate, not accuracy, percent of code written or a claim of full feature equivalence. No category has completed all release/validation acceptance gates yet.

The fixed 100-point scope and evidence are in `tools/parity-progress.json`; run `node tools/parity-progress.cjs` to calculate the total. Reconstruction, expanded measurements, girths and composition carry 54 points collectively (58 with population benchmarking), so secondary work cannot dominate the percentage. The rubric awards 25% of a category's weight for partial implementation, 50% for a tested core local workflow, 75% for the live deployed/device milestone, and 100% only for agreed coverage plus supporting acceptance evidence. Category stages are explicit engineering judgments; missing features are recorded even when a core workflow exists. New scope requires a documented rebaseline rather than silently moving the denominator. The first rebaseline, on September 13, 2026, is recorded in `FITMATCH-CLAIM-MAP.md` and in the rubric's `rebaselines` list; `tests/deck-evidence.test.cjs` fails if a category weight differs from the latest recorded rebaseline.

Rescheduled buyer presentation: live app and slides. Implemented: the SDK 0.13.0 four-photo flow, one accepted real-person surface, three pose plane guides, three central-contour surface sections, 25 provisional length outputs, company record lifecycle, a tested Supabase persistence adapter, deployed ParentPlaybook schema and production organization UI connection, Body Insights, maturity context, exports, reports and movement video. Six editable presentation slides are being kept aligned with that verified state. See FRIDAY-DEMO-READINESS.md for rehearsal and limits. This progress does not close accuracy, repeatability, composition, buyer-host or intended-device gaps.

- [x] Record parity-first priority and acquisition constraint.
- [x] Recheck public sports-science/SDK targets and map against local code.
- [x] Identify reconstruction/composition as the critical gap rather than UI.
- [ ] Complete output dictionary and engine feasibility decision.
- [ ] Demonstrate reconstruction plus reference-measured dimensions.
- [x] Implement body-scan assessment identity/provenance and integrate results into Body Insights locally.
- [ ] Verify the complete capture/save/export flow against live Supabase and presentation devices.
- [ ] Validate and release supported claims.
# Organization assessment increment (September 9)

The parent application's organization roster now links to a read-only body-assessment dashboard (`js/org-insights.js`). It uses authorized roster membership, paginated measurement reads, one-assessment summaries, missing-data statuses, per-athlete results and a filtered CSV export with a fresh access read. This is local FM10/FM11 coverage, not a validated cohort model or athlete ranking.

Staging requires the new `20260909120000_allow_org_admin_membership_reads.sql` migration. It closes an existing gap in roster membership reads without granting edits or cross-team membership access. Rollback-only checks passed on isolated PostgreSQL; the live Supabase database has not been changed. Browser evidence uses synthetic records. Overall weighted completion remains 20% under the fixed acceptance rubric.
