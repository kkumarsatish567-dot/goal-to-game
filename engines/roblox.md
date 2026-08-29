# Roblox Studio

Roblox-specific instructions for Goal to Game. The shared Thrixel asset pipeline remains in
[`../SKILL.md`](../SKILL.md); this file defines the Roblox import, project, gameplay, and
verification path.

The target is not "a folder of meshes that can probably be imported." The target is a playable
Roblox place whose Thrixel assets survive Roblox's geometry checks, have deliberate scale,
orientation, materials and collisions, and can be reproduced from source.

Read [`roblox/PITFALLS.md`](roblox/PITFALLS.md) before importing the first asset.

## Hard gates

1. Use Thrixel for production 3D assets. Do not replace rejected assets with cubes and call the
   game finished.
2. Keep scripts and project structure in source control with Rojo. Studio is the visual/import
   boundary, not the source of truth for code.
3. Validate every downloaded mesh before Studio. Roblox's general mesh specification currently
   limits an individual mesh to 20,000 triangles and requires watertight geometry with volume.
4. Never assume source scale or forward axis. Record the correction once and reuse it.
5. Treat materials and collision as separate design problems. A beautiful MeshPart should not
   automatically become an expensive gameplay collider.
6. Verify in Play mode on desktop and at least one mobile emulator preset. A successful Rojo build
   proves serialization, not playability.
7. Publishing, API-key creation, paid uploads, and account permission changes remain explicit user
   actions unless authority was already granted.

Roblox references used by this workflow:

- General mesh specifications: https://create.roblox.com/docs/art/modeling/specifications
- Texture specifications: https://create.roblox.com/docs/art/modeling/texture-specifications
- PBR / SurfaceAppearance: https://create.roblox.com/docs/art/modeling/surface-appearance
- Open Cloud Assets API: https://create.roblox.com/docs/cloud/guides/usage-assets

## Toolchain check

Before creating a Roblox game, verify:

```sh
rojo --version
python3 --version
```

`rokit` is preferred for pinning Rojo:

```sh
rokit --version
```

Roblox Studio must also be installed on a machine that can launch its GUI. Native Linux can
prepare source and validate meshes but cannot replace the Studio import/playtest boundary. Under
WSL, run Rojo in WSL and Studio on Windows, or move the project to the Windows filesystem if local
networking prevents the Studio plugin from reaching the Rojo server.

## Project contract

Start from [`roblox/templates`](roblox/templates):

```text
game/
├── rokit.toml
├── default.project.json
├── studio-sync.project.json
├── assets.manifest.json
├── assets/
│   ├── source/        # exact files downloaded from Thrixel
│   └── reports/       # validator JSON
├── src/
│   ├── assets/
│   ├── client/
│   ├── server/
│   ├── shared/
│   └── verification/
└── captures/          # screenshots/videos, normally gitignored
```

`default.project.json` is allowed to build a place from source. `studio-sync.project.json` is for
live iteration after assets have been inserted in Studio and deliberately avoids owning the whole
Workspace, so syncing scripts cannot erase imported models.

## Asset manifest: the reproducibility spine

Create `assets.manifest.json` before the first import. One entry per Thrixel asset:

```json
{
  "name": "storm-lighthouse",
  "submissionId": "...",
  "source": "assets/source/storm-lighthouse.glb",
  "sha256": "...",
  "targetHeightStuds": 54,
  "rotationDegrees": [0, 180, 0],
  "movingGroups": ["lamp_head"],
  "appearanceGroups": ["glass", "metal"],
  "collision": "simple-parts",
  "state": "prepared"
}
```

Allowed state progression should be explicit: `prepared` -> `imported` -> `verified`. If an upload
is waiting on moderation, use `moderation_pending`; if validation/import fails, use `failed` and
record why. Do not silently point the manifest at a substitute asset.

## Thrixel preparation loop

Run this loop for every asset.

### 1. Inspect before grouping

Use `thrixel_inspect_model` to discover the real node names. Decide which nodes must remain
separate for either of two reasons:

- **motion:** doors, wheels, rotors, handles, pointers, lids;
- **appearance:** glass, emissive panels, chrome, rubber, painted body, or any surface that needs
  a distinct Roblox material/PBR treatment.

Pass those exact nodes to `thrixel_group_parts`. Roblox mesh objects are effectively
single-material surfaces, so merging visually distinct regions and hoping to recover Unity-style
submaterials later is the wrong tradeoff.

Aim below the platform limit rather than exactly at it. A practical target is <= 18,000 triangles
per resulting mesh so later repair/export steps have headroom. If one required moving object cannot
fit the budget without losing its silhouette, redesign or regenerate that asset instead of hiding
an importer warning.

### 2. Download a deterministic source

Prefer GLB for the primary path because it is self-contained and carries hierarchy plus PBR data:

```text
thrixel_download(submission_id="<grouped-id>", format="glb")
```

FBX is the fallback when a specific Studio build/import case behaves better with it.

Store the exact download under `assets/source/` and hash it. Never overwrite a previously verified
file with a new conversion while keeping the old hash in the manifest.

### 3. Run the preflight validator

```sh
python engines/roblox/tools/validate_mesh.py \
  assets/source/storm-lighthouse.glb \
  --json assets/reports/storm-lighthouse.json
```

The supplied validator checks each mesh object for the 20k triangle budget, finite/non-zero
bounds, watertightness, consistent winding, and enclosed volume. Any error is a failed gate.

If the asset is over budget, reduce/regroup from the Thrixel source and validate again. Do not
write a post-import script that merely hides bad geometry.

## Import path

### Studio Importer: default path

Use Studio's 3D Importer when visual inspection matters or when you need to see exactly how the
hierarchy, pivots and materials resolved.

Before clicking Import, verify:

- every expected group from the manifest is present;
- no individual mesh reports more than 20,000 triangles;
- the preview has no holes, flipped faces, or zero-thickness failures;
- imported pivots are preserved for moving groups;
- world up / forward orientation matches the intended silhouette;
- dimensions are plausible next to a default avatar or a known stud reference;
- rigid scenery starts anchored;
- merge settings do not collapse groups needed for animation or separate materials.

Insert once, then inspect the result in Explorer before retrying. Duplicate clicks on an already
completed import are a common source of overlapping geometry and mysterious z-fighting.

### Open Cloud: optional automation path

As of this workflow, Roblox's Open Cloud Assets API can create **Model** assets from `.fbx`,
`.gltf`, or `.glb` content (subject to current API limits, permissions and moderation). This can
remove manual upload work, but it does not remove verification.

Rules:

- never commit API keys or print them in logs;
- poll the returned operation until completion instead of guessing an asset ID;
- record the resulting Model asset ID separately from any child MeshPart IDs;
- moderation/permission state is part of the import state machine, not a generic network error;
- still load/inspect the result in the target experience before marking it `verified`.

Use the live Roblox API documentation rather than hard-coding an endpoint contract into generated
game code. Open Cloud endpoints are service integration code, not gameplay code.

## Scale, orientation, pivots

Thrixel assets can arrive with different source conventions. Normalize per asset, once:

1. Inspect front/side/back in Studio.
2. Place a known-height reference beside it.
3. Decide a gameplay target height in studs.
4. Scale uniformly.
5. Ground by the bounding-box bottom, not by assuming the pivot sits on the floor.
6. Record rotation and target height in the manifest.

Luau grounding pattern:

```luau
local boxCf, boxSize = model:GetBoundingBox()
local bottom = boxCf.Position.Y - boxSize.Y * 0.5
local delta = groundY - bottom
model:PivotTo(model:GetPivot() + Vector3.new(0, delta, 0))
```

For a wheel/rotor, a center pivot is useful. For a hinged door, create a dedicated pivot part or
parent model at the hinge instead of rotating around the visual bounding-box center.

## Materials and textures

Roblox supports basic textures and PBR through `SurfaceAppearance`. Keep the art pipeline honest:

- preserve UVs and inspect imported maps before changing lighting;
- use distinct mesh objects for surfaces that require distinct appearances;
- test a suspect asset under neutral white lighting before blaming tone/atmosphere;
- use OpenGL tangent-space normal maps;
- size textures to screen importance rather than uploading maximum resolution everywhere;
- keep transparent surfaces sparse on mobile.

If a PBR import loses a map, repair the imported `SurfaceAppearance` in edit/build time and record
that decision. Do not rely on a runtime script to perform one-time content authoring.

## Collision policy

Visual geometry and gameplay collision should be decoupled by default.

| Asset role | Visual mesh collision | Preferred gameplay collision |
|---|---|---|
| tiny prop / pickup | off | none or simple trigger part |
| building / large prop | selective | primitive Parts / simple hulls |
| moving visual group | off | simple proxy if needed |
| floor / wall gameplay boundary | off where possible | dedicated invisible Parts |

Use expensive mesh collision only when a measured gameplay need justifies it. A detailed lighthouse
mesh does not need thousands of triangles participating in physics merely because the player can
walk around it.

## Source layout and Rojo

Keep authority clear:

- `src/server/`: server-owned game state, spawning, validation;
- `src/client/`: camera, input, HUD, local presentation;
- `src/shared/`: constants and data schemas;
- `src/assets/`: source-controlled Roblox model files only when the import can be represented
  safely there;
- `src/verification/`: temporary or permanent automated checks.

Prefer server authority for rewards, damage, inventory, gates, and world-changing interactions.
Never trust a RemoteEvent payload merely because the UI that fired it was written by us.

## Verification loop

A Roblox build is complete only after all four gates:

### Gate A — static project

```sh
rojo build default.project.json -o build.rbxlx
```

The build must succeed with no missing mapped paths.

### Gate B — mesh evidence

Every manifest asset must have a validator report whose hash matches the source file and `ok` is
true.

### Gate C — runtime self-test

Copy `roblox/tools/runtime-selftest.server.luau` into the project verification server path. In Play
Solo it checks tagged Thrixel assets for non-empty geometry, sane bounds and anchoring/collision
mistakes. Fix every emitted error.

Tag imported roots `ThrixelAsset`; tag independent moving visual pieces `ThrixelMovingPart`.

### Gate D — visual/playtest

Capture at least:

- establishing view;
- close asset/material view;
- gameplay interaction view;
- worst lighting/weather state;
- mobile emulator view.

Verify orientation, grounding, missing textures, z-fighting, collision snagging, avatar scale,
camera clipping, UI safe areas, and frame rate. For a storm/lighthouse example, explicitly test the
night/storm transition rather than only the sunny spawn state.

## Performance budget

The hard product requirement remains at least 30 FPS. Treat 60 FPS desktop as the target when the
game permits it. Profile the actual scene instead of optimizing folklore.

First fixes when mobile performance misses target:

1. reduce visible parts and repeated unique meshes;
2. replace decorative mesh collision with simple proxies;
3. reduce local shadow-casting lights;
4. lower oversized textures;
5. reuse imported assets rather than uploading near-identical copies;
6. use StreamingEnabled for worlds large enough to benefit, then test spawn/teleport behavior.

## Definition of done

A Roblox Goal to Game result is done when a fresh checkout plus the documented Studio import step
can reproduce a playable place, every Thrixel mesh passes preflight, source and imported assets are
traceable through the manifest, scripts build through Rojo, the runtime self-test is clean, and the
game has been visually checked on desktop and mobile.

Do not report "Roblox support complete" if the only artifact is documentation that was never
exercised against a place build.