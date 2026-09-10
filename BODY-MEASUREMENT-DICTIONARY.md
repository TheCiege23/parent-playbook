# Photo measurement dictionary

Current local provider: `ondevice-pose` 1.3.0. Dictionary: `body-outputs-v2`. Side method: `front-joint-proxy-v2`. Up to 25 outputs use inches, rounded to one decimal place; this precision is not an accuracy claim. Definitions are visible in Body Insights and included in report/CSV/JSON exports. Existing strict engine-version comparison rules prevent new results from being silently compared with older dictionaries.

| Keys | Current method |
| --- | --- |
| `wingspan` | Predicted shoulder width plus twice the averaged shoulder-to-wrist path and estimated hand length. |
| `standing_reach` | Estimated shoulder height plus averaged shoulder-to-wrist path and estimated hand length. |
| `shoulder_width` | Predicted shoulder-joint distance from front/back views. |
| `hip_width` | Predicted hip-joint distance from front/back views; not a circumference or skeletal breadth. |
| `ear_width` | Predicted ear-landmark distance from front/back views; not measured head breadth. |
| `torso_length` | Predicted shoulder-midpoint to hip-midpoint distance. |
| `leg_length` | Averaged hip-to-knee and knee-to-ankle paths plus estimated ankle height above heel. |
| `left_upper_arm_length`, `right_upper_arm_length` | Straight predicted shoulder-to-elbow distance, separately for each side. |
| `left_forearm_length`, `right_forearm_length` | Straight predicted elbow-to-wrist distance, separately for each side. |
| `left_thigh_length`, `right_thigh_length` | Straight predicted hip-to-knee distance, separately for each side. |
| `left_lower_leg_length`, `right_lower_leg_length` | Straight predicted knee-to-ankle distance, separately for each side. |
| `left_arm_path_length`, `right_arm_path_length` | Predicted shoulder-to-elbow plus elbow-to-wrist joint path, separately for each side. |
| `left_leg_path_length`, `right_leg_path_length` | Predicted hip-to-knee plus knee-to-ankle joint path, separately for each side. |
| `left_shoulder_hip_length`, `right_shoulder_hip_length` | Straight predicted shoulder-to-hip distance, separately for each side. |
| `left_ankle_heel_length`, `right_ankle_heel_length` | Straight predicted ankle-to-heel landmark distance, separately for each side. |
| `left_foot_length`, `right_foot_length` | Straight predicted heel-to-forefoot landmark distance, separately for each side; not direct heel-to-toe length. |

The 18 bilateral outputs use only the requested front photo and the same model-stature scale as the overall outputs. Straight segments use Euclidean world-landmark distance; arm and leg paths sum their two consecutive joint segments. Every required point must have finite coordinates and visibility of at least 0.75. Each segment family has a broad height-share rejection range suited to its definition. These are engineering error gates, not biological reference intervals.

The left/right panel pairs counterparts only within one assessment with matching recorded engine/model/unit/side-method provenance. It reports absolute difference, leaves missing sides empty and never fills them from an older assessment. A changed engine version is intentionally incompatible for longitudinal comparisons.

These outputs are pose-based joint proxies. They are not direct tape measurements, palpated anatomical breadths, bone lengths, sitting height, inseam, a 3D surface reconstruction or FITMATCH's proprietary metric dictionary. Mirroring or incorrect orientation can swap side labels. Pose/capture error can create apparent differences. There is no validated clinical asymmetry threshold or injury-risk inference.

Before accuracy claims: assess repeatability and side orientation on intended devices; compare every output against its explicitly defined physical reference; record rejected/missing outputs and errors; agree acceptance thresholds before evaluation. Reaching 25 defined outputs does not establish FITMATCH-equivalent accuracy or coverage. Girths and body composition remain separate unfinished work.

Consent text now enumerates the additional side estimates under policy `2026-09-09.ondevice.v2`. Only output values and bounded provenance are saved. Raw photos and landmarks are not added to persistent records by this increment.
