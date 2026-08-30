# Roblox pitfalls

Read this before the first import. These are failure modes that can make a build look fine in
source control while the actual place is broken.

## 1. Treating a Model asset ID as a MeshPart MeshId

Open Cloud can create a Model from FBX/glTF/GLB. That returned Model ID is a container asset. Do
not assume it is interchangeable with every child MeshPart's `MeshId`. Record the Model ID as a
Model ID, then inspect the inserted result in Studio before recording child mesh references.

## 2. Trusting the filename instead of the payload

Conversion/upload tooling can fail while leaving a file with the requested extension. Hash and
validate the file before import. A `.glb` name does not prove the bytes are a usable glTF binary.

## 3. Merging appearance groups too aggressively

One Roblox mesh object cannot recover arbitrary Unity-style submaterial semantics after the fact.
If glass, chrome, emissive pieces, rubber, painted body, etc. need distinct appearances, keep them
separate during Thrixel grouping.

## 4. Forgetting moving pivots

Grouping a door, wheel or rotor into the body destroys the independent pivot you need later. Keep
moving groups separate and verify the pivot before writing animation. For hinge motion, a parent
pivot object is usually more predictable than rotating a visual mesh around its center.

## 5. Using detailed visual meshes as physics

High-detail collision is expensive and often feels worse. Decorative MeshParts should usually have
collision disabled while invisible primitive Parts or simple hulls define gameplay space.

## 6. "Fixing" bad import with arbitrary scale/rotation scripts

If every clone gets a different guessed rotation or scale, the pipeline is not deterministic.
Correct orientation and target height once, store them in the asset manifest, and apply the same
transform to every instance.

## 7. Calling a Rojo build a playtest

`rojo build` proves the source tree can serialize. It does not prove imported meshes exist,
textures survived moderation, collisions feel right, remotes are secure, UI fits mobile, or the
camera can navigate the scene. Play mode is a separate gate.

## 8. Re-importing because the importer row still looks active

Before clicking Import again, check Explorer and Workspace. Duplicate assets in the same location
cause z-fighting, doubled draw cost and confusing collision bugs.

## 9. Hiding moderation/permission failures behind substitute assets

A blank or unavailable cloud asset can mean moderation pending, missing experience permission, or
a broken reference. Preserve that state explicitly. Do not swap in a random public mesh and mark
the Thrixel pipeline verified.

## 10. Shipping one lighting setup only

PBR mistakes are easiest to miss when art lighting hides them. Inspect important assets once under
neutral white light and again under the game's hardest lighting/weather state.

## 11. Oversized textures everywhere

Roblox supports large texture uploads, but memory pressure still matters. Size maps according to
screen importance. Small props rarely justify the same map size as a hero asset.

## 12. Client-authoritative gameplay

A beautiful prototype can still be structurally wrong. Rewards, damage, inventory, unlocks and
world-changing actions should be validated on the server. Treat client RemoteEvent data as
untrusted input.

## 13. WSL/Linux confusion

Rojo and mesh validation can run under Linux/WSL, but Roblox Studio itself is a GUI boundary on
Windows/macOS. If WSL networking blocks Studio from reaching Rojo, move the checkout to the Windows
filesystem or expose the Rojo server deliberately; do not invent a native-Linux Studio step.

## 14. Optimizing before measuring

When performance is poor, collect evidence first: visible part count, MeshPart count, local lights,
render/physics timings, and actual FPS in the target device preset. Then simplify the bottleneck.
Deleting visual quality blindly is not an optimization strategy.