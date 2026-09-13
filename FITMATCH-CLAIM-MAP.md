# FITMATCH claim map and rubric version 2

Reviewed 2026-09-13. Rubric version 2 was adopted the same day.

This maps each capability FITMATCH describes on its public pages to the parity rubric in `tools/parity-progress.json`, and records the rebaseline that followed. Everything attributed to FITMATCH here is a vendor description, not independently verified performance. None of it is evidence about Parent Playbook, and nothing in this document claims Parent Playbook matches FITMATCH.

Sources, all fetched 2026-09-13:

- https://www.fitmatch.ai/ (home)
- https://www.fitmatch.ai/sports-science
- https://www.fitmatch.ai/sdk
- https://graupel.github.io/web-sdk-documentation/ (QuadraScan web SDK integration guide; no version or date shown)

## Why rebaseline

Version 1 of the rubric was written from the September 9 review, which summarized the SDK page as capture, result exports and enterprise integration. It did not separately score four things FITMATCH describes publicly: avatar files, a results API, iOS delivery and comparison with population norms. Leaving them unscored overstated how much of the claimed product exists. `FITMATCH-PARITY-PLAN.md` requires new scope to arrive through a documented rebaseline rather than by silently moving the denominator. This is that record.

## Claim by claim

Stages are the rubric's: 0 no applicable output, 0.25 partial, 0.5 core workflow with automated checks, 0.75 deployed and demonstrated on intended devices, 1 agreed coverage with acceptance evidence.

| FITMATCH describes | Where | Scored in | Stage | What Parent Playbook has |
| --- | --- | --- | --- | --- |
| Guided capture from four photos, in seconds | home, sports-science | FM01 | 0.5 | Guided four-view capture with per-photo checks, tested locally; no intended-phone trial |
| An iOS 17+ SDK beside the web SDK; WebView embedding for iOS, Android and Flutter | sdk, web-sdk guide | FM16 (new) | 0 | A browser SDK only (scored in FM11); no native iOS SDK and no documented or tested WebView integration |
| An AI-generated 3D avatar or digital twin | home, sports-science | FM02 | 0.5 | Four-silhouette reconstruction under automated checks against a synthetic subject; one accepted real clothed surface |
| The avatar delivered as a USDZ or OBJ file | sdk | FM02 (criterion added) | 0.5 | An experimental OBJ writer used by the silhouette lab; no USDZ, and no avatar file in company results |
| 25+ lengths, circumferences and ratios | home, sports-science | FM03, FM04 | 0.5, 0.25 | 25 provisional length estimates and three descriptive proportions; three experimental clothed-surface sections, not anatomical circumferences |
| Circumferences described as high confidence | sdk | FM04 | 0.25 | FITMATCH publishes no accuracy figure; ours are unvalidated |
| Lean mass and bone mineral content, DEXA-trained | sdk, sports-science | FM05 | 0 | A provider gate that shows no values until a licensed, DEXA-validated model is connected |
| Muscle mass, and composition described as DEXA-validated | home | FM05 | 0 | Muscle mass is not mirrored, because DXA lean mass is not skeletal muscle mass; DEXA-trained and DEXA-validated need different evidence |
| Peak height velocity, maturity offset, predicted adult height and developmental trajectory | home, sports-science; maturation in higher SDK tiers | FM06, FM07 | 0.5, 0.5 | Mirwald 2002 maturity offset from manual inputs; a mid-parental height range |
| Asymmetries and structural imbalances | sports-science | FM08 | 0.5 | Four provisional left/right pairs within one assessment |
| Developmental risk factors | sports-science | not scored | — | Deliberately not built: no risk prediction without outcome evidence, and estimates are never used for selection or ranking |
| Comparison with population norms | home | FM14 (new, split from FM09) | 0.25 | CDC 2000 stature-for-age; a cohort contract that refuses metrics without established equivalence; zero body-measurement cohorts loaded |
| Tracking body change over time | home | FM09 | 0.5 | Parent history and a repeat-assessment comparator; no second real capture |
| A body insights portal, a downloadable report and team scanning | home, sports-science | FM10 | 0.75 | Deployed parent and organization dashboards, report and exports |
| A guided scan with secure upload, and results delivered via API | sdk | FM15 (new) | 0.25 | Result tables under organization row-level security and signed-in adapters; no server-to-server results API |
| Results returned to the page through a completion callback, with a client-visible licence key checked against origin | web-sdk guide | FM11 | 0.75 | A browser SDK that returns results in the page, a portable package and exports |
| Encryption in transit and at rest, a SOC 2 report under NDA, HIPAA BAAs, GDPR, penetration testing, compliance monitoring, 2FA and images not stored | home, sdk, sports-science | FM12 (criteria added) | 0.75 | Row-level security, consent, retention, audit and deletion evidence; no third-party attestation is held or claimed |
| Tiered pricing, scan allowances, API integration at extra cost and lifecycle automation | sdk | not scored | — | Commercial terms, not capability |
| Retail, healthcare and wellness offerings | home | not scored | — | Outside the sports-science scope set in `FITMATCH-PARITY-PLAN.md` |
| Customer testimonials | sports-science | not scored | — | Not evidence; FM13 presentation must not borrow them |

Not claimed on these pages, so not scored: an accuracy or error figure for any output, a native Android SDK, GLB export and webhooks (the SDK page says it does not offer them at present).

## Rubric version 2

Weights at the rebaseline. Stages are those held on 2026-09-13; no stage changed.

| ID | Category | v1 weight | v2 weight | Stage | v1 points | v2 points |
| --- | --- | --- | --- | --- | --- | --- |
| FM01 | Guided four-view capture | 10 | 9 | 0.5 | 5 | 4.5 |
| FM02 | Personalized 3D body | 20 | 16 | 0.5 | 10 | 8 |
| FM03 | 25+ anthropometrics | 15 | 13 | 0.5 | 7.5 | 6.5 |
| FM04 | Circumferences | 10 | 10 | 0.25 | 2.5 | 2.5 |
| FM05 | Body composition | 15 | 15 | 0 | 0 | 0 |
| FM06 | PHV and maturity offset | 7 | 6 | 0.5 | 3.5 | 3 |
| FM07 | Predicted adult height | 3 | 3 | 0.5 | 1.5 | 1.5 |
| FM08 | Static asymmetry | 3 | 3 | 0.5 | 1.5 | 1.5 |
| FM09 | History and repeat comparisons | 5 | 3 | 0.5 | 2.5 | 1.5 |
| FM10 | Body-insights portal | 4 | 4 | 0.75 | 3 | 3 |
| FM11 | Integration and portable results | 4 | 3 | 0.75 | 3 | 2.25 |
| FM12 | Data protection and operation | 3 | 3 | 0.75 | 2.25 | 2.25 |
| FM13 | Product presentation | 1 | 1 | 0.5 | 0.5 | 0.5 |
| FM14 | Population benchmarking | — | 4 | 0.25 | — | 1 |
| FM15 | Authenticated results API | — | 4 | 0.25 | — | 1 |
| FM16 | iOS and mobile embedding | — | 3 | 0 | — | 0 |
| | **Total** | 100 | 100 | | 42.75 | 39 |

The weighted total moves from **42.75%** to **39%**.

The tables above record the rebaseline itself. Stages move after it through dated history entries in
`tools/parity-progress.json`, so the current total is whatever `node tools/parity-progress.cjs` reports.

### How the weights were set

1. No stage moved. The version 1 weights at today's stages still give 42.75, the last recorded total, so the fall to 39 is added scope, not undone work.
2. The 11 points for the new categories came only from categories at stage 0.5 or above: FM02 (4), FM03 (2), FM09 (2), FM01 (1), FM06 (1) and FM11 (1). They went only to categories at 0.25 or 0. Moving weight that way can only lower the total, so the rebaseline could not flatter the score.
3. Body composition (15) and circumferences (10) kept their weights. Lowering a weakly scored category would have raised the total.
4. FM09 gave the two points that benchmarking took with it. FM11 gave one point toward the results API and mobile embedding it had previously stood in for.
5. Measurement capability (FM02 to FM05, plus FM14) keeps 58 of 100 points, so integration and operations work still cannot dominate the percentage.

Weights are engineering judgments, like stages. Another weighting is defensible; this one is recorded so that any change to it is visible.

### What moves the new and changed criteria

| Criterion | Next stage needs | Kind of work |
| --- | --- | --- |
| FM14 population benchmarking | A cohort whose protocol matches our outputs, with equivalence established per metric, loaded through `validateReferenceCohort()` | External evidence first; the software contract exists |
| FM15 results API | Organization API credentials with rotation; versioned list, get and delete endpoints over the existing tables, with schema, pagination, idempotency, rate limits and audit, tested against the disposable database (0.5); then deployment on a buyer-shaped host (0.75) | Engineering |
| FM16 iOS and mobile embedding | A documented, tested WebView embedding of the browser SDK (0.25); a native Swift package with automated tests (0.5); a trial on an intended iPhone (0.75) | Engineering, then a device |
| FM02 avatar files | OBJ and USDZ delivered through the company results contract with private storage and retention. This closes a feature gap; the stage still waits on anatomical evidence | Engineering |
| FM12 attestations | Whatever a buyer requires, such as a SOC 2 report or a signed BAA, obtained from an independent party | External |

## How this is enforced

`tools/parity-progress.json` records `rubric_version` and a `rebaselines` list holding the version 1 and version 2 weights and the stages scored at the rebaseline. `tests/deck-evidence.test.cjs` recomputes both totals from those records. It also checks the version 1 total against the last score in the history, refuses a rebaseline that raised the score, fails if any category's weight differs from the latest recorded rebaseline, and checks this document's weight table against the record.

History entries before 2026-09-13 were scored under version 1 and are not comparable with version 2 totals.
