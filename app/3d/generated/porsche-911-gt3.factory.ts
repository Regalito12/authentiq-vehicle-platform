import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

type SdfVector = readonly [number, number, number];
type SdfTransform = { position?: SdfVector; translation?: SdfVector; rotation?: SdfVector; scale?: SdfVector };
type SdfPrimitive = {
  readonly id: string;
  readonly type: 'sphere' | 'capsule' | 'box' | 'cone' | 'ellipsoid';
  readonly center?: SdfVector;
  readonly radius?: number | SdfVector;
  readonly height?: number;
  readonly size?: SdfVector;
  readonly dimensions?: SdfVector;
  readonly radii?: SdfVector;
  readonly transform?: SdfTransform;
};
type SdfOperation = {
  readonly id?: string;
  readonly output?: string;
  readonly type: 'smooth-union' | 'subtract' | 'intersect';
  readonly left: string;
  readonly right: string;
  readonly radius?: number;
};
type SdfDescriptor = {
  readonly primitives: readonly SdfPrimitive[];
  readonly operations?: readonly SdfOperation[];
  readonly resolution: number;
  readonly bounds?: { readonly min: SdfVector; readonly max: SdfVector };
};
type SdfFunction = (point: THREE.Vector3) => number;

function sdfSphere(point: THREE.Vector3, radius: number): number {
  return point.length() - radius;
}

function sdfCapsule(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const y = Math.max(-halfHeight, Math.min(halfHeight, point.y));
  return point.distanceTo(new THREE.Vector3(0, y, 0)) - radius;
}

function sdfBox(point: THREE.Vector3, size: SdfVector): number {
  const q = new THREE.Vector3(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
    .sub(new THREE.Vector3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5));
  return q.clone().max(new THREE.Vector3()).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function sdfCone(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (point.y + halfHeight) / height);
  return Math.max(Math.hypot(point.x, point.z) - Math.max(0, taper), Math.abs(point.y) - halfHeight);
}

function sdfEllipsoid(point: THREE.Vector3, radii: SdfVector): number {
  const scaled = new THREE.Vector3(point.x / radii[0], point.y / radii[1], point.z / radii[2]);
  return (scaled.length() - 1) * Math.min(radii[0], radii[1], radii[2]);
}

function sdfRadii(primitive: SdfPrimitive): SdfVector {
  const radius = primitive.radius;
  if (primitive.radii) return primitive.radii;
  if (typeof radius === 'number') return [radius, radius, radius];
  return radius ?? [0.5, 0.5, 0.5];
}

function smin(left: number, right: number, radius: number): number {
  const blend = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - blend * blend * radius * 0.25;
}

function sdfLocalPoint(point: THREE.Vector3, primitive: SdfPrimitive): { point: THREE.Vector3; scale: number } {
  const transform = primitive.transform;
  const translation = transform?.position ?? transform?.translation ?? primitive.center ?? [0, 0, 0];
  const rotation = transform?.rotation ?? [0, 0, 0];
  const scale = transform?.scale ?? [1, 1, 1];
  const local = point.clone().sub(new THREE.Vector3(translation[0], translation[1], translation[2]));
  const inverseRotation = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .invert();
  local.applyQuaternion(inverseRotation);
  local.set(local.x / scale[0], local.y / scale[1], local.z / scale[2]);
  return { point: local, scale: Math.min(scale[0], scale[1], scale[2]) };
}

function sdfPrimitive(point: THREE.Vector3, primitive: SdfPrimitive): number {
  const local = sdfLocalPoint(point, primitive);
  let distance: number;
  switch (primitive.type) {
    case 'sphere':
      distance = sdfSphere(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5);
      break;
    case 'capsule':
      distance = sdfCapsule(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.25, primitive.height ?? 1);
      break;
    case 'box':
      distance = sdfBox(local.point, primitive.size ?? primitive.dimensions ?? [1, 1, 1]);
      break;
    case 'cone':
      distance = sdfCone(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5, primitive.height ?? 1);
      break;
    case 'ellipsoid':
      distance = sdfEllipsoid(local.point, sdfRadii(primitive));
      break;
  }
  return distance * local.scale;
}

function sdfSample(descriptor: SdfDescriptor): SdfFunction {
  const nodes = new Map<string, SdfFunction>();
  for (const primitive of descriptor.primitives) nodes.set(primitive.id, (point) => sdfPrimitive(point, primitive));
  let result = descriptor.primitives.length > 0 ? nodes.get(descriptor.primitives[0].id) : undefined;
  for (let index = 0; index < (descriptor.operations?.length ?? 0); index += 1) {
    const operation = descriptor.operations?.[index];
    if (!operation) continue;
    const left = nodes.get(operation.left);
    const right = nodes.get(operation.right);
    if (!left || !right) continue;
    let combined: SdfFunction;
    switch (operation.type) {
      case 'smooth-union':
        combined = (point) => smin(left(point), right(point), operation.radius ?? 0.1);
        break;
      case 'subtract':
        combined = (point) => Math.max(left(point), -right(point));
        break;
      case 'intersect':
        combined = (point) => Math.max(left(point), right(point));
        break;
    }
    nodes.set(operation.id ?? operation.output ?? `operation-${index}`, combined);
    result = combined;
  }
  return result ?? (() => Infinity);
}

function polygonizeSdf(descriptor: SdfDescriptor): THREE.BufferGeometry {
  const resolution = Math.max(4, Math.min(64, Math.floor(descriptor.resolution)));
  const defaultBounds: { readonly min: SdfVector; readonly max: SdfVector } = { min: [-2, -2, -2], max: [2, 2, 2] };
  const bounds = descriptor.bounds ?? defaultBounds;
  const min = new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]);
  const step = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / resolution,
    (bounds.max[1] - bounds.min[1]) / resolution,
    (bounds.max[2] - bounds.min[2]) / resolution,
  );
  const field = new Float32Array(resolution * resolution * resolution);
  const sample = sdfSample(descriptor);
  const indexAt = (x: number, y: number, z: number): number => (z * resolution + y) * resolution + x;
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        field[indexAt(x, y, z)] = sample(new THREE.Vector3(
          min.x + (x + 0.5) * step.x,
          min.y + (y + 0.5) * step.y,
          min.z + (z + 0.5) * step.z,
        ));
      }
    }
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const vertices = new Map<string, number>();
  const vertexAt = (x: number, y: number, z: number): number => {
    const key = `${x},${y},${z}`;
    const existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const vertex = positions.length / 3;
    positions.push(min.x + x * step.x, min.y + y * step.y, min.z + z * step.z);
    vertices.set(key, vertex);
    return vertex;
  };
  const addFace = (a: number, b: number, c: number, d: number): void => {
    indices.push(a, b, c, a, c, d);
  };
  const inside = (x: number, y: number, z: number): boolean => (
    x >= 0 && y >= 0 && z >= 0 && x < resolution && y < resolution && z < resolution && field[indexAt(x, y, z)] <= 0
  );
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        if (!inside(x, y, z)) continue;
        if (!inside(x - 1, y, z)) addFace(vertexAt(x, y, z), vertexAt(x, y, z + 1), vertexAt(x, y + 1, z + 1), vertexAt(x, y + 1, z));
        if (!inside(x + 1, y, z)) addFace(vertexAt(x + 1, y, z), vertexAt(x + 1, y + 1, z), vertexAt(x + 1, y + 1, z + 1), vertexAt(x + 1, y, z + 1));
        if (!inside(x, y - 1, z)) addFace(vertexAt(x, y, z), vertexAt(x + 1, y, z), vertexAt(x + 1, y, z + 1), vertexAt(x, y, z + 1));
        if (!inside(x, y + 1, z)) addFace(vertexAt(x, y + 1, z), vertexAt(x, y + 1, z + 1), vertexAt(x + 1, y + 1, z + 1), vertexAt(x + 1, y + 1, z));
        if (!inside(x, y, z - 1)) addFace(vertexAt(x, y, z), vertexAt(x, y + 1, z), vertexAt(x + 1, y + 1, z), vertexAt(x + 1, y, z));
        if (!inside(x, y, z + 1)) addFace(vertexAt(x, y, z + 1), vertexAt(x + 1, y, z + 1), vertexAt(x + 1, y + 1, z + 1), vertexAt(x, y + 1, z + 1));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const [red, green, blue] = hexToRgb(source);
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Porsche 911 GT3 RS showroom reconstruction
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createPorsche911GT3RSShowroomReconstructionModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Porsche 911 GT3 RS showroom reconstruction";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["body-paint"] = createSculptMaterial(
    "body-paint",
    {"id": "body-paint", "name": "Gloss white body paint", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#f1f0eb", "color": "#f1f0eb", "albedo": {"dominant": "#f1f0eb", "secondary": ["#d3d5d6"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.22, "variation": 0.12, "map": "procedural/body-paint-roughness"}, "metalness": {"base": 0.0, "variation": 0.06}, "normal": {"pattern": "procedural/body-paint-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "clearcoat", "region": "outer-shell", "roughness": 0.16, "notes": "Broad showroom reflections on the visible body shell."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"},
    options
  );
  materialMap["black-aero"] = createSculptMaterial(
    "black-aero",
    {"id": "black-aero", "name": "Satin black aero", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#111416", "color": "#111416", "albedo": {"dominant": "#111416", "secondary": ["#2e3436"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.48, "variation": 0.12, "map": "procedural/black-aero-roughness"}, "metalness": {"base": 0.05, "variation": 0.06}, "normal": {"pattern": "procedural/black-aero-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "recessed-cavity", "region": "vents-and-intakes", "roughness": 0.62, "notes": "Darken cavities without erasing their geometry."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"},
    options
  );
  materialMap["green-metal"] = createSculptMaterial(
    "green-metal",
    {"id": "green-metal", "name": "Green metallic wheel finish", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#05b866", "color": "#05b866", "albedo": {"dominant": "#05b866", "secondary": ["#064b2f"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.28, "variation": 0.12, "map": "procedural/green-metal-roughness"}, "metalness": {"base": 0.78, "variation": 0.06}, "normal": {"pattern": "procedural/green-metal-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "wheel-edge-highlight", "region": "wheel-rim", "roughness": 0.18, "notes": "Keep the wheel color vivid while preserving metal response."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"},
    options
  );
  materialMap["tire-rubber"] = createSculptMaterial(
    "tire-rubber",
    {"id": "tire-rubber", "name": "Performance tire rubber", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#0b0d0e", "color": "#0b0d0e", "albedo": {"dominant": "#0b0d0e", "secondary": ["#24292a"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.82, "variation": 0.12, "map": "procedural/tire-rubber-roughness"}, "metalness": {"base": 0.0, "variation": 0.06}, "normal": {"pattern": "procedural/tire-rubber-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "tread-relief", "region": "tire", "roughness": 0.9, "notes": "Low-frequency tread suggestion; do not claim tire exactness."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"},
    options
  );
  materialMap["glass"] = createSculptMaterial(
    "glass",
    {"id": "glass", "name": "Dark automotive glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#1a2529", "color": "#1a2529", "albedo": {"dominant": "#1a2529", "secondary": ["#5c767b"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.18, "variation": 0.12, "map": "procedural/glass-roughness"}, "metalness": {"base": 0.0, "variation": 0.06}, "normal": {"pattern": "procedural/glass-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "glass-reflection", "region": "cabin", "roughness": 0.12, "notes": "Opaque approximation for the visible glazing."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"},
    options
  );
  materialMap["brake-metal"] = createSculptMaterial(
    "brake-metal",
    {"id": "brake-metal", "name": "Dark brake hardware", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#3c4243", "color": "#3c4243", "albedo": {"dominant": "#3c4243", "secondary": ["#aeb6b5"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.34, "variation": 0.12, "map": "procedural/brake-metal-roughness"}, "metalness": {"base": 0.82, "variation": 0.06}, "normal": {"pattern": "procedural/brake-metal-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "disc-response", "region": "brake-disc", "roughness": 0.42, "notes": "Contrast hardware inside the wheel openings."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"},
    options
  );
  materialMap["accent-graphic"] = createSculptMaterial(
    "accent-graphic",
    {"id": "accent-graphic", "name": "Green body graphic", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#05b866", "color": "#05b866", "albedo": {"dominant": "#05b866", "secondary": ["#064b2f"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.34, "variation": 0.12, "map": "procedural/accent-graphic-roughness"}, "metalness": {"base": 0.0, "variation": 0.06}, "normal": {"pattern": "procedural/accent-graphic-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "graphic-edge", "region": "side-stripe", "roughness": 0.28, "notes": "Linework remains a separate visible component."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_body_shell_0 = null;
  const endpoint_body_shell_0 = makeAttachmentEndpoint(attachment_body_shell_0);
  const node_body_shell_0 = new THREE.Group();
  node_body_shell_0.name = "Continuous body shell__pivot";
  node_body_shell_0.scale.set(1, 1, 1);
  if (endpoint_body_shell_0) {
    node_body_shell_0.position.copy(endpoint_body_shell_0.start);
    node_body_shell_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_body_shell_0.position.set(0.0, 0.0, 0.0);
    node_body_shell_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_body_shell_0.userData.sculptComponent = {"id": "body-shell", "name": "Continuous body shell", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.8, "height": 0.78, "depth": 1.08, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body-paint", "materialLayers": ["body-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["low-roofline", "front-overhang", "rear-haunches"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["low-roofline", "front-overhang", "rear-haunches"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 240, 235, 1.0)", "secondaryAlbedo": "rgba(211, 213, 214, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(241, 240, 235, 1.0)"}, {"position": 1, "color": "rgba(211, 213, 214, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_body_shell_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_body_shell_0);
  nodes["body-shell"] = node_body_shell_0;
  const mesh_body_shell_0Geometry = endpoint_body_shell_0
    ? new THREE.CylinderGeometry(endpoint_body_shell_0.endRadius, endpoint_body_shell_0.baseRadius, endpoint_body_shell_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_body_shell_0) {
    mesh_body_shell_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_body_shell_0 = new THREE.Mesh(
    mesh_body_shell_0Geometry,
    materialMap["body-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_shell_0.name = "Continuous body shell";
  if (endpoint_body_shell_0) {
    mesh_body_shell_0.position.copy(endpoint_body_shell_0.midpoint);
    mesh_body_shell_0.quaternion.copy(endpoint_body_shell_0.quaternion);
  }
  mesh_body_shell_0.castShadow = options.castShadow ?? true;
  mesh_body_shell_0.receiveShadow = options.receiveShadow ?? true;
  mesh_body_shell_0.userData.sculptComponent = {"id": "body-shell", "name": "Continuous body shell", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.8, "height": 0.78, "depth": 1.08, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body-paint", "materialLayers": ["body-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["low-roofline", "front-overhang", "rear-haunches"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["low-roofline", "front-overhang", "rear-haunches"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 240, 235, 1.0)", "secondaryAlbedo": "rgba(211, 213, 214, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(241, 240, 235, 1.0)"}, {"position": 1, "color": "rgba(211, 213, 214, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_body_shell_0.add(mesh_body_shell_0);
  meshes["body-shell"] = mesh_body_shell_0;
  colliders["body-shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_body_shell_0);

  const attachment_cabin_1 = {"parentId": "body-shell", "parentSocket": "roof-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_cabin_1 = makeAttachmentEndpoint(attachment_cabin_1);
  const node_cabin_1 = new THREE.Group();
  node_cabin_1.name = "Glazed cabin and roof__pivot";
  node_cabin_1.scale.set(1, 1, 1);
  if (endpoint_cabin_1) {
    node_cabin_1.position.copy(endpoint_cabin_1.start);
    node_cabin_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cabin_1.position.set(0.0, 0.0, 0.0);
    node_cabin_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_cabin_1.userData.sculptComponent = {"id": "cabin", "name": "Glazed cabin and roof", "level": "macro", "role": "cabin", "importance": 0.9, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "roof-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.38, "height": 0.52, "depth": 0.92, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["dark-glazing", "sloped-windscreen", "side-window", "glass-cabin"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["dark-glazing", "sloped-windscreen", "side-window"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 37, 41, 1.0)", "secondaryAlbedo": "rgba(92, 118, 123, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(26, 37, 41, 1.0)"}, {"position": 1, "color": "rgba(92, 118, 123, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_cabin_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_cabin_1);
  nodes["cabin"] = node_cabin_1;
  const mesh_cabin_1Geometry = endpoint_cabin_1
    ? new THREE.CylinderGeometry(endpoint_cabin_1.endRadius, endpoint_cabin_1.baseRadius, endpoint_cabin_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_cabin_1) {
    mesh_cabin_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cabin_1 = new THREE.Mesh(
    mesh_cabin_1Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cabin_1.name = "Glazed cabin and roof";
  if (endpoint_cabin_1) {
    mesh_cabin_1.position.copy(endpoint_cabin_1.midpoint);
    mesh_cabin_1.quaternion.copy(endpoint_cabin_1.quaternion);
  }
  mesh_cabin_1.castShadow = options.castShadow ?? true;
  mesh_cabin_1.receiveShadow = options.receiveShadow ?? true;
  mesh_cabin_1.userData.sculptComponent = {"id": "cabin", "name": "Glazed cabin and roof", "level": "macro", "role": "cabin", "importance": 0.9, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "roof-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.38, "height": 0.52, "depth": 0.92, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["dark-glazing", "sloped-windscreen", "side-window", "glass-cabin"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["dark-glazing", "sloped-windscreen", "side-window"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 37, 41, 1.0)", "secondaryAlbedo": "rgba(92, 118, 123, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(26, 37, 41, 1.0)"}, {"position": 1, "color": "rgba(92, 118, 123, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_cabin_1.add(mesh_cabin_1);
  meshes["cabin"] = mesh_cabin_1;
  colliders["cabin"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_cabin_1);

  const attachment_front_fascia_2 = {"parentId": "body-shell", "parentSocket": "front-bumper", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_front_fascia_2 = makeAttachmentEndpoint(attachment_front_fascia_2);
  const node_front_fascia_2 = new THREE.Group();
  node_front_fascia_2.name = "Front fascia and bumper__pivot";
  node_front_fascia_2.scale.set(1, 1, 1);
  if (endpoint_front_fascia_2) {
    node_front_fascia_2.position.copy(endpoint_front_fascia_2.start);
    node_front_fascia_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_fascia_2.position.set(-1.18, -0.08, 0.0);
    node_front_fascia_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_fascia_2.userData.sculptComponent = {"id": "front-fascia", "name": "Front fascia and bumper", "level": "macro", "role": "aero", "importance": 0.9, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "front-bumper", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.78, "height": 0.34, "depth": 0.9, "units": "relative", "confidence": 0.78}, "transform": {"position": [-1.18, -0.08, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-1.18, -0.08, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["low-splitter", "bumper-openings"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["low-splitter", "bumper-openings"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_front_fascia_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-1.18, -0.08, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_front_fascia_2);
  nodes["front-fascia"] = node_front_fascia_2;
  const mesh_front_fascia_2Geometry = endpoint_front_fascia_2
    ? new THREE.CylinderGeometry(endpoint_front_fascia_2.endRadius, endpoint_front_fascia_2.baseRadius, endpoint_front_fascia_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_front_fascia_2) {
    mesh_front_fascia_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_fascia_2 = new THREE.Mesh(
    mesh_front_fascia_2Geometry,
    materialMap["black-aero"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_fascia_2.name = "Front fascia and bumper";
  if (endpoint_front_fascia_2) {
    mesh_front_fascia_2.position.copy(endpoint_front_fascia_2.midpoint);
    mesh_front_fascia_2.quaternion.copy(endpoint_front_fascia_2.quaternion);
  }
  mesh_front_fascia_2.castShadow = options.castShadow ?? true;
  mesh_front_fascia_2.receiveShadow = options.receiveShadow ?? true;
  mesh_front_fascia_2.userData.sculptComponent = {"id": "front-fascia", "name": "Front fascia and bumper", "level": "macro", "role": "aero", "importance": 0.9, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "front-bumper", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.78, "height": 0.34, "depth": 0.9, "units": "relative", "confidence": 0.78}, "transform": {"position": [-1.18, -0.08, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-1.18, -0.08, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["low-splitter", "bumper-openings"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["low-splitter", "bumper-openings"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_front_fascia_2.add(mesh_front_fascia_2);
  meshes["front-fascia"] = mesh_front_fascia_2;
  colliders["front-fascia"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_front_fascia_2);

  const attachment_rear_wing_3 = {"parentId": "body-shell", "parentSocket": "rear-deck", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_rear_wing_3 = makeAttachmentEndpoint(attachment_rear_wing_3);
  const node_rear_wing_3 = new THREE.Group();
  node_rear_wing_3.name = "Large rear wing__pivot";
  node_rear_wing_3.scale.set(1, 1, 1);
  if (endpoint_rear_wing_3) {
    node_rear_wing_3.position.copy(endpoint_rear_wing_3.start);
    node_rear_wing_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_wing_3.position.set(0.92, 0.58, 0.0);
    node_rear_wing_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_wing_3.userData.sculptComponent = {"id": "rear-wing", "name": "Large rear wing", "level": "macro", "role": "wing", "importance": 0.9, "confidence": 0.82, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-deck", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.16, "height": 0.18, "depth": 0.16, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.92, 0.58, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.92, 0.58, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["wing-plane", "two-supports", "rear-wing"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["wing-plane", "two-supports"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_rear_wing_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.92, 0.58, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_rear_wing_3);
  nodes["rear-wing"] = node_rear_wing_3;
  const mesh_rear_wing_3Geometry = endpoint_rear_wing_3
    ? new THREE.CylinderGeometry(endpoint_rear_wing_3.endRadius, endpoint_rear_wing_3.baseRadius, endpoint_rear_wing_3.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_rear_wing_3) {
    mesh_rear_wing_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_wing_3 = new THREE.Mesh(
    mesh_rear_wing_3Geometry,
    materialMap["black-aero"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_wing_3.name = "Large rear wing";
  if (endpoint_rear_wing_3) {
    mesh_rear_wing_3.position.copy(endpoint_rear_wing_3.midpoint);
    mesh_rear_wing_3.quaternion.copy(endpoint_rear_wing_3.quaternion);
  }
  mesh_rear_wing_3.castShadow = options.castShadow ?? true;
  mesh_rear_wing_3.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_wing_3.userData.sculptComponent = {"id": "rear-wing", "name": "Large rear wing", "level": "macro", "role": "wing", "importance": 0.9, "confidence": 0.82, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-deck", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.16, "height": 0.18, "depth": 0.16, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.92, 0.58, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.92, 0.58, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["wing-plane", "two-supports", "rear-wing"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["wing-plane", "two-supports"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_rear_wing_3.add(mesh_rear_wing_3);
  meshes["rear-wing"] = mesh_rear_wing_3;
  colliders["rear-wing"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_rear_wing_3);

  const attachment_wheel_front_4 = {"parentId": "body-shell", "parentSocket": "front-wheel-well", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wheel_front_4 = makeAttachmentEndpoint(attachment_wheel_front_4);
  const node_wheel_front_4 = new THREE.Group();
  node_wheel_front_4.name = "Front wheel assembly__pivot";
  node_wheel_front_4.scale.set(1, 1, 1);
  if (endpoint_wheel_front_4) {
    node_wheel_front_4.position.copy(endpoint_wheel_front_4.start);
    node_wheel_front_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_front_4.position.set(-0.78, -0.44, 0.48);
    node_wheel_front_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_front_4.userData.sculptComponent = {"id": "wheel-front", "name": "Front wheel assembly", "level": "macro", "role": "wheel", "importance": 0.9, "confidence": 0.82, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "front-wheel-well", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.56, "height": 0.56, "depth": 0.24, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.78, -0.44, 0.48], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "articulated", "pivot": {"mode": "local", "localPosition": [-0.78, -0.44, 0.48], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green-metal", "materialLayers": ["green-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["green-rim", "black-tire", "green-wheel-finish"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["green-rim", "black-tire"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 184, 102, 1.0)", "secondaryAlbedo": "rgba(6, 75, 47, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(5, 184, 102, 1.0)"}, {"position": 1, "color": "rgba(6, 75, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wheel_front_4.userData.actionProfile = {"animationRole": "articulated", "pivot": {"mode": "local", "localPosition": [-0.78, -0.44, 0.48], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_wheel_front_4);
  nodes["wheel-front"] = node_wheel_front_4;
  const mesh_wheel_front_4Geometry = endpoint_wheel_front_4
    ? new THREE.CylinderGeometry(endpoint_wheel_front_4.endRadius, endpoint_wheel_front_4.baseRadius, endpoint_wheel_front_4.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  if (!endpoint_wheel_front_4) {
    mesh_wheel_front_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_front_4 = new THREE.Mesh(
    mesh_wheel_front_4Geometry,
    materialMap["green-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_front_4.name = "Front wheel assembly";
  if (endpoint_wheel_front_4) {
    mesh_wheel_front_4.position.copy(endpoint_wheel_front_4.midpoint);
    mesh_wheel_front_4.quaternion.copy(endpoint_wheel_front_4.quaternion);
  }
  mesh_wheel_front_4.castShadow = options.castShadow ?? true;
  mesh_wheel_front_4.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_front_4.userData.sculptComponent = {"id": "wheel-front", "name": "Front wheel assembly", "level": "macro", "role": "wheel", "importance": 0.9, "confidence": 0.82, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "front-wheel-well", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.56, "height": 0.56, "depth": 0.24, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.78, -0.44, 0.48], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "articulated", "pivot": {"mode": "local", "localPosition": [-0.78, -0.44, 0.48], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green-metal", "materialLayers": ["green-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["green-rim", "black-tire", "green-wheel-finish"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["green-rim", "black-tire"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 184, 102, 1.0)", "secondaryAlbedo": "rgba(6, 75, 47, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(5, 184, 102, 1.0)"}, {"position": 1, "color": "rgba(6, 75, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wheel_front_4.add(mesh_wheel_front_4);
  meshes["wheel-front"] = mesh_wheel_front_4;
  colliders["wheel-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wheel_front_4);

  const attachment_wheel_rear_5 = {"parentId": "body-shell", "parentSocket": "rear-wheel-well", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wheel_rear_5 = makeAttachmentEndpoint(attachment_wheel_rear_5);
  const node_wheel_rear_5 = new THREE.Group();
  node_wheel_rear_5.name = "Rear wheel assembly__pivot";
  node_wheel_rear_5.scale.set(1, 1, 1);
  if (endpoint_wheel_rear_5) {
    node_wheel_rear_5.position.copy(endpoint_wheel_rear_5.start);
    node_wheel_rear_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_rear_5.position.set(0.82, -0.44, 0.48);
    node_wheel_rear_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_rear_5.userData.sculptComponent = {"id": "wheel-rear", "name": "Rear wheel assembly", "level": "macro", "role": "wheel", "importance": 0.9, "confidence": 0.82, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-wheel-well", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.62, "height": 0.62, "depth": 0.25, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.82, -0.44, 0.48], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "articulated", "pivot": {"mode": "local", "localPosition": [0.82, -0.44, 0.48], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green-metal", "materialLayers": ["green-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["green-rim", "black-tire"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["green-rim", "black-tire"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 184, 102, 1.0)", "secondaryAlbedo": "rgba(6, 75, 47, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(5, 184, 102, 1.0)"}, {"position": 1, "color": "rgba(6, 75, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wheel_rear_5.userData.actionProfile = {"animationRole": "articulated", "pivot": {"mode": "local", "localPosition": [0.82, -0.44, 0.48], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_wheel_rear_5);
  nodes["wheel-rear"] = node_wheel_rear_5;
  const mesh_wheel_rear_5Geometry = endpoint_wheel_rear_5
    ? new THREE.CylinderGeometry(endpoint_wheel_rear_5.endRadius, endpoint_wheel_rear_5.baseRadius, endpoint_wheel_rear_5.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.08, 24, 96);
  if (!endpoint_wheel_rear_5) {
    mesh_wheel_rear_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_rear_5 = new THREE.Mesh(
    mesh_wheel_rear_5Geometry,
    materialMap["green-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_rear_5.name = "Rear wheel assembly";
  if (endpoint_wheel_rear_5) {
    mesh_wheel_rear_5.position.copy(endpoint_wheel_rear_5.midpoint);
    mesh_wheel_rear_5.quaternion.copy(endpoint_wheel_rear_5.quaternion);
  }
  mesh_wheel_rear_5.castShadow = options.castShadow ?? true;
  mesh_wheel_rear_5.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_rear_5.userData.sculptComponent = {"id": "wheel-rear", "name": "Rear wheel assembly", "level": "macro", "role": "wheel", "importance": 0.9, "confidence": 0.82, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-wheel-well", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.62, "height": 0.62, "depth": 0.25, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.82, -0.44, 0.48], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "articulated", "pivot": {"mode": "local", "localPosition": [0.82, -0.44, 0.48], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green-metal", "materialLayers": ["green-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["green-rim", "black-tire"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["green-rim", "black-tire"], "fidelityTier": "form-refinement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 184, 102, 1.0)", "secondaryAlbedo": "rgba(6, 75, 47, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(5, 184, 102, 1.0)"}, {"position": 1, "color": "rgba(6, 75, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wheel_rear_5.add(mesh_wheel_rear_5);
  meshes["wheel-rear"] = mesh_wheel_rear_5;
  colliders["wheel-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wheel_rear_5);

  const attachment_hood_vents_6 = {"parentId": "body-shell", "parentSocket": "hood-surface", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_hood_vents_6 = makeAttachmentEndpoint(attachment_hood_vents_6);
  const node_hood_vents_6 = new THREE.Group();
  node_hood_vents_6.name = "Hood vent cluster__pivot";
  node_hood_vents_6.scale.set(1, 1, 1);
  if (endpoint_hood_vents_6) {
    node_hood_vents_6.position.copy(endpoint_hood_vents_6.start);
    node_hood_vents_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hood_vents_6.position.set(-0.6, 0.32, 0.0);
    node_hood_vents_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_hood_vents_6.userData.sculptComponent = {"id": "hood-vents", "name": "Hood vent cluster", "level": "meso", "role": "vent", "importance": 0.72, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "hood-surface", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.06, "depth": 0.32, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.6, 0.32, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.6, 0.32, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["paired-vents", "hood-vents"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["paired-vents"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_hood_vents_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.6, 0.32, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_hood_vents_6);
  nodes["hood-vents"] = node_hood_vents_6;
  const mesh_hood_vents_6Geometry = endpoint_hood_vents_6
    ? new THREE.CylinderGeometry(endpoint_hood_vents_6.endRadius, endpoint_hood_vents_6.baseRadius, endpoint_hood_vents_6.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_hood_vents_6) {
    mesh_hood_vents_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hood_vents_6 = new THREE.Mesh(
    mesh_hood_vents_6Geometry,
    materialMap["black-aero"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hood_vents_6.name = "Hood vent cluster";
  if (endpoint_hood_vents_6) {
    mesh_hood_vents_6.position.copy(endpoint_hood_vents_6.midpoint);
    mesh_hood_vents_6.quaternion.copy(endpoint_hood_vents_6.quaternion);
  }
  mesh_hood_vents_6.castShadow = options.castShadow ?? true;
  mesh_hood_vents_6.receiveShadow = options.receiveShadow ?? true;
  mesh_hood_vents_6.userData.sculptComponent = {"id": "hood-vents", "name": "Hood vent cluster", "level": "meso", "role": "vent", "importance": 0.72, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "hood-surface", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.06, "depth": 0.32, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.6, 0.32, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.6, 0.32, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["paired-vents", "hood-vents"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["paired-vents"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_hood_vents_6.add(mesh_hood_vents_6);
  meshes["hood-vents"] = mesh_hood_vents_6;
  colliders["hood-vents"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_hood_vents_6);

  const attachment_side_intake_7 = {"parentId": "body-shell", "parentSocket": "rear-quarter", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_side_intake_7 = makeAttachmentEndpoint(attachment_side_intake_7);
  const node_side_intake_7 = new THREE.Group();
  node_side_intake_7.name = "Recessed side intake__pivot";
  node_side_intake_7.scale.set(1, 1, 1);
  if (endpoint_side_intake_7) {
    node_side_intake_7.position.copy(endpoint_side_intake_7.start);
    node_side_intake_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_side_intake_7.position.set(0.42, 0.0, 0.52);
    node_side_intake_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_side_intake_7.userData.sculptComponent = {"id": "side-intake", "name": "Recessed side intake", "level": "meso", "role": "intake", "importance": 0.72, "confidence": 0.82, "primitive": "box", "topologyClass": "implicit", "topologyRationale": "The visible side intake is a recessed cavity, so the volume is carved with an SDF subtract operation rather than represented as a convex patch.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "sdf": {"primitives": [{"id": "intake-volume", "type": "box", "size": [0.42, 0.3, 0.24]}, {"id": "intake-cutout", "type": "box", "size": [0.34, 0.24, 0.18]}], "operations": [{"id": "intake-cavity", "type": "subtract", "left": "intake-volume", "right": "intake-cutout"}], "resolution": 16}}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-quarter", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36, "height": 0.3, "depth": 0.22, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.42, 0.0, 0.52], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.42, 0.0, 0.52], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["recessed-opening", "side-intake"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["recessed-opening"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_side_intake_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.42, 0.0, 0.52], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_side_intake_7);
  nodes["side-intake"] = node_side_intake_7;
  const mesh_side_intake_7Geometry = polygonizeSdf({"primitives": [{"id": "intake-volume", "type": "box", "size": [0.42, 0.3, 0.24]}, {"id": "intake-cutout", "type": "box", "size": [0.34, 0.24, 0.18]}], "operations": [{"id": "intake-cavity", "type": "subtract", "left": "intake-volume", "right": "intake-cutout"}], "resolution": 16});
  if (!endpoint_side_intake_7) {
    mesh_side_intake_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_side_intake_7 = new THREE.Mesh(
    mesh_side_intake_7Geometry,
    createSculptMaterial("black-aero", {"id": "black-aero", "name": "Satin black aero", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#111416", "color": "#111416", "albedo": {"dominant": "#111416", "secondary": ["#2e3436"], "samplingNotes": "Observed from the side reference; exact lighting is not treated as albedo."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 512, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.12, "role": "broad finish variation"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.08, "role": "panel and aero breakup"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.04, "role": "highlight breakup"}], "roughness": {"base": 0.48, "variation": 0.12, "map": "procedural/black-aero-roughness"}, "metalness": {"base": 0.05, "variation": 0.06}, "normal": {"pattern": "procedural/black-aero-normal", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "micro surface breakup", "amplitude": 0.03, "scale": 12.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken wheel wells, panel seams and aero contacts."}, "wear": {"edgeWear": 0.04, "scratches": ["very sparse showroom micro-scratches"], "chips": []}, "dirt": {"amount": 0.04, "cavityBias": 0.18, "color": "#121516"}, "localOverrides": [{"id": "recessed-cavity", "region": "vents-and-intakes", "roughness": 0.62, "notes": "Darken cavities without erasing their geometry."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "qualityTier": "utility"}, options, true)
  );
  mesh_side_intake_7.name = "Recessed side intake";
  if (endpoint_side_intake_7) {
    mesh_side_intake_7.position.copy(endpoint_side_intake_7.midpoint);
    mesh_side_intake_7.quaternion.copy(endpoint_side_intake_7.quaternion);
  }
  mesh_side_intake_7.castShadow = options.castShadow ?? true;
  mesh_side_intake_7.receiveShadow = options.receiveShadow ?? true;
  mesh_side_intake_7.userData.sculptComponent = {"id": "side-intake", "name": "Recessed side intake", "level": "meso", "role": "intake", "importance": 0.72, "confidence": 0.82, "primitive": "box", "topologyClass": "implicit", "topologyRationale": "The visible side intake is a recessed cavity, so the volume is carved with an SDF subtract operation rather than represented as a convex patch.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "sdf": {"primitives": [{"id": "intake-volume", "type": "box", "size": [0.42, 0.3, 0.24]}, {"id": "intake-cutout", "type": "box", "size": [0.34, 0.24, 0.18]}], "operations": [{"id": "intake-cavity", "type": "subtract", "left": "intake-volume", "right": "intake-cutout"}], "resolution": 16}}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-quarter", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36, "height": 0.3, "depth": 0.22, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.42, 0.0, 0.52], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.42, 0.0, 0.52], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["recessed-opening", "side-intake"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["recessed-opening"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_side_intake_7.add(mesh_side_intake_7);
  meshes["side-intake"] = mesh_side_intake_7;
  colliders["side-intake"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_side_intake_7);

  const attachment_headlamp_8 = {"parentId": "front-fascia", "parentSocket": "lamp-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_headlamp_8 = makeAttachmentEndpoint(attachment_headlamp_8);
  const node_headlamp_8 = new THREE.Group();
  node_headlamp_8.name = "Headlamp housing__pivot";
  node_headlamp_8.scale.set(1, 1, 1);
  if (endpoint_headlamp_8) {
    node_headlamp_8.position.copy(endpoint_headlamp_8.start);
    node_headlamp_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_headlamp_8.position.set(-0.24, 0.12, 0.44);
    node_headlamp_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_headlamp_8.userData.sculptComponent = {"id": "headlamp", "name": "Headlamp housing", "level": "meso", "role": "lamp", "importance": 0.72, "confidence": 0.82, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-fascia", "attachment": {"parentId": "front-fascia", "parentSocket": "lamp-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36, "height": 0.18, "depth": 0.24, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.24, 0.12, 0.44], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.24, 0.12, 0.44], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["sloped-lamp", "headlamp-contour"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["sloped-lamp"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 37, 41, 1.0)", "secondaryAlbedo": "rgba(92, 118, 123, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(26, 37, 41, 1.0)"}, {"position": 1, "color": "rgba(92, 118, 123, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_headlamp_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.24, 0.12, 0.44], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["front-fascia"] ?? root).add(node_headlamp_8);
  nodes["headlamp"] = node_headlamp_8;
  const mesh_headlamp_8Geometry = endpoint_headlamp_8
    ? new THREE.CylinderGeometry(endpoint_headlamp_8.endRadius, endpoint_headlamp_8.baseRadius, endpoint_headlamp_8.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_headlamp_8) {
    mesh_headlamp_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_headlamp_8 = new THREE.Mesh(
    mesh_headlamp_8Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_headlamp_8.name = "Headlamp housing";
  if (endpoint_headlamp_8) {
    mesh_headlamp_8.position.copy(endpoint_headlamp_8.midpoint);
    mesh_headlamp_8.quaternion.copy(endpoint_headlamp_8.quaternion);
  }
  mesh_headlamp_8.castShadow = options.castShadow ?? true;
  mesh_headlamp_8.receiveShadow = options.receiveShadow ?? true;
  mesh_headlamp_8.userData.sculptComponent = {"id": "headlamp", "name": "Headlamp housing", "level": "meso", "role": "lamp", "importance": 0.72, "confidence": 0.82, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-fascia", "attachment": {"parentId": "front-fascia", "parentSocket": "lamp-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.36, "height": 0.18, "depth": 0.24, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.24, 0.12, 0.44], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.24, 0.12, 0.44], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["sloped-lamp", "headlamp-contour"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["sloped-lamp"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 37, 41, 1.0)", "secondaryAlbedo": "rgba(92, 118, 123, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(26, 37, 41, 1.0)"}, {"position": 1, "color": "rgba(92, 118, 123, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_headlamp_8.add(mesh_headlamp_8);
  meshes["headlamp"] = mesh_headlamp_8;
  colliders["headlamp"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_headlamp_8);

  const attachment_front_brake_9 = {"parentId": "wheel-front", "parentSocket": "hub-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_front_brake_9 = makeAttachmentEndpoint(attachment_front_brake_9);
  const node_front_brake_9 = new THREE.Group();
  node_front_brake_9.name = "Front brake hardware__pivot";
  node_front_brake_9.scale.set(1, 1, 1);
  if (endpoint_front_brake_9) {
    node_front_brake_9.position.copy(endpoint_front_brake_9.start);
    node_front_brake_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_brake_9.position.set(0.0, 0.0, 0.0);
    node_front_brake_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_brake_9.userData.sculptComponent = {"id": "front-brake", "name": "Front brake hardware", "level": "meso", "role": "brake", "importance": 0.72, "confidence": 0.82, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-front", "attachment": {"parentId": "wheel-front", "parentSocket": "hub-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.34, "height": 0.08, "depth": 0.34, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brake-metal", "materialLayers": ["brake-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["disc", "caliper", "brake-discs"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["disc", "caliper"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_front_brake_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["wheel-front"] ?? root).add(node_front_brake_9);
  nodes["front-brake"] = node_front_brake_9;
  const mesh_front_brake_9Geometry = endpoint_front_brake_9
    ? new THREE.CylinderGeometry(endpoint_front_brake_9.endRadius, endpoint_front_brake_9.baseRadius, endpoint_front_brake_9.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_front_brake_9) {
    mesh_front_brake_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_brake_9 = new THREE.Mesh(
    mesh_front_brake_9Geometry,
    materialMap["brake-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_brake_9.name = "Front brake hardware";
  if (endpoint_front_brake_9) {
    mesh_front_brake_9.position.copy(endpoint_front_brake_9.midpoint);
    mesh_front_brake_9.quaternion.copy(endpoint_front_brake_9.quaternion);
  }
  mesh_front_brake_9.castShadow = options.castShadow ?? true;
  mesh_front_brake_9.receiveShadow = options.receiveShadow ?? true;
  mesh_front_brake_9.userData.sculptComponent = {"id": "front-brake", "name": "Front brake hardware", "level": "meso", "role": "brake", "importance": 0.72, "confidence": 0.82, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-front", "attachment": {"parentId": "wheel-front", "parentSocket": "hub-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.34, "height": 0.08, "depth": 0.34, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brake-metal", "materialLayers": ["brake-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["disc", "caliper", "brake-discs"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["disc", "caliper"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_front_brake_9.add(mesh_front_brake_9);
  meshes["front-brake"] = mesh_front_brake_9;
  colliders["front-brake"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_front_brake_9);

  const attachment_rear_brake_10 = {"parentId": "wheel-rear", "parentSocket": "hub-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_rear_brake_10 = makeAttachmentEndpoint(attachment_rear_brake_10);
  const node_rear_brake_10 = new THREE.Group();
  node_rear_brake_10.name = "Rear brake hardware__pivot";
  node_rear_brake_10.scale.set(1, 1, 1);
  if (endpoint_rear_brake_10) {
    node_rear_brake_10.position.copy(endpoint_rear_brake_10.start);
    node_rear_brake_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_brake_10.position.set(0.0, 0.0, 0.0);
    node_rear_brake_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_brake_10.userData.sculptComponent = {"id": "rear-brake", "name": "Rear brake hardware", "level": "meso", "role": "brake", "importance": 0.72, "confidence": 0.82, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rear", "attachment": {"parentId": "wheel-rear", "parentSocket": "hub-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.08, "depth": 0.38, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brake-metal", "materialLayers": ["brake-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["disc", "caliper"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["disc", "caliper"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_rear_brake_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["wheel-rear"] ?? root).add(node_rear_brake_10);
  nodes["rear-brake"] = node_rear_brake_10;
  const mesh_rear_brake_10Geometry = endpoint_rear_brake_10
    ? new THREE.CylinderGeometry(endpoint_rear_brake_10.endRadius, endpoint_rear_brake_10.baseRadius, endpoint_rear_brake_10.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_rear_brake_10) {
    mesh_rear_brake_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_brake_10 = new THREE.Mesh(
    mesh_rear_brake_10Geometry,
    materialMap["brake-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_brake_10.name = "Rear brake hardware";
  if (endpoint_rear_brake_10) {
    mesh_rear_brake_10.position.copy(endpoint_rear_brake_10.midpoint);
    mesh_rear_brake_10.quaternion.copy(endpoint_rear_brake_10.quaternion);
  }
  mesh_rear_brake_10.castShadow = options.castShadow ?? true;
  mesh_rear_brake_10.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_brake_10.userData.sculptComponent = {"id": "rear-brake", "name": "Rear brake hardware", "level": "meso", "role": "brake", "importance": 0.72, "confidence": 0.82, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-rear", "attachment": {"parentId": "wheel-rear", "parentSocket": "hub-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.08, "depth": 0.38, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brake-metal", "materialLayers": ["brake-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["disc", "caliper"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["disc", "caliper"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_rear_brake_10.add(mesh_rear_brake_10);
  meshes["rear-brake"] = mesh_rear_brake_10;
  colliders["rear-brake"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_rear_brake_10);

  const attachment_side_stripe_11 = {"parentId": "body-shell", "parentSocket": "door-side", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_side_stripe_11 = makeAttachmentEndpoint(attachment_side_stripe_11);
  const node_side_stripe_11 = new THREE.Group();
  node_side_stripe_11.name = "Green side graphic__pivot";
  node_side_stripe_11.scale.set(1, 1, 1);
  if (endpoint_side_stripe_11) {
    node_side_stripe_11.position.copy(endpoint_side_stripe_11.start);
    node_side_stripe_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_side_stripe_11.position.set(0.08, -0.16, 0.55);
    node_side_stripe_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_side_stripe_11.userData.sculptComponent = {"id": "side-stripe", "name": "Green side graphic", "level": "meso", "role": "decal", "importance": 0.72, "confidence": 0.82, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "door-side", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.42, "height": 0.02, "depth": 0.12, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.08, -0.16, 0.55], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.08, -0.16, 0.55], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "accent-graphic", "materialLayers": ["accent-graphic"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["green-stripe", "gt3rs-lettering", "side-stripe"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["green-stripe", "gt3rs-lettering", "side-stripe"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_side_stripe_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.08, -0.16, 0.55], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_side_stripe_11);
  nodes["side-stripe"] = node_side_stripe_11;
  const mesh_side_stripe_11Geometry = endpoint_side_stripe_11
    ? new THREE.CylinderGeometry(endpoint_side_stripe_11.endRadius, endpoint_side_stripe_11.baseRadius, endpoint_side_stripe_11.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_side_stripe_11) {
    mesh_side_stripe_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_side_stripe_11 = new THREE.Mesh(
    mesh_side_stripe_11Geometry,
    materialMap["accent-graphic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_side_stripe_11.name = "Green side graphic";
  if (endpoint_side_stripe_11) {
    mesh_side_stripe_11.position.copy(endpoint_side_stripe_11.midpoint);
    mesh_side_stripe_11.quaternion.copy(endpoint_side_stripe_11.quaternion);
  }
  mesh_side_stripe_11.castShadow = options.castShadow ?? true;
  mesh_side_stripe_11.receiveShadow = options.receiveShadow ?? true;
  mesh_side_stripe_11.userData.sculptComponent = {"id": "side-stripe", "name": "Green side graphic", "level": "meso", "role": "decal", "importance": 0.72, "confidence": 0.82, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "door-side", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.42, "height": 0.02, "depth": 0.12, "units": "relative", "confidence": 0.78}, "transform": {"position": [0.08, -0.16, 0.55], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0.08, -0.16, 0.55], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "accent-graphic", "materialLayers": ["accent-graphic"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["green-stripe", "gt3rs-lettering", "side-stripe"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["green-stripe", "gt3rs-lettering", "side-stripe"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_side_stripe_11.add(mesh_side_stripe_11);
  meshes["side-stripe"] = mesh_side_stripe_11;
  colliders["side-stripe"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_side_stripe_11);

  const attachment_side_mirror_12 = {"parentId": "cabin", "parentSocket": "mirror-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_side_mirror_12 = makeAttachmentEndpoint(attachment_side_mirror_12);
  const node_side_mirror_12 = new THREE.Group();
  node_side_mirror_12.name = "Aerodynamic side mirror__pivot";
  node_side_mirror_12.scale.set(1, 1, 1);
  if (endpoint_side_mirror_12) {
    node_side_mirror_12.position.copy(endpoint_side_mirror_12.start);
    node_side_mirror_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_side_mirror_12.position.set(-0.3, -0.04, 0.42);
    node_side_mirror_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_side_mirror_12.userData.sculptComponent = {"id": "side-mirror", "name": "Aerodynamic side mirror", "level": "meso", "role": "mirror", "importance": 0.72, "confidence": 0.82, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cabin", "attachment": {"parentId": "cabin", "parentSocket": "mirror-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.24, "height": 0.16, "depth": 0.18, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.3, -0.04, 0.42], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.3, -0.04, 0.42], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body-paint", "materialLayers": ["body-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror-shell"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["mirror-shell"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_side_mirror_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.3, -0.04, 0.42], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["cabin"] ?? root).add(node_side_mirror_12);
  nodes["side-mirror"] = node_side_mirror_12;
  const mesh_side_mirror_12Geometry = endpoint_side_mirror_12
    ? new THREE.CylinderGeometry(endpoint_side_mirror_12.endRadius, endpoint_side_mirror_12.baseRadius, endpoint_side_mirror_12.length, 32, 12)
    : new THREE.SphereGeometry(0.5, 64, 40);
  if (!endpoint_side_mirror_12) {
    mesh_side_mirror_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_side_mirror_12 = new THREE.Mesh(
    mesh_side_mirror_12Geometry,
    materialMap["body-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_side_mirror_12.name = "Aerodynamic side mirror";
  if (endpoint_side_mirror_12) {
    mesh_side_mirror_12.position.copy(endpoint_side_mirror_12.midpoint);
    mesh_side_mirror_12.quaternion.copy(endpoint_side_mirror_12.quaternion);
  }
  mesh_side_mirror_12.castShadow = options.castShadow ?? true;
  mesh_side_mirror_12.receiveShadow = options.receiveShadow ?? true;
  mesh_side_mirror_12.userData.sculptComponent = {"id": "side-mirror", "name": "Aerodynamic side mirror", "level": "meso", "role": "mirror", "importance": 0.72, "confidence": 0.82, "primitive": "ellipsoid", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "cabin", "attachment": {"parentId": "cabin", "parentSocket": "mirror-mount", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.24, "height": 0.16, "depth": 0.18, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.3, -0.04, 0.42], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.3, -0.04, 0.42], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "body-paint", "materialLayers": ["body-paint"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror-shell"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["mirror-shell"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_side_mirror_12.add(mesh_side_mirror_12);
  meshes["side-mirror"] = mesh_side_mirror_12;
  colliders["side-mirror"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_side_mirror_12);

  const attachment_rear_light_13 = {"parentId": "body-shell", "parentSocket": "rear-lamp-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_rear_light_13 = makeAttachmentEndpoint(attachment_rear_light_13);
  const node_rear_light_13 = new THREE.Group();
  node_rear_light_13.name = "Rear light bar__pivot";
  node_rear_light_13.scale.set(1, 1, 1);
  if (endpoint_rear_light_13) {
    node_rear_light_13.position.copy(endpoint_rear_light_13.start);
    node_rear_light_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_light_13.position.set(1.24, 0.1, 0.0);
    node_rear_light_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_light_13.userData.sculptComponent = {"id": "rear-light", "name": "Rear light bar", "level": "meso", "role": "lamp", "importance": 0.72, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-lamp-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.08, "depth": 0.06, "units": "relative", "confidence": 0.78}, "transform": {"position": [1.24, 0.1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [1.24, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "accent-graphic", "materialLayers": ["accent-graphic"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["rear-light-bar"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["rear-light-bar"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_rear_light_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [1.24, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["body-shell"] ?? root).add(node_rear_light_13);
  nodes["rear-light"] = node_rear_light_13;
  const mesh_rear_light_13Geometry = endpoint_rear_light_13
    ? new THREE.CylinderGeometry(endpoint_rear_light_13.endRadius, endpoint_rear_light_13.baseRadius, endpoint_rear_light_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_rear_light_13) {
    mesh_rear_light_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rear_light_13 = new THREE.Mesh(
    mesh_rear_light_13Geometry,
    materialMap["accent-graphic"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_light_13.name = "Rear light bar";
  if (endpoint_rear_light_13) {
    mesh_rear_light_13.position.copy(endpoint_rear_light_13.midpoint);
    mesh_rear_light_13.quaternion.copy(endpoint_rear_light_13.quaternion);
  }
  mesh_rear_light_13.castShadow = options.castShadow ?? true;
  mesh_rear_light_13.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_light_13.userData.sculptComponent = {"id": "rear-light", "name": "Rear light bar", "level": "meso", "role": "lamp", "importance": 0.72, "confidence": 0.82, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "rear-lamp-seat", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.48, "height": 0.08, "depth": 0.06, "units": "relative", "confidence": 0.78}, "transform": {"position": [1.24, 0.1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [1.24, 0.1, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "accent-graphic", "materialLayers": ["accent-graphic"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["rear-light-bar"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["rear-light-bar"], "fidelityTier": "material-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_rear_light_13.add(mesh_rear_light_13);
  meshes["rear-light"] = mesh_rear_light_13;
  colliders["rear-light"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_rear_light_13);

  const attachment_front_aero_14 = {"parentId": "front-fascia", "parentSocket": "lower-edge", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_front_aero_14 = makeAttachmentEndpoint(attachment_front_aero_14);
  const node_front_aero_14 = new THREE.Group();
  node_front_aero_14.name = "Front splitter__pivot";
  node_front_aero_14.scale.set(1, 1, 1);
  if (endpoint_front_aero_14) {
    node_front_aero_14.position.copy(endpoint_front_aero_14.start);
    node_front_aero_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_aero_14.position.set(-0.18, -0.24, 0.0);
    node_front_aero_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_aero_14.userData.sculptComponent = {"id": "front-aero", "name": "Front splitter", "level": "micro", "role": "aero", "importance": 0.55, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-fascia", "attachment": {"parentId": "front-fascia", "parentSocket": "lower-edge", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.62, "height": 0.06, "depth": 0.58, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.18, -0.24, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.18, -0.24, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["splitter-lip", "aero-splitter"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["splitter-lip"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_front_aero_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.18, -0.24, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["front-fascia"] ?? root).add(node_front_aero_14);
  nodes["front-aero"] = node_front_aero_14;
  const mesh_front_aero_14Geometry = endpoint_front_aero_14
    ? new THREE.CylinderGeometry(endpoint_front_aero_14.endRadius, endpoint_front_aero_14.baseRadius, endpoint_front_aero_14.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_front_aero_14) {
    mesh_front_aero_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_front_aero_14 = new THREE.Mesh(
    mesh_front_aero_14Geometry,
    materialMap["black-aero"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_aero_14.name = "Front splitter";
  if (endpoint_front_aero_14) {
    mesh_front_aero_14.position.copy(endpoint_front_aero_14.midpoint);
    mesh_front_aero_14.quaternion.copy(endpoint_front_aero_14.quaternion);
  }
  mesh_front_aero_14.castShadow = options.castShadow ?? true;
  mesh_front_aero_14.receiveShadow = options.receiveShadow ?? true;
  mesh_front_aero_14.userData.sculptComponent = {"id": "front-aero", "name": "Front splitter", "level": "micro", "role": "aero", "importance": 0.55, "confidence": 0.68, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-fascia", "attachment": {"parentId": "front-fascia", "parentSocket": "lower-edge", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.62, "height": 0.06, "depth": 0.58, "units": "relative", "confidence": 0.78}, "transform": {"position": [-0.18, -0.24, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [-0.18, -0.24, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["splitter-lip", "aero-splitter"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["splitter-lip"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_front_aero_14.add(mesh_front_aero_14);
  meshes["front-aero"] = mesh_front_aero_14;
  colliders["front-aero"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_front_aero_14);

  const attachment_wheel_spokes_15 = {"parentId": "wheel-front", "parentSocket": "rim-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wheel_spokes_15 = makeAttachmentEndpoint(attachment_wheel_spokes_15);
  const node_wheel_spokes_15 = new THREE.Group();
  node_wheel_spokes_15.name = "Front and rear spoke rhythm__pivot";
  node_wheel_spokes_15.scale.set(1, 1, 1);
  if (endpoint_wheel_spokes_15) {
    node_wheel_spokes_15.position.copy(endpoint_wheel_spokes_15.start);
    node_wheel_spokes_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wheel_spokes_15.position.set(0.0, 0.0, 0.0);
    node_wheel_spokes_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_wheel_spokes_15.userData.sculptComponent = {"id": "wheel-spokes", "name": "Front and rear spoke rhythm", "level": "micro", "role": "wheel-spokes", "importance": 0.55, "confidence": 0.68, "primitive": "instanced-cluster", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-front", "attachment": {"parentId": "wheel-front", "parentSocket": "rim-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.04, "depth": 0.38, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green-metal", "materialLayers": ["green-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["radial-spokes", "wheel-spokes"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["radial-spokes"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 184, 102, 1.0)", "secondaryAlbedo": "rgba(6, 75, 47, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(5, 184, 102, 1.0)"}, {"position": 1, "color": "rgba(6, 75, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wheel_spokes_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["wheel-front"] ?? root).add(node_wheel_spokes_15);
  nodes["wheel-spokes"] = node_wheel_spokes_15;
  const mesh_wheel_spokes_15Geometry = endpoint_wheel_spokes_15
    ? new THREE.CylinderGeometry(endpoint_wheel_spokes_15.endRadius, endpoint_wheel_spokes_15.baseRadius, endpoint_wheel_spokes_15.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_wheel_spokes_15) {
    mesh_wheel_spokes_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wheel_spokes_15 = new THREE.Mesh(
    mesh_wheel_spokes_15Geometry,
    materialMap["green-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wheel_spokes_15.name = "Front and rear spoke rhythm";
  if (endpoint_wheel_spokes_15) {
    mesh_wheel_spokes_15.position.copy(endpoint_wheel_spokes_15.midpoint);
    mesh_wheel_spokes_15.quaternion.copy(endpoint_wheel_spokes_15.quaternion);
  }
  mesh_wheel_spokes_15.castShadow = options.castShadow ?? true;
  mesh_wheel_spokes_15.receiveShadow = options.receiveShadow ?? true;
  mesh_wheel_spokes_15.userData.sculptComponent = {"id": "wheel-spokes", "name": "Front and rear spoke rhythm", "level": "micro", "role": "wheel-spokes", "importance": 0.55, "confidence": 0.68, "primitive": "instanced-cluster", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "wheel-front", "attachment": {"parentId": "wheel-front", "parentSocket": "rim-center", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.38, "height": 0.04, "depth": 0.38, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "green-metal", "materialLayers": ["green-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["radial-spokes", "wheel-spokes"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["radial-spokes"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(5, 184, 102, 1.0)", "secondaryAlbedo": "rgba(6, 75, 47, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(5, 184, 102, 1.0)"}, {"position": 1, "color": "rgba(6, 75, 47, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wheel_spokes_15.add(mesh_wheel_spokes_15);
  meshes["wheel-spokes"] = mesh_wheel_spokes_15;
  colliders["wheel-spokes"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wheel_spokes_15);

  const attachment_wing_supports_16 = {"parentId": "rear-wing", "parentSocket": "wing-underface", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_wing_supports_16 = makeAttachmentEndpoint(attachment_wing_supports_16);
  const node_wing_supports_16 = new THREE.Group();
  node_wing_supports_16.name = "Rear wing supports__pivot";
  node_wing_supports_16.scale.set(1, 1, 1);
  if (endpoint_wing_supports_16) {
    node_wing_supports_16.position.copy(endpoint_wing_supports_16.start);
    node_wing_supports_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_wing_supports_16.position.set(0.0, -0.2, 0.0);
    node_wing_supports_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_wing_supports_16.userData.sculptComponent = {"id": "wing-supports", "name": "Rear wing supports", "level": "micro", "role": "wing-support", "importance": 0.55, "confidence": 0.68, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rear-wing", "attachment": {"parentId": "rear-wing", "parentSocket": "wing-underface", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.44, "depth": 0.08, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, -0.2, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, -0.2, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["paired-supports"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["paired-supports"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wing_supports_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, -0.2, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["rear-wing"] ?? root).add(node_wing_supports_16);
  nodes["wing-supports"] = node_wing_supports_16;
  const mesh_wing_supports_16Geometry = endpoint_wing_supports_16
    ? new THREE.CylinderGeometry(endpoint_wing_supports_16.endRadius, endpoint_wing_supports_16.baseRadius, endpoint_wing_supports_16.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_wing_supports_16) {
    mesh_wing_supports_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_wing_supports_16 = new THREE.Mesh(
    mesh_wing_supports_16Geometry,
    materialMap["black-aero"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wing_supports_16.name = "Rear wing supports";
  if (endpoint_wing_supports_16) {
    mesh_wing_supports_16.position.copy(endpoint_wing_supports_16.midpoint);
    mesh_wing_supports_16.quaternion.copy(endpoint_wing_supports_16.quaternion);
  }
  mesh_wing_supports_16.castShadow = options.castShadow ?? true;
  mesh_wing_supports_16.receiveShadow = options.receiveShadow ?? true;
  mesh_wing_supports_16.userData.sculptComponent = {"id": "wing-supports", "name": "Rear wing supports", "level": "micro", "role": "wing-support", "importance": 0.55, "confidence": 0.68, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "rear-wing", "attachment": {"parentId": "rear-wing", "parentSocket": "wing-underface", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.08, "height": 0.44, "depth": 0.08, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, -0.2, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, -0.2, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "black-aero", "materialLayers": ["black-aero"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["paired-supports"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["paired-supports"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_wing_supports_16.add(mesh_wing_supports_16);
  meshes["wing-supports"] = mesh_wing_supports_16;
  colliders["wing-supports"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_wing_supports_16);

  const attachment_lamp_internals_17 = {"parentId": "headlamp", "parentSocket": "lamp-core", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lamp_internals_17 = makeAttachmentEndpoint(attachment_lamp_internals_17);
  const node_lamp_internals_17 = new THREE.Group();
  node_lamp_internals_17.name = "Headlamp internal accents__pivot";
  node_lamp_internals_17.scale.set(1, 1, 1);
  if (endpoint_lamp_internals_17) {
    node_lamp_internals_17.position.copy(endpoint_lamp_internals_17.start);
    node_lamp_internals_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lamp_internals_17.position.set(0.0, 0.0, 0.0);
    node_lamp_internals_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_lamp_internals_17.userData.sculptComponent = {"id": "lamp-internals", "name": "Headlamp internal accents", "level": "micro", "role": "lamp-detail", "importance": 0.55, "confidence": 0.68, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "headlamp", "attachment": {"parentId": "headlamp", "parentSocket": "lamp-core", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.04, "depth": 0.14, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brake-metal", "materialLayers": ["brake-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["lamp-internal"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["lamp-internal"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_lamp_internals_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}};
  (nodes["headlamp"] ?? root).add(node_lamp_internals_17);
  nodes["lamp-internals"] = node_lamp_internals_17;
  const mesh_lamp_internals_17Geometry = endpoint_lamp_internals_17
    ? new THREE.CylinderGeometry(endpoint_lamp_internals_17.endRadius, endpoint_lamp_internals_17.baseRadius, endpoint_lamp_internals_17.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_lamp_internals_17) {
    mesh_lamp_internals_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lamp_internals_17 = new THREE.Mesh(
    mesh_lamp_internals_17Geometry,
    materialMap["brake-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lamp_internals_17.name = "Headlamp internal accents";
  if (endpoint_lamp_internals_17) {
    mesh_lamp_internals_17.position.copy(endpoint_lamp_internals_17.midpoint);
    mesh_lamp_internals_17.quaternion.copy(endpoint_lamp_internals_17.quaternion);
  }
  mesh_lamp_internals_17.castShadow = options.castShadow ?? true;
  mesh_lamp_internals_17.receiveShadow = options.receiveShadow ?? true;
  mesh_lamp_internals_17.userData.sculptComponent = {"id": "lamp-internals", "name": "Headlamp internal accents", "level": "micro", "role": "lamp-detail", "importance": 0.55, "confidence": 0.68, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Visible hard-surface assembly is separated into overlapping solid parts so the silhouette and contact seams remain editable.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "headlamp", "attachment": {"parentId": "headlamp", "parentSocket": "lamp-core", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.08, 0.0, 0.0], "contactType": "overlap", "overlap": 0.04, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.14, "height": 0.04, "depth": 0.14, "units": "relative", "confidence": 0.78}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "local", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.72}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "base"}}, "material": "brake-metal", "materialLayers": ["brake-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["lamp-internal"], "surfaceDetail": {"macroRoughness": 0.12, "microRoughness": 0.08, "bumpAmplitude": 0.025, "normalPattern": "subtle automotive surface breakup", "displacementPattern": "none", "occlusionPattern": "contact seams and wheel wells", "edgeWearPattern": "minimal showroom wear", "notes": "Approximate procedural response; hidden surfaces remain inferred."}, "evidenceRefs": ["full-object"], "details": ["lamp-internal"], "fidelityTier": "surface-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(17, 20, 22, 1.0)", "secondaryAlbedo": "rgba(46, 52, 54, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.86, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(17, 20, 22, 1.0)"}, {"position": 1, "color": "rgba(46, 52, 54, 1.0)"}]}, "evidenceRefs": ["full-object"]}};
  node_lamp_internals_17.add(mesh_lamp_internals_17);
  meshes["lamp-internals"] = mesh_lamp_internals_17;
  colliders["lamp-internals"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_lamp_internals_17);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "runtime-first", "materialPass": {"minimumTextureResolution": 512, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7}, "limitation": "Procedural materials are used because the source is a single watermarked image with baked lighting."}, "lightingPass": {"key": "large softbox key above front quarter", "fill": "cool low-intensity fill from camera side", "rim": "narrow rim along roof and rear wing", "toneMapping": "ACES Filmic", "exposure": 1.0, "contactShadow": "soft ground contact under tires and splitter"}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createPorsche911GT3RSShowroomReconstructionLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Porsche 911 GT3 RS showroom reconstruction look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["large softbox key from upper front quarter", "cool ambient fill in the cabin and wheel wells", "rim highlight along roof, hood and rear wing", "ACES Filmic tone mapping with exposure 1.0", "soft contact shadow beneath tires and lower aero"];
  lights.userData.lookDevTargets = {"qualityPriority": "runtime-first", "materialPass": {"minimumTextureResolution": 512, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7}, "limitation": "Procedural materials are used because the source is a single watermarked image with baked lighting."}, "lightingPass": {"key": "large softbox key above front quarter", "fill": "cool low-intensity fill from camera side", "rim": "narrow rim along roof and rear wing", "toneMapping": "ACES Filmic", "exposure": 1.0, "contactShadow": "soft ground contact under tires and splitter"}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createPorsche911GT3RSShowroomReconstructionEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function framePorsche911GT3RSShowroomReconstructionCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createPorsche911GT3RSShowroomReconstructionPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configurePorsche911GT3RSShowroomReconstructionRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createPorsche911GT3RSShowroomReconstructionInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
