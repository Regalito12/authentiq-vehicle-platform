import copy
import json
from pathlib import Path


SPEC = Path(__file__).parent / "generated" / "porsche-911-gt3.sculpt-spec.json"
ANALYSIS = Path(__file__).parent / "porsche-911-gt3-reference-analysis.md"


def rgba(hex_color, alpha=1.0):
    value = hex_color.lstrip("#")
    if len(value) == 3:
        value = "".join(char * 2 for char in value)
    red, green, blue = (int(value[index:index + 2], 16) for index in (0, 2, 4))
    return f"rgba({red}, {green}, {blue}, {alpha})"


def recipe(dominant, secondary, material_class):
    return {
        "dominantAlbedo": rgba(dominant),
        "secondaryAlbedo": rgba(secondary),
        "materialClass": material_class,
        "materialClassConfidence": 0.86,
        "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": rgba(dominant)}, {"position": 1, "color": rgba(secondary)}]},
        "evidenceRefs": ["full-object"],
    }


def attachment(parent, socket):
    return {
        "parentId": parent,
        "parentSocket": socket,
        "localStart": [0.0, 0.0, 0.0],
        "localEnd": [0.08, 0.0, 0.0],
        "contactType": "overlap",
        "overlap": 0.04,
        "gapTolerance": 0.01,
        "evidenceRefs": ["full-object"],
    }


def component(template, *, identifier, name, level, role, primitive, material, dimensions, parent=None, socket="body-surface", features=None, position=None, action_role="static"):
    item = copy.deepcopy(template)
    item.update({
        "id": identifier,
        "name": name,
        "level": level,
        "role": role,
        "importance": 0.9 if level == "macro" else 0.72 if level == "meso" else 0.55,
        "confidence": 0.82 if level != "micro" else 0.68,
        "primitive": primitive,
        "topologyClass": "assembled-solid",
        "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.",
        "material": material,
        "materialLayers": [material],
        "dimensions": {"width": dimensions[0], "height": dimensions[1], "depth": dimensions[2], "units": "relative", "confidence": 0.78},
        "transform": {"position": position or [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]},
        "localFeatures": features or [],
        "details": features or [],
        "evidenceRefs": ["full-object"],
        "fidelityTier": "form-refinement" if level == "macro" else "material-pass" if level == "meso" else "surface-pass",
        "colorMaterialRecipe": recipe("#f1f0eb", "#181b1d", "plastic"),
        "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."},
    })
    item["actionProfile"] = copy.deepcopy(template.get("actionProfile", {}))
    item["actionProfile"]["animationRole"] = action_role
    if parent:
        item["parent"] = parent
        item["attachment"] = attachment(parent, socket)
    else:
        item["parent"] = None
        item["attachment"] = None
    if position:
        item["actionProfile"]["pivot"] = {"mode": "local", "localPosition": position, "axis": [0, 1, 0], "confidence": 0.72}
    return item


def material(template, identifier, name, base_color, secondary, roughness, metalness, local_overrides):
    item = copy.deepcopy(template)
    item.update({
        "id": identifier,
        "name": name,
        "baseColor": base_color,
        "color": base_color,
        "albedo": {"dominant": base_color, "secondary": [secondary], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."},
        "roughness": {"base": roughness, "variation": 0.12, "map": f"procedural/{identifier}-roughness"},
        "metalness": {"base": metalness, "variation": 0.06},
        "normal": {"pattern": f"procedural/{identifier}-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"},
        "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0},
        "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."},
        "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []},
        "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"},
        "localOverrides": local_overrides,
        "qualityTier": "utility",
        "textureResolution": 512,
        "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}],
    })
    return item


payload = json.loads(SPEC.read_text(encoding="utf-8"))
template_component = payload["componentTree"][0]
template_material = payload["materials"][0]

assessment = payload["preSpecAssessment"]
assessment["objectClass"] = {
    "primaryType": "performance coupe",
    "primaryDomain": "object",
    "formLanguage": ["hard-surface", "mechanical", "organic aerodynamic curves"],
    "structureKind": ["compound object", "layered shell", "repeated modules"],
    "motionPotential": ["whole-object transform", "articulated wheel rotation"],
    "materialFamilies": ["plastic", "glass", "rubber", "metal"],
    "notes": "Procedural showroom reconstruction from a conditional single side reference.",
}
assessment["complexity"]["scores"] = {"silhouetteComplexity": 3, "componentCount": 3, "hierarchyDepth": 2, "repetitionDensity": 2, "materialLayerCount": 3, "localDetailDensity": 2, "occlusionRisk": 3, "actionReadinessNeed": 1}
assessment["estimatedCounts"] = {"macroComponents": 5, "mesoComponents": 8, "microFeatureGroups": 7, "materialLayers": 6, "repetitionSystems": 1}
assessment["unknownsToResolveBeforeImplementation"] = []
assessment["detailInventory"] = {
    "scanMethod": "component-zones",
    "targetMinDetails": 10,
    "details": [
        {"id": "rear-wing", "kind": "contour", "mapsTo": {"ref": "rear-wing/rear-wing"}, "evidenceRefs": ["full-object"]},
        {"id": "green-wheel-finish", "kind": "gloss", "mapsTo": {"ref": "wheel-front/green-wheel-finish"}, "evidenceRefs": ["full-object"]},
        {"id": "side-stripe", "kind": "linework", "mapsTo": {"ref": "side-stripe/side-stripe"}, "evidenceRefs": ["full-object"]},
        {"id": "side-intake", "kind": "hole", "mapsTo": {"ref": "side-intake/side-intake"}, "evidenceRefs": ["full-object"]},
        {"id": "hood-vents", "kind": "groove", "mapsTo": {"ref": "hood-vents/hood-vents"}, "evidenceRefs": ["full-object"]},
        {"id": "headlamp-contour", "kind": "contour", "mapsTo": {"ref": "headlamp/headlamp-contour"}, "evidenceRefs": ["full-object"]},
        {"id": "wheel-spokes", "kind": "ridge", "mapsTo": {"ref": "wheel-spokes/wheel-spokes"}, "evidenceRefs": ["full-object"]},
        {"id": "brake-discs", "kind": "contour", "mapsTo": {"ref": "front-brake/brake-discs"}, "evidenceRefs": ["full-object"]},
        {"id": "aero-splitter", "kind": "contour", "mapsTo": {"ref": "front-aero/aero-splitter"}, "evidenceRefs": ["full-object"]},
        {"id": "glass-cabin", "kind": "gloss", "mapsTo": {"ref": "cabin/glass-cabin"}, "evidenceRefs": ["full-object"]},
    ],
}

body_recipe = recipe("#f1f0eb", "#d3d5d6", "plastic")
glass_recipe = recipe("#1a2529", "#5c767b", "glass")
black_recipe = recipe("#111416", "#2e3436", "plastic")
green_recipe = recipe("#05b866", "#064b2f", "metal")
rubber_recipe = recipe("#0b0d0e", "#24292a", "rubber")

components = [
    component(template_component, identifier="body-shell", name="Continuous body shell", level="macro", role="body", primitive="box", material="body-paint", dimensions=(2.8, 0.78, 1.08), features=["low-roofline", "front-overhang", "rear-haunches"]),
    component(template_component, identifier="cabin", name="Glazed cabin and roof", level="macro", role="cabin", primitive="box", material="glass", dimensions=(1.38, 0.52, 0.92), parent="body-shell", socket="roof-seat", features=["dark-glazing", "sloped-windscreen", "side-window"]),
    component(template_component, identifier="front-fascia", name="Front fascia and bumper", level="macro", role="aero", primitive="box", material="black-aero", dimensions=(0.78, 0.34, 0.9), parent="body-shell", socket="front-bumper", position=[-1.18, -0.08, 0], features=["low-splitter", "bumper-openings"]),
    component(template_component, identifier="rear-wing", name="Large rear wing", level="macro", role="wing", primitive="extrude", material="black-aero", dimensions=(1.16, 0.18, 0.16), parent="body-shell", socket="rear-deck", position=[0.92, 0.58, 0], features=["wing-plane", "two-supports"]),
    component(template_component, identifier="wheel-front", name="Front wheel assembly", level="macro", role="wheel", primitive="torus", material="green-metal", dimensions=(0.56, 0.56, 0.24), parent="body-shell", socket="front-wheel-well", position=[-0.78, -0.44, 0.48], action_role="articulated", features=["green-rim", "black-tire"]),
    component(template_component, identifier="wheel-rear", name="Rear wheel assembly", level="macro", role="wheel", primitive="torus", material="green-metal", dimensions=(0.62, 0.62, 0.25), parent="body-shell", socket="rear-wheel-well", position=[0.82, -0.44, 0.48], action_role="articulated", features=["green-rim", "black-tire"]),
    component(template_component, identifier="hood-vents", name="Hood vent cluster", level="meso", role="vent", primitive="box", material="black-aero", dimensions=(0.48, 0.06, 0.32), parent="body-shell", socket="hood-surface", position=[-0.6, 0.32, 0], features=["paired-vents"]),
    component(template_component, identifier="side-intake", name="Recessed side intake", level="meso", role="intake", primitive="box", material="black-aero", dimensions=(0.36, 0.3, 0.22), parent="body-shell", socket="rear-quarter", position=[0.42, 0.0, 0.52], features=["recessed-opening"]),
    component(template_component, identifier="headlamp", name="Headlamp housing", level="meso", role="lamp", primitive="ellipsoid", material="glass", dimensions=(0.36, 0.18, 0.24), parent="front-fascia", socket="lamp-seat", position=[-0.24, 0.12, 0.44], features=["sloped-lamp"]),
    component(template_component, identifier="front-brake", name="Front brake hardware", level="meso", role="brake", primitive="cylinder", material="brake-metal", dimensions=(0.34, 0.08, 0.34), parent="wheel-front", socket="hub-center", position=[0, 0, 0], features=["disc", "caliper"]),
    component(template_component, identifier="rear-brake", name="Rear brake hardware", level="meso", role="brake", primitive="cylinder", material="brake-metal", dimensions=(0.38, 0.08, 0.38), parent="wheel-rear", socket="hub-center", position=[0, 0, 0], features=["disc", "caliper"]),
    component(template_component, identifier="side-stripe", name="Green side graphic", level="meso", role="decal", primitive="extrude", material="accent-graphic", dimensions=(1.42, 0.02, 0.12), parent="body-shell", socket="door-side", position=[0.08, -0.16, 0.55], features=["green-stripe", "gt3rs-lettering", "side-stripe"]),
    component(template_component, identifier="side-mirror", name="Aerodynamic side mirror", level="meso", role="mirror", primitive="ellipsoid", material="body-paint", dimensions=(0.24, 0.16, 0.18), parent="cabin", socket="mirror-mount", position=[-0.3, -0.04, 0.42], features=["mirror-shell"]),
    component(template_component, identifier="rear-light", name="Rear light bar", level="meso", role="lamp", primitive="box", material="accent-graphic", dimensions=(0.48, 0.08, 0.06), parent="body-shell", socket="rear-lamp-seat", position=[1.24, 0.1, 0], features=["rear-light-bar"]),
    component(template_component, identifier="front-aero", name="Front splitter", level="micro", role="aero", primitive="box", material="black-aero", dimensions=(0.62, 0.06, 0.58), parent="front-fascia", socket="lower-edge", position=[-0.18, -0.24, 0], features=["splitter-lip"]),
    component(template_component, identifier="wheel-spokes", name="Front and rear spoke rhythm", level="micro", role="wheel-spokes", primitive="instanced-cluster", material="green-metal", dimensions=(0.38, 0.04, 0.38), parent="wheel-front", socket="rim-center", position=[0, 0, 0], features=["radial-spokes"]),
    component(template_component, identifier="wing-supports", name="Rear wing supports", level="micro", role="wing-support", primitive="cylinder", material="black-aero", dimensions=(0.08, 0.44, 0.08), parent="rear-wing", socket="wing-underface", position=[0, -0.2, 0], features=["paired-supports"]),
    component(template_component, identifier="lamp-internals", name="Headlamp internal accents", level="micro", role="lamp-detail", primitive="cylinder", material="brake-metal", dimensions=(0.14, 0.04, 0.14), parent="headlamp", socket="lamp-core", position=[0, 0, 0], features=["lamp-internal"]),
]
for item in components:
    if item["id"] in {"body-shell", "cabin", "front-fascia", "rear-wing", "front-aero", "side-intake", "hood-vents", "headlamp", "side-stripe"}:
        item["colorMaterialRecipe"] = body_recipe if item["material"] == "body-paint" else glass_recipe if item["material"] == "glass" else black_recipe
    elif item["material"] == "green-metal":
        item["colorMaterialRecipe"] = green_recipe
    elif item["material"] == "rubber":
        item["colorMaterialRecipe"] = rubber_recipe
    else:
        item["colorMaterialRecipe"] = black_recipe
    detail_ids = {
        "rear-wing": ["rear-wing"],
        "wheel-front": ["green-wheel-finish"],
        "side-stripe": ["side-stripe"],
        "side-intake": ["side-intake"],
        "hood-vents": ["hood-vents"],
        "headlamp": ["headlamp-contour"],
        "wheel-spokes": ["wheel-spokes"],
        "front-brake": ["brake-discs"],
        "front-aero": ["aero-splitter"],
        "cabin": ["glass-cabin"],
    }
    item["localFeatures"] = list(dict.fromkeys(item.get("localFeatures", []) + detail_ids.get(item["id"], [])))

payload["componentTree"] = components
side_intake = next(item for item in components if item["id"] == "side-intake")
side_intake["topologyClass"] = "implicit"
side_intake["topologyRationale"] = "The visible side intake is a recessed cavity, so the volume is carved with an SDF subtract operation rather than represented as a convex patch."
side_intake["geometryDescriptor"]["sdf"] = {
    "primitives": [{"id": "intake-volume", "type": "box", "size": [0.42, 0.3, 0.24]}, {"id": "intake-cutout", "type": "box", "size": [0.34, 0.24, 0.18]}],
    "operations": [{"id": "intake-cavity", "type": "subtract", "left": "intake-volume", "right": "intake-cutout"}],
    "resolution": 16,
}
payload["materials"] = [
    material(template_material, "body-paint", "Gloss white body paint", "#f1f0eb", "#d3d5d6", 0.22, 0.0, [{"id": "clearcoat", "region": "outer-shell", "roughness": 0.16, "notes": "Broad showroom reflections on the visible body shell."}]),
    material(template_material, "black-aero", "Satin black aero", "#111416", "#2e3436", 0.48, 0.05, [{"id": "recessed-cavity", "region": "vents-and-intakes", "roughness": 0.62, "notes": "Darken cavities without erasing their geometry."}]),
    material(template_material, "green-metal", "Green metallic wheel finish", "#05b866", "#064b2f", 0.28, 0.78, [{"id": "wheel-edge-highlight", "region": "wheel-rim", "roughness": 0.18, "notes": "Keep the wheel color vivid while preserving metal response."}]),
    material(template_material, "tire-rubber", "Performance tire rubber", "#0b0d0e", "#24292a", 0.82, 0.0, [{"id": "tread-relief", "region": "tire", "roughness": 0.9, "notes": "Low-frequency tread suggestion; do not claim tire exactness."}]),
    material(template_material, "glass", "Dark automotive glass", "#1a2529", "#5c767b", 0.18, 0.0, [{"id": "glass-reflection", "region": "cabin", "roughness": 0.12, "notes": "Opaque approximation for the visible glazing."}]),
    material(template_material, "brake-metal", "Dark brake hardware", "#3c4243", "#aeb6b5", 0.34, 0.82, [{"id": "disc-response", "region": "brake-disc", "roughness": 0.42, "notes": "Contrast hardware inside the wheel openings."}]),
    material(template_material, "accent-graphic", "Green body graphic", "#05b866", "#064b2f", 0.34, 0.0, [{"id": "graphic-edge", "region": "side-stripe", "roughness": 0.28, "notes": "Linework remains a separate visible component."}]),
]
payload["repetitionSystems"] = [{"id": "wheel-spoke-radial", "name": "Radial wheel spokes", "componentRefs": ["wheel-spokes"], "realization": "instanced-geometry", "geometry": {"basePrimitive": "cylinder", "count": 10, "distribution": "radial", "axis": "wheel-hub"}, "buildsGeometry": True, "notes": "Approximate spoke rhythm inferred from the visible wheel."}]
payload["featureReviewTargets"] = [
    {"id": "vehicle-silhouette", "name": "Low coupe silhouette", "tier": "critical", "passIds": ["blockout", "form-refinement"], "componentRefs": ["body-shell", "cabin"], "evidenceRefs": ["full-object"], "minimumScore": 0.7, "mustPass": True},
    {"id": "rear-wing", "name": "Rear wing and supports", "tier": "critical", "passIds": ["structural-pass", "form-refinement"], "componentRefs": ["rear-wing", "wing-supports"], "evidenceRefs": ["full-object"], "minimumScore": 0.68, "mustPass": True},
    {"id": "wheel-rhythm", "name": "Green wheel rhythm and brakes", "tier": "important", "passIds": ["structural-pass", "material-pass"], "componentRefs": ["wheel-front", "wheel-rear", "wheel-spokes", "front-brake"], "evidenceRefs": ["full-object"], "minimumScore": 0.62},
    {"id": "aero-intake", "name": "Side intake and black aero", "tier": "important", "passIds": ["form-refinement", "material-pass"], "componentRefs": ["front-fascia", "side-intake", "front-aero"], "evidenceRefs": ["full-object"], "minimumScore": 0.62},
    {"id": "green-graphic", "name": "Green side graphic", "tier": "detail", "passIds": ["material-pass", "surface-pass"], "componentRefs": ["side-stripe"], "evidenceRefs": ["full-object"], "minimumScore": 0.55},
]
payload["lookDevTargets"] = {
    "qualityPriority": "runtime-first",
    "materialPass": {"minimumTextureResolution": 512, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "referencePbrExtraction": {"requiredWhenSourceImagePresent": False, "targetThreshold": 0.7}, "limitation": "Procedural materials are used because the source is a single watermarked image with baked lighting."},
    "lightingPass": {"key": "large softbox key above front quarter", "fill": "cool low-intensity fill from camera side", "rim": "narrow rim along roof and rear wing", "toneMapping": "ACES Filmic", "exposure": 1.0, "contactShadow": "soft ground contact under tires and splitter"},
}
payload["lightingFromPhoto"] = ["large softbox key from upper front quarter", "cool ambient fill in the cabin and wheel wells", "rim highlight along roof, hood and rear wing", "ACES Filmic tone mapping with exposure 1.0", "soft contact shadow beneath tires and lower aero"]
payload["proceduralStrategy"] = ["approximate-vehicle-showroom", "separate hard-surface primitives with overlapping seams", "procedural PBR approximation", "hidden surfaces are inferred and must not be marketed as exact", "turntable-ready Three.js group with wheel rotation anchor"]
payload["assumptions"] = ["Relative units are used because no factory dimensions were supplied.", "Opposite-side and underbody geometry are inferred from bilateral vehicle symmetry.", "The source image is a development reference only; confirm usage rights before publishing any derived texture or image."]
payload["visualEvidence"] = [{"id": "reference-analysis", "path": str(ANALYSIS), "notes": "Conditional single-view reference; hidden sides and underbody are approximate."}]
# The first web demo is a consolidated showroom preview, not the final staged
# sculpt review. Include the authored component tree so the browser never
# exposes the generator's intentionally crude root-only blockout as a cube.
all_component_refs = ["root"] + [item["id"] for item in components]
for build_pass in payload.get("buildPasses", []):
    if build_pass.get("id") == "blockout":
        build_pass["componentRefs"] = all_component_refs
        build_pass["notes"] = "Consolidated local showroom preview; subsequent passes remain available for fidelity review."
payload["sourceImage"] = str(Path(payload["sourceImage"]).resolve())

SPEC.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(SPEC)
