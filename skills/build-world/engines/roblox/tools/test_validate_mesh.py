import tempfile
import unittest
from pathlib import Path

import trimesh

from validate_mesh import inspect


class ValidateMeshTests(unittest.TestCase):
    def export(self, mesh: trimesh.Trimesh, name: str) -> Path:
        root = Path(tempfile.mkdtemp())
        path = root / name
        mesh.export(path)
        return path

    def test_box_passes_default_gate(self):
        report = inspect(self.export(trimesh.creation.box(), "box.glb"))
        self.assertTrue(report["ok"])
        self.assertEqual(report["mesh_count"], 1)

    def test_triangle_budget_is_enforced(self):
        report = inspect(
            self.export(trimesh.creation.icosphere(subdivisions=2), "sphere.glb"),
            max_triangles=10,
        )
        self.assertFalse(report["ok"])
        self.assertTrue(
            any("triangle budget exceeded" in e for e in report["meshes"][0]["errors"])
        )

    def test_open_surface_fails_watertight_gate(self):
        box = trimesh.creation.box()
        open_mesh = trimesh.Trimesh(
            vertices=box.vertices.copy(),
            faces=box.faces[:-2].copy(),
            process=False,
        )
        report = inspect(self.export(open_mesh, "open.glb"))
        self.assertFalse(report["ok"])
        self.assertIn("mesh is not watertight", report["meshes"][0]["errors"])


if __name__ == "__main__":
    unittest.main()
