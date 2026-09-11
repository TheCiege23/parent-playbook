"""Offline reconstruction experiment, not a production measurement provider.

Requires an independently installed SAM 3D Body environment and authorized local
checkpoints. Nothing is downloaded or uploaded by this wrapper. Output geometry
keeps native model coordinates: its physical scale has NOT been established.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
import time


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_bbox(box, width, height):
    if len(box) != 4 or not all(math.isfinite(v) for v in box):
        raise ValueError("Bounding box must contain four finite pixel coordinates")
    x1, y1, x2, y2 = box
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        raise ValueError("Bounding box must lie inside the image with positive area")
    return list(box)


def mesh_obj(vertices, faces):
    # Validate the entire mesh before creating any experiment artifacts.
    points = [list(p) for p in vertices]
    triangles = [list(f) for f in faces]
    if len(points) < 3 or not triangles:
        raise ValueError("Model returned no triangular surface")
    for point in points:
        if len(point) != 3 or not all(math.isfinite(v) for v in point):
            raise ValueError("Model returned invalid vertices")
    for triangle in triangles:
        if len(triangle) != 3 or any(isinstance(i, bool) or not isinstance(i, int) or i < 0 or i >= len(points) for i in triangle):
            raise ValueError("Model returned invalid triangle indices")
        if len(set(triangle)) != 3:
            raise ValueError("Model returned a degenerate triangle")
    lines = ["# Parent Playbook reconstruction experiment", "# UNCALIBRATED model-native coordinates; not anthropometric measurements"]
    lines.extend("v " + " ".join(format(v, ".10g") for v in p) for p in points)
    lines.extend("f " + " ".join(str(i + 1) for i in f) for f in triangles)
    return "\n".join(lines) + "\n"


def write_result(directory, vertices, faces, provenance):
    obj = mesh_obj(vertices, faces)
    # A fresh directory prevents accidental replacement of a previous experiment.
    directory = Path(directory)
    manifest = dict(provenance)
    manifest.update({
        "schema": 1,
        "kind": "single_image_reconstruction_experiment",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mesh_file": "mesh.obj",
        "mesh_sha256": hashlib.sha256(obj.encode("utf-8")).hexdigest(),
        "vertex_count": len(vertices),
        "triangle_count": len(faces),
        "coordinate_unit": "model_native_unverified",
        "anatomical_calibration": None,
        "validated_measurements": [],
        "limitations": ["Single-view inference; no four-view fusion", "No verified metric scale or anatomical landmarks", "No circumference, tissue composition or maturity estimates", "No pediatric accuracy validation"],
    })
    encoded = json.dumps(manifest, indent=2, allow_nan=False) + "\n"
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "mesh.obj").write_bytes(obj.encode("utf-8"))
    (directory / "manifest.json").write_text(encoded, encoding="utf-8")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--mhr-model", type=Path, required=True)
    parser.add_argument("--model-revision", required=True, help="Operator-supplied checkpoint revision, recorded alongside SHA-256 hashes")
    parser.add_argument("--output-dir", type=Path, required=True, help="New private experiment directory")
    region = parser.add_mutually_exclusive_group(required=True)
    region.add_argument("--bbox", type=float, nargs=4, metavar=("X1", "Y1", "X2", "Y2"))
    region.add_argument("--single-person-crop", action="store_true", help="Input has already been cropped to one full person; no detector is used")
    args = parser.parse_args(argv)
    for path in (args.image, args.checkpoint, args.mhr_model):
        if not path.is_file():
            parser.error(f"Required local file is missing: {path}")
    if args.output_dir.exists():
        parser.error("Output directory already exists; choose a fresh experiment directory")
    configs = [args.checkpoint.parent / "model_config.yaml", args.checkpoint.parent.parent / "model_config.yaml"]
    config = next((p for p in configs if p.is_file()), None)
    if config is None:
        parser.error("model_config.yaml must be beside the checkpoint or in its parent directory")
    try:
        import cv2
        import numpy as np
        import torch
        from sam_3d_body import load_sam_3d_body, SAM3DBodyEstimator
    except ImportError as error:
        parser.error(f"Install the upstream SAM 3D Body environment first: {error}")
    # The inspected upstream estimator moves its batch to CUDA unconditionally.
    if not torch.cuda.is_available():
        parser.error("This runner requires a CUDA environment supported by the upstream estimator")
    image = cv2.imread(str(args.image))
    if image is None:
        parser.error("Image could not be decoded")
    height, width = image.shape[:2]
    try:
        box = validate_bbox(args.bbox, width, height) if args.bbox else None
    except ValueError as error:
        parser.error(str(error))
    provenance = {
        "engine": "sam-3d-body", "wrapper_version": "0.1.0",
        "model_revision_operator_supplied": args.model_revision,
        "checkpoint_sha256": file_hash(args.checkpoint),
        "mhr_model_sha256": file_hash(args.mhr_model),
        "config_sha256": file_hash(config), "image_sha256": file_hash(args.image),
        "input_pixels": [width, height], "bbox_pixels": box,
        "region_mode": "explicit_bbox" if box else "operator_cropped_single_person",
        "camera_intrinsics": "upstream_default_unverified", "device": "cuda",
        "torch_version": torch.__version__,
        "input_image_copied_to_output": False,
    }
    model, model_cfg = load_sam_3d_body(checkpoint_path=str(args.checkpoint), device="cuda", mhr_path=str(args.mhr_model))
    estimator = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=model_cfg)
    started = time.perf_counter()
    with torch.inference_mode():
        predictions = estimator.process_one_image(
            cv2.cvtColor(image, cv2.COLOR_BGR2RGB),
            bboxes=np.asarray([box], dtype=np.float32) if box else None,
            use_mask=False, inference_type="full",
        )
    if len(predictions) != 1:
        raise RuntimeError(f"Expected one reconstruction; model returned {len(predictions)}")
    provenance["inference_seconds"] = time.perf_counter() - started
    manifest = write_result(args.output_dir, predictions[0]["pred_vertices"].tolist(), estimator.faces.tolist(), provenance)
    print(json.dumps({"output_directory": str(args.output_dir.resolve()), "vertices": manifest["vertex_count"], "status": "uncalibrated_experiment"}))


if __name__ == "__main__":
    main()
