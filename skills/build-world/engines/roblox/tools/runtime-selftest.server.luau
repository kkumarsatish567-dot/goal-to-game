local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local errors = {}
local warnings = {}
local checkedAssets = 0
local checkedMeshes = 0

local function push(list, message)
	table.insert(list, message)
end

local function finiteVector3(v)
	return v.X == v.X and v.Y == v.Y and v.Z == v.Z
		and math.abs(v.X) < math.huge
		and math.abs(v.Y) < math.huge
		and math.abs(v.Z) < math.huge
end

for _, root in CollectionService:GetTagged("ThrixelAsset") do
	checkedAssets += 1
	local rootMeshes = 0

	for _, descendant in root:GetDescendants() do
		if descendant:IsA("MeshPart") then
			checkedMeshes += 1
			rootMeshes += 1

			if descendant.MeshId == "" then
				push(errors, string.format("%s/%s has an empty MeshId", root:GetFullName(), descendant.Name))
			end

			if not finiteVector3(descendant.Size) or descendant.Size.X <= 0 or descendant.Size.Y <= 0 or descendant.Size.Z <= 0 then
				push(errors, string.format("%s/%s has invalid bounds", root:GetFullName(), descendant.Name))
			end

			if not descendant.Anchored and not CollectionService:HasTag(descendant, "ThrixelMovingPart") then
				push(warnings, string.format("%s/%s is unanchored but not tagged ThrixelMovingPart", root:GetFullName(), descendant.Name))
			end

			if descendant.CanCollide and descendant.CollisionFidelity == Enum.CollisionFidelity.PreciseConvexDecomposition then
				push(warnings, string.format("%s/%s uses PreciseConvexDecomposition while collidable", root:GetFullName(), descendant.Name))
			end
		end
	end

	if rootMeshes == 0 then
		push(errors, string.format("%s is tagged ThrixelAsset but contains no MeshPart", root:GetFullName()))
	end

	if root:IsA("Model") then
		local _, size = root:GetBoundingBox()
		if not finiteVector3(size) or size.X <= 0 or size.Y <= 0 or size.Z <= 0 then
			push(errors, string.format("%s has invalid model bounds", root:GetFullName()))
		end
	end
end

if checkedAssets == 0 then
	push(errors, "no instances tagged ThrixelAsset were found")
end

local report = {
	ok = #errors == 0,
	checkedAssets = checkedAssets,
	checkedMeshes = checkedMeshes,
	errors = errors,
	warnings = warnings,
}

local encoded = HttpService:JSONEncode(report)
print("[BUILD_WORLD_ROBLOX_REPORT] " .. encoded)

local value = ReplicatedStorage:FindFirstChild("BuildWorldRobloxReport")
if not value then
	value = Instance.new("StringValue")
	value.Name = "BuildWorldRobloxReport"
	value.Parent = ReplicatedStorage
end
value.Value = encoded

if #errors > 0 then
	warn(string.format("Build World Roblox self-test failed with %d error(s)", #errors))
else
	print(string.format("Build World Roblox self-test passed (%d assets, %d meshes)", checkedAssets, checkedMeshes))
end
