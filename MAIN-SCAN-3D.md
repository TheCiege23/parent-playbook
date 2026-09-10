# Main-app experimental 3D preview

Local implementation, September 9, 2026. Not deployed or accepted as FITMATCH parity.

The parent body-scan setup now offers **Also create an experimental 3D preview**, off by default. An active release under `2026-09-09.ondevice.v3` covers the optional processing and its temporary lifetime; older releases do not satisfy the updated policy check. The stored release detail identifies `reviewed-silhouette-preview-v1/session-only`. The per-scan choice is temporary and is not added to the saved assessment.

The normal four-photo quality and distinct-file checks run first. After length inference succeeds, the optional step processes those same normalized photos in a dedicated worker. Each view shows its actual photo, segmentation overlay, a photo/mask selector and an adjustable hip center. All four views require manual confirmation; changing a center clears that view's confirmation. Reconstruction runs only after another fresh consent check. A failed or skipped preview can continue to length results. Loss of the session or permission prevents the result from being shown.

`js/visual-hull.js` is the canonical orthographic intersection algorithm for both the main app and the reconstruction lab. `js/surface-worker.js` owns the MediaPipe segmentation model and reconstruction worker handler. The lab extends that handler with its reference/archive operations. Main preview resolution is 64; the lab's default is 96, so those outputs do not pass the existing same-resolution repeat comparison gate.

The result screen displays rotatable geometry beside the length estimates. It models the visible clothed surface with assumed recorded-height scaling. It does not compute anatomical girths, body composition or maturity from geometry. The quality score is not an accuracy score. There is no fallback stock avatar or fabricated surface.

Photos and mask pixels are released before the result appears. Closing/skipping terminates pending worker work; account/capture changes abort the review. Geometry exists only in the current result and is cleared on save, dismissal or account change. `buildScanRecord` continues to serialize only its existing allowlist of scalar measurements/provenance; no geometry, mask, photo or asset URL enters the account, history, organizational export or report. Model assets may download from the existing public hosts; photos remain local.

## Verification

- 145 JavaScript tests pass, including new main orchestration and silhouette UI lifecycle checks.
- An isolated browser rehearsal runs the real main setup, review and result screens with explicitly synthetic rectangles and length readings. It uses the actual reconstruction worker path for geometry and an in-memory save stub. Four reviews enabled generation; the result rendered; saving excluded all media/geometry. Skipping also reached length results.
- Rehearsal command: `node tests/main-surface-preview.cjs` (loopback port 8779). It is a developer test fixture, never loaded by the production app.
- No live Supabase save, physical phone run or accepted four-view human reconstruction was demonstrated in this increment. The user's corrected front capture and measured height remain necessary for the next real-person test. Overall parity remains **20%** under the fixed rubric.
