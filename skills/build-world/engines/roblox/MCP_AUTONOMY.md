# Roblox Studio MCP autonomy contract

This file defines the no-human-in-the-loop Studio path for the Roblox engine.

The Roblox target is not complete when an agent has prepared files and asks a person to import, click Play, inspect Output, or take screenshots. The agent must drive those Studio steps itself through Roblox Studio's built-in MCP server.

Reference: https://create.roblox.com/docs/studio/mcp

## Hard gate

Before generating or importing production assets, discover the Roblox Studio MCP tool surface. The expected modern tool set includes:

- `get_studio_state`
- `list_roblox_studios`
- `set_active_studio`
- `execute_luau`
- `search_game_tree`
- `inspect_instance`
- `start_stop_play`
- `get_console_output`
- `screen_capture`
- `user_keyboard_input`
- `user_mouse_input`

Tool names can change between Studio releases. Use the live MCP tool list as the source of truth, not a memorized list.

If the agent cannot connect to an active Studio instance, stop the Roblox build before spending Thrixel Cubes and tell the user exactly what is missing. Do not silently downgrade to a manual Studio workflow and do not call Roblox support complete.

A successful MCP handshake alone is insufficient. Call `get_studio_state` (or the current equivalent) and confirm that an actual Studio instance is attached.

## Setup checks

Roblox Studio's built-in MCP server is enabled from Studio Assistant settings. On supported clients, Studio offers quick-connect. The fallback stdio launchers are platform-specific and should be taken from the live Roblox docs.

After configuration:

1. discover MCP tools;
2. call `list_roblox_studios` when more than one Studio window may exist;
3. use `set_active_studio` explicitly if selection is ambiguous;
4. call `get_studio_state` and require an attached Edit DataModel;
5. use `execute_luau` for a harmless probe such as returning the place name;
6. only then start the Thrixel asset-generation loop.

Record the Studio version and observed MCP tool names in the build evidence.

## Autonomous asset ingest

The preferred path avoids a person clicking the 3D Importer.

### Path A — Open Cloud Model + Studio MCP enumeration

1. Prepare and preflight the grouped Thrixel GLB/FBX as described in `../roblox.md`.
2. Upload through Roblox Open Cloud using credentials that the user has already configured. Never print or commit secrets.
3. Poll the operation to completion. The returned ID is a Model asset ID, not a child `MeshPart.MeshId`.
4. Pass the completed Model asset ID into Studio through `execute_luau`.
5. In Studio, call `InsertService:LoadAsset(modelAssetId)` from the MCP execution context.
6. Parent the returned container into a staging folder in `Workspace`.
7. Walk all descendants and enumerate every `MeshPart`, its actual `MeshId`, texture/`SurfaceAppearance` data, size, pivot, and name.
8. Compare those descendants with the expected grouped-part names in `assets.manifest.json`.
9. Reject the import if required moving groups or appearance groups disappeared or were merged unexpectedly.
10. Apply recorded scale/orientation/grounding corrections through `execute_luau` and tag the imported root `ThrixelAsset`; tag independently moving visual pieces `ThrixelMovingPart`.
11. Run the runtime self-test before changing the manifest state to `verified`.

Do not substitute the Model container ID where a child mesh ID is required. The purpose of the Studio MCP step is to resolve and verify the actual imported DataModel.

Treat permissions, moderation, and an empty descendant set as explicit failed states. Do not loop indefinitely.

### Path B — automated Studio Importer fallback

Use this only when Path A is blocked by a documented Roblox limitation for the current account or Studio build.

A fallback is still autonomous. The agent may use `screen_capture`, `user_keyboard_input`, and `user_mouse_input` to operate Studio's importer and then use `execute_luau`/`search_game_tree` to verify the result.

Rules:

- capture the viewport before and after each state-changing UI action;
- type the absolute source-file path rather than relying on recent-file state;
- verify the imported hierarchy in the DataModel, not only visually;
- compare imported names against the manifest;
- abort on an unexpected modal instead of clicking through blindly;
- never ask the user to perform the import as the normal fallback.

If the current Studio MCP cannot safely interact with the native file chooser on the target OS, fail closed and report that exact blocker. A human import can be useful for debugging, but evidence from a human-assisted run does not satisfy the autonomous completion gate.

## Autonomous build and sync

Rojo remains the source-control path for scripts. Studio MCP is the control/inspection path.

1. Start `rojo serve` for the project.
2. Confirm the Rojo endpoint is reachable.
3. Confirm through `execute_luau` or `script_read` that a known source edit reached Studio.
4. Do not assume `rojo sourcemap` means Studio is synchronized; a running server plus connected Studio plugin is the real path.
5. Use MCP inspection after each large sync to catch missing or unexpectedly overwritten instances.

Imported production assets should live outside any Rojo mapping that would delete and recreate them on sync unless the asset can be represented safely as source-controlled Roblox model data.

## Autonomous verification loop

The agent owns the whole verify/fix/retest loop.

### Static gate

Run the project build and local validators. No Studio result can waive a failing static gate.

### Studio structure gate

Use `search_game_tree`, `inspect_instance`, and/or `execute_luau` to verify:

- all manifest assets exist exactly once;
- required moving parts survived grouping/import;
- asset dimensions are non-zero and plausible;
- imported roots are grounded and oriented deliberately;
- visual meshes do not accidentally carry expensive gameplay collision;
- `SurfaceAppearance`/texture state matches the manifest;
- no placeholder geometry remains where a required Thrixel asset should be.

### Runtime gate

1. call `start_stop_play` to enter Play mode;
2. wait for the game to initialize;
3. call `get_console_output` and reject any runtime error or self-test failure;
4. drive at least one real gameplay path with `character_navigation`, `user_keyboard_input`, and/or `user_mouse_input`;
5. exercise the independently moving imported part and verify its pivot behavior;
6. inspect server/client state with `execute_luau` when a visual check alone is ambiguous;
7. stop play through MCP, never by asking the user to press Stop.

### Visual gate

Use `screen_capture` for a deterministic shot list:

- spawn / establishing view;
- close view of the highest-value imported asset;
- material/PBR view under neutral lighting;
- gameplay interaction view;
- moving-part before/after views;
- worst lighting/weather state;
- mobile/device-emulation view when available.

The agent must inspect the captures and fix visible failures. Merely saving screenshots is not verification.

For each final capture, store enough metadata to reproduce it: place version/commit, camera CFrame or named camera target, gameplay state, and capture purpose.

## Failure behavior

The workflow must distinguish these states instead of collapsing them into "import failed":

- `studio_unavailable`
- `mcp_unavailable`
- `mcp_no_active_studio`
- `rojo_not_connected`
- `source_preflight_failed`
- `open_cloud_upload_failed`
- `moderation_pending`
- `load_asset_permission_denied`
- `model_has_no_meshparts`
- `manifest_group_mismatch`
- `runtime_selftest_failed`
- `playtest_runtime_error`
- `visual_verification_failed`

Every retry needs a bounded reason. Do not burn Cubes or upload duplicate assets while waiting on moderation or auth.

## Evidence contract

A bounty-quality or release-quality Roblox run should preserve:

- exact source asset hashes and validator JSON;
- Thrixel submission/project IDs;
- Model asset ID plus resolved child MeshPart IDs;
- Studio version and observed MCP tool list;
- MCP connection/state probe evidence;
- runtime self-test output;
- console output for final playtests;
- deterministic screenshots;
- performance measurements;
- two complete gameplay-loop videos/public experiences when required by the submission.

Evidence must come from the actual run. Never fabricate screenshots, performance numbers, asset IDs, successful tool calls, or public experience URLs.

## Definition of autonomous done

Roblox support is autonomously done only when a fresh machine can follow the documented setup and an agent can, from one user game prompt:

1. connect to Thrixel and Roblox Studio;
2. generate/group/download and preflight assets;
3. import them without a person operating Studio;
4. resolve and verify the real imported hierarchy;
5. build/sync gameplay code;
6. start a real playtest;
7. drive gameplay and independently moving parts;
8. read runtime output;
9. capture and inspect visual evidence;
10. fix failures and rerun the loop.

If any normal step still says "ask the user to click/import/playtest/take a screenshot," the autonomy requirement is not met.