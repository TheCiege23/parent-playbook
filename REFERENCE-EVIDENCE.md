# Local reference series and evidence brief

Start `node tools/reconstruction/study-lab.cjs` from the repository root, then open `http://127.0.0.1:8776/`. The host is loopback-only with exact read routes, no uploads/database, and no external model downloads. It leaves the capture lab at port 8771 unchanged.

## Step 1: compare a series against independent references

Use permissioned adult reference scans from the experimental silhouette lab. Before viewing the surface estimate, describe a reproducible horizontal tape location and measurement procedure, record a tape perimeter and its level above the floor, and assign a participant code. Do not use names in this tool. Preserve the OBJ/method file pair for each scan.

The page accepts one location/procedure per report and up to eight scans. Add each pair with its participant code, floor level and tape perimeter. Repeated scans of one adult should use the same code. The maximums are 16 MB per OBJ, 256 KB per method JSON and 64 MB total OBJ data. Remove releases a queued pair; Clear releases all file references, computed observations and the evidence preview. Files are kept in memory until explicitly downloaded; a refresh discards the session.

Computation uses the existing strict archive parser and single-contour reference comparison. It verifies file fingerprints, supported format, geometry and scale metadata before calculating a perimeter. Malformed files or ambiguous/out-of-range sections remain rejected rows. Identical vertex sets are excluded even when vertex order or file comments differ. This is not an edited-duplicate or identity detector; metadata and independence declarations remain unauthenticated.

For each recorded method/model/delegate/resolution group, the report shows attempted/computed/rejected counts, participant codes with computed results, mean signed error, mean absolute error and maximum absolute error. Signed error is surface perimeter minus tape perimeter, in cm. Rejected rows do not contribute zeros to the averages. A group with no computed rows has null error statistics. Failed imports without usable method metadata appear in the overall rejection count, outside method groups.

The report does not pool incompatible methods, treat repeated scans as different people, infer anatomical landmarks, select an accuracy threshold or estimate population performance. Tape technique, clothing, camera assumptions, pose, voxel edges, centering and segmentation can all contribute error. A low mean signed error can hide positive/negative errors; mean absolute error is displayed alongside it. Scale still depends on recorded stature.

`PP_SURFACE_REFERENCE_STUDY_V1` exports the declared procedure, scalar observations/rejections, descriptive method groups, participant codes, source mesh fingerprints and limitations. Unknown imported fields, geometry, photos and landmarks are omitted. There is no account save or authenticated evidence audit trail. Do not treat this as a benchmark certification or automatic FITMATCH acceptance result.

## Step 2: present the evidence alongside the gaps

After computing, click **Preview evidence page**. The application reads only the repository's allowlisted `tools/parity-progress.json` and renders a sandboxed, script-free HTML brief. The score is calculated from the fixed weighted category stages, not from successful reference rows. The brief includes computed observations, every rejection, model metadata, file fingerprints, current capability evidence and limits. Editing the procedure, changing queued scans or clearing the session invalidates the brief. Late worker or rubric responses cannot restore cleared results.

For reference-input runs, **Download evidence HTML** creates a standalone file that can be opened without this server and printed to PDF using the browser. It contains no external assets or scripts. It is a generated snapshot, not a live dashboard; regenerate it when the rubric or observations change. The JSON and HTML still contain participant codes and measurements, so handle them as sensitive derived records.

The developer series uses two analytical boxes and one copied box. It should compute +2 cm and -2 cm errors, reject the copy, and return 0 cm mean signed error and 2 cm mean absolute error. The example and evidence preview are explicitly synthetic, with export disabled. These checks establish arithmetic and orchestration, not human scanning performance. Manually supplied files also have unauthenticated provenance; an operator declaration cannot prove that their source is a real person.

Current verification: ten automated tests cover computation, grouping, rejection handling, data filtering, rendering/escaping and lifecycle behavior; the browser worker and evidence preview were exercised using analytical fixtures. Actual adult reference trials, representative populations, supported-device testing, production operation and the Friday live-app rehearsal remain outstanding. Overall parity remains approximately 20%.
