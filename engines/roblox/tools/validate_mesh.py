#!/usr/bin/env python3
"""Preflight Roblox-bound meshes before Studio import.

Requires trimesh and numpy. Exits 0 when every mesh passes the configured gates,
1 when one or more meshes fail, and 2 for invocation/load errors.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh


def _finite(values) -> bool:
    return bool(np.isfinite(np.asarray(values, dtype=float)).all())


def _mesh_report(name: str, mesh: trimesh.Trimesh, max_triangles: int) -> dict:
    faces = int(len(mesh.faces))
    vertices = int(len(mesh.vertices))
    extents = np.asarray(mesh.extents, dtype=float)
    bounds = np.asarray(mesh.bounds, dtype=float)

    errors: list[str] = []
    warnings: list[str] = []

    if faces == 0 or vertices == 0:
        errors.append("mesh has no geometry")
    if faces > max_triangles:
        errors.append(f"triangle budget exceeded: {faces} > {max_triangles}")
    if not _finite(extents) or not _finite(bounds):
        errors.append("mesh contains non-finite bounds")
    elif np.any(extents <= 1e-8):
        errors.append(f"mesh has zero/near-zero thickness: extents={extents.tolist()}")

    watertight = bool(mesh.is_watertight)
    winding = bool(mesh.is_winding_consistent)
    volume = float(abs(mesh.volume)) if math.isfinite(float(mesh.volume)) else float("nan")

    if not watertight:
        errors.append("mesh is not watertight")
    if not winding:
        errors.append("mesh winding is inconsistent")
    if not math.isfinite(volume) or volume <= 1e-12:
        errors.append("mesh has no measurable enclosed volume")

    components = int(len(mesh.split(only_watertight=False))) if faces else 0
    if components > 8:
        warnings.append(f"mesh has {components} disconnected components; inspect for export debris")

    return {
        "name": name,
        "vertices": vertices,
        "triangles": faces,
        "extents": [float(x) for x in extents] if _finite(extents) else None,
        "watertight": watertight,
        "winding_consistent": winding,
        "volume": volume if math.isfinite(volume) else None,
        "components": components,
        "errors": errors,
        "warnings": warnings,
        "ok": not errors,
    }


def inspect(path: Path, max_triangles: int = 20_000) -> dict:
    raw = path.read_bytes()
    if not raw:
        raise ValueError("file is empty")

    loaded = trimesh.load(path, force="scene", process=False)
    if isinstance(loaded, trimesh.Trimesh):
        scene = trimesh.Scene(loaded)
    elif isinstance(loaded, trimesh.Scene):
        scene = loaded
    else:
        raise ValueError(f"unsupported mesh payload: {type(loaded).__name__}")

    if not scene.geometry:
        raise ValueError("file contains no mesh geometry")

    meshes = [_mesh_report(name, mesh, max_triangles) for name, mesh in sorted(scene.geometry.items())]
    return {
        "file": str(path),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "max_triangles_per_mesh": max_triangles,
        "mesh_count": len(meshes),
        "total_triangles": sum(m["triangles"] for m in meshes),
        "meshes": meshes,
        "ok": all(m["ok"] for m in meshes),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mesh", type=Path)
    parser.add_argument("--max-triangles", type=int, default=20_000)
    parser.add_argument("--json", dest="json_path", type=Path)
    args = parser.parse_args(argv)

    if args.max_triangles < 1:
        parser.error("--max-triangles must be positive")
    if not args.mesh.is_file():
        print(f"error: not a file: {args.mesh}", file=sys.stderr)
        return 2

    try:
        report = inspect(args.mesh, args.max_triangles)
    except Exception as exc:
        print(f"error: could not inspect {args.mesh}: {exc}", file=sys.stderr)
        return 2

    rendered = json.dumps(report, indent=2, sort_keys=True)
    print(rendered)
    if args.json_path:
        args.json_path.parent.mkdir(parents=True, exist_ok=True)
        args.json_path.write_text(rendered + "\n", encoding="utf-8")

    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
