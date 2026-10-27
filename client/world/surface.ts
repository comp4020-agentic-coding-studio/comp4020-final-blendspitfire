import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  FENCES,
  LIFT_CARS,
  LIFT_DZ,
  SCOREBOARD,
  STATIONS,
  SURFACE,
  SURFACE_FIXTURES,
  SURFACE_VIEW_MARGIN,
  type Obstacle,
  type SurfaceFixture,
} from "../../shared/protocol.ts";
import { rng } from "../models/kit.ts";

// The garden on the surface: where everyone arrives, learns the controls,
// and takes the lift down. The story it tells: a city left two hundred
// years, gone back to forest --- roofless wall stumps with trees inside,
// streets heaved into slabs, rust-brown hulks, ivy over everything --- that
// a corp's crew has just fenced off a patch of and moved into: fresh
// chain-link, a mown lawn the wild is already winning back, drop crates and
// a field tent. It's deliberately the facility's opposite ---
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
  plasterShade: 0xe2d2b8,
  targetRed: 0xe8574a,
  targetWhite: 0xfaf4ea,
  boardFrame: 0x4a5560,
  boardScreen: 0x1b2730,
  // the fallen town: sun-bleached concrete, soot, iron gone to rust, faded paint
  ruin: [0xa8a49c, 0x9c978e, 0xb4afa6, 0x8e8a82],
  ruinShade: 0x7a766e,
  soot: [0x5a5652, 0x6a645e, 0x4c4844],
  // what's grown over the ruins since the town fell: darker, shaggier,
  // muddier than the garden's trimmed, sun-bright greens --- these never
  // get cut back
  wildLeaf: [0x41603a, 0x34502f, 0x4a6a3e, 0x3a5634, 0x48623c],
  mossDark: [0x56663f, 0x485a38, 0x627448, 0x3f4e34],
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
  // two hundred years on: a canopy that's lighter on top where the sun hits,
  // ivy darker than any of it, ground cover between, water gone tea-dark
  canopy: [0x3c5a32, 0x46683a, 0x324e2c, 0x5a7840, 0x506e36, 0x668446],
  ivy: [0x2f4a2a, 0x3a5830, 0x284226, 0x345030],
  undergrowth: [0x4c6a3c, 0x587446, 0x435e36, 0x627c48, 0x3e5834, 0x6c8250],
  asphalt: [0x6c6a66, 0x76736c, 0x5e5c58, 0x807a70],
  pond: [0x4f6e6c, 0x5a7a74, 0x48625e],
  reed: [0xa8a868, 0x8e9a5a, 0xb8ac74],
  bark: [0x6a5a48, 0x7a6a54, 0x5a4c3e],
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
    if (onRangeLot(x, z)) continue;
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

// --- Two hundred years on ------------------------------------------------------
// What a city looks like after two centuries with nobody in it, from above:
// mostly forest. Roofs went first, then floors; what stands is wall stumps
// and a few concrete frames, each one full of soil and the trees growing out
// of it. Streets are lines of broken asphalt slabs heaved up by roots, grass
// in every crack. Cars and steel have rusted to stained frames sunk in the
// ground. Ivy covers every wall top and spills down the faces; low ground
// has flooded into reedy ponds. Grey shows only where the green breaks.

/** a clump of undergrowth: a few low puffs, the carpet everything else sits in */
function undergrowth(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, r: number): void {
  const n = 2 + Math.floor(random() * 3);
  for (let i = 0; i < n; i++) {
    const s = r * (0.5 + random() * 0.6);
    parts.push(at(puff(s, pick(C.undergrowth, random), random, 0.45), x + (random() - 0.5) * r * 1.4, s * 0.2, z + (random() - 0.5) * r * 1.4));
  }
}

/** a wild tree: a leaning trunk and a broad, lumpy crown, lighter on top */
function wildTree(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, size = 1, base = 0): void {
  const h = (2.2 + random() * 1.6) * size;
  const trunk = new THREE.CylinderGeometry(0.12 * size, 0.24 * size, h, 6);
  trunk.translate(0, h / 2, 0);
  trunk.rotateZ((random() - 0.5) * 0.25);
  parts.push(tint(at(trunk, x, base, z), pick(C.bark, random)));
  const n = 5 + Math.floor(random() * 4);
  for (let i = 0; i < n; i++) {
    const a = random() * PI * 2;
    const r = i === 0 ? 0 : (0.45 + random() * 0.55) * size;
    const top = i === 0 || random() < 0.4;
    parts.push(at(puff((0.5 + random() * 0.4) * size, pick(top ? C.canopy.slice(3) : C.canopy.slice(0, 3), random), random, 0.7), x + Math.cos(a) * r, base + h + (top ? 0.4 : -0.1) * size + random() * 0.3, z + Math.sin(a) * r));
  }
}

/** ivy along a wall top and spilling down both faces: what you see of a wall from overhead */
function ivyWall(parts: THREE.BufferGeometry[], random: () => number, ax: number, az: number, bx: number, bz: number, h: number, cover = 0.8): void {
  const len = Math.hypot(bx - ax, bz - az);
  const nx = -(bz - az) / len;
  const nz = (bx - ax) / len;
  for (let t = 0; t < len; t += 0.45) {
    if (random() > cover) continue;
    const x = ax + ((bx - ax) * t) / len;
    const z = az + ((bz - az) * t) / len;
    parts.push(at(puff(0.28 + random() * 0.18, pick(C.ivy, random), random, 0.55), x, h + 0.05, z));
    // a curtain down one face or the other
    if (random() < 0.55) {
      const side = random() < 0.5 ? -1 : 1;
      const drop = h * (0.3 + random() * 0.6);
      const sheet = box(0.4 + random() * 0.4, drop, 0.06);
      sheet.rotateY(Math.atan2(bx - ax, bz - az) + PI / 2);
      parts.push(tint(at(sheet, x + nx * side * 0.2, h - drop / 2, z + nz * side * 0.2), pick(C.ivy, random)));
    }
  }
}

/** a wall stump: a run of concrete at a broken height, ivy over the top */
function wallStump(parts: THREE.BufferGeometry[], random: () => number, ax: number, az: number, bx: number, bz: number, h: number): void {
  const len = Math.hypot(bx - ax, bz - az);
  const ry = Math.atan2(bx - ax, bz - az);
  const segs = Math.max(1, Math.round(len / 1.2));
  const c = pick(C.ruin, random);
  for (let i = 0; i < segs; i++) {
    if (random() < 0.15) continue; // a gap where it's come down
    const t = (i + 0.5) / segs;
    const sh = h * (0.45 + random() * 0.55);
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    parts.push(tint(at(box(0.3, sh, len / segs + 0.02), x, sh / 2, z, ry), c));
    ivyWall(parts, random, x - ((bx - ax) / segs) * 0.5, z - ((bz - az) / segs) * 0.5, x + ((bx - ax) / segs) * 0.5, z + ((bz - az) / segs) * 0.5, sh, 0.75);
  }
}

/** a block that's lost its roof and floors: outer walls at broken heights, soil inside, a tree growing out */
function overgrownBlock(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, w: number, d: number, h: number, ry: number): void {
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const p = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const corners = [p(-w / 2, -d / 2), p(w / 2, -d / 2), p(w / 2, d / 2), p(-w / 2, d / 2)];
  for (let i = 0; i < 4; i++) {
    if (random() < 0.2) continue; // one face gone entirely
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    wallStump(parts, random, ax, az, bx, bz, h);
  }
  // inside: a floor of soil and fallen slab, the undergrowth thick
  parts.push(tint(at(box(w - 0.3, 0.1, d - 0.3), x, 0.05, z, ry), C.lawnDark));
  for (let i = 0; i < Math.ceil((w * d) / 2); i++) {
    const [ux, uz] = p((random() - 0.5) * (w - 0.6), (random() - 0.5) * (d - 0.6));
    if (random() < 0.3) {
      const s = box(0.8 + random() * 1.2, 0.15, 0.6 + random());
      s.rotateX((random() - 0.5) * 0.6);
      parts.push(tint(at(s, ux, 0.2, uz, random() * PI), pick(C.ruin, random)));
    }
    undergrowth(parts, random, ux, uz, 0.5 + random() * 0.4);
  }
  // most have a tree: it's had two centuries to come up through the floors
  if (random() < 0.55) {
    const [tx, tz] = p((random() - 0.5) * w * 0.4, (random() - 0.5) * d * 0.4);
    wildTree(parts, random, tx, tz, Math.min(w, d) / 4 + 0.6 + random() * 0.4);
  }
}

/** a concrete frame that kept its columns and a floor or two: the tall ruins, with a garden on every slab */
function concreteFrame(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, w: number, d: number, floors: number, ry: number): void {
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const p = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const storey = 2.4;
  const c = pick(C.ruin, random);
  const cols = Math.max(2, Math.round(w / 2.5));
  const rows = Math.max(2, Math.round(d / 2.5));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const [cx, cz] = p(-w / 2 + (w * i) / (cols - 1), -d / 2 + (d * j) / (rows - 1));
      const ch = storey * floors * (random() < 0.25 ? 0.4 + random() * 0.4 : 1);
      parts.push(tint(at(box(0.35, ch, 0.35), cx, ch / 2, cz, ry), c));
      if (random() < 0.5) ivyWall(parts, random, cx - 0.1, cz, cx + 0.1, cz, ch, 1);
    }
  }
  for (let f = 1; f <= floors; f++) {
    // each slab broken: only part of it still up, the rest tipped or gone
    const keep = 0.45 + random() * 0.45;
    const off = (random() - 0.5) * w * (1 - keep);
    const [sx, sz] = p(off, 0);
    const slab = box(w * keep, 0.2, d);
    if (f === floors || random() < 0.3) slab.rotateZ((random() - 0.5) * 0.12);
    parts.push(tint(at(slab, sx, storey * f, sz, ry), f === floors ? C.ruinShade : c));
    // and on it, what's taken root: moss, shrubs, on the top one a thicket
    const growth = f === floors ? 10 : 3;
    for (let i = 0; i < growth; i++) {
      const [gx, gz] = p(off + (random() - 0.5) * w * keep * 0.9, (random() - 0.5) * d * 0.9);
      parts.push(at(puff(0.35 + random() * 0.35, pick(random() < 0.5 ? C.ivy : C.undergrowth, random), random, 0.5), gx, storey * f + 0.2, gz));
    }
    if (f === floors && random() < 0.6) {
      const [tx, tz] = p(off, 0);
      wildTree(parts, random, tx, tz, 0.32, storey * f + 0.1);
    }
    rebar(parts, random, sx + (w * keep * 0.5) * cs, storey * f - 0.2, sz - (w * keep * 0.5) * sn, 4, 0.6);
  }
  // the fallen part of the slabs, in a heap at its foot gone to green
  for (let i = 0; i < 4; i++) {
    const [hx, hz] = p((random() - 0.5) * w * 1.2, (random() - 0.5) * d * 1.2);
    const s = box(1 + random() * 1.4, 0.2, 0.8 + random());
    s.rotateX((random() - 0.5) * 0.9);
    parts.push(tint(at(s, hx, 0.3, hz, random() * PI), C.ruinShade));
    undergrowth(parts, random, hx, hz, 0.7);
  }
}

/** a street: asphalt broken into slabs, heaved by roots, grass and saplings up every crack */
function buriedStreet(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, w: number, d: number): void {
  const along = w > d;
  const len = along ? w : d;
  const wide = along ? d : w;
  for (let t = -len / 2; t < len / 2; t += 1.1) {
    for (let s = -wide / 2; s < wide / 2; s += 1.1) {
      if (random() < 0.3) continue; // gone under the turf
      const slab = box(0.7 + random() * 0.6, 0.06, 0.7 + random() * 0.6);
      slab.rotateX((random() - 0.5) * 0.18);
      slab.rotateZ((random() - 0.5) * 0.18);
      const sx = x + (along ? t : s) + (random() - 0.5) * 0.3;
      const sz = z + (along ? s : t) + (random() - 0.5) * 0.3;
      parts.push(tint(at(slab, sx, 0.03 + random() * 0.04, sz, (random() - 0.5) * 0.4), pick(C.asphalt, random)));
    }
    // a centre line, mostly worn off
    if (random() < 0.35) parts.push(tint(at(box(along ? 0.9 : 0.1, 0.01, along ? 0.1 : 0.9), x + (along ? t : 0), 0.085, z + (along ? 0 : t)), 0xc8c0a8));
  }
  for (let i = 0; i < len * 0.9; i++) {
    const a = (random() - 0.5) * len;
    const b = (random() - 0.5) * wide;
    const ux = x + (along ? a : b);
    const uz = z + (along ? b : a);
    if (random() < 0.7) weedTuft(parts, random, ux, uz, 0.6 + random() * 0.6);
    else undergrowth(parts, random, ux, uz, 0.4 + random() * 0.4);
  }
  // a sapling or two right in the carriageway
  for (let i = 0; i < len / 9; i++) wildTree(parts, random, x + (along ? (random() - 0.5) * len : (random() - 0.5) * wide * 0.5), z + (along ? (random() - 0.5) * wide * 0.5 : (random() - 0.5) * len), 0.55 + random() * 0.3);
}

/** a car two centuries gone: a rust-brown body sunk to its sills, glass and wheels long gone, growing a bush */
function rustHulk(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, ry: number): void {
  const c = pick(C.rust, random);
  parts.push(tint(at(box(1.6, 0.4, 3.5), x, 0.15, z, ry), c));
  parts.push(tint(at(box(1.35, 0.3, 1.6), x, 0.5, z - 0.2 * Math.cos(ry), ry), pick(C.rust, random)));
  undergrowth(parts, random, x, z, 0.9);
  if (random() < 0.6) parts.push(at(puff(0.55, pick(C.ivy, random), random, 0.6), x, 0.75, z));
}

/** a pond where the ground sank: dark water, a reedy rim */
function pond(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number, r: number): void {
  const water = new THREE.CylinderGeometry(r, r, 0.04, 10);
  water.scale(1, 1, 0.7 + random() * 0.4);
  parts.push(tint(at(water, x, 0.025, z, random() * PI), pick(C.pond, random)));
  for (let a = 0; a < PI * 2; a += 0.35) {
    const rr = r * (0.95 + random() * 0.25);
    if (random() < 0.6) {
      for (let k = 0; k < 3; k++) {
        const h = 0.4 + random() * 0.4;
        const reed = new THREE.ConeGeometry(0.03, h, 3);
        reed.translate(0, h / 2, 0);
        reed.rotateZ((random() - 0.5) * 0.4);
        parts.push(tint(at(reed, x + Math.cos(a) * rr + (random() - 0.5) * 0.3, 0, z + Math.sin(a) * rr * 0.85 + (random() - 0.5) * 0.3), pick(C.reed, random)));
      }
    } else undergrowth(parts, random, x + Math.cos(a) * rr, z + Math.sin(a) * rr * 0.85, 0.4);
  }
}

/** a tree that came down years ago: a mossy log on the ground */
function fallenLog(parts: THREE.BufferGeometry[], random: () => number, x: number, z: number): void {
  const len = 2.5 + random() * 2.5;
  const log = new THREE.CylinderGeometry(0.2, 0.26, len, 6);
  log.rotateZ(PI / 2);
  parts.push(tint(at(log, x, 0.2, z, random() * PI), pick(C.bark, random)));
  mossPatch(parts, random, x, 0.35, z, 0.5);
}

/** the range sits on what was a car park: inside the fence, north-west, under the targets */
const RANGE_LOT = { minX: SURFACE.minX + 1.2, maxX: -3.2, minZ: SURFACE.minZ + 0.3, maxZ: SURFACE.minZ + 4.3 };
const onRangeLot = (x: number, z: number): boolean => x > RANGE_LOT.minX && x < RANGE_LOT.maxX && z > RANGE_LOT.minZ && z < RANGE_LOT.maxZ;

/**
 * The car park under the range: asphalt crazed into plates, weeds up every
 * crack, the bay lines nearly gone. Weeds kept short so the targets and the
 * shots still read over them.
 */
function crackedLot(parts: THREE.BufferGeometry[], random: () => number): void {
  const L = RANGE_LOT;
  parts.push(tint(at(box(L.maxX - L.minX, 0.006, L.maxZ - L.minZ), (L.minX + L.maxX) / 2, 0.028, (L.minZ + L.maxZ) / 2), 0x3e4c34));
  for (let x = L.minX; x < L.maxX; x += 0.85) {
    for (let z = L.minZ; z < L.maxZ; z += 0.85) {
      if (random() < 0.12) continue; // a plate gone, soil showing
      const w = 0.55 + random() * 0.35;
      const d = 0.55 + random() * 0.35;
      const plate = box(Math.min(w, L.maxX - x), 0.04, Math.min(d, L.maxZ - z));
      plate.rotateX((random() - 0.5) * 0.08);
      plate.rotateZ((random() - 0.5) * 0.08);
      parts.push(tint(at(plate, x + 0.42, 0.045 + random() * 0.015, z + 0.42, (random() - 0.5) * 0.35), pick(C.asphalt, random)));
    }
  }
  // the old bay lines, run toward the targets, mostly worn away
  for (let lx = L.minX + 1.2; lx < L.maxX; lx += 2.5) {
    for (let z = L.minZ + 0.2; z < L.maxZ - 0.3; z += 0.5) {
      if (random() < 0.45) continue;
      parts.push(tint(at(box(0.1, 0.008, 0.42), lx + (random() - 0.5) * 0.04, 0.072, z + 0.2), 0xcfc6ac));
    }
  }
  // weeds along the cracks, thick at the edges where the lawn's pushing in
  for (let i = 0; i < 150; i++) {
    const edge = random() < 0.4;
    const x = L.minX + random() * (L.maxX - L.minX);
    const z = edge ? (random() < 0.5 ? L.minZ + random() * 0.6 : L.maxZ - random() * 0.6) : L.minZ + random() * (L.maxZ - L.minZ);
    if (random() < 0.75) weedTuft(parts, random, x, z, 0.35 + random() * 0.4);
    else undergrowth(parts, random, x, z, 0.2 + random() * 0.2);
  }
}

/**
 * Old cables strung high between rusted masts outside the fence, sagging
 * over corners of the garden with ivy hanging off them. They sit at 6--10 m,
 * so as you walk under one it slides across the top camera's view and
 * briefly covers a little of it.
 */
function overheadVine(parts: THREE.BufferGeometry[], random: () => number, ax: number, az: number, ah: number, bx: number, bz: number, bh: number, sag: number): void {
  for (const [x, z, h] of [
    [ax, az, ah],
    [bx, bz, bh],
  ]) {
    const mast = new THREE.CylinderGeometry(0.12, 0.18, h, 6);
    mast.translate(0, h / 2, 0);
    mast.rotateZ((random() - 0.5) * 0.08);
    parts.push(tint(at(mast, x, 0, z), pick(C.rust, random)));
    ivyWall(parts, random, x - 0.05, z, x + 0.05, z, h, 1);
    for (let k = 0; k < 4; k++) parts.push(at(puff(0.3, pick(C.ivy, random), random, 1.4), x + (random() - 0.5) * 0.2, h * (0.15 + random() * 0.7), z + (random() - 0.5) * 0.2));
  }
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(len / 0.6);
  const y = (t: number) => ah + (bh - ah) * t - sag * 4 * t * (1 - t);
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const x0 = ax + (bx - ax) * t0;
    const z0 = az + (bz - az) * t0;
    const x1 = ax + (bx - ax) * t1;
    const z1 = az + (bz - az) * t1;
    const seg = new THREE.CylinderGeometry(0.025, 0.025, Math.hypot(x1 - x0, y(t1) - y(t0), z1 - z0), 4);
    const dir = new THREE.Vector3(x1 - x0, y(t1) - y(t0), z1 - z0).normalize();
    seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    parts.push(tint(at(seg, (x0 + x1) / 2, (y(t0) + y(t1)) / 2, (z0 + z1) / 2), C.soot[2]));
    // ivy along it in clumps, with strands hanging down
    if (random() < 0.6) parts.push(at(puff(0.22 + random() * 0.2, pick(C.ivy, random), random, 0.8), x0, y(t0), z0));
    if (random() < 0.22) {
      const drop = 1 + random() * 2.2;
      const stem = new THREE.CylinderGeometry(0.02, 0.02, drop, 4);
      stem.translate(0, -drop / 2, 0);
      parts.push(tint(at(stem, x0, y(t0), z0), pick(C.ivy, random)));
      for (let k = 0; k < 3; k++) parts.push(at(puff(0.12 + random() * 0.1, pick(C.ivy, random), random, 0.9), x0 + (random() - 0.5) * 0.15, y(t0) - drop * ((k + 1) / 3), z0 + (random() - 0.5) * 0.15));
    }
  }
}

/**
 * Inside the fence, two hundred years on: the crew mowed a lawn over the old
 * square but hasn't won. Patches of rank grass, the old street and house
 * footings breaking through, weeds banked against every fence and footing,
 * moss in the gravel. All of it ankle-high and walk-through, and kept off
 * the paths, the stations, the spawn, the lift door and the range lane, so
 * players, guns and prompts still read.
 */
function wildGarden(parts: THREE.BufferGeometry[], random: () => number): void {
  const S = SURFACE;
  const keepClear = (x: number, z: number, pad = 0): boolean =>
    onPath(x, z) ||
    onRangeLot(x, z) ||
    STATIONS.some((s) => Math.hypot(x - s.x, z - s.z) < 2 + pad) ||
    (Math.abs(x) < 4 && z > S.maxZ - 7) || // spawn and the lift door
    (x < -3 && z < S.minZ + 5.5) || // the range lane
    (Math.abs(x - SCOREBOARD.x) < 3 && z < S.minZ + 2.5) ||
    SURFACE_FIXTURES.some((f) => Math.abs(x - f.x) < f.halfX + 0.25 && Math.abs(z - f.z) < f.halfZ + 0.25);
  const inside = (x: number, z: number) => x > S.minX + 0.2 && x < S.maxX - 0.2 && z > S.minZ + 0.2 && z < S.maxZ - 0.2;
  // patches of rank grass: the mower lost these, darker and coarser than the lawn
  for (let i = 0; i < 16; i++) {
    const cx = S.minX + random() * (S.maxX - S.minX);
    const cz = S.minZ + random() * (S.maxZ - S.minZ);
    const r = 1.5 + random() * 2.2;
    for (let k = 0; k < r * r * 2.2; k++) {
      const a = random() * PI * 2;
      const d = Math.sqrt(random()) * r;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d * 0.8;
      if (!inside(x, z) || keepClear(x, z)) continue;
      parts.push(tint(at(box(0.5 + random() * 0.5, 0.02, 0.22 + random() * 0.25), x, 0.022, z, random() * PI), pick(C.undergrowth, random)));
      if (random() < 0.35) weedTuft(parts, random, x, z, 0.35 + random() * 0.35);
    }
  }
  // the old street under the square, east to west across the middle: asphalt plates breaking through
  const streetZ = S.minZ + 13.5;
  for (let x = S.minX + 0.5; x < S.maxX - 0.5; x += 0.8) {
    for (let dz = -1.4; dz < 1.4; dz += 0.8) {
      const px = x + (random() - 0.5) * 0.3;
      const pz = streetZ + dz + (random() - 0.5) * 0.3;
      if (random() < 0.45 || keepClear(px, pz, -0.5)) continue;
      const plate = box(0.5 + random() * 0.35, 0.03, 0.5 + random() * 0.35);
      plate.rotateX((random() - 0.5) * 0.08);
      plate.rotateZ((random() - 0.5) * 0.08);
      parts.push(tint(at(plate, px, 0.03 + random() * 0.012, pz, (random() - 0.5) * 0.4), pick(C.asphalt, random)));
      if (random() < 0.4) weedTuft(parts, random, px + 0.35, pz + 0.3, 0.3 + random() * 0.3);
    }
  }
  // house footings: low outlines of what stood here, ivy along them, weeds inside the corners
  const footings: [number, number, number, number, number][] = [
    [-11.5, S.minZ + 8.5, 4.5, 3.5, 0.05],
    [10.5, S.minZ + 7.5, 4, 3.2, -0.08],
    [-12.5, S.maxZ - 8.5, 3.6, 4, 0.1],
    [6, S.minZ + 19.5, 3.4, 3, 0.04],
    [-5, S.minZ + 19, 3, 2.6, -0.12],
  ];
  for (const [fx, fz, w, d, ry] of footings) {
    const cs = Math.cos(ry);
    const sn = Math.sin(ry);
    const p = (lx: number, lz: number): [number, number] => [fx + lx * cs + lz * sn, fz - lx * sn + lz * cs];
    const corners = [p(-w / 2, -d / 2), p(w / 2, -d / 2), p(w / 2, d / 2), p(-w / 2, d / 2)];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t < len; t += 0.5) {
        const x = ax + ((bx - ax) * t) / len;
        const z = az + ((bz - az) * t) / len;
        if (random() < 0.2 || keepClear(x, z, -0.8)) continue;
        const h = 0.08 + random() * 0.14;
        parts.push(tint(at(box(0.52, h, 0.24), x, h / 2, z, Math.atan2(bx - ax, bz - az) + PI / 2), pick(C.ruin, random)));
        if (random() < 0.45) parts.push(at(puff(0.16 + random() * 0.1, pick(C.ivy, random), random, 0.5), x, h + 0.03, z));
        if (random() < 0.3) weedTuft(parts, random, x, z, 0.4 + random() * 0.3);
      }
      mossPatch(parts, random, ax, 0.05, az, 0.35);
    }
  }
  // banked against the fence, all the way round: weeds, ivy clumps, a scatter of broken concrete
  for (const f of FENCES) {
    const alongX = f.halfX >= f.halfZ;
    const len = (alongX ? f.halfX : f.halfZ) * 2;
    const inward = alongX ? (f.z < (S.minZ + S.maxZ) / 2 ? 1 : -1) : f.x < 0 ? 1 : -1;
    for (let t = -len / 2; t < len / 2; t += 0.35) {
      const depth = 0.25 + random() * random() * 1.6;
      const x = f.x + (alongX ? t : inward * depth);
      const z = f.z + (alongX ? inward * depth : t);
      if (!inside(x, z) || keepClear(x, z, -1)) continue;
      const r = random();
      if (r < 0.55) weedTuft(parts, random, x, z, 0.45 + random() * 0.45);
      else if (r < 0.8) undergrowth(parts, random, x, z, 0.25 + random() * 0.2);
      else if (r < 0.88) parts.push(tint(at(new THREE.DodecahedronGeometry(0.08 + random() * 0.1, 0), x, 0.06, z), pick(C.ruin, random)));
    }
  }
  // weeds up through the gravel, moss along its edges
  for (const pth of [
    { minX: -1.6, maxX: 1.6, minZ: S.minZ + 1.5, maxZ: S.maxZ },
    { minX: -11, maxX: 7, minZ: S.minZ + 4.4, maxZ: S.minZ + 6.2 },
  ]) {
    const area = (pth.maxX - pth.minX) * (pth.maxZ - pth.minZ);
    for (let i = 0; i < area * 0.35; i++) {
      const edge = random() < 0.6;
      const x = edge ? (random() < 0.5 ? pth.minX : pth.maxX) + (random() - 0.5) * 0.3 : pth.minX + random() * (pth.maxX - pth.minX);
      const z = pth.minZ + random() * (pth.maxZ - pth.minZ);
      if (Math.abs(x) < 4 && z > S.maxZ - 7) continue;
      if (edge) parts.push(at(puff(0.12 + random() * 0.1, pick(C.mossDark, random), random, 0.3), x, 0.05, z));
      else weedTuft(parts, random, x, z, 0.25 + random() * 0.2);
    }
  }
  // and loose weeds everywhere else the crew hasn't got to
  for (let i = 0; i < 340; i++) {
    const x = S.minX + random() * (S.maxX - S.minX);
    const z = S.minZ + random() * (S.maxZ - S.minZ);
    if (keepClear(x, z)) continue;
    if (random() < 0.7) weedTuft(parts, random, x, z, 0.3 + random() * 0.4);
    else parts.push(tint(at(new THREE.DodecahedronGeometry(0.06 + random() * 0.08, 0), x, 0.04, z), pick(C.ruin, random)));
  }
}

/**
 * The surface past the fence, two hundred years on. Placed on a loose street
 * grid so it still reads as a town; everything between the streets is block
 * ruins and woodland, and nothing is bare ground. Seeded.
 */
function overgrownCity(parts: THREE.BufferGeometry[], random: () => number): void {
  const S = SURFACE;
  const m = SURFACE_VIEW_MARGIN;
  const minX = S.minX - m;
  const maxX = S.maxX + m;
  const minZ = S.minZ - m;
  const maxZ = S.maxZ + 12;
  const outside = (x: number, z: number, pad: number) => x < S.minX - pad || x > S.maxX + pad || z < S.minZ - pad || z > S.maxZ + pad;
  const nearLift = (x: number, z: number) => Math.abs(x) < 5 && z > S.maxZ - 1;
  // the forest floor: darker than the garden's lawn, laid over it everywhere past the fence
  for (let x = minX; x < maxX; x += 2) {
    for (let z = minZ; z < maxZ; z += 2) {
      const ux = x + 1;
      const uz = z + 1;
      if (!outside(ux, uz, 0.3) || nearLift(ux, uz)) continue;
      parts.push(tint(at(box(2.3, 0.02, 2.3), ux + (random() - 0.5) * 0.4, 0.004, uz + (random() - 0.5) * 0.4, (random() - 0.5) * 0.3), pick(C.undergrowth.slice(0, 5), random)));
    }
  }
  // the old streets: one ring just past the fence (the crew camped in what was a square), cross streets further out
  buriedStreet(parts, random, (S.minX + S.maxX) / 2, S.minZ - 3.2, S.maxX - S.minX + 2 * m, 4);
  buriedStreet(parts, random, S.minX - 3.2, (S.minZ + S.maxZ) / 2 + 2, 4, S.maxZ - S.minZ + m);
  buriedStreet(parts, random, S.maxX + 3.2, (S.minZ + S.maxZ) / 2 + 2, 4, S.maxZ - S.minZ + m);
  buriedStreet(parts, random, -6, S.minZ - 12, 3.2, 10);
  buriedStreet(parts, random, S.minX - 12, S.minZ + 10, 10, 3.2);
  // blocks between the streets: wall stumps full of trees, and a few tall concrete frames
  const blocks: [number, number, number, number, number, number][] = [
    // x, z, w, d, h, ry
    [S.minX - 11, S.minZ - 10, 6, 5, 2.6, 0.05],
    [-12, S.minZ - 10, 5, 6, 3.4, -0.04],
    [1, S.minZ - 10, 7, 5, 2.2, 0.08],
    [11, S.minZ - 11, 5, 5, 3, -0.1],
    [S.maxX + 10, S.minZ - 9, 6, 6, 2.8, 0.03],
    [S.minX - 10, S.minZ + 3, 5, 7, 2.4, PI / 2],
    [S.minX - 10.5, S.minZ + 18, 6, 6, 3.2, 0.12],
    [S.maxX + 10, S.minZ + 3, 5, 6, 2, -0.06],
    [S.maxX + 11, S.minZ + 21, 6, 5, 2.6, 0.1],
    [S.minX - 9, S.maxZ + 6, 7, 5, 2.4, -0.08],
    [S.maxX + 9, S.maxZ + 6, 6, 5, 2.8, 0.05],
  ];
  for (const [x, z, w, d, h, ry] of blocks) overgrownBlock(parts, random, x, z, w, d, h, ry);
  // the tall ones stand north and east, so their long shadows fall away from the garden
  concreteFrame(parts, random, 6, S.minZ - 11, 6, 4.5, 3, 0.04);
  concreteFrame(parts, random, S.maxX + 11, S.minZ + 12, 5, 6, 2, -0.08);
  concreteFrame(parts, random, -19, S.minZ - 12, 5, 5, 2, 0.1);
  // the old town's bigger wrecks, rusted out and grown over
  craneJib(parts, random, -2, S.minZ - 3.6, PI / 2 + 0.08, 22);
  ivyWall(parts, random, -12, S.minZ - 3.6, 9, S.minZ - 3.3, 1.05, 0.6);
  container(parts, random, S.minX - 7.5, S.minZ + 10, 0.15);
  ivyWall(parts, random, S.minX - 7.5, S.minZ + 7.2, S.minX - 7.2, S.minZ + 12.8, 2.55, 0.9);
  pylon(parts, random, S.maxX + 7, S.maxZ - 4, 0.5);
  const hulks: [number, number, number][] = [
    [S.minX - 3.4, S.minZ + 6, 0.2],
    [S.minX - 2.8, S.maxZ - 6, PI + 0.4],
    [S.maxX + 3.1, S.minZ + 3, -0.15],
    [S.maxX + 3.6, S.maxZ - 10, 0.9],
    [9, S.minZ - 3.4, PI / 2 + 0.3],
    [-14, S.minZ - 2.9, PI / 2 - 0.5],
    [-9, S.maxZ + 3, 1.2],
    [12, S.maxZ + 3.5, -0.5],
  ];
  for (const [x, z, ry] of hulks) rustHulk(parts, random, x, z, ry);
  pond(parts, random, S.maxX + 9, S.minZ + 30 - 14, 2.4);
  pond(parts, random, S.minX - 13, S.minZ - 2, 1.8);
  // the woods: trees wherever there's room, dense away from the streets
  for (let i = 0; i < 74; i++) {
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    if (!outside(x, z, 2.5) || nearLift(x, z)) continue;
    wildTree(parts, random, x, z, 0.6 + random() * 0.5);
  }
  for (let i = 0; i < 24; i++) {
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    if (!outside(x, z, 1.5) || nearLift(x, z)) continue;
    fallenLog(parts, random, x, z);
  }
  // and the carpet under all of it: no bare ground anywhere past the fence
  for (let x = minX; x < maxX; x += 1.3) {
    for (let z = minZ; z < maxZ; z += 1.3) {
      const ux = x + random() * 1.3;
      const uz = z + random() * 1.3;
      if (!outside(ux, uz, 0.6) || nearLift(ux, uz)) continue;
      const r = random();
      if (r < 0.55) undergrowth(parts, random, ux, uz, 0.45 + random() * 0.45);
      else if (r < 0.85) weedTuft(parts, random, ux, uz, 0.7 + random() * 0.8);
      else if (r < 0.93) rubbleHeap(parts, random, ux, uz, 0.6 + random() * 0.6);
    }
  }
  // cables high overhead, sagging across corners of the garden: walk under one and it slides over the view
  overheadVine(parts, random, S.minX - 3, S.minZ - 2, 9, -4, S.minZ + 6, 10, 2.2);
  overheadVine(parts, random, S.maxX + 2.5, S.minZ + 4, 10, 6, S.minZ + 14, 8.5, 1.8);
  overheadVine(parts, random, S.minX - 2.5, S.maxZ - 3, 8, -9, S.maxZ + 3, 9, 1.5);
  overheadVine(parts, random, S.maxX + 3, S.maxZ - 8, 9.5, 12, S.maxZ + 4, 8, 1.6);
  // the wild pressing on the fence: ivy climbing the wire, saplings against it
  for (const f of FENCES) {
    const alongX = f.halfX >= f.halfZ;
    const len = (alongX ? f.halfX : f.halfZ) * 2;
    for (let t = -len / 2; t < len / 2; t += 0.6) {
      const x = f.x + (alongX ? t : 0);
      const z = f.z + (alongX ? 0 : t);
      if (random() < 0.55) {
        const h = 0.4 + random() * 1.3;
        parts.push(at(puff(0.25 + random() * 0.15, pick(C.ivy, random), random, 1.3), x + (alongX ? 0 : 0.12), h * 0.6, z + (alongX ? 0.12 : 0)));
      }
    }
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
  overgrownCity(parts, random);
  crackedLot(parts, random);
  wildGarden(parts, random);
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
  /** 0..1 of full strength: the sky as seen from inside a part-shut lift car */
  setLevel(level: number): void;
  follow(x: number, z: number): void;
  /** overhead: noon through a skylight (the training shed), rather than the garden's low afternoon sun */
  setOverhead(on: boolean): void;
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
  const low = new THREE.Vector3(-9, 18, 7);
  const high = new THREE.Vector3(-1.5, 20, 1);
  let offset = low;
  scene.add(sun, sun.target, sky);
  return {
    setOn(on) {
      sun.visible = on;
      sky.visible = on;
    },
    setLevel(level) {
      sun.intensity = 2.4 * level;
      sky.intensity = 1.3 * level;
    },
    follow(x, z) {
      sun.position.set(x + offset.x, offset.y, z + offset.z);
      sun.target.position.set(x, 0, z);
    },
    setOverhead(on) {
      offset = on ? high : low;
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
