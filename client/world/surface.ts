import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  HEDGES,
  LIFT_CARS,
  LIFT_DZ,
  SCOREBOARD,
  SURFACE,
  SURFACE_FIXTURES,
  type Obstacle,
  type SurfaceFixture,
} from "../../shared/protocol.ts";
import { rng } from "../models/kit.ts";

// The garden on the surface: where everyone arrives, learns the controls,
// and takes the lift down. It's deliberately the facility's opposite ---
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
  // strokes laid side by side
  const S = SURFACE;
  const pad = 3;
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

function hedgeModel(h: Obstacle, parts: THREE.BufferGeometry[], random: () => number): void {
  const alongX = h.halfX >= h.halfZ;
  const len = (alongX ? h.halfX : h.halfZ) * 2;
  const height = h.halfHeight * 2;
  for (let t = -len / 2; t < len / 2; t += 0.55) {
    const x = h.x + (alongX ? t : (random() - 0.5) * 0.1);
    const z = h.z + (alongX ? (random() - 0.5) * 0.1 : t);
    parts.push(at(puff(0.5, pick(C.hedge, random), random, 1.1), x, height * 0.55, z));
    if (random() < 0.25) parts.push(at(puff(0.12, pick(C.flower, random), random), x + (random() - 0.5) * 0.6, height * 0.9, z + (random() - 0.5) * 0.6));
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
  for (const h of HEDGES) hedgeModel(h, parts, random);
  for (const f of SURFACE_FIXTURES) {
    if (f.kind === "tree") tree(f, parts, random);
    else if (f.kind === "target") target(f, parts);
    else if (f.kind === "bench") bench(f, parts);
    else if (f.kind === "planter") planter(f, parts, random);
    else if (f.kind === "scoreboard") scoreboardFrame(f, parts, glow);
  }
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
