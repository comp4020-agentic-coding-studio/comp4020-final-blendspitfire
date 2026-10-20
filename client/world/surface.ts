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
// and takes the lift down. The story it tells: an ancient site, overgrown
// and half fallen, that a corp's crew has just fenced off and moved into ---
// sandstone ruins and old rust in long grass, against fresh chain-link,
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
  // the old site: weathered sandstone, moss in its cracks, iron gone to rust
  ruin: [0xd8c8a8, 0xcdbb98, 0xe0d2b4, 0xc4b08c],
  ruinShade: 0xb09c7c,
  moss: 0x8aa868,
  rust: [0xb0704a, 0x9a5e40, 0xc08058],
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
  const pad = SURFACE_VIEW_MARGIN + 1;
  // (not past the south hedge: the lift car's floor is there)
  const south = S.maxZ + 0.6;
  parts.push(tint(at(box(S.maxX - S.minX + pad * 2, 0.04, south - S.minZ + pad), (S.minX + S.maxX) / 2, -0.02, (S.minZ - pad + south) / 2), C.lawnDark));
  for (let x = S.minX - pad; x < S.maxX + pad; x += 0.7) {
    for (let z = S.minZ - pad; z < south - 0.6; z += 0.7) {
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

/** a stump of the old colonnade: drum on drum, the top one knocked askew, moss in the joins */
function ruinPillar(f: SurfaceFixture, parts: THREE.BufferGeometry[], random: () => number): void {
  const h = f.halfHeight * 2;
  const drums = Math.max(1, Math.round(h / 0.5));
  for (let i = 0; i < drums; i++) {
    const dh = h / drums;
    const g = new THREE.CylinderGeometry(f.halfX * 0.85, f.halfX * 0.9, dh - 0.02, 8);
    g.rotateY(random() * PI);
    parts.push(tint(at(g, f.x + (i === drums - 1 ? 0.06 : 0), dh * (i + 0.5), f.z), pick(C.ruin, random)));
    parts.push(tint(at(new THREE.CylinderGeometry(f.halfX * 0.88, f.halfX * 0.88, 0.04, 8), f.x, dh * (i + 1) - 0.01, f.z), C.moss));
  }
  parts.push(tint(at(box(f.halfX * 2.2, 0.16, f.halfZ * 2.2), f.x, 0.08, f.z), C.ruinShade));
  // a few fallen chips round the base
  for (let i = 0; i < 4; i++) parts.push(tint(at(new THREE.DodecahedronGeometry(0.08 + random() * 0.08, 0), f.x + (random() - 0.5) * 1.6, 0.06, f.z + (random() - 0.5) * 1.6), pick(C.ruin, random)));
}

/** a lintel that came down off the colonnade, lying cracked in two in the grass */
function ruinLintel(f: SurfaceFixture, parts: THREE.BufferGeometry[], random: () => number): void {
  const len = f.halfX * 2;
  const h = f.halfHeight * 2;
  parts.push(tint(at(box(len * 0.55, h, f.halfZ * 2), f.x - len * 0.22, h / 2, f.z, 0.06), pick(C.ruin, random)));
  parts.push(tint(at(box(len * 0.42, h * 0.9, f.halfZ * 1.9), f.x + len * 0.3, h * 0.45, f.z + 0.05, -0.12), pick(C.ruin, random)));
  // the carved band along its face, still just visible
  parts.push(tint(at(box(len * 0.5, 0.05, 0.06), f.x - len * 0.22, h + 0.01, f.z), C.ruinShade));
  parts.push(tint(at(box(len * 0.9, 0.03, f.halfZ * 2.4), f.x, 0.01, f.z), C.moss));
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
 * Past the fence, where nobody can go but everyone can see: more of what
 * the site was --- broken walls, toppled drums, a rusted gantry from some
 * earlier dig --- dotted in long grass. Seeded, so every client has the same.
 */
function outsideRuins(parts: THREE.BufferGeometry[], random: () => number): void {
  const S = SURFACE;
  const m = SURFACE_VIEW_MARGIN;
  const spots: [number, number][] = [];
  for (let i = 0; i < 22; i++) {
    const side = Math.floor(random() * 3); // 0 west, 1 east, 2 north
    const k = random();
    const o = 1.2 + random() * (m - 2);
    if (side === 0) spots.push([S.minX - o, S.minZ + k * (S.maxZ - S.minZ)]);
    else if (side === 1) spots.push([S.maxX + o, S.minZ + k * (S.maxZ - S.minZ)]);
    else spots.push([S.minX + k * (S.maxX - S.minX), S.minZ - o]);
  }
  spots.forEach(([x, z], i) => {
    const kind = i % 4;
    if (kind === 0) {
      // a stretch of wall, broken off at a slant
      const len = 1.5 + random() * 2.5;
      const ry = random() * PI;
      parts.push(tint(at(box(len, 0.6 + random() * 1.2, 0.45), x, 0.5, z, ry), pick(C.ruin, random)));
      parts.push(tint(at(box(len * 0.6, 0.35, 0.47), x, 1.2, z, ry), C.ruinShade));
    } else if (kind === 1) {
      // a toppled drum on its side
      const g = new THREE.CylinderGeometry(0.45, 0.45, 0.9, 8);
      g.rotateZ(PI / 2);
      parts.push(tint(at(g, x, 0.45, z, random() * PI), pick(C.ruin, random)));
    } else if (kind === 2) {
      // a rusted gantry leg from an older dig
      parts.push(tint(at(box(0.15, 2.2, 0.15), x, 1.1, z), pick(C.rust, random)));
      parts.push(tint(at(box(1.6, 0.12, 0.12), x + 0.7, 2.1, z, random() * 0.4), pick(C.rust, random)));
    } else {
      // rubble half in the grass
      for (let j = 0; j < 5; j++) parts.push(tint(at(new THREE.DodecahedronGeometry(0.15 + random() * 0.2, 0), x + (random() - 0.5) * 1.4, 0.1, z + (random() - 0.5) * 1.4), pick(C.ruin, random)));
    }
    if (random() < 0.6) parts.push(at(puff(0.35, pick(C.leaf, random), random), x + 0.5, 0.2, z + 0.4));
  });
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
