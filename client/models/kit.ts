import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// The building blocks every model is made from. A model is a list of
// coloured primitive parts merged into one geometry, drawn with the one
// shared flat-shaded material --- so every asset gets the same faceted look
// by construction rather than by each one remembering to.

export const sharedMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 1,
  metalness: 0,
});

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

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("model parts failed to merge");
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export function mesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  const m = new THREE.Mesh(geometry, sharedMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
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
