import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";
import { OUTLINE } from "../../shared/palette.ts";

// The building blocks every model is made from. A model is a list of
// coloured primitive parts merged into one geometry, drawn with one of a
// few shared flat-shaded materials --- so every asset gets the same faceted
// look by construction rather than by each one remembering to. Colour
// grading isn't done here: it's one full-screen pass (client/postprocess.ts,
// tuned from client/assets/grade.ts), so it can change without touching a
// model.

/** paint, concrete, fabric, plastic: no highlight */
export const sharedMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.95,
  metalness: 0,
});

/** sealed floors and lino: a soft sheen, so a lamp leaves a pool on the floor rather than just lighting it */
export const tileMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.6,
  metalness: 0,
});

/** bare metal: guns, rack cabinets, the reactor's shell --- a tight highlight */
export const glossyMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.38,
  metalness: 0.6,
});

/**
 * Light-emitting parts: lamp tubes, indicator LEDs, screens. Unlit, so they
 * stay their colour in the dark --- the only parts allowed outside the
 * surface gamut. Tone mapping is left on so very bright lamps roll off
 * instead of clipping.
 */
export const emissiveMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });

/**
 * Bake a colour into a primitive and position it. Scale (X and Z only,
 * for flattening a round primitive) comes first, then rotation (XYZ
 * order), then translation, so (x, y, z) is where the part's own center
 * ends up.
 */
export function part(
  geometry: THREE.BufferGeometry,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sz = 1,
): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Some primitives (Polyhedron/Extrude) differ in which attributes they
  // carry; keep just what the material reads so any set of parts merges.
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "color") g.deleteAttribute(name);
  }
  return g;
}

/**
 * How a model's ambient occlusion is baked: against its own parts only, or
 * also against the ground plane at y = 0 (for models that stand on it, so
 * their bases darken where they meet the floor).
 */
export type AO = "self" | "ground" | "none";

/** `reach` is how far (world units) occluders count: roughly the size of the model's creases. */
export function merge(parts: THREE.BufferGeometry[], ao: AO = "ground", reach = 0.6): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("model parts failed to merge");
  merged.computeVertexNormals();
  if (ao !== "none") bakeAO(merged, ao === "ground", reach);
  merged.computeBoundingSphere();
  return merged;
}

// Fixed, cosine-distributed directions over the +Y hemisphere (a Fibonacci
// spiral), rotated onto each vertex's normal. Fixed rather than random so
// every client bakes the identical result.
const AO_RAYS = 24;
const AO_DARKEST = 0.55;
const hemisphere = Array.from({ length: AO_RAYS }, (_, i) => {
  const u = (i + 0.5) / AO_RAYS;
  const r = Math.sqrt(u);
  const a = i * 2.399963; // golden angle
  return new THREE.Vector3(r * Math.cos(a), Math.sqrt(1 - u), r * Math.sin(a));
});

/**
 * Ambient occlusion baked into the vertex colours once, when the model is
 * built: from each vertex, cast a short fan of rays around its normal and
 * darken it by the share that hit something. Creases, undersides and the
 * foot of a model darken; open faces stay as they are. Zero cost per frame,
 * which is the point --- screen-space AO would cost milliseconds every frame
 * on a laptop GPU.
 */
function bakeAO(geometry: THREE.BufferGeometry, ground: boolean, reach: number): void {
  const bvh = new MeshBVH(geometry, { indirect: true });
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const color = geometry.attributes.color;
  const ray = new THREE.Ray();
  const n = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(normal, i);
    q.setFromUnitVectors(up, n);
    let hits = 0;
    for (const dir of hemisphere) {
      ray.origin.fromBufferAttribute(pos, i).addScaledVector(n, 0.002);
      ray.direction.copy(dir).applyQuaternion(q);
      if (ground && ray.direction.y < 0 && -ray.origin.y / ray.direction.y < reach) {
        hits++;
        continue;
      }
      if (bvh.raycastFirst(ray, THREE.DoubleSide, 0, reach)) hits++;
    }
    const k = THREE.MathUtils.lerp(1, AO_DARKEST, hits / AO_RAYS);
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
  }
  color.needsUpdate = true;
}

const outlineMaterial = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });

/**
 * A dark outline around a model, by the inverted-hull trick: a copy of the
 * geometry pushed out along smoothed normals and drawn back-faces only, so
 * only the rim around the model shows. One extra draw, no post-processing
 * pass. Only players and things you can pick up get one --- it's what makes
 * them pop off the pale ground; scenery reads through AO and shadow instead.
 */
export function outlined(m: THREE.Mesh, width = 0.03): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", m.geometry.attributes.position.clone());
  const hull = mergeVertices(g, 1e-4);
  hull.computeVertexNormals();
  const p = hull.attributes.position;
  const nrm = hull.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + nrm.getX(i) * width, p.getY(i) + nrm.getY(i) * width, p.getZ(i) + nrm.getZ(i) * width);
  }
  const shell = new THREE.Mesh(hull, outlineMaterial);
  shell.raycast = () => {}; // picking should hit the model, not its outline
  m.add(shell);
  return m;
}

export type Finish = "matte" | "tile" | "glossy" | "emissive";
export const FINISHES: Finish[] = ["matte", "tile", "glossy", "emissive"];
const materialFor: Record<Finish, THREE.Material> = {
  matte: sharedMaterial,
  tile: tileMaterial,
  glossy: glossyMaterial,
  emissive: emissiveMaterial,
};

export function mesh(geometry: THREE.BufferGeometry, finish: Finish = "matte"): THREE.Mesh {
  const m = new THREE.Mesh(geometry, materialFor[finish]);
  m.castShadow = finish !== "emissive";
  m.receiveShadow = finish !== "emissive";
  return m;
}

/**
 * A model made of more than one finish (a lamp's housing and its glowing
 * tube): one geometry per finish, so it's still one draw call per material.
 */
export type Pieces = Partial<Record<Finish, THREE.BufferGeometry[]>>;

export function multiMesh(pieces: Pieces): THREE.Group {
  const g = new THREE.Group();
  for (const finish of FINISHES) {
    const list = pieces[finish];
    if (!list || list.length === 0) continue;
    const merged = list.length === 1 ? list[0] : mergeGeometries(list);
    if (merged) g.add(mesh(merged, finish));
  }
  return g;
}

/** an emissive part: colour baked like any part, but no AO --- light isn't occluded by itself */
export function glowPart(
  geometry: THREE.BufferGeometry,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  const g = part(geometry, color, x, y, z, rx, ry, rz);
  g.computeVertexNormals();
  return g;
}

/**
 * Seeded PRNG (mulberry32). Every bit of randomness in the world's look
 * goes through one of these, so every client builds the same rocks, trees
 * and ground from the same seed.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nudge every vertex of a geometry by up to `amount` in each axis.
 * Vertices that share a position move together (keyed on their rounded
 * coordinates), so faces stay closed even on non-indexed geometry.
 */
export function jitter(geometry: THREE.BufferGeometry, amount: number, random: () => number): THREE.BufferGeometry {
  const pos = geometry.attributes.position;
  const offsets = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let o = offsets.get(key);
    if (!o) {
      o = [(random() * 2 - 1) * amount, (random() * 2 - 1) * amount, (random() * 2 - 1) * amount];
      offsets.set(key, o);
    }
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  pos.needsUpdate = true;
  return geometry;
}

/**
 * A flat side profile, extruded sideways (along X) to `depth` and centered
 * on X. Points are (z, y) pairs: forward and up, as the model sees itself.
 * The way to get a recognisable silhouette --- a gun stock, a sight post ---
 * without sculpting anything.
 */
export function profile(points: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // the shape lies in XY with extrusion along +Z; turn it so the profile's
  // first axis runs along Z (forward) and the extrusion along X
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  return g;
}
