import * as THREE from "three";
import { BRASS, CANVAS, COMPUTER_WHITE, HAZARD, OLIVE_DRAB, PAPER, RUBBER, STEEL } from "../../shared/palette.ts";
import { merge, multiMesh, part, rng } from "./kit.ts";

// The freight lift's load: what the whole job is for (user 2026-11-04 --- in
// the setting the reactor is only switched on to power this lift). Piled
// high, the way a game's ammo dump is (user: "猛猛堆", a mountain of it but
// not a mess): heaped against the back wall and stepping down toward the
// crew, every stack square and strapped, a few things knocked loose round
// the edges. A hoard that's been counted, not junk that's been dropped.
//
// Munitions: walls of olive drab ammunition cases at the back, artillery
// shells lying in log-pile pyramids between end chocks in the middle, a
// lower course of cases, an opened case and loose shells at the front.
// Equipment (unpowered, so nothing on it is lit): two rows of white
// mainframe cabinets at the back with chassis stacked beside them, big
// film reels (three windows round the hub) heaped flat and racked on
// edge, antennas in cradles, unnamed modules, monitors and cable at the
// front, and one tarpaulin over the lot, dragged half off (user 2026-11-04).
//
// Each prop adds its parts, centred on (x, z), to a list; the two blocks
// (munitionsCargo, equipmentCargo) are built `w` wide by `d` deep round
// the origin (+z toward the door) to fill a FREIGHT_CARGO footprint, each
// merged into one mesh per finish. The props are registered one by one so
// each stays inside the fixture budget.

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, n = 8) => new THREE.CylinderGeometry(rt, rb, h, n);
const PI = Math.PI;

type Parts = THREE.BufferGeometry[];

/** a pallet under each stack: slats on a base, so the stacks read as freight */
function pallet(parts: Parts, x: number, z: number, w: number, d: number): void {
  parts.push(part(box(w, 0.06, d), STEEL.shade, x, 0.03, z));
  for (let i = 0; i < 4; i++) parts.push(part(box(w, 0.04, 0.12), STEEL.base, x, 0.08, z - d / 2 + 0.1 + (i * (d - 0.2)) / 3));
}

/** a ratchet strap over a stack, top and both sides, with its buckle; `span` across the stack, `h` its height */
function strap(parts: Parts, x: number, z: number, span: number, h: number, alongX: boolean): void {
  const t = 0.05;
  const across = (a: number, b: number, c: number) => (alongX ? box(a, b, c) : box(c, b, a));
  parts.push(part(across(span + 0.04, t, 0.1), HAZARD.shade, x, h + t / 2, z));
  for (const s of [-1, 1]) parts.push(part(across(t, h, 0.1), HAZARD.shade, x + (alongX ? s * (span / 2 + 0.02) : 0), h / 2, z + (alongX ? 0 : s * (span / 2 + 0.02))));
  parts.push(part(box(0.15, 0.06, 0.15), STEEL.light, x, h + 0.05, z));
}

/** the asset tag on a stack: a pale plate with a barcode, the company's own stamp on what it owns */
function assetTag(parts: Parts, x: number, y: number, z: number): void {
  parts.push(part(box(0.62, 0.02, 0.3), PAPER.light, x, y, z));
  for (const [bx, bw] of [[-0.2, 0.06], [-0.08, 0.03], [0.02, 0.07], [0.16, 0.04]]) parts.push(part(box(bw, 0.025, 0.2), RUBBER.base, x + bx, y + 0.005, z));
}

// --- munitions -------------------------------------------------------------------

const CASE = { w: 0.62, d: 0.4, h: 0.34 };

/** a stack of ammunition cases `nx` by `nz`, `courses` high, on a pallet, strapped: the lower courses as one block (only its faces show), the top course case by case; returns its height */
function ammoStackParts(parts: Parts, x: number, z: number, nx: number, nz: number, courses: number, random: () => number): number {
  const w = nx * CASE.w;
  const d = nz * CASE.d;
  const ch = CASE.h;
  pallet(parts, x, z, w + 0.1, d + 0.1);
  const low = courses - 1;
  if (low > 0) {
    parts.push(part(box(w - 0.03, low * ch - 0.02, d - 0.03), OLIVE_DRAB.base, x, 0.1 + (low * ch) / 2, z));
    // the seams between cases, cut in as dark bands
    for (let i = 1; i < nx; i++) parts.push(part(box(0.025, low * ch - 0.04, d + 0.005), OLIVE_DRAB.shade, x - w / 2 + i * CASE.w, 0.1 + (low * ch) / 2, z));
    for (let k = 1; k < low; k++) parts.push(part(box(w + 0.005, 0.025, d + 0.005), OLIVE_DRAB.shade, x, 0.1 + k * ch, z));
  }
  const y = 0.1 + low * ch;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = x - w / 2 + CASE.w / 2 + i * CASE.w;
      const cz = z - d / 2 + CASE.d / 2 + j * CASE.d;
      parts.push(part(box(CASE.w - 0.03, ch - 0.02, CASE.d - 0.03), random() < 0.25 ? OLIVE_DRAB.shade : OLIVE_DRAB.base, cx, y + ch / 2, cz));
      parts.push(part(box(CASE.w - 0.2, 0.015, 0.05), PAPER.base, cx, y + ch, cz - 0.06));
    }
  }
  const top = 0.1 + courses * ch;
  const straps = Math.max(1, Math.floor(nx / 2));
  for (let i = 0; i < straps; i++) strap(parts, x - w / 2 + ((i + 0.5) * w) / straps, z, d, top, false);
  return top;
}

const SHELL_R = 0.12;
/** one artillery shell lying flat, turned `turn` from +z (nose forward): brass case, olive (or steel) projectile tapering to the nose */
function shell(parts: Parts, x: number, y: number, z: number, turn = 0, nose = OLIVE_DRAB.light): void {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  parts.push(part(cyl(SHELL_R, SHELL_R, 0.36, 5), BRASS.base, x - s * 0.18, y, z - c * 0.18, PI / 2, turn, 0));
  parts.push(part(cyl(0.03, SHELL_R, 0.34, 5), nose, x + s * 0.17, y, z + c * 0.17, PI / 2, turn, 0));
}

/** shells lying in a log-pile pyramid, `base` wide and `rows` high, noses toward +z, between steel end chocks on a pallet */
function shellPyramidParts(parts: Parts, x: number, z: number, base: number, rows: number, nose = OLIVE_DRAB.light): void {
  const w = base * SHELL_R * 2;
  const h = 0.2 + rows * SHELL_R * 1.75;
  pallet(parts, x, z, w + 0.2, 0.8);
  for (const s of [-1, 1]) {
    parts.push(part(box(w + 0.2, 0.18, 0.08), STEEL.base, x, 0.19, z + s * 0.36));
    parts.push(part(box(0.08, h, 0.08), STEEL.base, x + s * (w / 2 + 0.06), 0.1 + h / 2, z));
  }
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < base - r; i++) shell(parts, x - w / 2 + SHELL_R + r * SHELL_R + i * SHELL_R * 2, 0.1 + SHELL_R + r * SHELL_R * Math.sqrt(3), z, 0, nose);
  }
}

/** an opened case: the lid leant against it, three shells showing inside */
function openCaseParts(parts: Parts, x: number, z: number): void {
  parts.push(part(box(0.9, 0.3, 0.55), OLIVE_DRAB.shade, x, 0.15, z));
  parts.push(part(box(0.8, 0.02, 0.45), RUBBER.base, x, 0.3, z));
  for (let i = 0; i < 3; i++) shell(parts, x - 0.25 + i * 0.25, 0.28, z, PI / 2, STEEL.light);
  parts.push(part(box(0.9, 0.04, 0.5), OLIVE_DRAB.base, x, 0.25, z + 0.42, -1.1, 0, 0));
}

/** munitions: a wall of cases at the back, shell pyramids in the middle, a low course and loose things at the front */
export function munitionsCargo(w: number, d: number): THREE.Group {
  const parts: Parts = [];
  const random = rng(11);
  const back = -d / 2;
  // the back: two big stacks, five and four courses, the tag on the taller
  const bz = back + 0.15 + 2 * CASE.d;
  const top = ammoStackParts(parts, -w / 2 + 0.1 + 2 * CASE.w, bz, 4, 4, 5, random);
  assetTag(parts, -w / 2 + 0.1 + 2 * CASE.w, top + 0.04, bz);
  ammoStackParts(parts, w / 2 - 0.1 - 2 * CASE.w, bz, 4, 4, 4, random);
  // the middle: three rows of three shell pyramids, packed nose to tail, olive then steel then olive
  const pw = 7 * SHELL_R * 2 + 0.2;
  const rows: [number, typeof OLIVE_DRAB.light][] = [[back + 2.3, OLIVE_DRAB.light], [back + 3.12, STEEL.light], [back + 3.94, OLIVE_DRAB.light]];
  for (const [row, nose] of rows) {
    for (let i = 0; i < 3; i++) shellPyramidParts(parts, -w / 2 + pw / 2 + 0.05 + i * (pw + 0.03), row, 7, 4, nose);
  }
  // the front: stacks of cases stepping down, an opened case among them, things knocked loose
  ammoStackParts(parts, -w / 2 + 0.1 + 1.5 * CASE.w, back + 5.15, 3, 3, 3, random);
  ammoStackParts(parts, -w / 2 + 0.2 + 4 * CASE.w, back + 5.15, 2, 3, 2, random);
  ammoStackParts(parts, w / 2 - 0.1 - 1.5 * CASE.w, back + 5.15, 3, 3, 2, random);
  shellPyramidParts(parts, -w / 2 + 0.1 + 1.5 * CASE.w, d / 2 - 0.4, 6, 3);
  openCaseParts(parts, 0.6, d / 2 - 0.45);
  ammoStackParts(parts, w / 2 - 0.1 - CASE.w, d / 2 - 0.15 - CASE.d, 2, 2, 1, random);
  parts.push(part(box(CASE.w, CASE.h, CASE.d), OLIVE_DRAB.base, -0.2, 0.17, d / 2 + 0.05, 0, 0.5, 0));
  for (const [sx, sz, t] of [[-0.85, d / 2 + 0.3, 1.2], [1.55, d / 2 + 0.25, -0.4], [w / 2 + 0.05, 0.4, 0.2]]) shell(parts, sx, SHELL_R, sz, t);
  return multiMesh({ matte: [merge(parts, "ground", 0.4)] });
}

// --- equipment -------------------------------------------------------------------
// None of it is powered (the reactor feeds the lift, not the load), so no
// lamp on it is lit. One big tarpaulin was thrown over the lot and has been
// dragged half off: what's left hangs crooked over the back cabinets, the
// rest slumps over the reels and lies heaped on the deck.

const CABINET = { w: 0.8, d: 0.7, h: 1.5 };

/** a row of `n` mainframe cabinets on a pallet, facing +z: tape windows, dark (unpowered) panel bands on top */
function cabinetRowParts(parts: Parts, x: number, z: number, n: number): void {
  const { w: cw, d: cd, h: chh } = CABINET;
  const rowW = n * cw;
  pallet(parts, x, z, rowW + 0.1, cd + 0.15);
  for (let i = 0; i < n; i++) {
    const cx = x - rowW / 2 + cw / 2 + i * cw;
    parts.push(part(box(cw - 0.04, chh, cd), COMPUTER_WHITE.base, cx, 0.1 + chh / 2, z));
    parts.push(part(box(cw - 0.12, 0.02, 0.2), RUBBER.base, cx, 0.1 + chh + 0.01, z + cd / 2 - 0.14));
    // the front face: two tape reels behind a dark window, on every other one
    if (i % 2 === 0) {
      parts.push(part(box(cw - 0.2, 0.6, 0.02), RUBBER.base, cx, 0.1 + chh - 0.45, z + cd / 2 + 0.01));
      for (const s of [-1, 1]) parts.push(part(cyl(0.13, 0.13, 0.03, 7), STEEL.light, cx + s * 0.16, 0.1 + chh - 0.45, z + cd / 2 + 0.03, PI / 2, 0, 0));
    }
  }
}

const REEL_R = 0.42;
const REEL_T = 0.09;
/**
 * A big film reel lying flat: a steel disc with three round windows round
 * its hub, the dark wound film showing through them, the hub on top.
 */
function filmReel(parts: Parts, x: number, y: number, z: number, turn = 0): void {
  parts.push(part(cyl(REEL_R * 0.86, REEL_R * 0.86, REEL_T - 0.01, 9), RUBBER.base, x, y + REEL_T / 2, z));
  parts.push(part(cyl(REEL_R, REEL_R, 0.012, 9), STEEL.light, x, y + REEL_T - 0.006, z));
  for (let k = 0; k < 3; k++) {
    const a = turn + (k * 2 * PI) / 3;
    parts.push(part(cyl(0.12, 0.12, 0.014, 6), RUBBER.base, x + Math.cos(a) * REEL_R * 0.52, y + REEL_T, z + Math.sin(a) * REEL_R * 0.52));
  }
  parts.push(part(cyl(0.07, 0.07, 0.02, 6), STEEL.base, x, y + REEL_T + 0.005, z));
}

/** reels stacked flat in `cols` piles on a pallet, `high` reels each, the piles stepping down from the middle */
function reelStackParts(parts: Parts, x: number, z: number, cols: [number, number, number][]): void {
  const span = REEL_R * 2 + 0.06;
  const xs = cols.map((c) => c[0]);
  const zs = cols.map((c) => c[1]);
  const w = Math.max(...xs) - Math.min(...xs) + span;
  const d = Math.max(...zs) - Math.min(...zs) + span;
  pallet(parts, x + (Math.max(...xs) + Math.min(...xs)) / 2, z + (Math.max(...zs) + Math.min(...zs)) / 2, w, d);
  // each pile: the reels under the top one as a single drum (only its side shows) ringed by their steel flanges, the top reel in full
  for (const [cx, cz, high] of cols) {
    const under = (high - 1) * REEL_T;
    if (under > 0) {
      parts.push(part(cyl(REEL_R * 0.9, REEL_R * 0.9, under, 9), RUBBER.base, x + cx, 0.1 + under / 2, z + cz));
      for (let k = 1; k < high; k++) parts.push(part(cyl(REEL_R, REEL_R, 0.02, 9), k % 2 ? STEEL.light : STEEL.base, x + cx, 0.1 + k * REEL_T - 0.01, z + cz));
    }
    filmReel(parts, x + cx, 0.1 + under, z + cz, high * 0.7);
  }
}

/** reels standing on edge in a steel rack, a row of them, like records in a crate */
function reelRackParts(parts: Parts, x: number, z: number, n: number): void {
  const w = n * (REEL_T + 0.05) + 0.2;
  parts.push(part(box(w, 0.08, 0.6), STEEL.shade, x, 0.04, z));
  for (const s of [-1, 1]) parts.push(part(box(0.06, 0.95, 0.6), STEEL.base, x + s * (w / 2 - 0.03), 0.48, z));
  parts.push(part(box(w, 0.04, 0.06), STEEL.base, x, 0.6, z + 0.27));
  for (let i = 0; i < n; i++) {
    const rx = x - w / 2 + 0.15 + i * (REEL_T + 0.05);
    parts.push(part(cyl(REEL_R, REEL_R, REEL_T - 0.02, 9), i % 3 === 1 ? STEEL.base : STEEL.light, rx, 0.08 + REEL_R, z, 0, 0, PI / 2));
    parts.push(part(cyl(REEL_R * 0.86, REEL_R * 0.86, REEL_T - 0.01, 9), RUBBER.base, rx, 0.08 + REEL_R, z, 0, 0, PI / 2));
  }
}

/** rack-mounted chassis stacked on a pallet: grey boxes of different heights, front panels dark, handles and vents */
function chassisStackParts(parts: Parts, x: number, z: number, random: () => number): void {
  pallet(parts, x, z, 1.0, 0.8);
  let y = 0.1;
  for (let k = 0; k < 5; k++) {
    const h = [0.18, 0.26, 0.14, 0.32, 0.2][k];
    const tone = random() < 0.5 ? STEEL.base : COMPUTER_WHITE.shade;
    parts.push(part(box(0.9, h, 0.7), tone, x + (random() - 0.5) * 0.06, y + h / 2, z));
    parts.push(part(box(0.84, h - 0.06, 0.02), RUBBER.base, x, y + h / 2, z + 0.36));
    for (const s of [-1, 1]) parts.push(part(box(0.04, h * 0.6, 0.05), STEEL.light, x + s * 0.4, y + h / 2, z + 0.38));
    y += h + 0.01;
  }
  // vents on the top lid
  for (let i = 0; i < 4; i++) parts.push(part(box(0.5, 0.012, 0.03), RUBBER.base, x, y + 0.006, z - 0.2 + i * 0.13));
}

/** a mast antenna lying in a cradle: a lattice tube with a small dish on its end, and a whip aerial */
function antennaParts(parts: Parts, x: number, z: number, len: number): void {
  for (const s of [-1, 1]) parts.push(part(box(0.3, 0.2, 0.08), STEEL.shade, x + s * (len / 2 - 0.3), 0.1, z));
  parts.push(part(cyl(0.06, 0.06, len, 5), STEEL.light, x, 0.24, z, 0, 0, PI / 2));
  for (let i = 0; i < 5; i++) parts.push(part(box(0.03, 0.18, 0.18), STEEL.base, x - len / 2 + 0.3 + (i * (len - 0.6)) / 4, 0.24, z));
  parts.push(part(cyl(0.32, 0.08, 0.14, 8), COMPUTER_WHITE.base, x + len / 2 + 0.05, 0.3, z, 0, 0, -PI / 2));
  parts.push(part(cyl(0.012, 0.012, 1.1, 4), STEEL.light, x - len / 4, 0.3, z + 0.18, 0, 0.3, PI / 2));
}

/** a coil of heavy cable lying flat */
function cableCoil(parts: Parts, x: number, z: number, r = 0.32): void {
  parts.push(part(new THREE.TorusGeometry(r, 0.06, 4, 10), RUBBER.base, x, 0.06, z, PI / 2, 0, 0));
  parts.push(part(new THREE.TorusGeometry(r * 0.72, 0.06, 4, 9), RUBBER.base, x, 0.14, z, PI / 2, 0, 0));
}

/** unnamed modules: squat cases with fins, connectors and a stencil plate, a few to a pallet */
function modulesParts(parts: Parts, x: number, z: number, random: () => number): void {
  pallet(parts, x, z, 1.3, 0.9);
  for (let i = 0; i < 4; i++) {
    const mx = x - 0.33 + (i % 2) * 0.66;
    const mz = z - 0.2 + Math.floor(i / 2) * 0.42;
    const h = 0.22 + random() * 0.16;
    parts.push(part(box(0.56, h, 0.36), i % 3 === 0 ? OLIVE_DRAB.base : STEEL.base, mx, 0.1 + h / 2, mz));
    for (let f = 0; f < 4; f++) parts.push(part(box(0.03, 0.06, 0.32), STEEL.light, mx - 0.18 + f * 0.12, 0.1 + h + 0.03, mz));
    parts.push(part(cyl(0.04, 0.04, 0.06, 5), BRASS.base, mx + 0.22, 0.1 + h + 0.03, mz + 0.12));
  }
}

/** a monitor: a deep beige box with a dark screen facing +z */
function monitor(parts: Parts, x: number, y: number, z: number, turn = 0): void {
  parts.push(part(box(0.5, 0.42, 0.48), COMPUTER_WHITE.base, x, y + 0.21, z, 0, turn, 0));
  parts.push(part(box(0.38, 0.3, 0.02), RUBBER.base, x + Math.sin(turn) * 0.25, y + 0.23, z + Math.cos(turn) * 0.25, 0, turn, 0));
}

/**
 * The tarpaulin, half dragged off: still over the back cabinets but pulled
 * askew (its edge runs crooked across them, a corner hangs down the front),
 * then slumping off their front over the reels in a fold, and the rest
 * crumpled on the deck where it was dragged. Built from tilted slabs and
 * lumps rather than a cloth simulation.
 */
function tarpParts(parts: Parts, x0: number, x1: number, back: number, front: number, random: () => number): void {
  const top = 0.1 + CABINET.h + 0.04;
  const span = x1 - x0;
  // the part still on: over both cabinet rows, its free edge running crooked
  // from deep (west, where it still covers both rows) to shallow (east, where
  // only the back row's top is under it)
  const n = 7;
  const w = span / n;
  const deep = 2 * CABINET.d + 0.45;
  for (let i = 0; i < n; i++) {
    const reach = THREE.MathUtils.lerp(deep, 0.35, (i / (n - 1)) ** 1.4);
    const cx = x0 + w / 2 + i * w;
    parts.push(part(box(w + 0.05, 0.04, reach), i % 2 ? CANVAS.base : CANVAS.light, cx, top + 0.015 * (i % 2), back + reach / 2, 0.03 * (random() - 0.5), 0.04 * (random() - 0.5), 0));
  }
  // folds running down it, where it was pulled: ridges toward the front-west corner
  for (let i = 0; i < 4; i++) parts.push(part(box(0.12, 0.07, deep * 0.8), CANVAS.light, x0 + 0.5 + i * 0.55, top + 0.05, back + deep * 0.45, 0, 0.35 + i * 0.05, 0));
  // where it comes off the front of the rows: a big sheet hanging down, skewed
  const edge = back + deep;
  parts.push(part(box(2.3, 1.35, 0.05), CANVAS.shade, x0 + 1.15, top - 0.68, edge + 0.15, -0.22, 0.12, 0.08));
  // dragged across the reels in front, in broad slabs sloping down to the deck
  parts.push(part(box(2.4, 0.05, 1.4), CANVAS.base, x0 + 1.25, 0.95, edge + 1.0, 0.45, 0.12, 0.06));
  parts.push(part(box(2.2, 0.05, 1.1), CANVAS.light, x0 + 1.1, 0.55, front + 0.2, 0.3, 0.22, -0.05));
  // and the rest heaped on the deck where it was pulled: crumpled lumps, and its trailing corner
  for (let i = 0; i < 7; i++) {
    const lx = x0 + 0.3 + random() * 2.0;
    const lz = front + 0.75 + random() * 0.6;
    parts.push(part(new THREE.IcosahedronGeometry(0.3 + random() * 0.16, 0), i % 2 ? CANVAS.base : CANVAS.shade, lx, 0.12, lz, random(), random(), random(), 1.5, 1.2));
  }
  parts.push(part(box(1.0, 0.03, 0.7), CANVAS.base, x0 + 2.4, 0.02, front + 1.35, 0, 0.5, 0));
}

/** equipment: cabinets at the back under the dragged tarp, reels stacked and racked, chassis, antennas, modules, monitors, cable */
export function equipmentCargo(w: number, d: number): THREE.Group {
  const parts: Parts = [];
  const random = rng(23);
  const back = -d / 2;
  // the back: two rows of cabinets, back to back
  const rowX = -w / 2 + 0.1 + (5 * CABINET.w) / 2;
  const row1 = back + 0.15 + CABINET.d / 2;
  const row2 = back + 0.4 + 1.5 * CABINET.d;
  cabinetRowParts(parts, rowX, row1, 5);
  cabinetRowParts(parts, rowX, row2, 5);
  assetTag(parts, -w / 2 + 0.1 + 4.5 * CABINET.w, 0.1 + CABINET.h + 0.06, row2 - 0.1);
  // beside them, chassis stacked high
  chassisStackParts(parts, w / 2 - 0.6, back + 0.6, random);
  chassisStackParts(parts, w / 2 - 0.6, back + 1.5, random);
  // the middle: film reels heaped in flat piles, the tallest in the middle, packed up to the cabinets
  const reelZ = back + 2.85;
  const s = REEL_R * 2 + 0.06;
  reelStackParts(parts, -w / 2 + 0.1 + 1.5 * s, reelZ, [
    [-s, -s / 2, 6], [0, -s / 2, 9], [s, -s / 2, 7],
    [-s, s / 2, 5], [0, s / 2, 8], [s, s / 2, 6],
  ]);
  reelRackParts(parts, w / 2 - 1.0, back + 2.45, 12);
  reelRackParts(parts, w / 2 - 1.0, back + 3.15, 10);
  modulesParts(parts, w / 2 - 0.85, back + 4.05, random);
  // further forward: an antenna in its cradle, more reels, chassis, modules, all close
  antennaParts(parts, -w / 2 + 1.5, back + 4.3, 2.4);
  reelStackParts(parts, -w / 2 + 0.1 + s, back + 5.0, [[-s / 2, 0, 4], [s / 2, 0, 6]]);
  chassisStackParts(parts, 0.15, back + 4.75, random);
  reelStackParts(parts, w / 2 - 0.1 - s, back + 5.05, [[-s / 2, 0, 5], [s / 2, 0, 3]]);
  modulesParts(parts, -w / 2 + 2.6, back + 5.75, random);
  // the front: monitors stacked two on three, a cable coil, things knocked loose
  pallet(parts, w / 2 - 1.0, d / 2 - 0.45, 1.6, 0.8);
  for (const [mx, my] of [[w / 2 - 1.5, 0.1], [w / 2 - 1.0, 0.1], [w / 2 - 0.5, 0.1], [w / 2 - 1.25, 0.52], [w / 2 - 0.75, 0.52]]) monitor(parts, mx, my, d / 2 - 0.5);
  cableCoil(parts, -0.15, d / 2 - 0.15);
  monitor(parts, 0.8, 0, d / 2 + 0.05, 0.9);
  filmReel(parts, -w / 2 + 0.3, 0, d / 2 + 0.05, 0.3);
  filmReel(parts, w / 2 + 0.15, 0, 1.4, 1.1);
  parts.push(part(cyl(REEL_R, REEL_R, REEL_T, 9), STEEL.light, -0.75, REEL_R * 0.7, d / 2 + 0.1, 0.4, 0.5, PI / 2 - 0.2));
  // the tarp: still on the back, half dragged off over the reels and onto the deck
  tarpParts(parts, -w / 2 + 0.05, -w / 2 + 0.15 + 5 * CABINET.w, back + 0.1, reelZ - s / 2, random);
  return multiMesh({ matte: [merge(parts, "ground", 0.4)] });
}

// --- the props, one by one (registered, each under the fixture budget) -------

const build = (parts: Parts): THREE.Group => multiMesh({ matte: [merge(parts, "ground", 0.4)] });

export function ammoStack(): THREE.Group {
  const parts: Parts = [];
  ammoStackParts(parts, 0, 0, 4, 4, 5, rng(11));
  return build(parts);
}
export function shellPyramid(): THREE.Group {
  const parts: Parts = [];
  shellPyramidParts(parts, 0, 0, 7, 4);
  return build(parts);
}
export function cabinetRow(): THREE.Group {
  const parts: Parts = [];
  cabinetRowParts(parts, 0, 0, 5);
  return build(parts);
}
export function filmReelStack(): THREE.Group {
  const parts: Parts = [];
  const s = REEL_R * 2 + 0.06;
  reelStackParts(parts, 0, 0, [[-s / 2, 0, 9], [s / 2, 0, 6]]);
  return build(parts);
}
export function filmReelRack(): THREE.Group {
  const parts: Parts = [];
  reelRackParts(parts, 0, 0, 12);
  return build(parts);
}
export function chassisStack(): THREE.Group {
  const parts: Parts = [];
  chassisStackParts(parts, 0, 0, rng(3));
  return build(parts);
}
export function antenna(): THREE.Group {
  const parts: Parts = [];
  antennaParts(parts, 0, 0, 2.4);
  return build(parts);
}
export function modules(): THREE.Group {
  const parts: Parts = [];
  modulesParts(parts, 0, 0, rng(5));
  return build(parts);
}
export function tarp(): THREE.Group {
  const parts: Parts = [];
  tarpParts(parts, -2, 2, -1, 1.2, rng(7));
  return build(parts);
}
