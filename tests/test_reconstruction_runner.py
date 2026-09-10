"""Artifact/validation checks only; these do not execute or validate inference."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("runner", Path(__file__).resolve().parents[1] / "tools/reconstruction/run_sam3d.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ReconstructionRunnerTest(unittest.TestCase):
    def test_obj_indexing_and_rejection(self):
        vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
        self.assertIn("f 1 2 3\n", runner.mesh_obj(vertices, [[0, 1, 2]]))
        for faces in ([[0, 1, 3]], [[0, 0, 1]], [[0, 1.0, 2]], [[0, True, 2]]):
            with self.assertRaises(ValueError):
                runner.mesh_obj(vertices, faces)
        with self.assertRaises(ValueError):
            runner.mesh_obj([[float("nan"), 0, 0], *vertices[1:]], [[0, 1, 2]])

    def test_bounds(self):
        self.assertEqual(runner.validate_bbox([0, 0, 640, 480], 640, 480), [0, 0, 640, 480])
        for box in ([-1, 0, 640, 480], [0, 0, 641, 480], [0, 0, 0, 480], [0, 0, float("nan"), 480]):
            with self.assertRaises(ValueError):
                runner.validate_bbox(box, 640, 480)

    def test_private_artifact_integrity_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "run"
            runner.write_result(folder, [[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]], {"image_sha256": "input-hash"})
            manifest = json.loads((folder / "manifest.json").read_text())
            self.assertEqual(manifest["mesh_sha256"], hashlib.sha256((folder / "mesh.obj").read_bytes()).hexdigest())
            self.assertEqual(manifest["coordinate_unit"], "model_native_unverified")
            self.assertEqual(manifest["validated_measurements"], [])
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ["manifest.json", "mesh.obj"])
            with self.assertRaises(FileExistsError):
                runner.write_result(folder, [[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]], {})

    def test_invalid_output_creates_no_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "bad"
            with self.assertRaises(ValueError):
                runner.write_result(folder, [], [], {})
            self.assertFalse(folder.exists())


if __name__ == "__main__":
    unittest.main()
