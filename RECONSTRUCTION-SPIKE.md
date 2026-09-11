# Reconstruction spike — first candidate

Date: September 9, 2026. Status: inference wrapper and calibrated geometry assessment pipeline implemented; model not installed or executed.

## Candidate

[SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) performs single-image human mesh recovery using [MHR](https://github.com/facebookresearch/MHR). This is a candidate initialization for a body reconstruction pipeline, not an implementation of four-view measurement fusion or composition estimation.

MHR's repository states Apache-2.0 licensing. SAM 3D Body uses a separate [SAM license](https://github.com/facebookresearch/sam-3d-body/blob/main/LICENSE), including a non-transferable grant and redistribution terms. Do not describe the combined stack as owned proprietary technology or assume acquisition transfer rights from the MHR license alone. Inventory all selected weights and dependencies before making buyer-facing rights claims.

The [installation guide](https://github.com/facebookresearch/sam-3d-body/blob/main/INSTALL.md) requires requesting access to its Hugging Face checkpoints and authenticating after approval. No access was requested or model agreement accepted in this iteration.

## Local runtime check

Windows hardware reports Intel Iris Xe Graphics and virtual display devices; no NVIDIA GPU was identified. WSL reports not installed. Recommend a suitable GPU environment for the first experiment; no GPU rental or installation has been authorized or performed. This does not establish that CPU execution is impossible, only that a ready accelerated environment is not present.

## Experiment

1. Obtain authorized model access and a suitable execution environment.
2. Start with an authorized adult/reference test capture, separate from production athlete records.
3. Run inference and export subject-specific mesh geometry, preserving engine/model version and input provenance.
4. Inspect front and side shape against the original capture; do not infer that a visually convincing mesh is a correct measurement.
5. Establish known-height scaling and reference landmarks; evaluate a few dimensions against measured references.
6. Compare repeated captures and four-view consistency. Single-image inference is not four-view fusion; design shared-shape fitting if baseline results justify it.
7. Only then connect a private, authenticated inference service to the app provider interface, with an accurate cloud-processing consent flow and retention behavior.

## Acceptance

Required outputs: executable inference, model/rights inventory, private mesh export, reference comparison table and rejection/latency observations. Accuracy thresholds must be set before the evaluation; no clinical or competitor-equivalence claim follows from a successful mesh render.

A [research evaluation](https://arxiv.org/abs/2601.06035) reports limitations reconstructing distinctive anthropometric features with this model. This makes measurement validation a deciding experiment, not a finishing task. That paper does not supply pediatric validation for our use case.

Body composition remains a separate missing output even if this spike succeeds. Maturity offset and estimated PHV age come only from the separate manual anthropometric workflow; never derive them or composition values from mesh appearance alone.

## Geometry preparation implemented

`tools/reconstruction/mesh-section.cjs` now reads triangulated OBJ meshes and extracts closed plane sections with explicit orientation and units. It exports contour coordinates and perimeters in meters. It refuses open/branching contours and coplanar faces, and keeps multiple contours separate. No external packages or model access needed.

Usage: `node tools/reconstruction/mesh-section.cjs path-to-authorized-mesh.obj y 0.9 m`

The coordinate 0.9 above is only an example plane location. This utility does not choose waist/chest landmarks, reconstruct a body, estimate tissue composition or certify measurement accuracy. It is an executable probe for future reconstruction outputs. Analytical geometry tests cover known perimeters, disconnected contours, malformed input and rejection cases.

## Inference runner implemented

`tools/reconstruction/run_sam3d.py` follows the upstream [`load_sam_3d_body`](https://github.com/facebookresearch/sam-3d-body/blob/main/sam_3d_body/build_models.py) and [`SAM3DBodyEstimator.process_one_image`](https://github.com/facebookresearch/sam-3d-body/blob/main/sam_3d_body/sam_3d_body_estimator.py) interfaces inspected September 9. It requires locally installed dependencies, authorized checkpoints with `model_config.yaml`, and CUDA. The inspected estimator sends its batch to CUDA unconditionally. This wrapper does not install dependencies, download weights, accept licenses, or send captures to a service.

After upstream installation in the GPU environment, run from this repository (replace the example input paths):

```text
python tools/reconstruction/run_sam3d.py --image /private/reference-front.jpg --checkpoint /private/weights/model.ckpt --mhr-model /private/weights/assets/mhr_model.pt --model-revision ACTUAL_CHECKPOINT_REVISION --single-person-crop --output-dir tools/reconstruction/runs/reference-001
```

Use a photo cropped to one full person or replace `--single-person-crop` with `--bbox X1 Y1 X2 Y2` in image pixels. No person detector, segmentation model or camera-calibration model is configured. Region validity does not establish a person was successfully reconstructed.

Expected outputs after successful inference: `mesh.obj` and `manifest.json`, recording SHA-256 input/model/config/mesh fingerprints, operator-supplied model revision, image dimensions, region selection and inference duration. Existing output directories are refused. The original image is not copied or deleted. Outputs remain sensitive body data; the suggested runs directory is excluded from Git and the production Docker image.

Geometry is explicitly labeled **uncalibrated model-native coordinates**. Do not feed it to `mesh-section.cjs` with an assumed physical unit. Establish scale, orientation, pose and anatomical plane selection against reference measurements first. The runner has not been integrated into the production app provider or tested against downloaded model weights.

Four standard-library tests verify artifact integrity, OBJ indexing, invalid-input rejection and no overwrite. These tests do not execute inference:

```text
python -B -m unittest discover -s tests -p test_reconstruction_runner.py -v
```

## Calibrated geometry assessment pipeline

`tools/reconstruction/mesh-assessment.cjs` takes a triangulated OBJ and a protocol pinned to its exact SHA-256 fingerprint. It calibrates uniform scale using two operator-selected vertices and an independently recorded reference distance. It then computes explicit landmark distances and plane-section perimeters. It does not infer anatomical landmarks or choose a waist plane automatically.

The protocol declares zero-based vertex indices, native-coordinate section axes/planes, metric definitions and optional physical reference values/error thresholds. Units `m`, `cm`, `mm` and `in` are converted explicitly. All JSON result values use metres; the printable report displays centimetres. Model geometry is never assumed to have a verified physical unit.

For multiple section contours (for example torso plus arms), an explicit interior point in native coordinates must identify exactly one contour. Open, branching, coplanar, degenerate, self-intersecting or ambiguous sections are rejected. An invalid measurement remains in the requested count and receives a reason; valid neighboring measurements can still succeed. The tool never silently picks the largest loop or sums multiple loops into a body girth.

Each reference comparison reports signed/absolute error and whether an operator-declared error threshold was met. A missing reference or threshold stays absent. Reusing the calibration endpoints is flagged as not an independent accuracy check. A single comparison never establishes population accuracy. Define protocols and thresholds before evaluation, separately from the test captures; a protocol hash supports reproducibility but does not prove when it was specified.

Outputs in a new directory: `assessment.json`, the exact `protocol.json`, and a self-contained printable `report.html`. Existing directories are refused. No images or full mesh are copied, but outputs include private derived measurements and selected contour points, so real experiment outputs belong in the ignored `tools/reconstruction/runs/` directory. The parent output directory must already exist.

Synthetic smoke example (cube only, not a human reconstruction):

```text
node tools/reconstruction/mesh-assessment.cjs tools/reconstruction/examples/synthetic-cube.obj tools/reconstruction/examples/synthetic-cube.protocol.json tools/reconstruction/runs/NEW_SYNTHETIC_RUN
```

Create `tools/reconstruction/runs` first if necessary. The example produces one exact reference comparison, one deliberately mismatched comparison and one rejected plane. Its values cannot be presented as a scanned athlete. Use the example's protocol structure for real authorized meshes, changing the fingerprint, reference, landmark indices and measurement planes for that exact mesh. The supplied cube's line endings are pinned to LF to preserve its fingerprint.

Nine additional tests cover scale/units, changed-mesh refusal, analytical distances/perimeters, reference errors, ambiguous contour selection, calibration reuse, rejection counts, output escaping, no overwrite and the full command-line flow. Run `node --test tests/mesh-assessment.test.cjs tests/mesh-section.test.cjs`.

This increment prepares a measurable reconstruction experiment; it does not close FM02/FM04. Real body reconstruction, anatomical calibration and repeatability evidence remain unavailable, and no additional parity percentage is credited yet.

## Local silhouette reconstruction experiment

An alternate executable experiment now avoids the SAM 3D CUDA requirement:

```text
node tools/reconstruction/silhouette-lab.cjs
```

Open `http://127.0.0.1:8771`. The loopback server serves an exact file allowlist and has no upload endpoint or database connection. It is excluded from the production Docker COPY allowlist and Vercel deployment. This is a local research interface, not a released parent-app feature.

Choose four authorized **adult reference** photos after checking the permission acknowledgement. The worker downloads the pinned MediaPipe Tasks Vision 1.0.1 runtime and Pose Full float16 v1 model; inference happens in that dedicated worker. It tries GPU, then CPU if model creation fails. The parent scanner's cached model/configuration is untouched. Processing times identify the actual delegate and include model loading when cold.

Each photo produces a thresholded person mask and a hip-center alignment. The operator checks the silhouette and can adjust its center. Exact-byte reuse across views is rejected; edited/re-encoded copies are not detected. Missing/multiple detected people, invalid masks, cropped silhouettes, substantial disconnected regions and unclear hip alignment fail explicitly. These gates are heuristic and do not verify anatomical view identity or matching pose.

The four masks constrain a voxel intersection under **orthographic camera assumptions**: front maps X, back maps −X, anatomical right maps Z, left maps −Z, with Y up. Each view is scaled independently so its segmented vertical extent matches the entered stature. Hair, clothing, perspective, limb occlusion, inconsistent pose and erroneous alignment can distort this surface. Resolution defaults to 96 cells over height; grid spacing is not measurement accuracy. Empty/fragmented intersections and ambiguous voxel edge contacts are rejected. No hidden anatomy, girths, body composition or PHV is inferred.

Successful geometry can be rotated and explicitly downloaded as triangulated OBJ plus a method JSON containing model version, delegate, timings, alignment, assumed scale and the exact OBJ SHA-256. Images, masks and image hashes are not in that method export. Geometry itself remains sensitive derived body data. The app does not save these artifacts. Clear/session exit terminates the worker and releases page references; explicitly downloaded files persist on the operator's device. The existing offline mesh-assessment tool still requires independently chosen calibration/reference measurements for any physical evaluation.

**Observed September 9, 2026:** the lab ran the real model on Google's public `mediapipe-assets/pose.jpg` example in the Codex in-app browser. It detected one person and returned a 1000 × 667 silhouette on the GPU in 8.4 seconds, including initialization on that run. The mask was visually inspected. The example is a yoga pose, not a standing four-view reference. It does not populate the four capture slots and cannot establish reconstruction accuracy. Network requests and photo decoding precede this worker timing; it is not end-to-end capture latency or a competitor speed comparison.

An explicit synthetic rectangular-prism check verifies the surface renderer and rotation controls; its downloads are disabled and it is labeled synthetic. Nine additional automated tests cover analytical mesh dimensions/volume/closed edges, view mirroring, invalid masks/scale, four-view constraints, OBJ indices, full lab orchestration with mocked inference, exact-file rejection, invalid alignment, export fingerprint integrity and cleanup of late/error results. Browser checks verified real segmentation plus synthetic rendering/rotation. No real four-view human reconstruction or independent anthropometric validation has been completed. FM02/FM04 receive no additional completion credit yet.

References: [Google Pose Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [Google MPMask API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.mpmask), and the exact pinned package's `vision.d.ts` were inspected for segmentation options, float-mask access and resource cleanup. This experiment is a coarse silhouette intersection, not SAM 3D Body inference or FITMATCH technology.

## Tape-reference workflow in the lab

The local lab now contains a preparation guide covering the four anatomical views, fitted clothing, camera/pose consistency, accepted file formats and independent reference recording. A successful real-input mesh exposes a reference panel. Enter the location description, that horizontal level's height above the floor in cm, and an independently recorded tape perimeter at the same level. Height remains an assumed scale input; comparing the reconstructed total height back to this input would be circular.

The panel shows a level line on the mesh and a top-down section contour, then reports surface perimeter, tape perimeter, signed/absolute error in cm and absolute percentage error. It reuses the existing `mesh-section.cjs` geometry implementation through a browser-compatible export and runs section extraction in the experiment worker. The current method export records a computed comparison or its rejection reason, tied to the existing mesh fingerprint. Editing reference inputs removes the old comparison, rebuilding clears it, and session clearing removes reference inputs. No comparison automatically passes an accuracy threshold. The section contour is displayed in memory but its points are omitted from the method JSON.

Multiple contours are rejected; there is no automatic largest-loop selection, arm/torso summing, or anatomical waist/chest identification. Coplanar faces, open/branching sections, invalid inputs and out-of-range levels also fail explicitly. Voxel stair steps can distort perimeter even when the overall shape looks plausible. The 3D preview preserves its aspect ratio at desktop and phone sizes.

September 9 browser verification: the actual worker compared a synthetic 54 × 54 cm prism section with its independently known 216 cm analytical perimeter and returned 216.0 cm. The developer fixture remains labeled synthetic and cannot export an athlete artifact. Three additional tests check reference arithmetic, signed errors, invalid inputs and separate-contour rejection. Existing lab orchestration tests now cover reference results, rejection provenance, export linkage and stale-result removal; offline geometry/CLI regressions also pass. No real person's perimeter has been tested, and parity remains 20%.

## Photo/segmentation review

Each successful photo now keeps a resized canvas preview in browser memory for Photo + silhouette, Photo only and Silhouette only displays. The preview is copied from the exact oriented/resized bitmap passed to inference; the green mask is composited at the returned mask dimensions. Gold extent/center lines remain visible. These controls help an operator detect missing limbs or extra background, but do not repair segmentation. Retake a bad outline.

All four views require an explicit manual review before a mesh can be built. Changing a view's center or replacing its photo resets its review and invalidates the old geometry/reference result. A per-view Remove button deletes that view and its preview. Clear and session exit clear all previews; pending/error processing also releases its staging canvas. The method export adds `manual-view-review-v1` confirmation metadata, without including photo previews or mask pixels. Review is an operator assertion, not automated proof of anatomical orientation or accuracy.

Browser verification used the public Google pose example and visually confirmed its real segmentation overlay. This run reported 0.9 s worker time with previously cached resources; it is not an end-to-end scan benchmark. Two new automated tests verify preview replacement/removal/clear/failure cleanup and alpha compositing; existing orchestration tests cover the review requirement, alignment reset, metadata and cancellation cleanup. Four-view human reconstruction and independent accuracy evidence remain outstanding; parity stays 20%.

## Reopening saved results

The lab can now reopen the exact OBJ and matching method JSON downloaded from an earlier experimental result. This runs locally in the worker without rerunning the pose model or loading original photos. It checks SHA-256 against the exact OBJ bytes, method schema/protocol/scale, bounded dimensions/counts, four view records, valid vertex indices and nondegenerate triangles, and two incident triangles per mesh edge. External materials/textures and unsupported OBJ directives are rejected. Limits are 16 MB OBJ, 256 KB method JSON, 100,000 vertices and 150,000 triangles.

A matching hash establishes file pairing only. Method files are unsigned and can be edited; neither capture provenance nor accuracy is authenticated. Reopened results say so prominently and retain `reopened.verification = mesh-file-sha256-only`. The importer normalizes an allowlist of metadata and discards unknown fields. It restores only valid tape-reference inputs; previous computed errors/pass claims are discarded, and comparison must be rerun. Imported scale is fixed. Re-export preserves the exact original OBJ bytes so the method fingerprint remains valid.

An invalid file pair leaves the current result intact. Successful reopening replaces the current photo views and releases their previews. Clear zeroes the retained OBJ buffer, removes the surface and inputs, and cancels pending work. This does not delete explicitly downloaded files. Originals and silhouettes cannot be recovered from the method file.

Verification: four new archive tests cover supported reopening, metadata sanitization, mismatched files/scale/counts/views, unsupported OBJ resources/open geometry and untrusted reference results. A full lab orchestration test covers export → reopen → reference recomputation → identical OBJ re-export, invalid-import preservation and cancellation/cleanup. The actual browser worker also reopened a synthetic 13,802-vertex prism export and matched its known 216 cm section perimeter. This is file portability and geometry evidence, not a real-human reconstruction or accuracy result. Overall parity remains 20%.
# Repeat-scan comparison — local research tool

Start `node tools/reconstruction/repeat-lab.cjs` and open `http://127.0.0.1:8775/`. The existing capture lab at port 8771 is independent; opening the comparison tool does not reload an in-progress capture. The comparison host serves an exact file allowlist on loopback, has no upload/database endpoints and makes no external model requests.

For an initial adult reference trial:

1. Record standing height and choose clearly identifiable horizontal levels above the floor. Record independent tape measurements at those levels before inspecting any mesh result.
2. Capture four views in the silhouette lab with consistent camera position, pose and clothing. Review every mask and hip center, build the experimental surface and download both OBJ and method JSON. Keep these together as **scan A**.
3. Take four new photos in the same session, keeping height, clothing, pose and processing resolution unchanged. Build and save **scan B**. Reopening scan A or reusing its photos is not an independent capture.
4. In the repeat tool, choose both file pairs, confirm permission/independent capture and enter up to 12 floor levels in cm. Inspect every rejected level as well as the computed ones.
5. Download the repeat-comparison JSON. Separately reopen each surface in the original lab to compare its perimeter against the independently recorded tape reference. Record camera/device, capture conditions and any retakes outside the app; no participant identity is collected by the comparison tool.

The worker runs the existing strict OBJ/method import checks for both files, requires matching recorded height, resolution, protocol and per-view segmentation model, and rejects identical file fingerprints or identical vertex sets even when ordering/comments differ. This does not authenticate independence, same-person identity or model metadata, and does not detect every edited duplicate. Different CPU/GPU delegates are reported as a warning. No alignment, rotation or scale fitting is applied to make scans agree.

Each requested floor level is intersected with both meshes. Exactly one closed contour is required in each. The result reports first/second geometric perimeter, width and depth, signed second-minus-first differences, absolute differences and rejected-section reasons. Multiple contours are not summed or assigned anatomical labels. The summary's maximum absolute perimeter difference covers only computed levels; if all levels reject it is null. There is no pass threshold, precision/accuracy score, clinical interpretation or population repeatability claim.

`PP_SURFACE_REPEAT_V1` exports source mesh fingerprints and recorded timestamps, model metadata, the operator declaration, settings, scalar section results and limitations. It omits geometry, photos and unknown imported metadata. It remains a sensitive derived record despite containing no names. Files and results stay in browser memory until explicitly downloaded; Cancel terminates the worker, and Clear releases page references and removes results. File changes invalidate an existing report. Nothing is saved into the parent account or organization's dashboard.

Verification: ten automated tests cover analytical dimensions and signed differences, reordered/comment-edited copies, changed models/scale, bad file pairs/open meshes, level bounds, ambiguous contours, curated outputs, actual UI-to-comparison orchestration, synthetic export suppression and cancellation/stale-result handling. The real browser worker returned +4.00 cm perimeter, +2.00 cm width and 0.00 cm depth at three levels for 54 × 54 cm and 56 × 54 cm boxes. These are analytical synthetic fixtures, not voxel reconstructions of a person. Actual paired human scans and anatomical reference comparisons remain outstanding. This tooling earns no new FM02/FM04 parity credit.

## Integrated parent preview

The parent app now uses the same visual-hull implementation and segmentation worker for an opt-in, temporary preview after its normal four-photo quality checks and length inference. Each silhouette requires manual review. Main-preview resolution is 64, while the lab defaults to 96; do not compare them as identical protocols in a repeatability study. Geometry is not saved in the parent account. See `MAIN-SCAN-3D.md`. This is a local integration milestone; no accepted four-view human reconstruction or anatomical accuracy evidence was added.
