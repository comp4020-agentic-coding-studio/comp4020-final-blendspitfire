import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  FENCES,
  LIFT_CARS,
  LIFT_DZ,
  SCOREBOARD,
  SURFACE,
  SURFACE_FIXTURES,
  SURFACE_VIEW_MARGIN,
  type Obstacle,
  type SurfaceFixture,
} from "../../shared/protocol.ts";
import { rng } from "../models/kit.ts";

// The garden on the surface: where everyone arrives, learns the controls,
// and takes the lift down. The story it tells: a town that fell --- broken
// concrete, rebar, burnt-out cars, a crane down across a street, containers
// and pipe left where they were dropped, all gone to grass --- that a corp's
// crew has just fenced off a patch of and moved into: fresh chain-link,
// drop crates and a field tent. It's deliberately the facility's opposite ---
// and deliberately outside docs/art-and-interaction.md, which governs the
// underground only. Up here the brief is an impressionist painting: warm
// sun, soft blue shade, saturated young greens, flowers as dabs of colour.
// Still low-poly and still flat-shaded, so a player walking out of the
// lift is plainly in the same game; but its own materials, its own
// palette, a real sun with shadows, and its own grade (client/postprocess.ts
// "paint") in place of the facility's.

const { PI } = Math;

/** colours by eye, not from the facility's greyed palette */
const C = {
  // young greens leaning both ways --- toward yellow in the light, toward
  // blue in the shade --- so the lawn is many greens, never one
  lawn: [0x9cc47c, 0xa9cc80, 0x8fbb7a, 0xb4cf88, 0x93c08e, 0xbdd18e],
  lawnDark: 0x7fa96c,
  path: [0xe6d7b8, 0xeedfc2, 0xdccbaa, 0xe9dcc8],
  hedge: [0x5f8f5c, 0x6a9a5e, 0x557f5a, 0x709c6a],
  leaf: [0x8cbf6a, 0x9fc977, 0x7fb070, 0xb0cf80, 0x88b88c],
  trunk: 0x8a6a4a,
  flower: [0xf6dc7a, 0xf2a6b4, 0xfaf6ee, 0xc7b2e8, 0xf0b088],
  wood: 0xc4a37e,
  woodDark: 0x9a7d62,
  stone: 0xe9e1d2,
  stoneShade: 0xc9bfae,
  terracotta: 0xc99474,
  roof: 0xb86a4f,
  plaster: 0xf3e8d4,
  plasterShade: 0xe2d2b8,
  targetRed: 0xe8574a,
  targetWhite: 0xfaf4ea,
  boardFrame: 0x4a5560,
  boardScreen: 0x1b2730,
  water: 0x9fd8e8,
  // the fallen town: sun-bleached concrete, soot, iron gone to rust, faded paint
  ruin: [0xa8a49c, 0x9c978e, 0xb4afa6, 0x8e8a82],
  ruinShade: 0x7a766e,
  soot: [0x5a5652, 0x6a645e, 0x4c4844],
  moss: 0x8aa868,
  // what's grown over the ruins since the town fell: darker, shaggier,
  // muddier than the garden's trimmed, sun-bright greens --- these never
  // get cut back
  wildLeaf: [0x4f6e42, 0x3f5c38, 0x5a7a4a, 0x46633c, 0x567048],
  mossDark: [0x6a7a52, 0x5a6c46, 0x7a8a5c, 0x4f5e42],
  rust: [0xb0704a, 0x9a5e40, 0xc08058, 0x8a5238],
  faded: [0x8aa0a8, 0xb89a6a, 0x9a7a72, 0x7f9a80, 0xc4b07a],
  // the corp's kit: olive drab, khaki canvas, fresh hazard yellow, galvanised steel
  drab: 0x6f7550,
  drabDark: 0x5a6040,
  canvas: 0xcbbb8e,
  canvasShade: 0xb3a376,
  hazard: 0xe8c14a,
  steel: 0xa8aeb0,
  steelDark: 0x80878a,
  dirt: 0xb89c78,
} as const;

/** soft materials: no metal, a little sheen on the lawn so the sun reads on it */
const paintMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 });
const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });

function tint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const colors = new Float32Array(out.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  out.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "color") out.deleteAttribute(name);
  return out;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry => {
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};
const pick = <T>(list: readonly T[], r: () => number): T => list[Math.floor(r() * list.length)];

/** a puff of foliage: a squashed icosahedron, its vertices nudged so no two match */
function puff(r: number, color: number, random: () => number, squash = 0.8): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(1, squash, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (random() - 0.5) * 0.18;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  return tint(g, color);
}

function lawn(parts: THREE.BufferGeometry[], random: () => number): void {
  // a broad base, then a patchwork of slightly different greens, like brush
  // strokes laid side by side --- out past the fence too, as far as sight goes
  const S = SURFACE;
  const pad = SURFACE_VIEW_MARGIN + 4;
  // (not past the south hedge: the lift car's floor is there)
  const south = S.maxZ + 0.6;
  parts.push(tint(at(box(S.maxX - S.minX + pad * 2, 0.04, south - S.minZ + pad), (S.minX + S.maxX) / 2, -0.02, (S.minZ - pad + south) / 2), C.lawnDark));
  // and either side of the lift house, south past the fence, where the car isn't
  const car = LIFT_CARS.top;
  for (const side of [-1, 1]) {
    const inner = side < 0 ? car.minX - 0.9 : car.maxX + 0.9;
    const outer = side < 0 ? S.minX - pad : S.maxX + pad;
    parts.push(tint(at(box(Math.abs(outer - inner), 0.04, 12), (inner + outer) / 2, -0.02, south + 6), C.lawnDark));
  }
  // the strokes only where they're seen up close: inside the fence and a margin past it
  const strokes = 7;
  for (let x = S.minX - strokes; x < S.maxX + strokes; x += 0.7) {
    for (let z = S.minZ - strokes; z < south - 0.6; z += 0.7) {
      const w = 0.6 + random() * 0.6;
      const d = 0.25 + random() * 0.3;
      parts.push(tint(at(box(w, 0.02, d), x + random() * 0.6, 0.005 + random() * 0.01, z + random() * 0.6, random() * PI), pick(C.lawn, random)));
    }
  }
  // tufts and flowers scattered over it
  for (let i = 0; i < 260; i++) {
    const x = S.minX + random() * (S.maxX - S.minX);
    const z = S.minZ + random() * (S.maxZ - S.minZ);
    if (onPath(x, z)) continue;
    if (random() < 0.45) {
      const color = pick(C.flower, random);
      parts.push(tint(at(new THREE.IcosahedronGeometry(0.07 + random() * 0.05, 0), x, 0.1, z), color));
      parts.push(tint(at(box(0.02, 0.1, 0.02), x, 0.05, z), C.lawnDark));
    } else {
      parts.push(tint(at(new THREE.ConeGeometry(0.08, 0.18 + random() * 0.1, 4), x, 0.1, z, random() * PI), pick(C.leaf, random)));
    }
  }
}

/** the gravel path: from the lift door north to the scoreboard, with a branch west to the range */
const PATHS = [
  { minX: -1.6, maxX: 1.6, minZ: SURFACE.minZ + 1.5, maxZ: SURFACE.maxZ },
  { minX: -11, maxX: 7, minZ: SURFACE.minZ + 4.4, maxZ: SURFACE.minZ + 6.2 },
  { minX: 2.4, maxX: 5.6, minZ: SURFACE.minZ + 1.2, maxZ: SURFACE.minZ + 4.4 },
];
const onPath = (x: number, z: number): boolean => PATHS.some((p) => x > p.minX - 0.2 && x < p.maxX + 0.2 && z > p.minZ - 0.2 && z < p.maxZ + 0.2);

function paths(parts: THREE.BufferGeometry[], random: () => number): void {
  for (const p of PATHS) {
    parts.push(tint(at(box(p.maxX - p.minX + 0.3, 0.03, p.maxZ - p.minZ + 0.3), (p.minX + p.maxX) / 2, 0.025, (p.minZ + p.maxZ) / 2), C.path[2]));
    for (let x = p.minX; x < p.maxX; x += 0.55) {
      for (let z = p.minZ; z < p.maxZ; z += 0.55) {
        const s = 0.4 + random() * 0.25;
        parts.push(tint(at(box(s, 0.03, s * (0.7 + random() * 0.5)), x + 0.27, 0.03, z + 0.27, random() * PI), pick(C.path, random)));
      }
    }
  }
}

/**
 * The perimeter fence, put up by the corp round its dig: galvanised posts
 * every couple of metres, a top rail, and the mesh between drawn as a few
 * thin wires so it reads as a fence from overhead without hiding what's
 * past it. Hazard tags on some posts; weeds already climbing the bottom.
 */
function fenceModel(h: Obstacle, parts: THREE.BufferGeometry[], random: () => number): void {
  const alongX = h.halfX >= h.halfZ;
  const len = (alongX ? h.halfX : h.halfZ) * 2;
  const height = 1.9;
  const place = (t: number, y: number, g: THREE.BufferGeometry, color: number) =>
    parts.push(tint(at(g, h.x + (alongX ? t : 0), y, h.z + (alongX ? 0 : t)), color));
  const run = (w: number, th: number) => (alongX ? box(w, th, th) : box(th, th, w));
  for (let t = -len / 2; t <= len / 2 + 0.01; t += 2.2) {
    place(t, height / 2, new THREE.CylinderGeometry(0.05, 0.06, height, 6), C.steelDark);
    if (random() < 0.3) place(t, 1.2, alongX ? box(0.3, 0.2, 0.04) : box(0.04, 0.2, 0.3), C.hazard);
    if (random() < 0.5) parts.push(at(puff(0.22, pick(C.leaf, random), random), h.x + (alongX ? t + 0.3 : 0.1), 0.15, h.z + (alongX ? 0.1 : t + 0.3)));
  }
  place(0, height, run(len, 0.06), C.steel);
  for (const y of [0.45, 0.9, 1.35]) place(0, y, run(len, 0.02), C.steelDark);
}

/** a ragged clump of tall weeds: darker and shaggier than the lawn's trimmed tufts, grown wild over the ruins */
function weedTuft(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, scale = 1): void {
  const n = 3 + Math.floor(random() * 4);
  for (let i = 0; i < n; i++) {
    const h = (0.3 + random() * 0.35) * scale;
    const blade = new THREE.ConeGeometry(0.05 * scale, h, 4);
    blade.translate(0, h / 2, 0);
    blade.rotateZ((random() - 0.5) * 0.5);
    blade.rotateX((random() - 0.5) * 0.3);
    parts.push(tint(at(blade, x + (random() - 0.5) * 0.3 * scale, 0, z + (random() - 0.5) * 0.3 * scale, random() * PI), pick(C.wildLeaf, random)));
  }
}

/** a low mat of moss, flattened and dark, grown over whatever it sits on */
function mossPatch(parts: THREE.BufferGeometry[], random: () => number, x: number, y: number, z: number, r: number): void {
  const n = 3 + Math.floor(random() * 3);
  for (let i = 0; i < n; i++) {
    parts.push(at(puff(r * (0.4 + random() * 0.5), pick(C.mossDark, random), random, 0.35), x + (random() - 0.5) * r, y, z + (random() - 0.5) * r));
  }
}

/** a trail of vine climbing (or hanging down) a vertical face: a few drooping strands of leaf clumps */
function vineHang(parts: THREE.BufferGeometry[], random: () => number, x: number, topY: number, z: number, dropLen: number): void {
  const strands = 2 + Math.floor(random() * 2);
  for (let s = 0; s < strands; s++) {
    const sx = x + (random() - 0.5) * 0.5;
    const sz = z + (random() - 0.5) * 0.3;
    const len = dropLen * (0.6 + random() * 0.5);
    const stem = new THREE.CylinderGeometry(0.015, 0.02, len, 4);
    stem.translate(0, -len / 2, 0);
    parts.push(tint(at(stem, sx, topY, sz), pick(C.wildLeaf, random)));
    const leaves = 2 + Math.floor(random() * 3);
    for (let i = 0; i < leaves; i++) {
      const t = (i + 0.5) / leaves;
      parts.push(at(puff(0.1 + random() * 0.08, pick(C.wildLeaf, random), random, 0.6), sx + (random() - 0.5) * 0.15, topY - len * t, sz + (random() - 0.5) * 0.15));
    }
  }
}

/** rebar bristling out of a broken edge: a few thin rusty rods at odd angles */
function rebar(parts: THREE.BufferGeometry[], random: () => number, x: number, y: number, z: number, n = 4, len = 0.6): void {
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(0.025, 0.025, len * (0.5 + random()), 4);
    g.rotateZ((random() - 0.5) * 1.6);
    g.rotateX((random() - 0.5) * 1.2);
    parts.push(tint(at(g, x + (random() - 0.5) * 0.5, y + 0.2, z + (random() - 0.5) * 0.5), pick(C.rust, random)));
  }
}

/** a stump of reinforced-concrete column, sheared off, its rebar showing */
function ruinPillar(f: SurfaceFixture, parts: THREE.BufferGeometry[], random: () => number): void {
  const h = f.halfHeight * 2;
  parts.push(tint(at(box(f.halfX * 1.7, h, f.halfZ * 1.7), f.x, h / 2, f.z, random() * 0.3), pick(C.ruin, random)));
  // the break: a slanted cap of shade and a scorch down one face
  parts.push(tint(at(box(f.halfX * 1.75, 0.08, f.halfZ * 1.2), f.x, h - 0.02, f.z + 0.1, 0.2), C.ruinShade));
  parts.push(tint(at(box(f.halfX * 0.9, h * 0.6, 0.03), f.x, h * 0.4, f.z + f.halfZ * 0.86), pick(C.soot, random)));
  rebar(parts, random, f.x, h, f.z, 5, 0.5);
  parts.push(tint(at(box(f.halfX * 2.4, 0.06, f.halfZ * 2.4), f.x, 0.03, f.z), C.ruinShade));
  for (let i = 0; i < 5; i++) parts.push(tint(at(new THREE.DodecahedronGeometry(0.08 + random() * 0.1, 0), f.x + (random() - 0.5) * 1.8, 0.06, f.z + (random() - 0.5) * 1.8), pick(C.ruin, random)));
  // grown over: moss up the shady side, weeds at the foot, a vine hanging off the broken cap
  mossPatch(parts, random, f.x - f.halfX * 0.4, h * 0.3, f.z, f.halfZ * 1.3);
  for (let i = 0; i < 3; i++) weedTuft(parts, random, f.x + (random() - 0.5) * 1.8, f.z + (random() - 0.5) * 1.8);
  vineHang(parts, random, f.x + f.halfX * 0.5, h, f.z, h * 0.7);
}

/** a floor slab come down whole and cracked across, rebar out of the break */
function ruinLintel(f: SurfaceFixture, parts: THREE.BufferGeometry[], random: () => number): void {
  const len = f.halfX * 2;
  const h = f.halfHeight * 2;
  parts.push(tint(at(box(len * 0.55, h, f.halfZ * 2), f.x - len * 0.22, h / 2, f.z, 0.06), pick(C.ruin, random)));
  parts.push(tint(at(box(len * 0.42, h * 0.9, f.halfZ * 1.9), f.x + len * 0.3, h * 0.45, f.z + 0.05, -0.12), pick(C.ruin, random)));
  rebar(parts, random, f.x + len * 0.06, h * 0.6, f.z, 6, 0.45);
  parts.push(tint(at(box(len * 0.3, 0.02, f.halfZ * 1.4), f.x - len * 0.25, h + 0.01, f.z), pick(C.soot, random)));
  weedTuft(parts, random, f.x - len * 0.3, f.z, 0.7);
  weedTuft(parts, random, f.x + len * 0.25, f.z - f.halfZ, 0.7);
  mossPatch(parts, random, f.x, h * 0.6, f.z, f.halfZ * 1.2);
}

// --- The fallen town: wreck builders (outside the fence, and low ones inside) ---

/** a burnt-out car: a sooty shell on its rims, the roof caved, glass long gone */
function wreckCar(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, ry: number): void {
  const paint = random() < 0.5 ? pick(C.faded, random) : pick(C.rust, random);
  const g = (gg: THREE.BufferGeometry, lx: number, y: number, lz: number) => {
    gg.translate(lx, y, lz);
    gg.rotateY(ry);
    gg.translate(x, 0, z);
    return gg;
  };
  parts.push(tint(g(box(1.7, 0.45, 3.6), 0, 0.38, 0), paint));
  parts.push(tint(g(box(1.5, 0.38, 1.8), 0, 0.78, -0.2), pick(C.soot, random)));
  parts.push(tint(g(box(1.3, 0.04, 1.5), 0, 0.98, -0.2), pick(C.soot, random)));
  for (const sx of [-0.8, 0.8]) for (const sz of [-1.2, 1.2]) {
    const w = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 7);
    w.rotateZ(PI / 2);
    parts.push(tint(g(w, sx, 0.22, sz), C.soot[2]));
  }
  // weeds grown up through the undercarriage and round the wheels
  weedTuft(parts, random, x, z, 0.7);
  if (random() < 0.5) mossPatch(parts, random, x, 0.42, z, 1);
}

/** a shipping container, dented, door hanging, faded paint and rust streaks */
function container(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, ry: number, y = 0): void {
  const c = pick(C.faded, random);
  const g = (gg: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
    gg.translate(lx, ly, lz);
    gg.rotateY(ry);
    gg.translate(x, y, z);
    return gg;
  };
  parts.push(tint(g(box(2.4, 2.5, 6), 0, 1.25, 0), c));
  for (let i = -2; i <= 2; i++) parts.push(tint(g(box(2.44, 2.3, 0.08), 0, 1.25, i * 1.15), C.ruinShade));
  parts.push(tint(g(box(2.46, 0.08, 6.04), 0, 2.5, 0), pick(C.rust, random)));
  parts.push(tint(g(box(1.1, 2.3, 0.06), 1.4, 1.2, 3.3), c));
  weedTuft(parts, random, x, z, 0.7);
}

/** a fallen tower-crane jib: a long lattice boom lying across the ground, its cab crushed at one end */
function craneJib(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, ry: number, len: number): void {
  const g = (gg: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
    gg.translate(lx, ly, lz);
    gg.rotateY(ry);
    gg.translate(x, 0, z);
    return gg;
  };
  for (const sx of [-0.45, 0.45]) {
    parts.push(tint(g(box(0.12, 0.12, len), sx, 0.12, 0), C.hazard));
    parts.push(tint(g(box(0.1, 0.1, len), sx * 0.4, 0.95, 0), C.hazard));
  }
  for (let t = -len / 2; t < len / 2; t += 0.9) {
    const d = box(0.07, 1.1, 0.07);
    d.rotateX(0.7);
    parts.push(tint(g(d, -0.45, 0.55, t + 0.4), pick(C.rust, random)));
    const d2 = box(0.07, 1.1, 0.07);
    d2.rotateX(-0.7);
    parts.push(tint(g(d2, 0.45, 0.55, t + 0.4), pick(C.rust, random)));
  }
  parts.push(tint(g(box(1.6, 1.2, 1.6), 0.2, 0.55, len / 2 + 0.6), C.hazard));
  parts.push(tint(g(box(1.4, 0.4, 1.4), 0.2, 1.1, len / 2 + 0.6), pick(C.soot, random)));
}

/** a toppled lattice pylon, lying on its side with its cables trailing */
function pylon(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, ry: number): void {
  const len = 9;
  const g = (gg: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
    gg.translate(lx, ly, lz);
    gg.rotateY(ry);
    gg.translate(x, 0, z);
    return gg;
  };
  for (const sx of [-1, 1]) for (const sy of [0.15, 1.3]) {
    const leg = box(0.1, 0.1, len);
    parts.push(tint(g(leg, sx * (0.9 - sy * 0.4), sy, 0), C.steelDark));
  }
  for (let t = -len / 2; t < len / 2; t += 1) parts.push(tint(g(box(1.6, 0.06, 0.06), 0, 0.7, t), C.steel));
  parts.push(tint(g(box(3.2, 0.12, 0.12), 0, 1.0, len / 2 - 0.4), C.steelDark));
  for (const sx of [-1.5, 1.5]) parts.push(tint(g(box(0.03, 0.03, 4), sx, 0.04, len / 2 + 2), C.soot[2]));
}

/** a run of large pipe sections dropped in a heap */
function pipes(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, ry: number): void {
  const g = (gg: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
    gg.translate(lx, ly, lz);
    gg.rotateY(ry);
    gg.translate(x, 0, z);
    return gg;
  };
  const rows: [number, number][] = [
    [-0.75, 0.42],
    [0, 0.42],
    [0.75, 0.42],
    [-0.38, 1.12],
    [0.38, 1.12],
  ];
  for (const [lx, ly] of rows) {
    const p = new THREE.CylinderGeometry(0.4, 0.4, 3 + random() * 0.6, 8, 1, true);
    p.rotateX(PI / 2);
    parts.push(tint(g(p, lx, ly, (random() - 0.5) * 0.4), pick([...C.rust, C.ruinShade], random)));
  }
}

/** what's left of a building: two walls meeting at a corner, window holes, a floor slab hanging off */
function buildingShell(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, ry: number): void {
  const w = 4 + random() * 3;
  const d = 3 + random() * 3;
  const h = 2.6 + random() * 2.4;
  const g = (gg: THREE.BufferGeometry, lx: number, ly: number, lz: number) => {
    gg.translate(lx, ly, lz);
    gg.rotateY(ry);
    gg.translate(x, 0, z);
    return gg;
  };
  const c = pick(C.ruin, random);
  // the long wall, stepped down where it broke, window holes cut by leaving gaps
  const segs = Math.round(w / 1.1);
  for (let i = 0; i < segs; i++) {
    const sh = h * (1 - (i / segs) * 0.6 * random());
    const lx = -w / 2 + (i + 0.5) * (w / segs);
    parts.push(tint(g(box(w / segs - 0.02, sh * 0.35, 0.3), lx, sh * 0.175, 0), c));
    if (i % 2 === 0) parts.push(tint(g(box(w / segs - 0.02, sh * 0.35, 0.3), lx, sh * 0.82, 0), c));
    parts.push(tint(g(box(0.32, sh, 0.3), lx - w / segs / 2 + 0.16, sh / 2, 0), c));
  }
  // the short wall
  parts.push(tint(g(box(0.3, h * 0.8, d), -w / 2, h * 0.4, d / 2), c));
  // a floor slab tipped down from the first storey
  const slab = box(w * 0.6, 0.18, d * 0.9);
  slab.rotateX(0.35);
  parts.push(tint(g(slab, -w * 0.15, h * 0.42, d * 0.45), C.ruinShade));
  rebar(parts, random, x, h * 0.55, z, 4, 0.7);
  // scorch and rubble at its foot
  parts.push(tint(g(box(w * 0.7, 0.02, d * 0.8), 0, 0.01, d * 0.5), pick(C.soot, random)));
  for (let i = 0; i < 7; i++) parts.push(tint(g(new THREE.DodecahedronGeometry(0.15 + random() * 0.3, 0), (random() - 0.5) * w, 0.12, random() * d), pick(C.ruin, random)));
  // reclaimed: weeds thick along the foot, moss up the walls, vines spilling off the slab --- this is the wild stage, long since left to the green
  for (let i = 0; i < 6; i++) weedTuft(parts, random, x + (random() - 0.5) * w * 1.4, z + (random() - 0.5) * d * 1.4, 0.8 + random() * 0.6);
  mossPatch(parts, random, x - w * 0.2, h * 0.15, z, Math.min(w, d) * 0.5);
  vineHang(parts, random, x - w * 0.15, h * 0.42, z + d * 0.45, h * 0.4);
}

/** broken slabs and loose concrete with rebar sticking out */
function rubbleHeap(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, spread = 1.6): void {
  for (let j = 0; j < 3; j++) {
    const s = box(0.4 + random() * 0.8, 0.1 + random() * 0.15, 0.35 + random() * 0.6);
    s.rotateX((random() - 0.5) * 0.5);
    s.rotateZ((random() - 0.5) * 0.5);
    parts.push(tint(at(s, x + (random() - 0.5) * spread, 0.15, z + (random() - 0.5) * spread, random() * PI), pick(C.ruin, random)));
  }
  weedTuft(parts, random, x + (random() - 0.5) * spread, z + (random() - 0.5) * spread, 0.7 + random() * 0.5);
  if (random() < 0.6) mossPatch(parts, random, x, 0.1, z, spread * 0.4);
  for (let j = 0; j < 7; j++) parts.push(tint(at(new THREE.DodecahedronGeometry(0.08 + random() * 0.14, 0), x + (random() - 0.5) * spread * 1.3, 0.06, z + (random() - 0.5) * spread * 1.3), pick(random() < 0.3 ? C.soot : C.ruin, random)));
  rebar(parts, random, x, 0.2, z, 3, 0.5);
}

/** a road's worth of cracked asphalt, so the town reads as streets, not a field */
function roadPatch(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, w: number, d: number): void {
  parts.push(tint(at(box(w, 0.03, d), x, 0.012, z), 0x6c6a66));
  for (let i = 0; i < Math.floor(Math.max(w, d) / 2.5); i++) {
    const along = w > d;
    parts.push(tint(at(box(along ? 1.1 : 0.12, 0.005, along ? 0.12 : 1.1), x + (along ? -w / 2 + 1.2 + i * 2.5 : 0), 0.03, z + (along ? 0 : -d / 2 + 1.2 + i * 2.5)), 0xd8d0b8));
  }
  for (let i = 0; i < 4; i++) weedTuft(parts, random, x + (random() - 0.5) * w, z + (random() - 0.5) * d, 0.6);
}

/** a stack of drop crates, olive drab with stencilled lids, strapped on a pallet */
function supplyCrates(f: SurfaceFixture, parts: THREE.BufferGeometry[], random: () => number): void {
  const alongX = f.halfX >= f.halfZ;
  const len = (alongX ? f.halfX : f.halfZ) * 2;
  const dep = (alongX ? f.halfZ : f.halfX) * 2;
  const h = f.halfHeight * 2;
  const g = (w: number, hh: number, d: number) => (alongX ? box(w, hh, d) : box(d, hh, w));
  const off = (t: number) => ({ x: f.x + (alongX ? t : 0), z: f.z + (alongX ? 0 : t) });
  parts.push(tint(at(g(len, 0.12, dep), f.x, 0.06, f.z), C.wood));
  const n = Math.max(2, Math.floor(len / 0.75));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (len / n) * (i + 0.5);
    const p = off(t);
    const ch = h - 0.12 - (i % 2) * 0.15;
    parts.push(tint(at(g(len / n - 0.06, ch, dep - 0.06), p.x, 0.12 + ch / 2, p.z), random() < 0.5 ? C.drab : C.drabDark));
    parts.push(tint(at(g((len / n) * 0.5, 0.01, dep * 0.3), p.x, 0.12 + ch + 0.005, p.z), C.hazard));
  }
  // a strap over the lot
  parts.push(tint(at(g(0.06, h + 0.02, dep + 0.02), f.x, h / 2 + 0.01, f.z), C.steelDark));
}

/** the crew's field tent: khaki canvas over a ridge, guy ropes, a crate of kit at the flap */
function fieldTent(f: SurfaceFixture, parts: THREE.BufferGeometry[]): void {
  const w = f.halfX * 2;
  const d = f.halfZ * 2;
  const h = f.halfHeight * 2;
  for (const side of [-1, 1]) {
    const roof = box(w, 0.05, d * 0.58);
    roof.rotateX(side * 0.95);
    parts.push(tint(at(roof, f.x, h * 0.55, f.z + side * d * 0.22), side < 0 ? C.canvas : C.canvasShade));
  }
  parts.push(tint(at(box(w + 0.1, 0.06, 0.06), f.x, h, f.z), C.drabDark));
  for (const dx of [-w / 2, w / 2]) parts.push(tint(at(new THREE.CylinderGeometry(0.035, 0.035, h, 5), f.x + dx, h / 2, f.z), C.drabDark));
  parts.push(tint(at(box(w + 1.2, 0.02, d + 1), f.x, 0.01, f.z), C.dirt));
  parts.push(tint(at(box(0.6, 0.4, 0.4), f.x + w / 2 + 0.5, 0.2, f.z + 0.4), C.drab));
}

/**
 * Past the fence, where nobody can go but everyone can see: the town that
 * fell. Streets of cracked asphalt, building shells, burnt cars, a crane
 * down across the north road, containers and pipe, a pylon on its side,
 * rubble everywhere in between --- dense enough that the view never runs
 * out into empty grass. Seeded, so every client has the same.
 */
function outsideRuins(parts: THREE.BufferGeometry[], random: () => number): void {
  const S = SURFACE;
  const m = SURFACE_VIEW_MARGIN;
  // streets just outside the fence, round three sides
  roadPatch(parts, random, (S.minX + S.maxX) / 2, S.minZ - 3.2, S.maxX - S.minX + 2 * m, 4);
  roadPatch(parts, random, S.minX - 3.2, (S.minZ + S.maxZ) / 2 + 1, 4, S.maxZ - S.minZ + m);
  roadPatch(parts, random, S.maxX + 3.2, (S.minZ + S.maxZ) / 2 + 1, 4, S.maxZ - S.minZ + m);
  // the landmarks, placed by hand so they frame the garden from every side
  craneJib(parts, random, -2, S.minZ - 3.4, PI / 2 + 0.08, 22);
  pylon(parts, random, S.maxX + 9, S.minZ + 5, 0.4);
  container(parts, random, S.minX - 8, S.minZ + 4, 0.15);
  container(parts, random, S.minX - 8.3, S.minZ + 4.2, 0.1, 2.5);
  container(parts, random, S.maxX + 7.5, S.maxZ - 3, -0.3);
  container(parts, random, 9, S.minZ - 10, PI / 2 - 0.2);
  pipes(parts, random, S.minX - 6.5, S.maxZ - 4, 0.6);
  pipes(parts, random, S.maxX + 6, S.minZ + 14, -0.9);
  wreckCar(parts, random, S.minX - 3.4, S.minZ + 8, 0.2);
  wreckCar(parts, random, S.minX - 2.8, S.maxZ - 7, PI + 0.4);
  wreckCar(parts, random, S.maxX + 3.1, S.minZ + 2, -0.15);
  wreckCar(parts, random, S.maxX + 3.6, S.maxZ - 9, 0.9);
  wreckCar(parts, random, 8, S.minZ - 3.4, PI / 2 + 0.3);
  wreckCar(parts, random, -11, S.minZ - 2.9, PI / 2 - 0.5);
  // building shells further out, all the way round
  const shells: [number, number, number][] = [
    [S.minX - 11, S.minZ - 8, 0.1],
    [-8, S.minZ - 11, 0],
    [3, S.minZ - 12, -0.15],
    [S.maxX + 11, S.minZ - 7, PI / 2],
    [S.minX - 12, S.minZ + 13, PI / 2 + 0.2],
    [S.maxX + 12, S.minZ + 21, -PI / 2],
    [S.minX - 11, S.maxZ + 2, 0.3],
    [S.maxX + 10, S.maxZ + 3, -0.2],
  ];
  for (const [x, z, ry] of shells) buildingShell(parts, random, x, z, ry);
  // south of the fence either side of the lift house: a yard of scrap
  wreckCar(parts, random, -9, S.maxZ + 4, 1.2);
  wreckCar(parts, random, 12, S.maxZ + 5.5, -0.5);
  container(parts, random, -15, S.maxZ + 6, PI / 2 + 0.1);
  pipes(parts, random, 7, S.maxZ + 6, 0.2);
  for (let i = 0; i < 26; i++) {
    const side = random() < 0.5 ? -1 : 1;
    const x = side * (5 + random() * (S.maxX + m - 5));
    rubbleHeap(parts, random, x, S.maxZ + 1.5 + random() * 9, 0.8 + random());
  }
  // and rubble, scrap and weeds filling everything between --- dense enough
  // that this reads as the wild, overgrown stage: nothing left bare
  for (let i = 0; i < 190; i++) {
    const side = Math.floor(random() * 3);
    const k = random();
    const o = 1 + random() * (m - 1);
    let x: number;
    let z: number;
    if (side === 0) [x, z] = [S.minX - o, S.minZ - m + k * (S.maxZ - S.minZ + m * 1.5)];
    else if (side === 1) [x, z] = [S.maxX + o, S.minZ - m + k * (S.maxZ - S.minZ + m * 1.5)];
    else [x, z] = [S.minX - m + k * (S.maxX - S.minX + 2 * m), S.minZ - o];
    const r = random();
    if (r < 0.4) rubbleHeap(parts, random, x, z, 0.8 + random() * 1.4);
    else if (r < 0.52) {
      // a twisted beam
      const b = box(0.2, 0.25, 2 + random() * 3);
      b.rotateX((random() - 0.5) * 0.4);
      parts.push(tint(at(b, x, 0.2, z, random() * PI), pick(C.rust, random)));
    } else if (r < 0.62) {
      // an oil drum, some tipped over
      const d = new THREE.CylinderGeometry(0.3, 0.3, 0.85, 8);
      if (random() < 0.5) d.rotateZ(PI / 2);
      parts.push(tint(at(d, x, random() < 0.5 ? 0.3 : 0.43, z, random() * PI), pick([...C.rust, ...C.faded], random)));
    } else if (r < 0.85) weedTuft(parts, random, x, z, 0.8 + random() * 0.7);
    else mossPatch(parts, random, x, 0.08, z, 0.8 + random() * 0.6);
  }
  // a second, denser weed pass right along the fence line, where the crew's
  // mowing stops and the wild growth presses right up against the wire
  for (let i = 0; i < 70; i++) {
    const side = Math.floor(random() * 4);
    let x: number;
    let z: number;
    if (side === 0) [x, z] = [S.minX - 0.5 - random() * 2.5, S.minZ + random() * (S.maxZ - S.minZ)];
    else if (side === 1) [x, z] = [S.maxX + 0.5 + random() * 2.5, S.minZ + random() * (S.maxZ - S.minZ)];
    else if (side === 2) [x, z] = [S.minX + random() * (S.maxX - S.minX), S.minZ - 0.5 - random() * 2.5];
    else [x, z] = [S.minX + random() * (S.maxX - S.minX), S.maxZ + 0.5 + random() * 2.5];
    weedTuft(parts, random, x, z, 0.6 + random() * 0.8);
  }
}

function tree(f: SurfaceFixture, parts: THREE.BufferGeometry[], random: () => number): void {
  parts.push(tint(at(new THREE.CylinderGeometry(0.14, 0.22, 1.8, 6), f.x, 0.9, f.z), C.trunk));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + random();
    const r = i === 0 ? 0 : 0.7 + random() * 0.4;
    parts.push(at(puff(0.9 + random() * 0.4, pick(C.leaf, random), random), f.x + Math.cos(a) * r, 2.3 + random() * 0.6, f.z + Math.sin(a) * r));
  }
}

function target(f: SurfaceFixture, parts: THREE.BufferGeometry[]): void {
  // a straw boss on a wooden easel, face turned up and toward the path so it reads from above
  parts.push(tint(at(box(0.08, 1.4, 0.08), f.x - 0.35, 0.7, f.z + 0.1), C.woodDark));
  parts.push(tint(at(box(0.08, 1.4, 0.08), f.x + 0.35, 0.7, f.z + 0.1), C.woodDark));
  const face = (r: number, color: number, y: number) => {
    const g = new THREE.CylinderGeometry(r, r, 0.06, 12);
    g.rotateX(PI / 2 - 0.5);
    return tint(at(g, f.x, y, f.z), color);
  };
  parts.push(face(0.5, C.targetWhite, 1.1));
  parts.push(face(0.36, C.targetRed, 1.13));
  parts.push(face(0.22, C.targetWhite, 1.16));
  parts.push(face(0.1, C.targetRed, 1.19));
}

function bench(f: SurfaceFixture, parts: THREE.BufferGeometry[]): void {
  const len = f.halfZ * 2;
  parts.push(tint(at(box(0.6, 0.08, len), f.x, 0.45, f.z), C.wood));
  parts.push(tint(at(box(0.08, 0.5, len), f.x + 0.3, 0.75, f.z), C.wood));
  for (const dz of [-len / 2 + 0.15, len / 2 - 0.15]) parts.push(tint(at(box(0.5, 0.45, 0.08), f.x, 0.22, f.z + dz), C.woodDark));
}

function planter(f: SurfaceFixture, parts: THREE.BufferGeometry[], random: () => number): void {
  parts.push(tint(at(box(f.halfX * 2, f.halfHeight * 2, f.halfZ * 2), f.x, f.halfHeight, f.z), C.terracotta));
  for (let i = 0; i < 5; i++) {
    parts.push(at(puff(0.32, pick(C.leaf, random), random), f.x + (i - 2) * 0.35, f.halfHeight * 2 + 0.15, f.z + (random() - 0.5) * 0.3));
    parts.push(at(puff(0.1, pick(C.flower, random), random), f.x + (i - 2) * 0.35, f.halfHeight * 2 + 0.42, f.z + (random() - 0.5) * 0.3));
  }
}

/** the scoreboard's frame; the screen itself is a canvas texture (scoreboardScreen) */
function scoreboardFrame(f: SurfaceFixture, parts: THREE.BufferGeometry[], glow: THREE.BufferGeometry[]): void {
  const w = f.halfX * 2;
  parts.push(tint(at(box(0.14, 2.8, 0.14), f.x - w / 2 + 0.1, 1.4, f.z), C.boardFrame));
  parts.push(tint(at(box(0.14, 2.8, 0.14), f.x + w / 2 - 0.1, 1.4, f.z), C.boardFrame));
  parts.push(tint(at(box(w, 1.7, 0.2), f.x, 1.85, f.z), C.boardFrame));
  // a little roof over it, and a glowing strip along the bottom so it reads as a screen from above
  parts.push(tint(at(box(w + 0.3, 0.1, 0.7), f.x, 2.85, f.z + 0.1), C.roof));
  glow.push(tint(at(box(w - 0.3, 0.05, 0.05), f.x, 1.05, f.z + 0.13), 0xbfefff));
}

/** the lift house round the car's top end: plaster walls, a tiled roof edge, a lamp over the door */
function liftHouse(parts: THREE.BufferGeometry[], glow: THREE.BufferGeometry[]): void {
  const car = LIFT_CARS.top;
  const front = car.minZ - 0.3;
  // a stone step and a doormat in front of the door
  parts.push(tint(at(box(4.6, 0.08, 1.2), 0, 0.04, front - 0.9), C.stone));
  parts.push(tint(at(box(3.2, 0.03, 0.8), 0, 0.09, front - 0.9), C.woodDark));
  // pilasters either side of the door
  for (const side of [-1, 1]) parts.push(tint(at(box(0.4, 2.6, 0.4), side * 2.3, 1.3, front - 0.2), C.plasterShade));
  // the sign over the door, and its lamp
  parts.push(tint(at(box(2.6, 0.4, 0.12), 0, 2.4, front - 0.35), C.boardFrame));
  glow.push(tint(at(box(2.2, 0.08, 0.05), 0, 2.4, front - 0.42), 0xffe2a8));
}

/** a sundial in the middle of the lawn, for the sun to cast a line from */
function sundial(parts: THREE.BufferGeometry[]): void {
  const x = 7.5;
  const z = SURFACE.maxZ - 5;
  parts.push(tint(at(new THREE.CylinderGeometry(0.5, 0.6, 0.7, 8), x, 0.35, z), C.stone));
  parts.push(tint(at(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 10), x, 0.73, z), C.stoneShade));
  parts.push(tint(at(box(0.05, 0.35, 0.4), x, 0.9, z), C.woodDark));
}

export function buildSurface(): THREE.Group {
  const random = rng(2026);
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  lawn(parts, random);
  paths(parts, random);
  for (const h of FENCES) fenceModel(h, parts, random);
  for (const f of SURFACE_FIXTURES) {
    if (f.kind === "tree") tree(f, parts, random);
    else if (f.kind === "target") target(f, parts);
    else if (f.kind === "bench") bench(f, parts);
    else if (f.kind === "planter") planter(f, parts, random);
    else if (f.kind === "scoreboard") scoreboardFrame(f, parts, glow);
    else if (f.kind === "ruinPillar") ruinPillar(f, parts, random);
    else if (f.kind === "ruinLintel") ruinLintel(f, parts, random);
    else if (f.kind === "supplyCrates") supplyCrates(f, parts, random);
    else if (f.kind === "fieldTent") fieldTent(f, parts);
  }
  outsideRuins(parts, random);
  // inside the fence, kept low (under the sight-blocking height): what the crew hasn't cleared yet
  rubbleHeap(parts, random, -13.5, SURFACE.minZ + 18.5, 1.6);
  rubbleHeap(parts, random, 14.6, SURFACE.minZ + 8, 1.2);
  rubbleHeap(parts, random, -4, SURFACE.minZ + 9, 1);
  liftHouse(parts, glow);
  sundial(parts);
  const group = new THREE.Group();
  const merged = new THREE.Mesh(mergeGeometries(parts)!, paintMaterial);
  merged.geometry.computeVertexNormals();
  merged.castShadow = true;
  merged.receiveShadow = true;
  group.add(merged);
  if (glow.length) group.add(new THREE.Mesh(mergeGeometries(glow)!, glowMaterial));
  return group;
}

// --- Light -------------------------------------------------------------------

/**
 * The sun and sky: a warm low sun from the south-west throwing long soft
 * shadows, a sky-blue fill so shade is blue rather than black (the
 * impressionists' rule), and a little bounce off the grass. Only on while
 * the viewer is up here; the shadow camera follows them.
 */
export interface Sunlight {
  setOn(on: boolean): void;
  follow(x: number, z: number): void;
}

export function createSunlight(scene: THREE.Scene): Sunlight {
  const sun = new THREE.DirectionalLight(0xffeccc, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const cam = sun.shadow.camera;
  cam.left = -14;
  cam.right = 14;
  cam.top = 14;
  cam.bottom = -14;
  cam.near = 1;
  cam.far = 60;
  sun.shadow.bias = -0.0015;
  sun.shadow.radius = 3;
  const sky = new THREE.HemisphereLight(0xc4dcf2, 0xb8c890, 1.3);
  const offset = new THREE.Vector3(-9, 18, 7);
  scene.add(sun, sun.target, sky);
  return {
    setOn(on) {
      sun.visible = on;
      sky.visible = on;
    },
    follow(x, z) {
      sun.position.set(x + offset.x, offset.y, z + offset.z);
      sun.target.position.set(x, 0, z);
    },
  };
}

// --- The scoreboard's screen ----------------------------------------------------

/**
 * The board's face: a canvas the client redraws when the scores change,
 * laid flat on the top of the board so a little of it shows from above.
 * Too small to read from the camera's height --- that's what the
 * full-screen view (opened from the board) is for.
 */
export function scoreboardScreen(): { mesh: THREE.Mesh; draw(lines: string[]): void } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SCOREBOARD.halfX * 2 - 0.3, 0.55), new THREE.MeshBasicMaterial({ map: texture }));
  mesh.rotation.x = -PI / 2;
  mesh.position.set(SCOREBOARD.x, 2.91, SCOREBOARD.z + 0.1);
  return {
    mesh,
    draw(lines) {
      ctx.fillStyle = "#16222b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 20px ui-monospace, monospace";
      ctx.fillText("SCORES", 14, 30);
      ctx.font = "14px ui-monospace, monospace";
      lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, 14, 52 + i * 16));
      texture.needsUpdate = true;
    },
  };
}

/** is (z) on the surface level, for anything client-side that changes with the level */
export const SURFACE_MIN_Z = SURFACE.minZ - 5;
export const LIFT_OFFSET = LIFT_DZ;
