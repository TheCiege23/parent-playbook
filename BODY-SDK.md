# Parent Playbook browser SDK — local preview 0.13.0

This SDK runs the existing `ondevice-pose` 1.3.0 provider inside a dedicated browser worker. It produces up to 25 provisional length and landmark-distance estimates, scaled to a supplied measured height. The separate opt-in scanWithSurface method adds an experimental clothed-surface reconstruction after four manual silhouette reviews. It can guide horizontal surface sections with four-view pose-derived plane heights, but it does not label those sections as validated anatomical circumferences. It does not estimate composition or predict PHV. It is not API-compatible with FITMATCH's SDK, and equivalent accuracy has not been established.

## Run the integration demo

From the repository root, run `node tools/sdk-demo.cjs`, then open `http://127.0.0.1:8774/`. The loopback server serves only the demo and its 26 matched SDK files. It has no upload endpoint, authentication or database. The existing experimental reconstruction lab remains at port 8771.

Use permissioned adult reference photos for this preview. Each view can be reviewed independently, then a four-photo scan returns downloadable JSON. Cancel terminates the active worker. Clear releases the page's file references and result. A separate developer check downloads Google's public pose example and runs real photo review; it does not fill capture slots or count as a body measurement trial.

## Build and verify a portable handoff

Run `node tools/sdk-bundle.cjs` from the repository root. It creates `tools/sdk-releases/parent-playbook-sdk-0.13.0/` from an explicit allowlist: 26 SDK source assets, the standalone demo, verifier, package instructions and integration/dependency notes. It does not collect participant captures, saved geometry, measurements, database configuration or repository history. Generated releases are ignored by git. Existing destinations are never overwritten; pass a new destination path to build another snapshot.

The current buyer handoff snapshot is `tools/sdk-releases/parent-playbook-sdk-0.13.0-friday-final-v41.zip`: 216 verified payload files plus `manifest.json` and `signature.json`, 219 archive entries total (218 files and one empty directory entry), SHA-256 `FB7552B49CF97598C41978849E68459062F5DA55842E92B0B42D752F75E5FD35`, 640,419 bytes, payload digest `3736240cfd815a6fdc0652af49421ff07bb21ca0126ae252becba7a7d60e4487`. It carries a detached ed25519 signature over the manifest contents, made with key `0cc2d189c342212d23d250264f8ab71d`, whose public half is published in the repository as `SIGNING-KEY.pub.pem` and is deliberately NOT inside the archive — a key that arrived with the package it vouches for is not a trust anchor. Its payload digest differs from v40’s (`b591208ec549dff9e9fa44dc11a6829c72e98823c77704b51a1d3dc9839acf46`) because the package gained one migration and changed four files: `20260914120000_adult_training_foundation.sql` (a parent’s own training record, private to that guardian, writable only by allowlisted accounts while the feature is behind a flag); `tests/db/security-tests.cjs` gains 16 cases (two for deleting a single measurement, fourteen for that record), `tools/sdk-files.cjs` lists the migration, and `HANDOVER.md` and `tests/db/README.md` carry the new database counts. The contract count is unchanged at 330; the database cases rise from 369 to 385. v40 and earlier are stale. Evidence was taken from the extracted archive rather than the build directory, and the archive was built from a clean worktree of `main` at `88e8bdf`: `node tools/acceptance.cjs` reports **seven of seven checks passing** — manifest 216/216, exclusion scan clean, 330/330 contract tests, 385/385 database cases on a disposable cluster built from the package’s own 90 migrations (364 security plus a 21-case restore and deletion rehearsal), the signature verified against the repository copy of the public key, and the bundled host serving modules that match the manifest with off-allowlist paths refused. The signature establishes that the manifest is ours; `tools/sdk-verify.cjs` establishes that the files match it; a reader wants both. Neither establishes measurement accuracy, and the archive still contains no provider model, composition estimate or validation dataset. The results API, the deletion rehearsal and the restore drill in it have not been run against any live project, none of the five 2026-09-13 and 2026-09-14 migrations has been applied to the live project, and the WebView bridge has not run inside a real WebView. The checksum is published beside the archive and the bundler replaces this line inside the packaged copy, so no archive certifies itself.

### Checking that this package is ours

The checksum manifest answers one question: do the files match what the manifest says? It
cannot answer whether the manifest is ours, because anyone who modifies a file can
recompute its hash and rewrite the entry to agree.

A signed package carries `signature.json`, a detached ed25519 signature over the manifest
contents — the SDK version and every path/sha256 pair, in bundle order. Check it with:

```sh
node tools/sdk-verify.cjs                                    # do the files match the manifest?
node tools/sdk-sign.cjs --verify . --public-key <key.pem>    # is the manifest ours?
```

You need both. The first says the bytes are intact; the second says the list of bytes was
signed by the key holder.

**The public key is not in this package, on purpose.** Fetch it over HTTPS from:

```sh
curl -O https://playbookbp.com/SIGNING-KEY.pub.pem
```

A key that arrived inside the archive would prove nothing — whoever replaced the archive
could replace the key beside it — so the verification tool warns you when you point it at
one. Fetching it from the site is a route the archive cannot influence.

Its fingerprint is:

```
0cc2d189c342212d23d250264f8ab71d
```

Treat the copy of that fingerprint printed here with the same suspicion: it travelled
inside the archive. Compare it against the fingerprint published in the repository before
relying on it. If the two disagree, this package did not come from us.

An UNSIGNED package is not evidence of tampering — we have shipped unsigned builds. It
means origin is unverified, which is what `node tools/acceptance.cjs` reports as a SKIP
rather than a pass.
Inside the copied release folder, run `node tools/sdk-verify.cjs`, then `node tools/sdk-demo.cjs 8774`. A different port can be supplied if needed. No npm install or access to the original repository is required. A maintained Node.js runtime is required for these scripts; browser inference still requires the external runtime assets described below. The server binds only to loopback and remains a local demonstration host.

The same clearly labeled, in-memory integration demo is also published at `https://playbookbp.com/company-sdk-demo` for the Friday production-origin rehearsal. It has no ParentPlaybook account or database connection. Selected adult reference photos stay in browser memory; the page downloads its external model dependencies at runtime and clears selected inputs, previews and geometry on Clear or navigation.

`manifest.json` records SDK version, exact file paths, byte lengths and SHA-256 checksums. Verification rejects changed/missing files, unexpected content, symlinks and malformed/duplicate manifest entries. The manifest is unsigned; replacing both files and manifest can defeat integrity checks, so it does not establish trusted authorship or rights. Preserve a separately trusted manifest when verifying a transfer. External MediaPipe/model/HEIC assets are not included, and this package does not establish a fully offline or independently owned inference engine.

The portable release was tested from a separate directory, including every served SDK asset, restricted routes and deliberate file/manifest corruption. The full JavaScript suite has 239 passing tests at this handoff increment. The ParentPlaybook Supabase schema also passed a rollback-only live scoped-consent, save/read/delete, cross-account denial and audit test. A real signed-in organization session and a production Windows Chrome SDK run returned 25/25 outputs, completed the in-memory save and produced a parsed authorized JSON download with zero forbidden capture/geometry keys. This does not replace intended-phone, buyer-host, production-backed organization lifecycle or restore acceptance.

## Host in a company application

Copy these files together into a versioned directory on the application's **same origin**, preserving their names:

- `js/body-sdk.mjs`
- `js/body-sdk-report.mjs`
- `js/body-sdk-worker.js`
- `js/body-section-worker.js`
- `js/body-surface-report.mjs`
- `js/mesh-section.js`
- `js/surface-section.js`
- `js/body-sdk-surface.mjs`
- `js/surface-review.mjs`
- `js/surface-worker.js`
- `js/visual-hull.js`
- `js/body-outputs.js`
- `js/photo-identity.js`
- `js/photo-quality.js`
- `js/pose-measure.js`
- `js/heic-decode.js`
- `js/photo-import.mjs` (preview/capture UI helper)
- `js/photo-import-worker.js` (preview/capture UI worker)
- `js/body-sdk-embed.mjs` (message bridge, needed only inside a native app's WebView)

Serve over HTTPS (localhost is suitable for development), with JavaScript MIME types. Do not import this version from a separate CDN origin: its relative dedicated worker must be hosted on the page's origin. Publish all 34 SDK source files as a matched version. The repository Dockerfile includes `js/` and publishes the company demo at `/company-sdk-demo`. ParentPlaybook's organization integration and the standalone demonstration are deployed on `playbookbp.com`; the portable handoff remains separately runnable on loopback.

```js
import {createBodyScanner} from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';

const scanner = createBodyScanner({timeoutMs: 120000});
const controller = new AbortController();
// frontFile/rightFile/backFile/leftFile are File objects from your capture UI.
// Set this only after your application completes its permission flow.
const permissionAcknowledged = permissionFlowCompleted;
try {
  const result = await scanner.scan({
    frames: {front: frontFile, right: rightFile, back: backFile, left: leftFile},
    heightIn: measuredHeightInches,
    permissionAcknowledged,
    signal: controller.signal,
    onProgress: message => { statusElement.textContent = message; },
  });
  // Display result.measurements. Save only through your own authorized backend.
  renderMeasurements(result);
} finally {
  scanner.dispose(); // call this on unmount if keeping the scanner for multiple requests
}
// Wire controller.abort() to your cancel button while the request is active.
```

`scanner.reviewPhoto({frame, view, permissionAcknowledged, signal, onProgress})` returns `PP_BODY_SDK_REVIEW_V1`: protocol, requested view, accepted flag, reasons and warnings. View is one of `front`, `right`, `back`, `left`. Passing a review is a capture heuristic, not an accuracy or identity guarantee. Scan always repeats all photo checks; prior review is not required by the API.

Inputs are HEIC/HEIF, JPEG, PNG or WebP Blobs, positive size up to 25 MB each, decoded size up to 16 megapixels, and finite numeric height 30–90 inches. Four different file byte sequences are required; edited duplicates or wrongly oriented captures are not reliably detected. All frames are decoded locally; very large/compressed images may exceed a device's memory before the dimension check can complete.

SDK 0.4.0 accepts HEIC/HEIF originals and converts a single image to PNG inside its worker before pose processing. Format detection includes MIME, extension and container-brand checks. Duplicate-file checks run on the originals and the measurement provider checks normalized inputs again. A successful HEIC review includes `conversion` metadata; scan results can include per-view `imports` metadata. The decoder is downloaded only when needed; no photos are uploaded. See `HEIC-IMPORT.md` for the pinned dependency, license/source links, limits and browser evidence.

The demo displays each selected photo and dimensions so an incorrect/rotated/undecodable selection is visible before review. HEIC preview conversion requires the permission checkbox; checking it after selecting files starts their preview conversions. Object URLs and conversion workers are released on replacement, Clear, cancellation and navigation. A late preview load cannot overwrite a completed photo review.

`CAPTURE_QUALITY` errors can include `captureChecks`: up to four allowlisted `{view, accepted, reasons}` summaries. The SDK carries these through the worker boundary instead of discarding the per-view cause. Hosts can display exactly which views need attention while retaining passed-view feedback. These summaries contain reason codes, never images, landmarks or file digests. The demo gives specific framing and file-export advice for each failed view. Capture thresholds and measurement calculations have not been relaxed.

Each scanner allows one request at a time. Length/review requests create a fresh worker and release it on success, failure, cancellation or timeout. The combined workflow also uses conversion workers and one segmentation/reconstruction worker, with the scanner busy throughout human review. The model may be served from the browser's HTTP cache, but model initialization repeats. Processing is asynchronous to the page; no fixed runtime is promised. `dispose()` aborts current work and permanently closes that scanner. Recreate a scanner to start again.

Errors have `name`, `code` and `message`. Cancellation uses `name: 'AbortError'`, `code: 'ABORTED'`. Expected codes include `PERMISSION_REQUIRED`, `INVALID_PHOTO`, `INVALID_HEIGHT`, `INVALID_VIEW`, `DUPLICATE_PHOTOS`, `PHOTO_DIMENSIONS`, `CAPTURE_QUALITY`, `BUSY`, `TIMEOUT`, `DISPOSED`, `WORKER_FAILED`, `PROCESSING_FAILED`, `INCOMPLETE` and `IMPLAUSIBLE`. Display messages as text. Dispose on account changes or navigation so a result cannot be applied to a different athlete.

## Result contract and data handling

`PP_BODY_SDK_RESULT_V1` contains SDK version, creation time, engine ID/version/model, dictionary version, provisional status, recorded height, elapsed worker time, measurements, missing output keys, capture-check summaries and limitations. Each measurement includes key, numeric value, `in` unit, label and definition. Missing estimates remain missing. Processing time includes local prechecks and model initialization, excludes photo capture and host network/storage time, and is not a benchmark guarantee.

The scanner never calls a storage API, sends photos to a server or connects to Supabase. The separate company persistence adapter makes database requests only when the host creates it and invokes the record store. Standard scan results return no images, geometry, landmarks, file digests, family identifiers or raw inference objects. The explicitly requested combined result additionally returns sensitive surface geometry, described below. The caller still owns its original File objects and must clear its UI references when appropriate. Termination and releasing references are lifecycle cleanup, not a promise of forensic memory erasure.

The host must implement permission and guardian flows, authentication, athlete linkage, access controls, retention and deletion for anything it stores. The boolean permission flag is an integration guard, not a consent record or independent enforcement system. No acquisition or data-transfer permission is inferred from a successful scan. This package depends on separately distributed MediaPipe code and model assets; copying our adapter does not convey ownership of those assets.

## Optional experimental 3D integration (0.4.0)

`scanner.scanWithSurface(options)` first performs the full length scan and its normal four-photo checks. After success it uses the same silhouette-review module and geometry worker as the parent app. The host mounts the review inside its own page. All four outlines must be checked manually; adjusting a hip center clears its review. The algorithm intersects the visible clothed silhouettes at resolution 64 and assumes recorded-height scaling. It is not FITMATCH's API, trained body model or validated anatomical reconstruction.

Additional required options:

- `surfacePermissionAcknowledged: true`: host permission explicitly includes processing and returning sensitive geometry.
- `checkPermission: async () => boolean`: recheck the captured subject/account's current permission. Called before measurement, before each silhouette, before reconstruction and before returning the package. Capture the host's subject/account identity in this closure. Returning anything other than `true` stops the workflow; cancel on account changes.
- `mountReview: html => HTMLElement`: create and attach a fresh root, set its content to the SDK-provided HTML and return it. The SDK owns/removes this root for the duration of review. Do not reuse a container holding unrelated host content. Scope host CSS to the root and provide appropriate layout/accessibility around it.

The recorded height must be at least 80 cm (about 31.5 inches), and no more than 90 inches. Other photo constraints are unchanged. Photos normalize locally and are resized to a maximum dimension of 1600 for segmentation. HEIC may be converted again after length inference; no fixed processing time is promised. Human review has no overall timeout. Individual surface-worker operations time out after 90 seconds and permission callbacks after 30 seconds; the configured SDK timeout still applies to length inference. AbortSignal/dispose cancels the full active workflow, including a stalled permission lookup.

```js
import {
  createBodyScanner, renderSurfacePreview, releaseSurfaceResult
} from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';

const scanner = createBodyScanner();
const controller = new AbortController();
let output, disposePreview;
async function assess() {
  output = await scanner.scanWithSurface({
    frames: capturedFiles, heightIn: measuredHeightInches,
    permissionAcknowledged: photoPermissionRecorded,
    surfacePermissionAcknowledged: geometryPermissionRecorded,
    checkPermission: () => hostStillAuthorizesCapturedSubject(),
    signal: controller.signal,
    mountReview(html) {
      const root = document.createElement('div');
      root.innerHTML = html;
      reviewContainer.append(root);
      return root;
    },
    onProgress: text => { statusElement.textContent = text; },
  });
  renderMeasurements(output.assessment);
  if (output.surface) disposePreview = renderSurfacePreview(
    previewContainer, output.surface,
    {retentionNotice: 'This application keeps this preview only until you leave.'}
  );
}
function unmount() {
  controller.abort(); scanner.dispose();
  disposePreview?.(); releaseSurfaceResult(output);
  // Also clear the host's selected Files and object URLs.
}
```

The combined result is `PP_BODY_SDK_SURFACE_RESULT_V1`, containing `sdkVersion`, `assessment` (the unchanged measurement-result schema), `surfaceStatus` (`generated`, `skipped`, `rejected`, or `unavailable`), `surface`, `surfaceFailure` and limitations. A generated surface contains `mesh`, reconstruction-only `processingMs` and four reviewed-view model/delegate summaries. Mesh fields include zero-based triangular `faces`, XYZ `vertices` in meters, `heightM`, `resolution`, `stepM`, `occupiedVoxels`, the orthographic protocol and explicit experimental/unvalidated-scale markers. These timings are separate from the assessment's length-processing time and exclude human review. Photos, mask pixels and landmarks are absent.

Selecting **Continue with lengths only** returns a null surface and keeps the completed assessment. If no failure occurred it reports `skipped`; after a segmentation/reconstruction failure it reports `rejected` with a curated `surfaceFailure`. A surface initialization failure outside review can return `unavailable`. Cancellation or permission failure returns no combined package. Additional errors include `SURFACE_PERMISSION_REQUIRED`, `INVALID_SURFACE_HOST`, `PERMISSION_CHANGED` and `PERMISSION_CHECK_FAILED` (permission timeout). A rejected host callback also propagates; display its message as text.

The SDK releases processing resources and its photo references before returning. The host still owns its original files and returned geometry. No storage or upload happens automatically. If the host saves geometry, it must implement authorization, explicit retention, deletion and any permitted sharing; the existing Parent Playbook measurement-only database path is not a geometry storage integration. Do not serialize the whole combined package accidentally when only measurements are authorized. The demo previews geometry but exports only `output.assessment`.

`renderSurfacePreview` returns an idempotent disposer that clears the canvas and the supplied geometry. `releaseSurfaceResult(output)` clears geometry without requiring a viewer. Both mutate the supplied object; any host-owned copies must be cleaned up separately. `scanner.dispose()` cancels active work; it does not revoke or erase results already returned to a host.

The local combined API, worker cancellation and permission boundaries have automated tests. A synthetic browser fixture at `node tests/sdk-surface-preview.cjs` exercised the real SDK/demo through four reviews, shared reconstruction and preview; inference inputs and lengths were explicitly synthetic. Real-person accuracy, physical-device behavior, authenticated company storage and deployment remain unverified. The full JavaScript suite contains 153 passing tests at this increment.

## Experimental surface perimeter and tape comparison (0.4.0)

After generating a surface, call `scanner.measureSurfaceSection()` with the same scanner or another idle scanner. This runs a dedicated local section worker and shares the same geometry intersection core as the research lab. The scalar result is separate from both the length assessment and geometry; it does not add waist/chest/hip values to the 13-output dictionary.

```js
const result = await scanner.measureSurfaceSection({
  surface: combinedResult.surface,
  planeCm: measuredFloorToMarkCm,
  label: descriptionOfPhysicalTapeLocation,
  referenceCm: measuredTapePerimeterCm, // optional; omit for perimeter alone
  permissionAcknowledged: currentPhotoAndAssessmentPermission,
  surfacePermissionAcknowledged: currentGeometryPermission,
  signal: controller.signal,
});
// Scalar report and geometry are separate:
renderSectionNumbers(result.section);
drawContour(result.contourPoints);
disposePreview.setSectionPlane(result.section.planeCm); // optional visual level marker
```

`planeCm` must be above the floor and below the recorded stature. The location description is required (1–120 characters); there is no automatic anatomical landmark selection. Optional `referenceCm` must be finite, positive and at most 500 cm; an omitted reference remains null. The host must refresh its authorization before calling and abort on subject/account changes. This method uses the scanner's existing request timeout, busy lock, cancellation and disposal; it does not invoke the combined workflow's `checkPermission` callback automatically.

The result is `PP_BODY_SDK_SECTION_V1` with SDK version, worker processing time, scalar `section` and separate `contourPoints` in meters. Section fields include operator label, plane, surface perimeter, horizontal width/depth, optional signed/absolute/% difference from the entered tape reference, limitations and source metadata. The source has a `surface-json-sha256-v1` fingerprint over ordered protocol/height/resolution/vertices/faces JSON. It traces the exact supplied geometry; it is not a signature, identity check or accuracy proof. Reordering identical geometry can change the fingerprint.

Only one closed contour is accepted. Multiple contours, open/branching intersections, coplanar faces, invalid coordinates/indices and unsupported scale/protocol metadata are rejected with `SECTION_REJECTED`. Missing/oversized geometry can fail early with `INVALID_SURFACE`. No contours are summed and no largest-body-part guess is made. Size limits are 100,000 vertices and 150,000 triangles. Inputs are copied to the worker; the original surface remains available after a section completes or is canceled.

The company demo displays the selected contour from above and marks its height on the 3D preview. A separate `PP_SURFACE_SECTION_REPORT_V1` JSON download contains only the scalar section, location and source fingerprint—no contour coordinates or mesh. This remains derived sensitive information even without photos. Changing a field invalidates the previous report and marker; Clear cancels a request and prevents a late report from reappearing. The original measurement JSON is unchanged.

The full suite has 161 passing JavaScript tests. A real browser SDK/worker run on explicitly synthetic geometry reported a 222.25 cm perimeter for a 55.5625 × 55.5625 cm rectangular section, and a +12.25 cm difference from an entered 210 cm reference. A level outside the surface was rejected and the old report invalidated. This verifies geometry arithmetic and integration, not human circumference accuracy. Real tape comparisons, repeatability, physical-device checks and deployment remain outstanding.

## Multiple location reports (0.5.0)

Keep up to 12 operator-selected sections from one surface and export a combined scalar JSON report or a standalone printable HTML page. The company demo adds, removes and exports these locations without uploading or persisting them. Editing the current location preserves the collection; changing a source photo, recorded height or permission, starting a new scan, or clearing the page removes it.

```js
import {createSurfaceReport, surfaceReportHTML}
  from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';

// Each entry is a measureSurfaceSection() result.section, not the whole result.
const sections = [firstSection.section, secondSection.section];
const jsonReport = createSurfaceReport(sections);
const printableHTML = surfaceReportHTML(sections);
// Display/download only within the host's currently authorized subject context.
```

`createSurfaceReport()` returns `PP_SURFACE_LOCATION_REPORT_V1` with creation time, experimental status, curated source fingerprint, location/reference counts, scalar sections and fixed limitations. It rejects mixed source fingerprints/methods/scales, duplicate floor heights, invalid values and collections outside 1–12 entries with `INVALID_SURFACE_REPORT`. Remove an earlier location before replacing its reading. Tape differences are recomputed from the scalar perimeter and reference; unknown input fields are discarded. No photographs, geometry or contour coordinates are included.

`surfaceReportHTML()` accepts the same section array and validates it again. It returns script-free HTML with inline styles, escaped labels, one row per location, explicit missing references and source/scale context. It can be opened offline and printed with browser controls. These synchronous helpers do not check authorization or erase host copies; the host owns subject linkage, access and cleanup. Measurements and location descriptions remain sensitive derived information.

These are multiple locations on one scan, not independent accuracy trials. There is no aggregate accuracy score or pass/fail claim. The full JavaScript suite now has 166 passing tests. The browser fixture exercised two distinct locations through the actual SDK/section worker, retained the first during input edits, enabled both exports and removed a location. Automated checks verify export payloads, source/duplicate rejection, HTML escaping and collection invalidation. Inputs were explicitly synthetic; real-person accuracy and deployment remain outstanding.

## Rejected reconstruction and diagnostics (0.6.0)

Hosts must handle the new `rejected` status instead of treating every null mesh as an unattempted scan. `surfaceFailure` is null for generated/skipped results. A failed result includes bounded `stage`, `code`, fixed `message` and optional scalar `diagnostics`. Codes are `DISCONNECTED_SURFACE`, `SURFACE_RECONSTRUCTION_FAILED` or `SURFACE_SEGMENTATION_FAILED`. A successful retry clears an earlier failure. The original length assessment and its schema remain unchanged.

Disconnected intersections remain rejected. The connectivity diagnostic includes grid resolution, occupied-cell count, component count, largest-component fraction and up to eight largest components with cell counts and floor-height fractions. These locate a reconstruction defect; they are not anatomical measurements, confidence scores or accuracy evidence. No component is removed or joined to force a mesh to pass. Arbitrary error properties, photographs, masks and vertices are excluded from the failure summary.

When all reported fragments are near the bottom of the surface, the shared review points the operator to the feet/lower legs and suggests inspecting stance, outlines and hip-center alignment. The company demo retains the final outcome beside the length assessment and offers a separate `PP_SURFACE_ATTEMPT_V1` JSON export. That report contains the SDK version, assessment timestamp, outcome, failure summary and limitations. Changing inputs/permission or selecting Clear removes it. Photo cards also reflect successful full-scan capture checks instead of remaining marked unreviewed.

177 JavaScript tests pass. Tests cover scalar diagnostic arithmetic, bounded fragment summaries, actual worker forwarding, outcome retention after failure, successful retry, export separation, malformed diagnostic rejection and cleanup. A real adult set was examined at resolutions 48, 64, 96 and 128: detached regions persisted, so increased resolution alone did not resolve it. The resolution-64 defect was near the feet; its exact geometric cause is still under investigation. A real SDK browser replay verified the specific lower-body guidance, rejected outcome and preserved 13-output assessment. No accepted real-person mesh or accuracy claim has been added.

## Opposite-view alignment comparison (0.7.0)

The shared silhouette review now includes **Compare opposite views and foot alignment**. It overlays front/back and right/left silhouettes in the same hip-centered, normalized floor-to-head coordinate system used by the reconstruction. The opposite image's horizontal direction is reversed. First-view-only pixels appear green, opposite-only pixels pink, and overlap white; legends name the two views. Each pair also has an enlarged view of the bottom 20% of inferred height.

The comparisons update with hip-center edits. Invalid alignment inputs clear the affected comparison and prevent reconstruction; changing a view still requires its manual check again. The comparison never edits source photos, fills gaps, moves alignment automatically, or accepts geometry. Differences may reflect perspective, stance, alignment or segmentation. Overlap is not measurement accuracy, and the operator should not adjust alignment merely to maximize it.

Pixel buffers are temporary, omitted from SDK results, and released after painting. Comparison canvases are cleared with review completion/cancellation. No new stored data or external model dependency is introduced. The SDK result contract is unchanged from 0.6.0.

179 JavaScript tests pass, including asymmetric opposite-view reversal, response to alignment changes, input bounds, review invalidation and canvas cleanup. With the actual adult reference files, 16 one-view alignment perturbations of ±2/±4 pixels all remained disconnected at resolution 64; no adjustment was selected or persisted. Small hip-center shifts alone have not resolved this set's reconstruction.

The actual SDK review was inspected with the new comparison expanded. Both pairs and foot close-ups rendered; front/back showed substantial disagreement near one foot/lower leg, while the side pair overlapped more closely. This is visual diagnostic evidence only. Separating stance, projection and segmentation effects and evaluating a more pose-aware reconstruction method remain open work.

## Readable measurement results and printable reports (0.8.0)

The company demo now displays the five overall length estimates and four left/right segment pairs, with missing values explicit. Display units can switch between inches and centimeters. Same-assessment absolute differences are arithmetic comparisons of estimates, not clinical asymmetry or injury-risk scores. Source definitions, recorded stature, engine/model, processing-time scope and provisional limitations remain visible.

The SDK exports `summarizeMeasurementResult(assessment, {unit, surfaceStatus})` and `measurementReportHTML(assessment, {unit, surfaceStatus})`. Unit is `in` (default) or `cm`; surfaceStatus is `not_requested` (default), `generated`, `rejected`, `skipped` or `unavailable`. Pass the actual combined outcome when applicable. An unknown status, unsupported dictionary/schema, duplicate/unknown metric, invalid value/unit or absent required metadata throws `INVALID_ASSESSMENT_REPORT`.

The summary returns `PP_BODY_SDK_SUMMARY_V1` with curated scalar metadata, display values, missing keys and paired estimates. It recomputes missing outputs from the 13-key dictionary instead of trusting an input count. It excludes arbitrary fields, photos, landmarks and geometry. The HTML report is self-contained, script-free, escapes supplied definitions/metadata, includes a restrictive CSP and expands definitions for printing. Browser Print can save it as PDF. These helpers do not store, upload, authenticate or independently validate measurements; hosts control access and retention.

The demo report uses the currently selected units and actual surface outcome. Changing source inputs/permission or selecting Clear removes the dashboard and disables export. A standalone photo review does not create a measurement report. The original result JSON remains unchanged. 184 JavaScript tests pass, covering conversions, missing sides, invalid/duplicate data, escaping, report export and cleanup.

An actual four-photo adult run populated all 13 estimates in the dashboard. Desktop rendering, missing/unrequested-3D wording and live conversion to centimeters were inspected in the browser. This used the same reference images, not an independent repeat capture or numerical accuracy trial.

## Company record and authorization contract (0.9.0)

The SDK now exports `prepareCompanyAssessment()` and `createCompanyAssessmentStore()`. The first converts a valid `PP_BODY_SDK_RESULT_V1` into `PP_COMPANY_BODY_ASSESSMENT_V1`: a detached, allowlisted record containing company, subject, operator and consent references; timestamps; retention metadata; engine provenance; and the scalar measurement summary. It excludes photos, masks, landmarks, file fingerprints, contours and geometry. The caller must supply a stable `assessmentId`; using the same ID for a retry lets the host implement an idempotent upsert instead of creating duplicate assessments.

```js
import {createCompanyAssessmentStore} from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';

const records = createCompanyAssessmentStore({
  getSession: async () => ({
    authenticated: true,
    actorId: session.user.id,
    organizationId: session.organization.id,
    sessionId: session.tokenId,
  }),
  authorize: async scope => api.canAccessBodyAssessment(scope),
  put: async (record, scope) => api.upsertBodyAssessment(record, scope),
  get: async scope => api.getBodyAssessment(scope),
  remove: async scope => api.deleteBodyAssessment(scope),
});

await records.save(assessment, {
  assessmentId: crypto.randomUUID(),
  subjectId: athlete.id,
  consentReference: consent.id,
  surfaceStatus: combined.surfaceStatus,
  surfaceProcessing: {
    schema: 'PP_COMPANY_SURFACE_PROCESSING_V1',
    status: combined.surfaceStatus,
    adjustment: combined.surface?.mesh?.topologyAdjustment ?? null,
  },
});
```

`surfaceProcessing` is optional scalar provenance. When present, its status must match the measurement summary. A generated adjusted surface may record only the bounded protocol, original/removed voxel counts and fractions, prior component count and affected floor-height fractions; the SDK recalculates and validates the removal ratio and rejects values outside the reconstruction limits. Unknown fields are discarded. No vertices, faces, photos, masks, contours or landmarks enter the company record.

`save`, `reopen`, `exportRecord` and `delete` each require a current authenticated session and a fresh host authorization decision scoped to the exact organization, subject, assessment and action. The contract detects browser-session changes around callbacks and refuses to release a cross-organization or mismatched record. These checks protect the client flow; `put`, `get` and `remove` must independently enforce the same scope at the company's server or database boundary. A browser callback is not a substitute for row-level security or an authorized API.

The company demo includes a complete lifecycle rehearsal using an explicitly labeled simulated session and in-memory record map. Run a scan, save it, clear the source photos/result, reopen it, export the freshly authorized record, then delete it. Reloading erases the rehearsal records. This proves the portable client contract and demo wiring; it does not prove production company authentication, persistence, retention jobs or deletion from backups.

### Supabase company persistence adapter

`createSupabaseCompanyAssessmentAdapter()` connects the same store contract to an authenticated Supabase client. Configure one team as the organization scope and one rostered athlete as the subject. Production saves require UUID references for the team, athlete and biometric consent plus a non-null retention deadline.

```js
import {
  createCompanyAssessmentStore,
  createSupabaseCompanyAssessmentAdapter,
} from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';

const adapter = createSupabaseCompanyAssessmentAdapter(supabaseClient, {
  teamId: selectedTeam.id,
  athleteId: selectedAthlete.id,
});
const records = createCompanyAssessmentStore(adapter);

await records.save(assessment, {
  assessmentId: crypto.randomUUID(),
  subjectId: selectedAthlete.id,
  consentReference: activeBiometricConsent.id,
  retentionUntil: new Date(activeBiometricConsent.retention_until + 'T23:59:59Z').toISOString(),
  surfaceStatus: combined.surfaceStatus,
});
```

Apply the bundled `supabase/migrations/20260910001500_company_body_assessments.sql` before using the adapter in another Supabase project. The migration creates the typed company assessment table, team/roster row-level policies, active-consent enforcement, a scalar-payload allowlist, mutation audit entries and the scheduled retention sweep. The browser session check and database policies are separate gates. ParentPlaybook's live Supabase project has the schema and scoped consent-reference RPC applied. A rollback-only authenticated-role transaction verified scoped consent, save, read, cross-account denial, delete and audit events with zero retained fixtures. The production organization athlete UI now imports a current versioned parent assessment, displays company-copy status, exports and deletes through the adapter. Railway deployment `43126450-2747-4cf0-96de-64202d28815d` reached SUCCESS, and `node tools/deployment-smoke.cjs https://playbookbp.com/` passed 17/17 required-route and private-file checks against cache `pp-v81`. A real signed-in organization session ran in Windows Chrome. The production SDK demo also completed an authorized four-photo scan/save/export: Chrome created a parsed `PP_COMPANY_BODY_ASSESSMENT_V1` JSON file with 25/25 scalar outputs and zero forbidden photo, landmark, geometry, mesh, mask or contour keys. The remaining acceptance work is a production-backed deletion rehearsal, a buyer-host deployment, intended phones, backup deletion and restore.

### Separate adult-reference persistence adapter

`parseAdultReferenceExport()` revalidates a downloaded `PP_COMPANY_BODY_ASSESSMENT_V1` record, rejects unknown or capture/geometry fields and rebuilds the provisional SDK result from its scalar measurement summary. `createSupabaseCompanyReferenceAdapter()` stores that result under an organization-owned text subject reference. This path has no athlete foreign key and must not be used to imply that an adult result belongs to a child profile.

Apply `supabase/migrations/20260910033000_company_adult_reference_assessments.sql` for this path. It creates `company_reference_assessments`, enforces organization-admin row-level access and the scalar payload schema, records mutations with a null athlete reference, and schedules retention deletion. The signed-in example is `company-persistence-demo.html` with `tools/company-persistence-demo.mjs`. Parent Playbook's live project has this migration applied. One authorized adult-reference record is stored in the live project and remains inside its retention window. The organization, record identifiers, supplied height and output values are deliberately not reproduced in a package that leaves the project; what the evidence establishes is that the path works, not what the record holds. The main signed-in organization dashboard lists its metadata in a separate adult-reference history outside the child roster; opening and exporting the record recheck the administrator session and tenant boundary before showing scalar outputs or downloading JSON. It also exposes the repeat-assessment workflow and correctly waits for a second compatible record. The production flow passed with zero browser warnings or errors. A clean persistence-page reload can also reopen or export this saved record without re-importing the source JSON; saving a new result still requires local validation and adult attestation.

### Repeat-assessment comparison

`compareCompanyAssessmentRecords(first, second)` accepts two company records only after each has passed the host store's fresh read authorization. The records must belong to the same organization and adult reference, have different capture times and assessment IDs, and use the same SDK, engine, model and unit. It compares only scalar outputs found in both records and reports baseline, current, signed change and absolute change. It does not infer growth, accuracy, statistical significance or cause. `companyAssessmentComparisonCSV(comparison)` produces a spreadsheet-safe scalar export without photos, landmarks, contours or geometry.

```js
import {
  compareCompanyAssessmentRecords,
  companyAssessmentComparisonCSV,
} from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';

const baseline = await records.reopen({ assessmentId: priorId, subjectId });
const current = await records.reopen({ assessmentId: currentId, subjectId });
const comparison = compareCompanyAssessmentRecords(baseline, current);
const csv = companyAssessmentComparisonCSV(comparison);
```

The full JavaScript suite has 190 passing tests at this increment, including allowlisting, detachment, idempotent record identity, unauthenticated/denied/stale-session failures, cross-organization record rejection and the complete demo lifecycle.

## Twenty-five-output dictionary (0.10.0)

Provider 1.3.0 introduces `body-outputs-v2` and `front-joint-proxy-v2`. The dictionary has seven overall estimates and nine left/right pairs: the prior limb segments plus arm and leg joint paths, shoulder-to-hip, ankle-to-heel and heel-to-forefoot landmark distances. Hip-joint and ear-landmark widths are also included. Compound paths sum consecutive predicted joint distances; they are not renamed copies of their individual segments. All outputs remain height-scaled, rounded provisional pose estimates with explicit definitions and family-specific broad error gates.

The SDK validator, readable dashboard, printable report, company record and missing-output list use the same 25-key contract. The app consent version advances to `2026-09-09.ondevice.v4`, and engine-version comparison keeps these records separate from older scans. A complete synthetic worker run and the full 190-test suite pass.

The authorized adult reference set returned all 25 outputs in the live SDK at the supplied 74-inch height on September 9. All four capture checks passed; reported length processing was 1.2 seconds. The result then saved and reopened through the simulated company host contract with no photo or geometry fields. This is one real workflow observation using the same prior photo set, not a physical-reference or repeatability study. `BODY-MEASUREMENT-DICTIONARY.md` defines every output and its limits.

## Capture-consistency diagnostics (0.11.0)

Opposite-view review now reports normalized silhouette intersection-over-union for the whole body and separately for the bottom 20% of inferred stature. A lower-region reading below 50% provides a retake instruction to keep the phone position and zoom fixed while the subject rotates on one marked floor center. The diagnostic is computed in memory from the existing comparison pixels and is discarded with the review; it is not included in the saved company assessment.

The reading describes projection agreement between two silhouettes. It is not a pass/fail accuracy gate, physical measurement, identity check or proof that an accepted mesh is anatomically accurate. Manual outline and hip-center review remain required, and disconnected reconstruction remains rejected without deleting or joining fragments.

The unchanged authorized adult reference set produced 72% overall and 27% lower-region agreement for front/back, and 71% overall and 31% lower-region agreement for right/left. Both pairs displayed the retake instruction. This is one diagnostic replay of the same photos; it does not establish a population threshold or cause, and no surface was accepted from it.

## Bounded lower-artifact removal (0.12.0)

The reconstruction core still rejects every disconnected intersection by default. The shared silhouette review now offers an explicit option to remove tiny detached sampling artifacts only when the main component contains at least 99.5% of occupied voxels, all fragments lie within the bottom 10% of reconstructed height, no more than four components exist, every removed component is retained for complete inspection and the total removal is at most 256 voxels. The option removes fragments; it never fills a gap or joins separated regions.

An adjusted mesh includes `topologyAdjustment` with protocol `surface-lower-artifact-removal-v1`, original and removed voxel counts, removed fraction, prior component count and affected height range. The preview states those values, and the separate `PP_SURFACE_ATTEMPT_V1` export includes the same scalar adjustment without photos, masks, landmarks or mesh. A host can leave the option off to preserve strict rejection.

The authorized 74-inch adult reference set produced 4,784 occupied voxels before cleanup: 4,770 in the main body and a detached 14-voxel lower-region artifact. With the explicit bounded option selected, 0.29% was removed and the browser displayed a connected rotatable surface while also returning all 25 provisional length estimates. This is the first accepted real-person surface workflow observation. It does not validate anatomical shape, circumference, repeatability or population performance.

The full JavaScript suite passes 201/201 checks, including strict default rejection, the cleanup bounds, disclosed adjustment metadata, preview wording, company outcome export and saved-record allowlisting.

## Four-view pose plane guides and surface sections (0.13.0)

Successful combined scans now return `surface.posePlanes` with protocol `four-view-pose-plane-markers-v1`. The SDK computes shoulder-midpoint and hip-midpoint heights in each pose result relative to that view's reviewed silhouette floor and head. It aggregates the middle two of four view fractions, derives a torso midpoint between those two levels, scales each plane with the supplied measured height, and records the maximum view-to-view spread in centimeters. Raw landmarks and per-view coordinates are not returned.

The company demo offers buttons for the three plane guides. Selecting one fills the section height and passes an allowlisted marker into `measureSurfaceSection()`. A successful report uses protocol `pose-plane-surface-section-v1` and records marker key, label, four-view input count, plane height and spread beside the existing geometry fingerprint. Manual section heights continue to use `operator-surface-section-v1` and require one closed contour. A pose-guided section may contain multiple closed contours only when exactly one contains the reconstruction axis. It records `unique-contour-containing-reconstruction-axis-v1`, the candidate count and the axis-containing count. Open intersections, no central contour and ambiguous nested central contours are rejected; the implementation never selects by contour size or sums body parts.

The authorized 74-inch adult replay returned shoulder, torso-midpoint and hip guide heights of 156.9, 128.1 and 98.8 cm above the inferred floor, with view spreads of 3.9, 2.3 and 1.7 cm. Pose-guided clothed-surface perimeters at those planes were 117.5, 164.5 and 123.3 cm. The shoulder and torso planes each had one candidate contour. The hip plane had three candidates, exactly one of which contained the reconstruction axis, so only that central contour was measured. These are implementation observations from one clothed subject and one capture set. They are not chest, waist or hip girths, and they have no independent tape accuracy or repeatability evidence. The reconstruction axis is a geometric reference in the hip-centered coordinate system, not anatomical segmentation.

The company demo can keep a scalar snapshot after all three pose sections are added, then compare it with the same three sections from a new four-photo scan. `body-surface-repeat.mjs` requires different geometry fingerprints and matching protocol, height and resolution. It reports changes in pose-plane height, perimeter, width and depth together. The snapshot and report exclude photos, landmarks, contour points, meshes and tape values. Two scans may share the same error, so the report makes no accuracy or pass claim.

The full JavaScript suite has 224 passing checks. New checks cover bounded four-view aggregation, landmark exclusion, marker/collection provenance, mismatch rejection, source-surface resolution, strict central-contour selection, scalar repeat snapshots, the Supabase persistence adapter, organization import conversion and demo wiring.

## Body-composition provider gate

SDK 0.13.0 exports a separate contract for a licensed or buyer-supplied body-composition model. The SDK does not contain that model and does not infer composition from its existing photo measurements. Until a provider is configured, `compositionUnavailableReason(null)` returns `MODEL_NOT_CONFIGURED` and the company UI displays no composition values.

```js
import {
  validateCompositionModelManifest,
  validateCompositionEstimate,
  evaluateCompositionValidationStudy,
} from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';

const manifest = validateCompositionModelManifest(providerManifest);
const estimate = validateCompositionEstimate(providerResponse, manifest);
const validation = evaluateCompositionValidationStudy(independentDxaRows, {manifest});
```

The manifest must declare an informational, non-diagnostic use; exact provider/model version; owned, licensed or buyer-supplied deployment rights; DEXA training provenance; an independent DEXA validation study; and a subset of five supported outputs: lean mass, fat mass, body-fat percentage, skeletal muscle mass and bone mineral content. Estimate validation binds the response to that exact model, accepts only finite scalar values in the declared units and requires an uncertainty interval or an explicit `not_provided` disclosure for every output. Capture data and geometry fields are rejected at every nesting depth.

`evaluateCompositionValidationStudy()` accepts coded independent observations paired with a DEXA reference within a bounded date window. It returns participant-aware descriptive bias, mean absolute error, root mean square error and maximum absolute error by metric. It drops participant and scan codes from the aggregate report. The report does not declare a pass threshold, clinical validity, DEXA equivalence, population generalizability or regulatory status.

## Organization-scoped composition storage

Composition results never share a record, table or payload allowlist with the provisional length assessments. `js/body-composition-record.mjs` defines a separate `PP_COMPANY_COMPOSITION_RESULT_V1` contract and an organization-scoped store; `js/body-composition-supabase.mjs` binds it to `public.company_composition_results`.

```js
import {createCompanyCompositionStore} from '/vendor/parent-playbook/0.13.0/body-composition-record.mjs';
import {createSupabaseCompanyCompositionAdapter} from '/vendor/parent-playbook/0.13.0/body-composition-supabase.mjs';

const store = createCompanyCompositionStore(createSupabaseCompanyCompositionAdapter(client, {
  teamId, subjectReference, subjectScope: 'adult_reference',
}));

await store.save(providerResponse, providerManifest, {resultId, subjectId, subjectScope, consentReference, retentionUntil});
const history = await store.history({subjectId, subjectScope});
```

A record accepts only sanitized `validateCompositionEstimate()` output plus a compact reference to the accepted manifest: scalar outputs, units, uncertainty disclosure, provider id, model id and version, organization, opaque subject reference, assessment reference, capture/estimate/save timestamps, an authorization reference, a bounded retention date and the non-diagnostic limitations. Photos, images, landmarks, masks, contours, meshes, geometry, vertices, raw validation observations, participant and scan codes and unknown nested fields are rejected at every depth, on write and again on read.

`save`, `reopen`, `exportRecord`, `delete` and `history` each re-read the session, ask the adapter to authorize the exact scope, then confirm the session did not change; reads authorize twice so one stale allow is never enough. Rows outside the caller's organization, subject or subject scope are refused rather than displayed, and a result past its retention date is dropped from history and refused on read. Retention is bounded to at most 400 days after capture, and `private.sweep_company_composition_retention()` deletes expired rows on a nightly schedule. Every mutation writes an `access_log` audit row naming the team, result, scope and exact model.

Provider eligibility is enforced in the database, not only by the browser validators. `public.company_composition_providers` records the provider, model, version, DXA validation study, rights status, declared outputs, expiry and revocation that an organization actually holds. Organization accounts get SELECT on their own rows and **no write grant or policy at all** — registering a provider is a platform operation, because a registry the tenant can write to enforces nothing.

A result carries a composite foreign key to that registration, and a BEFORE INSERT/UPDATE trigger proves it was still usable when the result was saved: not revoked, rights not expired, manifest study and rights status matching, and every output inside what the registration declared. The trigger runs for every writer including the service role. The payload allowlist additionally pins each metric label, unit and physiological bound, requires the uncertainty interval to bracket its own value, requires the payload provider block to equal the indexed columns, and pins both disclosure strings verbatim.

Adult-reference and child-athlete scopes stay distinct end to end. An `adult_reference` row always carries a null `athlete_id`, so an adult measurement can never be attached to a child profile; a `child_athlete` row must name a rostered athlete and repeat that id as its opaque subject reference, and its policies additionally require roster membership.

Step 4 of `/company-composition-demo` lists this history for a signed-in organization administrator. With no licensed model connected, no composition result can exist, and the room says **No stored composition results.** Nothing is seeded to populate that screen.

The deployed `/company-composition-demo` route provides the three-step manifest, estimate and validation-data workflow. Files remain in the browser tab. Its downloadable starter templates are deliberately incomplete and cannot validate as provider evidence. A buyer must still supply and independently review the model, rights, datasets, study design, subgroup performance and release thresholds before any body-composition claim is enabled.

## Embedding in a mobile WebView

The SDK can run inside a native iOS or Android app's WebView, and that is how Flutter and similar wrappers
embed it too. **What has been tested is the page side only.** `js/body-sdk-embed.mjs` is covered by
`tests/sdk-embed-bridge.test.cjs` with stand-in native handlers. No WebView has loaded the SDK, the Swift and
Kotlin below have never been compiled, and no intended phone has run a scan. There is no native iOS SDK.

**Serve it; don't bundle it into the app.** Load the SDK page from your HTTPS origin, never from `file://`.
The module worker has to be same-origin with the page, and the pose model downloads from
`https://cdn.jsdelivr.net` and `https://storage.googleapis.com` (see below), so the WebView needs network
access and a policy that allows those hosts. Length inference needs WebAssembly and a GPU delegate; a WebView
that lacks them fails rather than returning measurements.

**Photos come from `<input type="file">`.** The SDK takes files, not a live camera stream.

- iOS: WKWebView shows the system picker itself. If that picker can offer the camera, the app needs
  `NSCameraUsageDescription` in its Info.plist. HEIC originals from the camera are accepted.
- Android: a file input does nothing until the app implements `WebChromeClient.onShowFileChooser` and returns
  the chosen `Uri` values through its callback. Always answer the callback, with `null` on cancel, or the
  input stops responding. Offering the camera there also needs the `CAMERA` permission and a content URI for
  the captured photo.

**Results reach the app through the bridge, not a download.** A download link goes nowhere in a WebView. On
the page:

```js
import {createBodyScanner} from '/vendor/parent-playbook/0.13.0/body-sdk.mjs';
import {createEmbedBridge} from '/vendor/parent-playbook/0.13.0/body-sdk-embed.mjs';

const bridge = createEmbedBridge();          // throws EMBED_NO_NATIVE_BRIDGE outside the app
const scanner = createBodyScanner();
try {
  const result = await scanner.scan({frames, heightIn, permissionAcknowledged, onProgress: text => bridge.sendStatus(text)});
  bridge.sendResult(result);                 // the allowlisted summary only
} catch (error) {
  bridge.sendError(error);
} finally {
  scanner.dispose();
}
```

The bridge sends only four message types, as JSON text with schema `PP_BODY_SDK_EMBED_MESSAGE_V1`:

- `result`: the `PP_BODY_SDK_SUMMARY_V1` summary a company record stores, rebuilt from the result
- `review`: a photo review's codes
- `error`: an error's name, code and message
- `status`: a progress line

It refuses a result that carries 3D surface geometry. It checks every message again for photo, landmark,
mask, contour, mesh, geometry, vertex, face, digest, fingerprint, frame and blob keys, and caps its size (64 KB
by default). The native side still owns permission, authentication, storage, retention and deletion for
anything it keeps.

iOS (untested reference code):

```swift
import WebKit

final class ScanMessages: NSObject, WKScriptMessageHandler {
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    // Accept messages only from the origin that serves the SDK page.
    guard message.frameInfo.securityOrigin.host == "sdk.example.com",
          let text = message.body as? String else { return }
    // Decode PP_BODY_SDK_EMBED_MESSAGE_V1 from text and pass it to your own authorized backend.
  }
}

let configuration = WKWebViewConfiguration()
configuration.userContentController.add(ScanMessages(), name: "parentPlaybookSdk")
let webView = WKWebView(frame: .zero, configuration: configuration)
webView.load(URLRequest(url: URL(string: "https://sdk.example.com/scan")!))
```

Android (untested reference code), using androidx.webkit so that only the SDK's origin can post:

```kotlin
val origin = "https://sdk.example.com"
webView.settings.javaScriptEnabled = true
if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
  WebViewCompat.addWebMessageListener(webView, "parentPlaybookSdk", setOf(origin)) { _, message, _, _, _ ->
    // Decode PP_BODY_SDK_EMBED_MESSAGE_V1 from message.data and pass it to your own authorized backend.
  }
}
webView.webChromeClient = object : WebChromeClient() {
  override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
    pendingFileCallback = callback            // answer it from your picker's result, with null on cancel
    photoPicker.launch(params.createIntent())
    return true
  }
}
webView.loadUrl("$origin/scan")
```

Prefer the web message listener over `addJavascriptInterface`, which exposes the object to every page and
frame the WebView loads.

**Memory.** On-device inference is memory-hungry, and a WebView can lose its content process under pressure.
Handle `webViewWebContentProcessDidTerminate` on iOS and `onRenderProcessGone` on Android by reloading the page
and starting the scan again. Never resume a half-finished one. Dispose the scanner when the screen closes.

## Browser and network requirements

This preview uses module imports, classic dedicated workers, WebAssembly, WebCrypto, `createImageBitmap`, OffscreenCanvas and a GPU delegate. Length inference has no CPU fallback. The experimental segmentation worker tries GPU then CPU. Unsupported devices fail; they do not return fabricated measurements. Model dependencies are pinned to MediaPipe Tasks Vision 1.0.1 and Pose Landmarker full float16 v1.

For a restrictive CSP, allow same-origin scripts and workers, `script-src` from `https://cdn.jsdelivr.net` with `'wasm-unsafe-eval'`, and `connect-src` to `https://cdn.jsdelivr.net` and `https://storage.googleapis.com`. These external hosts receive normal model-download requests; photos remain in the worker. The local demo applies this policy. Test the host's full CSP, MIME types and service-worker caching before staging deployment. The SDK is not fully offline unless those external model assets are already available through appropriate caching.

## Verification and remaining acceptance

SDK tests cover permission/input rejection, payload filtering, progress exceptions, concurrency, abort/stale output, disposal, worker failure, timeouts/retry, result allowlisting, exact duplicate rejection before inference and oversized-image cleanup. A complete SDK worker scan invokes the real provider using synthetic landmarks, returning 25 outputs and releasing all eight precheck/inference bitmaps. The actual browser worker completed real inference on Google's public pose sample, and the demo's permission check and narrow layout were inspected.

A subsequent real adult four-JPEG run passed all four capture checks and returned all 25 provisional outputs using user-supplied height. Strict reconstruction identified a 14-voxel lower-region artifact; SDK 0.13.0's explicit bounded option removed it and returned a connected preview with the adjustment recorded. Four-view pose guides then produced three central-contour surface sections. The hip plane recorded three candidates and selected the only contour containing the reconstruction axis. The scalar repeat-comparison path is implemented and tested, but no second independent real capture has populated it. No physical-reference accuracy or repeatability has been established.

Still required: independent repeat captures and reference measurement comparisons, intended-phone trials, an RLS-enforced production deletion (`tests/company-deletion-live-rls.sql`, not yet run live; the service-role production rehearsal was done on 2026-09-10), buyer-host deployment, backup deletion and restore. The authenticated storage contract now has a tested Supabase adapter, a deployed ParentPlaybook schema, live rollback-only RLS evidence, a real signed-in production organization rehearsal and a production SDK scan/save/export. The project-wide parity estimate is maintained in `tools/parity-progress.json` in the source repository, which this package does not include; this SDK does not compute it.
