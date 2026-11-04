import * as THREE from "three";
import { BRASS, CANVAS, COMPUTER_WHITE, EMIT_AMBER, EMIT_GREEN, HAZARD, OLIVE_DRAB, PAPER, RUBBER, STEEL } from "../../shared/palette.ts";
import { glowPart, merge, multiMesh, part, rng } from "./kit.ts";

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
// Equipment: two rows of white mainframe cabinets at the back (status
// lamps lit, part under canvas), a stepped heap of boxed tape in the
// middle with a pyramid of disk-pack canisters beside it, terminals and
// loose reels at the front.
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

const CABINET = { w: 0.8, d: 0.7, h: 1.5 };

/** a row of `n` mainframe cabinets on a pallet, facing +z, the first `covered` under a canvas sheet */
function cabinetRowParts(parts: Parts, lamps: Parts, x: number, z: number, n: number, covered: number): void {
  const { w: cw, d: cd, h: chh } = CABINET;
  const rowW = n * cw;
  pallet(parts, x, z, rowW + 0.1, cd + 0.15);
  for (let i = 0; i < n; i++) {
    const cx = x - rowW / 2 + cw / 2 + i * cw;
    parts.push(part(box(cw - 0.04, chh, cd), COMPUTER_WHITE.base, cx, 0.1 + chh / 2, z));
    // the front face: two tape reels behind a dark window, on every other one
    if (i % 2 === 0) {
      parts.push(part(box(cw - 0.2, 0.6, 0.02), RUBBER.base, cx, 0.1 + chh - 0.45, z + cd / 2 + 0.01));
      for (const s of [-1, 1]) parts.push(part(cyl(0.13, 0.13, 0.03, 7), STEEL.light, cx + s * 0.16, 0.1 + chh - 0.45, z + cd / 2 + 0.03, PI / 2, 0, 0));
    }
    if (i < covered) continue;
    // the top, where it's bare: a dark panel band with status lamps lit along it --- what shows from overhead
    parts.push(part(box(cw - 0.12, 0.02, 0.2), RUBBER.base, cx, 0.1 + chh + 0.01, z + cd / 2 - 0.14));
    for (let k = 0; k < 3; k++) {
      if ((i + k) % 3 !== 0) lamps.push(glowPart(box(0.08, 0.03, 0.07), k === 1 ? EMIT_GREEN : EMIT_AMBER, cx - 0.2 + k * 0.2, 0.1 + chh + 0.025, z + cd / 2 - 0.14));
    }
  }
  if (covered <= 0) return;
  // the canvas sheet: a slab draped over the top, hanging down the front and the outer side, folds across it
  const sw = covered * cw + 0.1;
  const sx = x - rowW / 2 + sw / 2 - 0.05;
  parts.push(part(box(sw, 0.04, cd + 0.12), CANVAS.base, sx, 0.1 + chh + 0.04, z));
  parts.push(part(box(sw, 0.7, 0.04), CANVAS.shade, sx, 0.1 + chh - 0.32, z + cd / 2 + 0.06, -0.08, 0, 0));
  parts.push(part(box(0.04, 0.9, cd + 0.12), CANVAS.shade, sx - sw / 2 - 0.02, 0.1 + chh - 0.42, z));
  for (const fx of [-0.35, 0.15, 0.6].map((k) => k * sw)) parts.push(part(box(0.1, 0.05, cd + 0.1), CANVAS.light, sx + fx, 0.1 + chh + 0.07, z, 0, 0.15, 0));
}

const TAPE_BOX = 0.12;
const TAPE_CELL = 0.48;
/**
 * A heap of boxed tape, `nx` by `nz` columns on a pallet, stepped: tallest
 * at `peak` boxes in the middle, falling away to its edges like a hill, but
 * every column square. Each column is one block with a seam every four
 * boxes; tones alternate so the heap reads as many boxes.
 */
function tapeHeapParts(parts: Parts, x: number, z: number, nx: number, nz: number, peak: number): void {
  pallet(parts, x, z, nx * TAPE_CELL + 0.1, nz * TAPE_CELL + 0.1);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const u = Math.abs((i - (nx - 1) / 2) / (nx / 2));
      const v = Math.abs((j - (nz - 1) / 2) / (nz / 2));
      const n = Math.max(2, Math.round(peak * (1 - 0.55 * Math.max(u, v) - 0.2 * Math.min(u, v))));
      const h = n * TAPE_BOX;
      const cx = x - (nx * TAPE_CELL) / 2 + TAPE_CELL / 2 + i * TAPE_CELL;
      const cz = z - (nz * TAPE_CELL) / 2 + TAPE_CELL / 2 + j * TAPE_CELL;
      const tone = (i * 7 + j * 3) % 5 === 0 ? COMPUTER_WHITE.shade : (i * 3 + j) % 4 === 0 ? COMPUTER_WHITE.light : COMPUTER_WHITE.base;
      parts.push(part(box(TAPE_CELL - 0.02, h, TAPE_CELL - 0.02), tone, cx, 0.1 + h / 2, cz));
      for (let k = 4; k < n; k += 4) parts.push(part(box(TAPE_CELL - 0.02, 0.02, TAPE_CELL - 0.02), RUBBER.base, cx, 0.1 + k * TAPE_BOX, cz));
    }
  }
}

/** straps over a heap, across it, at its middle height */
function heapStraps(parts: Parts, x: number, z: number, nx: number, nz: number, peak: number): void {
  const h = 0.1 + peak * TAPE_BOX * 0.62;
  for (let i = 1; i < nx; i += 2) strap(parts, x - (nx * TAPE_CELL) / 2 + i * TAPE_CELL, z, nz * TAPE_CELL, h, false);
}

/** disk-pack canisters stacked in a 3 x 3 pyramid of columns on a pallet */
function diskPyramidParts(parts: Parts, x: number, z: number): void {
  const cell = 0.48;
  pallet(parts, x, z, 3 * cell + 0.1, 3 * cell + 0.1);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const n = [7, 5, 3][(i !== 1 ? 1 : 0) + (j !== 1 ? 1 : 0)];
      for (let k = 0; k < n; k++) parts.push(part(cyl(0.22, 0.22, 0.15, 7), k % 2 ? COMPUTER_WHITE.shade : COMPUTER_WHITE.base, x - cell + i * cell, 0.1 + k * 0.17 + 0.075, z - cell + j * cell));
    }
  }
}

/** a terminal: a beige box with a dark screen facing +z, a keyboard in front */
function terminal(parts: Parts, x: number, y: number, z: number): void {
  parts.push(part(box(0.5, 0.42, 0.45), COMPUTER_WHITE.base, x, y + 0.21, z));
  parts.push(part(box(0.38, 0.28, 0.02), RUBBER.base, x, y + 0.26, z + 0.23));
  parts.push(part(box(0.48, 0.04, 0.2), COMPUTER_WHITE.shade, x, y + 0.02, z + 0.36));
}

/** a loose tape reel lying flat */
function reel(parts: Parts, x: number, z: number): void {
  parts.push(part(cyl(0.16, 0.16, 0.03, 7), RUBBER.base, x, 0.015, z));
  parts.push(part(cyl(0.05, 0.05, 0.035, 6), COMPUTER_WHITE.light, x, 0.02, z));
}

/** equipment: cabinets at the back, the tape heap and canister pyramid in the middle, terminals and loose reels at the front */
export function equipmentCargo(w: number, d: number): THREE.Group {
  const parts: Parts = [];
  const lamps: Parts = [];
  const back = -d / 2;
  const rowX = -w / 2 + 0.1 + (5 * CABINET.w) / 2;
  cabinetRowParts(parts, lamps, rowX, back + 0.15 + CABINET.d / 2, 5, 3);
  cabinetRowParts(parts, lamps, rowX, back + 0.4 + 1.5 * CABINET.d, 5, 2);
  assetTag(parts, -w / 2 + 0.1 + 4.5 * CABINET.w, 0.1 + CABINET.h + 0.06, back + 0.3 + 1.5 * CABINET.d);
  // beside the cabinets: a tall narrow heap of tape boxes
  tapeHeapParts(parts, w / 2 - 0.6, back + 0.9, 2, 3, 12);
  // the middle: the big tape heap and the canister pyramid beside it
  tapeHeapParts(parts, -w / 2 + 0.1 + 3 * TAPE_CELL, back + 3.45, 6, 5, 13);
  heapStraps(parts, -w / 2 + 0.1 + 3 * TAPE_CELL, back + 3.45, 6, 5, 13);
  diskPyramidParts(parts, w / 2 - 0.8, back + 2.95);
  // further forward: a second heap and a smaller canister pile, packed against it
  tapeHeapParts(parts, -w / 2 + 0.1 + 2.5 * TAPE_CELL, back + 5.55, 5, 3, 8);
  diskPyramidParts(parts, w / 2 - 0.8, back + 4.55);
  // the front: three terminals stacked on a pallet, things knocked loose
  pallet(parts, w / 2 - 1.0, d / 2 - 0.5, 1.4, 0.85);
  for (const [tx, ty] of [[w / 2 - 1.3, 0.1], [w / 2 - 0.7, 0.1], [w / 2 - 1.0, 0.52]]) terminal(parts, tx, ty, d / 2 - 0.7);
  parts.push(part(box(0.48, 0.24, 0.48), COMPUTER_WHITE.shade, 0.1, 0.12, d / 2 - 0.25, 0, 0.6, 0));
  parts.push(part(cyl(0.22, 0.22, 0.15, 7), COMPUTER_WHITE.base, -1.0, 0.22, d / 2 - 0.1, PI / 2, 0.4, 0));
  for (const [rx, rz] of [[-0.4, d / 2 + 0.15], [0.8, d / 2 + 0.05], [-w / 2 - 0.05, 0.4], [-w / 2 + 0.6, d / 2 + 0.2]]) reel(parts, rx, rz);
  return multiMesh({ matte: [merge(parts, "ground", 0.4)], emissive: lamps });
}

// --- the props, one by one (registered, each under the fixture budget) -------

const build = (parts: Parts, lamps: Parts = []): THREE.Group => multiMesh({ matte: [merge(parts, "ground", 0.4)], emissive: lamps });

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
  const lamps: Parts = [];
  cabinetRowParts(parts, lamps, 0, 0, 5, 3);
  return build(parts, lamps);
}
export function tapeHeap(): THREE.Group {
  const parts: Parts = [];
  tapeHeapParts(parts, 0, 0, 6, 5, 12);
  return build(parts);
}
export function diskPyramid(): THREE.Group {
  const parts: Parts = [];
  diskPyramidParts(parts, 0, 0);
  return build(parts);
}
