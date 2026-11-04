import * as THREE from "three";
import { BRASS, CANVAS, COMPUTER_WHITE, EMIT_AMBER, EMIT_GREEN, HAZARD, OLIVE_DRAB, PAPER, RUBBER, STEEL } from "../../shared/palette.ts";
import { glowPart, merge, multiMesh, part, rng } from "./kit.ts";

// The freight lift's load: what the whole job is for (user 2026-11-04 --- in
// the setting the reactor is only switched on to power this lift). Neat,
// square stacks on pallets, strapped down, with an asset tag on each block:
// freight that's been counted, not junk that's been piled.
//
// Munitions: olive drab steel ammunition cases in even courses, stencil
// bands on their lids, and racks of standing shells (brass cases, olive or
// steel noses). Equipment: white cabinets of an old mainframe (tape reels
// behind a window, a row of status lamps lit), stacks of disk-pack
// canisters, half of it under a canvas sheet.
//
// Each prop below adds its parts, centred on (x, z), to a list; the two
// blocks (munitionsCargo, equipmentCargo) are what the deck places, built
// `w` wide by `d` deep round the origin to fill a FREIGHT_CARGO footprint.
// The props are registered one by one so each stays inside the fixture budget.

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, n = 8) => new THREE.CylinderGeometry(rt, rb, h, n);

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

/** the asset tag on a block: a pale plate with a barcode, the company's own stamp on what it owns */
function assetTag(parts: Parts, x: number, y: number, z: number): void {
  parts.push(part(box(0.62, 0.02, 0.3), PAPER.light, x, y, z));
  for (const [bx, bw] of [[-0.2, 0.06], [-0.08, 0.03], [0.02, 0.07], [0.16, 0.04]]) parts.push(part(box(bw, 0.025, 0.2), RUBBER.base, x + bx, y + 0.005, z));
}

const CASE = { w: 0.62, d: 0.4, h: 0.34 };
export const AMMO_STACK = { w: 4 * CASE.w, d: 4 * CASE.d, h: 0.1 + 4 * CASE.h };

/** a stack of ammunition cases on a pallet, four courses, strapped: the lower three as one block (only its faces show) */
function ammoStackParts(parts: Parts, x: number, z: number, random: () => number): void {
  const { w, d } = AMMO_STACK;
  const ch = CASE.h;
  pallet(parts, x, z, w + 0.1, d + 0.1);
  parts.push(part(box(w - 0.03, 3 * ch - 0.02, d - 0.03), OLIVE_DRAB.base, x, 0.1 + 1.5 * ch, z));
  // the seams between cases, cut in as dark bands
  for (let i = 1; i < 4; i++) parts.push(part(box(0.025, 3 * ch - 0.04, d + 0.005), OLIVE_DRAB.shade, x - w / 2 + i * CASE.w, 0.1 + 1.5 * ch, z));
  for (const k of [1, 2]) parts.push(part(box(w + 0.005, 0.025, d + 0.005), OLIVE_DRAB.shade, x, 0.1 + k * ch, z));
  // the top course, case by case: lids with a stencil band
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = x - w / 2 + CASE.w / 2 + i * CASE.w;
      const cz = z - d / 2 + CASE.d / 2 + j * CASE.d;
      const y = 0.1 + 3 * ch;
      parts.push(part(box(CASE.w - 0.03, ch - 0.02, CASE.d - 0.03), random() < 0.25 ? OLIVE_DRAB.shade : OLIVE_DRAB.base, cx, y + ch / 2, cz));
      parts.push(part(box(CASE.w - 0.2, 0.015, 0.05), PAPER.base, cx, y + ch, cz - 0.06));
    }
  }
  strap(parts, x - w / 4, z, d, AMMO_STACK.h, false);
  strap(parts, x + w / 4, z, d, AMMO_STACK.h, false);
}

/** a steel rack of shells standing upright, three rows: brass cases, noses steel (back row) and olive */
function shellRackParts(parts: Parts, x: number, z: number, w: number, d: number): void {
  parts.push(part(box(w, 0.08, d), STEEL.shade, x, 0.04, z));
  for (const s of [-1, 1]) parts.push(part(box(w, 0.06, 0.06), STEEL.base, x, 0.62, z + s * (d / 2 - 0.03)));
  for (const s of [-1, 1]) for (const t of [-1, 1]) parts.push(part(box(0.06, 0.66, 0.06), STEEL.base, x + s * (w / 2 - 0.03), 0.33, z + t * (d / 2 - 0.03)));
  const n = 5;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      const sx = x - w / 2 + 0.24 + (i * (w - 0.48)) / (n - 1);
      const sz = z - d / 2 + 0.3 + (j * (d - 0.6)) / 2;
      parts.push(part(cyl(0.12, 0.13, 0.4, 5), BRASS.base, sx, 0.28, sz));
      parts.push(part(cyl(0.02, 0.12, 0.28, 5), j === 0 ? STEEL.light : OLIVE_DRAB.light, sx, 0.62, sz));
    }
  }
}

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
      for (const s of [-1, 1]) parts.push(part(cyl(0.13, 0.13, 0.03, 7), STEEL.light, cx + s * 0.16, 0.1 + chh - 0.45, z + cd / 2 + 0.03, Math.PI / 2, 0, 0));
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

/** disk-pack canisters stacked in columns on a pallet, strapped across */
function diskPackParts(parts: Parts, x: number, z: number, w: number, random: () => number): void {
  pallet(parts, x, z, w, 1.2);
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 2; j++) {
      const cx = x - w / 2 + 0.5 + i * ((w - 1) / 4);
      const cz = z - 0.28 + j * 0.56;
      const height = 2 + Math.floor(random() * 3);
      for (let k = 0; k < height; k++) parts.push(part(cyl(0.22, 0.22, 0.15, 7), k % 2 ? COMPUTER_WHITE.shade : COMPUTER_WHITE.base, cx, 0.1 + k * 0.17 + 0.075, cz));
    }
  }
  strap(parts, x, z, w - 0.1, 0.1 + 4 * 0.17, true);
}

const build = (parts: Parts, lamps: Parts = []): THREE.Group => multiMesh({ matte: [merge(parts, "ground", 0.4)], emissive: lamps });

// --- the props, one by one (registered, each under the fixture budget) -------

export function ammoStack(): THREE.Group {
  const parts: Parts = [];
  ammoStackParts(parts, 0, 0, rng(11));
  return build(parts);
}
export function shellRack(): THREE.Group {
  const parts: Parts = [];
  shellRackParts(parts, 0, 0, 2.4, 1.6);
  return build(parts);
}
export function cabinetRow(): THREE.Group {
  const parts: Parts = [];
  const lamps: Parts = [];
  cabinetRowParts(parts, lamps, 0, 0, 5, 3);
  return build(parts, lamps);
}
export function diskPacks(): THREE.Group {
  const parts: Parts = [];
  diskPackParts(parts, 0, 0, 5.3, rng(23));
  return build(parts);
}

// --- the two blocks the deck places --------------------------------------------

/** munitions: two strapped stacks of cases along the back, two shell racks in front, the tag on top */
export function munitionsCargo(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const random = rng(11);
  const back = -d / 2 + AMMO_STACK.d / 2 + 0.15;
  for (const sx of [-w / 2 + AMMO_STACK.w / 2 + 0.1, w / 2 - AMMO_STACK.w / 2 - 0.1]) {
    const parts: Parts = [];
    ammoStackParts(parts, sx, back, random);
    if (sx < 0) assetTag(parts, sx, AMMO_STACK.h + 0.08, back);
    g.add(build(parts));
  }
  const rackD = 1.6;
  for (const rx of [-w / 4 - 0.05, w / 4 + 0.05]) {
    const parts: Parts = [];
    shellRackParts(parts, rx, d / 2 - rackD / 2 - 0.15, w / 2 - 0.4, rackD);
    g.add(build(parts));
  }
  return g;
}

/** equipment: two rows of cabinets back to back down the middle (one half under canvas), disk packs in front, the tag on a bare cabinet */
export function equipmentCargo(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const rowX = -w / 2 + 0.1 + (5 * CABINET.w) / 2;
  const back = -d / 2 + CABINET.d / 2 + 0.2;
  // the back row faces the deck; a second row in front of it, back to back, under a sheet the other way
  const rowParts: Parts = [];
  const lamps: Parts = [];
  cabinetRowParts(rowParts, lamps, rowX, back, 5, 3);
  assetTag(rowParts, -w / 2 + 0.1 + 4.5 * CABINET.w, 0.1 + CABINET.h + 0.06, back - 0.12);
  g.add(build(rowParts, lamps));
  const frontParts: Parts = [];
  const frontLamps: Parts = [];
  cabinetRowParts(frontParts, frontLamps, rowX, back + CABINET.d + 0.25, 5, 2);
  g.add(build(frontParts, frontLamps));
  const diskParts: Parts = [];
  diskPackParts(diskParts, 0, d / 2 - 0.75, w - 0.4, rng(23));
  g.add(build(diskParts));
  return g;
}
