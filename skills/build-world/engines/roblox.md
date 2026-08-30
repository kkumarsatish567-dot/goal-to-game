# Roblox Studio

Roblox-specific instructions for Build World. The shared Thrixel generation loop, quality rules,
pricing/account behavior, and project planning remain in [`../SKILL.md`](../SKILL.md). This file
owns the Roblox toolchain, import boundary, Studio automation, gameplay verification, and
performance rules.

Read [`roblox/MCP_AUTONOMY.md`](roblox/MCP_AUTONOMY.md) and
[`roblox/PITFALLS.md`](roblox/PITFALLS.md) before generating the first production asset.

## Non-negotiable outcome

A Roblox build is not complete when the agent has prepared files and asks a person to import them,
press Play, inspect Output, or take screenshots. The normal path must be autonomous through Roblox
Studio's MCP server. The user may need to authorize account-level actions once, but after the
required access exists the agent owns the import -> inspect -> playtest -> capture -> fix loop.

Use the live Roblox docs as the source of truth for Studio MCP tool names. The current family
includes `get_studio_state`, `list_roblox_studios`, `set_active_studio`, `execute_luau`,
`search_game_tree`, `inspect_instance`, `start_stop_play`, `get_console_output`, `screen_capture`,
`user_keyboard_input`, `user_mouse_input`, and navigation helpers.

## Hard gates before spending Thrixel Cubes

1. Verify `rojo --version` and `python3 --version`.
2. Prefer Rokit for a pinned Rojo install; the template pins a known version.
3. Connect the coding agent to Roblox Studio MCP.
4. Confirm an actual Edit DataModel is attached with the live Studio-state tool.
5. Run a harmless Studio probe through `execute_luau`.
6. Only after those pass should the agent begin production Thrixel generation.

If Studio MCP is unavailable, stop the Roblox path before asset spend and explain the missing
setup. Do not silently downgrade to a manual Studio workflow and do not report Roblox support as
complete.

Roblox Studio itself is a Windows/macOS GUI application. WSL may host the coding agent, mesh
validation, and Rojo, but Studio must run on the Windows host. Native Linux alone cannot satisfy
the Studio verification gate.

## Project contract

Start from [`roblox/templates`](roblox/templates):

```text
game/
├── rokit.toml
├── default.project.json
├── studio-sync.project.json
├── assets.manifest.json
├── assets/
│   ├── source/
│   └── reports/
├── src/
│   ├── assets/
│   ├── client/
│   ├── server/
│   ├── shared/
│   └── verification/
└── captures/
```

`default.project.json` can build a place from source. `studio-sync.project.json` deliberately does
not own all of Workspace; live Rojo sync must not erase imported production models.

## Asset manifest is the reproducibility spine

Create `assets.manifest.json` before the first import. Each production asset records:

- Thrixel submission/project identity;
- exact source path and SHA-256;
- target height in studs;
- orientation correction;
- groups that must move independently;
- groups that need separate appearance/material treatment;
- collision policy;
- Roblox Model asset ID when uploaded;
- resolved child MeshPart IDs after Studio inspection;
- explicit state (`prepared`, `uploaded`, `imported`, `verified`, or a failure state).

Never replace a failed or moderation-pending asset with an unrelated public model and keep the
manifest marked verified.

## Thrixel preparation loop

Use the shared skill and the required Thrixel MCP lifecycle, including
`thrixel_account_status`, `thrixel_start_project`, `thrixel_inspect_model`,
`thrixel_group_parts`, and `thrixel_download`. Use the live account-wide concurrency cap from
`thrixel_account_status`; do not invent one.

### Preserve motion and material semantics

Inspect the real node names before grouping. Keep nodes separate for either reason:

- **motion** — wheels, rotors, doors, handles, lids, pointers, levers;
- **appearance** — glass, chrome, rubber, emissive panels, painted body, or any region needing a
  distinct Roblox appearance.

Use `keep_groups` for independently moving pieces so their pivots survive. A wheel merged into a
vehicle body cannot later rotate correctly around its own center without reconstructing the
hierarchy.

Roblox caps an individual imported mesh at 20,000 triangles. Aim below the hard cap (about 18k is a
useful working target) to leave repair/export headroom. Use the shared Thrixel triangle-reduction
path rather than hiding importer failures.

### Deterministic source

Prefer GLB when the current Roblox import route supports it because it is self-contained and keeps
hierarchy/PBR data together. FBX is an allowed fallback when the live Roblox import path behaves
better with it.

Store the exact download under `assets/source/`, hash it, and never overwrite a verified source
while leaving the old hash in the manifest.

### Preflight every source mesh

Run:

```sh
python skills/build-world/engines/roblox/tools/validate_mesh.py \
  assets/source/<asset>.glb \
  --json assets/reports/<asset>.json
```

The validator checks per-mesh triangle budget, finite/non-zero bounds, watertightness, winding, and
enclosed volume. A failing report blocks import.

Regression coverage lives next to the validator in `test_validate_mesh.py`.

## Autonomous import boundary

[`roblox/MCP_AUTONOMY.md`](roblox/MCP_AUTONOMY.md) is authoritative for the full automation
contract.

### Preferred path: Open Cloud Model -> Studio MCP inspection

1. Upload the validated asset with credentials the user has already authorized.
2. Poll the Roblox operation to completion.
3. Record the returned **Model** asset ID. It is not a child MeshPart ID.
4. Use Studio MCP `execute_luau` to load the owned Model into a staging container.
5. Enumerate the actual descendant MeshParts, MeshIds, texture/SurfaceAppearance state, sizes,
   pivots, and names.
6. Compare the hierarchy with the expected moving/appearance groups in the manifest.
7. Reject missing/merged required groups instead of guessing.
8. Apply recorded scale/orientation/grounding corrections through Studio.
9. Tag imported roots `ThrixelAsset`; tag independently moving visual pieces
   `ThrixelMovingPart`.
10. Run runtime verification before marking the manifest entry `verified`.

This explicitly solves the Model-ID vs child-MeshId problem: the Model container returned by cloud
upload is never substituted where a real imported MeshPart ID is required.

### Fallback: Studio importer driven through MCP

If the cloud Model path is blocked by a documented Roblox limitation for the current account or
Studio build, the agent may operate the Studio importer through MCP screen/input tools. The
fallback is still autonomous.

Capture state before and after UI actions, type deterministic absolute file paths, verify the
resulting DataModel hierarchy after import, and abort on an unexpected modal. If the current MCP
cannot safely operate the native file chooser on that OS, fail closed and report the exact blocker.
A human-assisted import may help debugging but does not satisfy the autonomous completion gate.

## Scale, orientation, and pivots

Thrixel assets do not have one guaranteed forward-axis convention. Normalize each asset once:

1. inspect front/side/back through Studio captures;
2. compare against a known-height reference or default avatar;
3. choose a gameplay target height in studs;
4. scale uniformly;
5. ground by the bounding-box bottom rather than assuming the pivot is on the floor;
6. record rotation and target size in the manifest.

For wheels/rotors, a centered pivot is useful. Hinged doors should rotate around a dedicated hinge
pivot rather than the visual bounding-box center.

## Materials and textures

A Roblox MeshPart effectively carries one appearance. Do not expect Unity-style submaterial slots
to survive after unrelated regions are merged into one mesh.

- keep required appearance regions separate during grouping;
- preserve UVs;
- connect PBR maps with `SurfaceAppearance` at build time;
- inspect important assets once under neutral lighting and once in the game's hardest lighting;
- size textures to actual screen importance;
- treat moderation delay as an explicit state, not as proof that the reference is broken;
- never rely on a runtime gameplay script for one-time content-authoring fixes.

Use MCP instance inspection plus screenshots to verify the actual imported state rather than
assuming the source file guarantees what Studio created.

## Collision and moving parts

Visual detail and gameplay collision are different systems. Prefer simple collision proxies for
large props and moving pieces. Detailed decorative MeshParts normally should not participate in
expensive physics merely because they are visible.

| Role | Visual mesh collision | Preferred gameplay collision |
|---|---|---|
| tiny prop/pickup | off | none or simple trigger |
| building/large prop | selective | primitive Parts/simple hulls |
| moving visual group | off | simple proxy when needed |
| floor/wall boundary | off where possible | dedicated invisible Parts |

Server-authoritative gameplay remains required for rewards, damage, inventory, gates, and
world-changing interactions. Treat client RemoteEvent payloads as untrusted input.

## Rojo sync + Studio inspection

Rojo is the source-code path; Studio MCP is the live control/inspection path.

- `src/server/`: server-owned state and gameplay;
- `src/client/`: camera, input, HUD, presentation;
- `src/shared/`: constants and schemas;
- `src/verification/`: automated runtime checks.

Start `rojo serve`, connect Studio, and prove a known source edit reached Studio. A successful
`rojo build` or sourcemap alone does not prove live synchronization. After large syncs, inspect the
DataModel so imported assets were not deleted or unexpectedly reparented.

## Verification loop — every gate is required

### A. Static build

```sh
rojo build default.project.json -o build.rbxlx
```

The build and local tests must succeed.

### B. Source evidence

Every production manifest entry must have a validator report whose SHA-256 matches the exact source
file.

### C. Studio structure

Through Studio MCP, verify each expected asset exists exactly once, moving parts survived,
dimensions/pivots are plausible, orientation/grounding are deliberate, appearance is connected,
and collision proxies are intentional.

### D. Runtime self-test

Use [`roblox/tools/runtime-selftest.server.luau`](roblox/tools/runtime-selftest.server.luau). Start
Play through MCP, then read console output. Any runtime error or self-test failure blocks
completion.

### E. Autonomous gameplay

Drive a representative gameplay path with MCP input/navigation. Exercise at least one independently
moving imported part and verify that it moves around the intended pivot. Do not ask the user to
play the acceptance path for the agent.

### F. Visual verification

Capture and inspect at least:

- establishing/spawn view;
- close material/PBR view;
- core gameplay interaction;
- moving-part before/after;
- worst lighting/weather state;
- mobile/device-emulation view when available.

Saving screenshots is not enough: inspect them and fix visible failures.

### G. Performance

The shared hard floor remains at least 30 FPS. Prefer 60 FPS desktop when practical. Measure the
actual target scene; never estimate FPS from scene complexity.

First fixes when performance misses target: reduce visible/repeated unique parts, replace decorative
mesh collision with simple proxies, reduce shadow-casting local lights, lower oversized textures,
reuse imported assets, and use StreamingEnabled for worlds large enough to benefit—then retest.

## Failure states

Keep failures specific and bounded. Useful states include:

```text
studio_unavailable
mcp_unavailable
mcp_no_active_studio
rojo_not_connected
source_preflight_failed
open_cloud_upload_failed
moderation_pending
load_asset_permission_denied
model_has_no_meshparts
manifest_group_mismatch
runtime_selftest_failed
playtest_runtime_error
visual_verification_failed
```

Do not burn Thrixel Cubes or create duplicate uploads while waiting on moderation/auth.

## Definition of done

A fresh machine following the documented setup must let an agent, from one Roblox Build World
prompt:

1. connect to Thrixel and a live Roblox Studio MCP session;
2. generate/group/download/preflight assets;
3. import without a person operating Studio;
4. resolve and verify the actual imported hierarchy;
5. build/sync gameplay code;
6. start a real playtest through MCP;
7. drive representative gameplay and moving parts;
8. read runtime/self-test output;
9. capture and inspect visual evidence;
10. measure performance and fix/retest failures.

Do not report Roblox support complete if any normal completion step still says "ask the user to
import", "press Play", "check Output", or "take a screenshot".