import * as THREE from "three";
import { CONCRETE_DARK, EMIT_AMBER, HAZARD, PAINT_ASH, PAINT_CHARCOAL, PAINT_OXIDE, RUBBER, STEEL } from "../../shared/palette.ts";
import { BLAST_DOOR, FACILITY_WALL_HALF_HEIGHT, FREIGHT, CARGO_D, CARGO_W, FREIGHT_CARGO, FREIGHT_PANEL, FREIGHT_SHAFT, FREIGHT_WALLS } from "../../shared/protocol.ts";
import { equipmentCargo, munitionsCargo } from "../models/cargo.ts";
import { RISE_MS, blastDoorOpen, evacStage, type EvacState } from "../../shared/enemies.ts";
import { glow } from "../look.ts";
import { lampFixture } from "../models/facility.ts";
import { FACING_DIR, LAMPS, LAMP_SPECS } from "./dressing.ts";
import { SCREEN_DOOR_SOLID, glowPart, merge, mesh, multiMesh, part, screenDoor } from "../models/kit.ts";

// The way out after a win (ADR-060), drawn: the blast door across the core's
// north wall, the freight lift's platform behind it, and the shaft it rises
// up. All of it is moved by the evacuation's server times (evacStage), so
// every screen sees the door move and the shaft go by together.
//
// The rise is staged: the platform never moves (deck, cargo, panel, its
// railing, the crew). Everything round it is the shaft and the map, and
// goes down together (user 2026-11-04): the blast door and the walls at
// the shaft's foot sink out of sight, and the same shaft wall on all four
// sides --- rails, a lamp every metre, panel seams --- streams down after
// them, with the camera rumbling. An open drop (FREIGHT_GAP) runs between
// the deck and the walls on three sides, behind a plain steel railing.

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const H = FACILITY_WALL_HALF_HEIGHT * 2;
/** the shaft's walls go this far up: past the camera, so the ribs come down from out of sight */
const SHAFT_TOP = 18;
/** the wall lamps' vertical spacing (user 2026-11-04: about a metre apart) */
const LAMP_STEP = 1;
/** the moving pattern's repeat: long enough that the walls' plant doesn't read as a stamp, a whole number of lamps and seams so it loops without a jump */
const LOOP = 9;
/** the shaft's walls go up to here: a whole number of lamp steps past SHAFT_TOP */
const SHAFT_H = SHAFT_TOP + 3;
/** how fast the shaft goes by, in metres a second */
const RISE_SPEED = 2.4;
/** how far the shaft sinks as a whole before only its lamps and plant move: the door's top well under the deck */
const SINK = 6;

// the platform
const W = FREIGHT.maxX - FREIGHT.minX;
const D = FREIGHT.maxZ - FREIGHT.minZ;
const CX = (FREIGHT.minX + FREIGHT.maxX) / 2;
const CZ = (FREIGHT.minZ + FREIGHT.maxZ) / 2;
// the shaft round it, inside its walls
const SW = FREIGHT_SHAFT.maxX - FREIGHT_SHAFT.minX;
const SD = FREIGHT_SHAFT.maxZ - FREIGHT_SHAFT.minZ;
const SCX = (FREIGHT_SHAFT.minX + FREIGHT_SHAFT.maxX) / 2;
const SCZ = (FREIGHT_SHAFT.minZ + FREIGHT_SHAFT.maxZ) / 2;

/**
 * One half of the blast door: armour slabs bolted in rows, heavy ribs up
 * its face, the hazard chevrons down its meeting edge. Each half is
 * `half` wide, its meeting edge at x = 0 (it's placed and slid from there).
 */
function doorHalf(half: number, side: -1 | 1): THREE.Mesh {
  const t = BLAST_DOOR.halfZ * 2;
  const parts: THREE.BufferGeometry[] = [part(box(half, H, t + 0.1), PAINT_CHARCOAL.shade, (side * half) / 2, H / 2, 0)];
  // armour slabs, offset like brickwork, on both faces
  for (let row = 0; row < 3; row++) {
    const y = 0.45 + row * 0.8;
    const offset = row % 2 ? 0.9 : 0;
    for (let x = offset; x < half - 0.3; x += 1.8) {
      const w = Math.min(1.7, half - x - 0.1);
      for (const face of [-1, 1]) {
        parts.push(part(box(w, 0.72, 0.06), row === 1 ? PAINT_CHARCOAL.base : PAINT_CHARCOAL.light, side * (x + w / 2), y, face * (t / 2 + 0.08)));
      }
    }
  }
  // ribs, every couple of metres, and a top beam: what reads from overhead
  for (let x = 1.2; x < half; x += 2.2) parts.push(part(box(0.22, H + 0.1, t + 0.4), STEEL.shade, side * x, H / 2, 0));
  parts.push(part(box(half, 0.18, t + 0.5), STEEL.base, (side * half) / 2, H + 0.05, 0));
  // the meeting edge: hazard chevrons, the one loud thing on it
  for (let y = 0.15; y < H; y += 0.5) {
    for (const face of [-1, 1]) parts.push(part(box(0.5, 0.22, 0.08), HAZARD.base, side * 0.25, y, face * (t / 2 + 0.12), 0, 0, side * 0.6));
  }
  parts.push(part(box(0.35, 0.2, t + 0.55), HAZARD.shade, side * 0.18, H + 0.08, 0));
  return mesh(merge(parts, "ground", 0.5));
}

/** a rotating warning beacon on the door's top beam: a housing, an amber lens, a sweeping glow */
function beacon(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(merge([part(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 8), STEEL.shade, 0, 0.09, 0)], "none")));
  const lens = mesh(glowPart(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 8), EMIT_AMBER, 0, 0.27, 0), "emissive");
  lens.name = "lens";
  g.add(lens);
  // the sweep: a long glow pushed out to one side and spun round
  const arm = new THREE.Group();
  arm.name = "arm";
  const beam = glow(EMIT_AMBER, 2.2, 0.55);
  beam.position.set(1.0, 0.3, 0);
  beam.scale.set(2.6, 0.9, 1);
  arm.add(beam);
  arm.add(glow(EMIT_AMBER, 0.9, 0.9));
  g.add(arm);
  return g;
}

/** the platform: a ribbed steel deck in hazard-edged bays, with the corp's cargo lashed down on it */
function deck(): THREE.Group {
  const parts: THREE.BufferGeometry[] = [part(box(W, 0.06, D), STEEL.shade, CX, 0.0, CZ)];
  // deck plates and their seams
  for (let x = FREIGHT.minX + 1; x < FREIGHT.maxX; x += 2) parts.push(part(box(0.06, 0.07, D - 0.2), RUBBER.base, x, 0.01, CZ));
  // the deck's edge over the drop: a steel lip, and the platform's frame under it going down into the dark
  parts.push(part(box(W, 0.12, 0.16), STEEL.base, CX, 0.03, FREIGHT.minZ + 0.08));
  for (const x of [FREIGHT.minX + 0.08, FREIGHT.maxX - 0.08]) parts.push(part(box(0.16, 0.12, D), STEEL.base, x, 0.03, CZ));
  parts.push(part(box(W, 1.2, 0.1), STEEL.shade, CX, -0.6, FREIGHT.minZ + 0.05));
  for (const x of [FREIGHT.minX + 0.05, FREIGHT.maxX - 0.05]) parts.push(part(box(0.1, 1.2, D), STEEL.shade, x, -0.6, CZ));
  // the start panel by the door, on a post at the railing's end: a pedestal, a big mushroom button
  parts.push(part(box(0.5, 1.0, 0.5), STEEL.base, FREIGHT_PANEL.x, 0.5, FREIGHT_PANEL.z));
  parts.push(part(box(0.4, 0.04, 0.4), HAZARD.base, FREIGHT_PANEL.x, 1.02, FREIGHT_PANEL.z));
  const g = multiMesh({ matte: [merge(parts, "ground", 0.4)] });
  // the cargo: munitions against the west railing, equipment against the east, the middle empty (user 2026-11-08)
  const [west, east] = FREIGHT_CARGO;
  const ammo = munitionsCargo(CARGO_W, CARGO_D);
  ammo.position.set(west.x, 0, west.z);
  const kit = equipmentCargo(CARGO_W, CARGO_D);
  kit.position.set(east.x, 0, east.z);
  g.add(ammo, kit);
  // the load's own light: a warm work lamp's pool over each block, so it's what the eye goes to
  for (const b of [west, east]) {
    const pool = new THREE.PointLight(0xffe2b8, 18, 9, 1.4);
    pool.position.set(b.x, 2.8, b.z + 0.4);
    g.add(pool);
  }
  // and a small one over the panel, so the way to start it is findable at the door
  const panelLight = new THREE.PointLight(0xffc890, 6, 3.5, 1.6);
  panelLight.position.set(FREIGHT_PANEL.x - 0.4, 2.2, FREIGHT_PANEL.z - 0.3);
  g.add(panelLight);
  const button = mesh(glowPart(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), EMIT_AMBER, FREIGHT_PANEL.x, 1.08, FREIGHT_PANEL.z), "emissive");
  button.name = "button";
  g.add(button);
  return g;
}

// The walls, after the lift shafts of industrial sci-fi (Alien's Nostromo,
// Blade Runner, the Expanse) and real hoistways: plain concrete in tall
// panels, a couple of steel guide rails per wall, a lamp beside each rail
// every metre in its own dark housing --- lit from within, not throwing
// light --- and the plant a working shaft carries (user 2026-11-04: less
// bare): conduit into junction boxes, a cable tray, a caged ladder, a vent,
// the fire main, limit switches by a rail, the shut doors of the levels the
// platform passes, and here and there a small dim red pilot light. What
// repeats up the wall (lamps, seams, clamps, rungs, boxes, doors) slides
// down together while the platform climbs; what runs the whole height
// (rails, conduit, tray, ladder stiles, the main) doesn't need to.

/** one inner face of the shaft: along x or z, its plane, which way it faces, and how low its plant starts */
interface Face {
  alongX: boolean;
  plane: number;
  n: 1 | -1;
  from: number;
}
/** the south wall's inner face, over the blast door */
const SOUTH_FACE = BLAST_DOOR.z - BLAST_DOOR.halfZ;
const BACK: Face = { alongX: true, plane: FREIGHT_SHAFT.minZ, n: 1, from: -2 };
const WEST: Face = { alongX: false, plane: FREIGHT_SHAFT.minX, n: 1, from: -2 };
const EAST: Face = { alongX: false, plane: FREIGHT_SHAFT.maxX, n: -1, from: -2 };
const SOUTH: Face = { alongX: true, plane: SOUTH_FACE, n: -1, from: H + 0.3 };

/** where the lamp columns stand: two up each side wall, three across the back (user 2026-11-04: fewer columns) */
const BACK_COLUMNS = [0.2, 0.5, 0.8].map((k) => FREIGHT_SHAFT.minX + k * (FREIGHT_SHAFT.maxX - FREIGHT_SHAFT.minX));
const SIDE_COLUMNS = [0.3, 0.75].map((k) => FREIGHT_SHAFT.minZ + k * (FREIGHT_SHAFT.maxZ - FREIGHT_SHAFT.minZ));
/** a lamp's face: a warm white held well under the light fittings', so it reads as glowing without lighting anything */
const LAMP_FACE = 0xd8cbb0;
/** a pilot light: a red held well under EMIT_RED, there if you look and nothing more */
const PILOT = 0xb8261e;

/** what one wall's dressing is made of, sorted by whether it slides and how it's lit */
interface Dressing {
  still: THREE.BufferGeometry[];
  moving: THREE.BufferGeometry[];
  faces: THREE.BufferGeometry[];
  pilots: THREE.BufferGeometry[];
  blinks: THREE.BufferGeometry[];
}

/** a box on a face: `w` along it, `h` tall, `t` deep, centred at `u` along, `y` up, `d` out from the wall; left out if it'd reach below the face's start */
function put(list: THREE.BufferGeometry[], f: Face, w: number, h: number, t: number, color: number, u: number, y: number, d: number, glowing = false): void {
  if (y - h / 2 < f.from) return;
  const g = f.alongX ? box(w, h, t) : box(t, h, w);
  const x = f.alongX ? u : f.plane + f.n * d;
  const z = f.alongX ? f.plane + f.n * d : u;
  list.push(glowing ? glowPart(g, color, x, y, z) : part(g, color, x, y, z));
}

/** an upright the whole height of the face: a rail, a stile, a strap */
function upright(list: THREE.BufferGeometry[], f: Face, w: number, t: number, color: number, u: number, d: number): void {
  const lo = f.from;
  const h = SHAFT_H - lo;
  put(list, f, w, h, t, color, u, lo + h / 2, d);
}

/** a round pipe the whole height of the face */
function pipe(list: THREE.BufferGeometry[], f: Face, r: number, color: number, u: number, d: number): void {
  const h = SHAFT_H - f.from;
  const x = f.alongX ? u : f.plane + f.n * d;
  const z = f.alongX ? f.plane + f.n * d : u;
  list.push(part(new THREE.CylinderGeometry(r, r, h, 6), color, x, f.from + h / 2, z));
}

/** each repeat of the sliding pattern's base height, from under the deck to a LOOP past the top */
function loops(): number[] {
  const out: number[] = [];
  for (let y = -2; y < SHAFT_H + LOOP; y += LOOP) out.push(y);
  return out;
}

/** a junction box on a conduit run, its lid's edge lighter, a pilot at its corner; `blink` makes the pilot flash */
function junctionBox(d: Dressing, f: Face, u: number, y: number, w = 0.55, h = 0.65, blink = false): void {
  put(d.moving, f, w, h, 0.24, PAINT_ASH.shade, u, y, 0.24);
  put(d.moving, f, w + 0.04, 0.05, 0.27, PAINT_ASH.base, u, y + h / 2, 0.25);
  put(d.moving, f, 0.12, 0.12, 0.1, RUBBER.base, u - w / 2 + 0.12, y - h / 2 - 0.04, 0.22);
  put(blink ? d.blinks : d.pilots, f, 0.09, 0.09, 0.03, PILOT, u + w / 2 - 0.1, y + h / 2 - 0.12, 0.375, true);
}

/** conduit: `n` steel pipes side by side, clamped every 1.5 m */
function conduit(d: Dressing, f: Face, u: number, n = 3): void {
  const span = (n - 1) * 0.16;
  for (let i = 0; i < n; i++) pipe(d.still, f, 0.045, STEEL.base, u - span / 2 + i * 0.16, 0.1);
  for (const y0 of loops()) for (let k = 0; k < LOOP; k += 1.5) put(d.moving, f, span + 0.2, 0.06, 0.05, STEEL.light, u, y0 + k + 0.4, 0.16);
}

/** the lamps and the panels' seams: every face has them */
function lampsAndSeams(d: Dressing, f: Face, columns: number[], width: number, mid: number): void {
  for (const y0 of loops()) {
    for (let k = 0; k < LOOP; k += LAMP_STEP) {
      for (const c of columns) {
        put(d.moving, f, 0.46, 0.32, 0.06, STEEL.shade, c + 0.35, y0 + k, 0.03);
        put(d.faces, f, 0.36, 0.22, 0.04, LAMP_FACE, c + 0.35, y0 + k, 0.06, true);
      }
    }
    for (let k = 0; k < LOOP; k += 3) put(d.moving, f, width, 0.06, 0.03, PAINT_CHARCOAL.shade, mid, y0 + k + 0.5, 0.015);
  }
  for (const c of columns) upright(d.still, f, 0.16, 0.14, STEEL.base, c, 0.07);
}

/** the back wall: conduit into boxes, a cable tray, a vent, the caged maintenance ladder in the corner */
function dressBack(d: Dressing): void {
  const f = BACK;
  lampsAndSeams(d, f, BACK_COLUMNS, SW, SCX);
  conduit(d, f, -12.7);
  // the cable tray: two stiles, a black bundle of cable in it, rungs across
  for (const s of [-0.22, 0.22]) upright(d.still, f, 0.04, 0.16, STEEL.base, -7.6 + s, 0.1);
  upright(d.still, f, 0.3, 0.07, RUBBER.base, -7.6, 0.06);
  for (const y0 of loops()) {
    for (let k = 0; k < LOOP; k += 0.45) put(d.moving, f, 0.48, 0.04, 0.04, STEEL.shade, -7.6, y0 + k, 0.17);
    junctionBox(d, f, -12.7, y0 + 2.2);
    junctionBox(d, f, -12.7, y0 + 6.8, 0.4, 0.45, true);
    // a vent: a frame and slats standing off it
    put(d.moving, f, 1.0, 0.7, 0.06, STEEL.shade, -2.6, y0 + 5, 0.03);
    for (let s = 0; s < 5; s++) put(d.moving, f, 0.9, 0.05, 0.08, STEEL.light, -2.6, y0 + 4.76 + s * 0.12, 0.08);
  }
  // the ladder in the corner, its cage kept clear of the platform's edge
  const lu = 2.7;
  for (const s of [-0.25, 0.25]) upright(d.still, f, 0.06, 0.08, STEEL.base, lu + s, 0.2);
  for (const s of [-0.37, 0.37]) upright(d.still, f, 0.04, 0.04, STEEL.shade, lu + s, 0.6);
  upright(d.still, f, 0.04, 0.04, STEEL.shade, lu, 0.6);
  for (const y0 of loops()) {
    for (let k = 0; k < LOOP; k += 0.3) put(d.moving, f, 0.5, 0.04, 0.04, STEEL.light, lu, y0 + k + 0.1, 0.2);
    for (let k = 0; k < LOOP; k += 1) {
      for (const s of [-0.37, 0.37]) put(d.moving, f, 0.04, 0.05, 0.6, STEEL.base, lu + s, y0 + k + 0.6, 0.3);
      put(d.moving, f, 0.78, 0.05, 0.04, STEEL.base, lu, y0 + k + 0.6, 0.6);
    }
  }
}

/** the west wall: the shut doors of the levels the platform passes, conduit by the door end */
function dressWest(d: Dressing): void {
  const f = WEST;
  lampsAndSeams(d, f, SIDE_COLUMNS, SD, SCZ);
  conduit(d, f, -19.4, 2);
  const u = -24;
  for (const y0 of loops()) {
    const sill = y0 + 2.2;
    // the frame, two shut oxide leaves and their meeting line, a hazard-edged sill that stands out
    for (const s of [-1.2, 1.2]) put(d.moving, f, 0.2, 2.6, 0.14, STEEL.base, u + s, sill + 1.3, 0.07);
    put(d.moving, f, 2.6, 0.22, 0.16, STEEL.base, u, sill + 2.6, 0.08);
    for (const s of [-0.56, 0.56]) put(d.moving, f, 1.1, 2.4, 0.05, PAINT_OXIDE.shade, u + s, sill + 1.2, 0.03);
    put(d.moving, f, 0.04, 2.4, 0.07, PAINT_CHARCOAL.shade, u, sill + 1.2, 0.04);
    put(d.moving, f, 2.6, 0.08, 0.32, HAZARD.shade, u, sill, 0.16);
    // the level's call box beside it, locked out: a red pilot
    put(d.moving, f, 0.22, 0.34, 0.1, PAINT_CHARCOAL.light, u - 1.6, sill + 1.3, 0.05);
    put(d.pilots, f, 0.09, 0.09, 0.03, PILOT, u - 1.6, sill + 1.38, 0.115, true);
    put(d.blinks, f, 0.1, 0.06, 0.03, PILOT, u, sill + 2.6, 0.175, true);
    junctionBox(d, f, -19.4, y0 + 7.2, 0.4, 0.5);
  }
}

/** the east wall: the fire main with its flanges and valves, limit switches by a rail, a junction box */
function dressEast(d: Dressing): void {
  const f = EAST;
  lampsAndSeams(d, f, SIDE_COLUMNS, SD, SCZ);
  const main = -28.9;
  pipe(d.still, f, 0.09, PAINT_OXIDE.base, main, 0.2);
  conduit(d, f, -24.2, 2);
  const x = f.plane + f.n * 0.42;
  for (const y0 of loops()) {
    for (let k = 0; k < LOOP; k += 3) put(d.moving, f, 0.28, 0.06, 0.28, PAINT_OXIDE.shade, main, y0 + k + 1.9, 0.2);
    // a valve: a stub off the main, a handwheel facing out
    put(d.moving, f, 0.1, 0.1, 0.24, PAINT_OXIDE.base, main, y0 + 4.3, 0.3);
    d.moving.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 8), STEEL.light, x, y0 + 4.3, main, 0, 0, Math.PI / 2));
    junctionBox(d, f, -24.2, y0 + 3.4);
    // limit switches beside the near rail: a body, its roller arm reaching for the rail
    for (const k of [1.0, 5.5]) {
      const u = SIDE_COLUMNS[1] - 0.5;
      put(d.moving, f, 0.22, 0.3, 0.18, PAINT_CHARCOAL.light, u, y0 + k, 0.09);
      put(d.moving, f, 0.24, 0.04, 0.04, STEEL.light, u + 0.18, y0 + k + 0.1, 0.16);
      put(d.pilots, f, 0.07, 0.07, 0.03, PILOT, u - 0.05, y0 + k + 0.07, 0.195, true);
    }
  }
}

/** the south wall, over the door: the same lamps and rails, conduit across to a box, a blinking pilot up high */
function dressSouth(d: Dressing): void {
  const f = SOUTH;
  lampsAndSeams(d, f, BACK_COLUMNS, SW, SCX);
  conduit(d, f, -12.4, 2);
  for (const s of [-0.22, 0.22]) upright(d.still, f, 0.04, 0.16, STEEL.base, -2.4 + s, 0.1);
  upright(d.still, f, 0.3, 0.07, RUBBER.base, -2.4, 0.06);
  for (const y0 of loops()) {
    for (let k = 0; k < LOOP; k += 0.45) put(d.moving, f, 0.48, 0.04, 0.04, STEEL.shade, -2.4, y0 + k, 0.17);
    junctionBox(d, f, -12.4, y0 + 5.2, 0.55, 0.65, true);
  }
}

/** a wall's dressing as meshes: what stays, and what slides (with its lamps, its pilots, and its blinking pilots by name) */
function dressing(dress: (d: Dressing) => void): { still: THREE.Mesh; moving: THREE.Group } {
  const d: Dressing = { still: [], moving: [], faces: [], pilots: [], blinks: [] };
  dress(d);
  const moving = multiMesh({ matte: [merge(d.moving, "none")], emissive: [...d.faces, ...d.pilots] });
  const blink = d.blinks.length ? mesh(merge(d.blinks, "none"), "emissive") : new THREE.Group();
  blink.name = "blink";
  moving.add(blink);
  return { still: mesh(merge(d.still, "none")), moving };
}

/**
 * The shaft's walls above head height: the facility's walls stop under a
 * ceiling the sight mask paints black, but a shaft has no ceiling, so from
 * the platform the view is wall on every side, past the camera. Below the
 * deck they carry on into the drop. The south wall (over the blast door,
 * which is the map's) is its own: from outside it'd stand between the
 * camera and the platform, so it's only up while you're in the shaft, and
 * then as a screen door (user 2026-11-04), so the core shows through it.
 */
const WALL_T = 0.6;
const DROP = 4;
function shaftWalls(): THREE.Mesh {
  const t = WALL_T;
  const h = SHAFT_H - H;
  const parts: THREE.BufferGeometry[] = [part(box(SW + 2 * t, h, t), CONCRETE_DARK.shade, SCX, H + h / 2, FREIGHT_SHAFT.minZ - t / 2)];
  for (const x of [FREIGHT_SHAFT.minX - t / 2, FREIGHT_SHAFT.maxX + t / 2]) parts.push(part(box(t, h, SD + t), CONCRETE_DARK.shade, x, H + h / 2, SCZ - t / 2));
  // under the deck's level: the same walls going on down
  parts.push(part(box(SW + 2 * t, DROP, t), CONCRETE_DARK.shade, SCX, -DROP / 2, FREIGHT_SHAFT.minZ - t / 2));
  for (const x of [FREIGHT_SHAFT.minX - t / 2, FREIGHT_SHAFT.maxX + t / 2]) parts.push(part(box(t, DROP, SD + t), CONCRETE_DARK.shade, x, -DROP / 2, SCZ - t / 2));
  return mesh(merge(parts, "none"));
}

/** the south wall's slab, over the door */
function southWall(): THREE.Mesh {
  const h = SHAFT_H - H - 0.15;
  return mesh(merge([part(box(SW + 2 * WALL_T, h, BLAST_DOOR.halfZ * 2), CONCRETE_DARK.shade, SCX, H + 0.15 + h / 2, BLAST_DOOR.z)], "none"));
}

/**
 * The shaft's foot: the facility's own walls round it (FREIGHT_WALLS),
 * drawn here rather than with the facility so they can sink with the door
 * when the platform leaves. Plain concrete to head height, like the walls
 * they meet.
 */
function footWalls(): THREE.Mesh {
  return mesh(merge(FREIGHT_WALLS.map((w) => part(box(w.halfX * 2, H, w.halfZ * 2), CONCRETE_DARK.base, w.x, H / 2, w.z)), "ground", 0.4));
}

/**
 * The railing round the platform's sides and back, at its edge over the
 * drop: plain steel posts and two rails, waist high, open toward the door.
 * Stops feet going over and anyone walking into the walls (FREIGHT_RAILS
 * is its footprint). It's the platform's, so it stays put while the shaft goes by.
 */
function railing(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const e = 0.12;
  const run = (x1: number, z1: number, x2: number, z2: number): void => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    for (const [y, t] of [[0.55, 0.06], [1.0, 0.1]]) parts.push(part(box(alongX ? len : t, t, alongX ? t : len), STEEL.light, mx, y, mz));
    const n = Math.max(1, Math.round(len / 1.5));
    for (let i = 0; i <= n; i++) parts.push(part(box(0.09, 1.04, 0.09), STEEL.base, x1 + ((x2 - x1) * i) / n, 0.51, z1 + ((z2 - z1) * i) / n));
  };
  const minX = FREIGHT.minX + e;
  const maxX = FREIGHT.maxX - e;
  const minZ = FREIGHT.minZ + e;
  const maxZ = FREIGHT.maxZ - 0.4;
  run(minX, minZ, maxX, minZ);
  run(minX, minZ, minX, maxZ);
  run(maxX, minZ, maxX, maxZ);
  return mesh(merge(parts, "ground", 0.3));
}

/** the shaft's footprint, its walls included: where there's no roof to hide (postprocess setOpenTop) */
export const SHAFT_AREA = { minX: FREIGHT_SHAFT.minX - WALL_T, maxX: FREIGHT_SHAFT.maxX + WALL_T, minZ: FREIGHT_SHAFT.minZ - WALL_T, maxZ: BLAST_DOOR.z + BLAST_DOOR.halfZ };

/** the camera's shake while the door grinds and the platform climbs, 0..1 */
export interface EvacFx {
  shake: number;
  /** a light pool over the platform while it climbs (with its strength 0..1): the deck lit as lamps go by */
  deckLight: number;
}

export class EvacView {
  readonly group = new THREE.Group();
  private readonly halves: [THREE.Mesh, THREE.Mesh];
  private readonly half: number;
  private readonly beacons: THREE.Group[] = [];
  /** what slides down a LOOP and jumps back while the platform climbs: the walls' lamps, seams and plant */
  private readonly lamps = new THREE.Group();
  /** the pilots that blink, on their own slow beat */
  private readonly blinks: THREE.Object3D[] = [];
  /** the south wall and its dressing: only up while the viewer's in the shaft */
  private readonly south: THREE.Object3D[] = [];
  /** what goes down while the platform climbs: the shaft's walls, the door, the foot */
  private readonly shaft = new THREE.Group();
  private readonly deck: THREE.Group;
  private readonly sweep: THREE.PointLight;

  constructor() {
    const doorMinX = BLAST_DOOR.x - BLAST_DOOR.halfX;
    const doorMaxX = BLAST_DOOR.x + BLAST_DOOR.halfX;
    this.half = (doorMaxX - doorMinX) / 2;
    this.halves = [doorHalf(this.half, -1), doorHalf(this.half, 1)];
    for (const h of this.halves) {
      h.position.set(BLAST_DOOR.x, 0, BLAST_DOOR.z);
      this.shaft.add(h);
    }
    for (let i = 0; i < 4; i++) {
      const b = beacon();
      b.position.set(doorMinX + 1.5 + (i * (doorMaxX - doorMinX - 3)) / 3, H + 0.15, BLAST_DOOR.z + 0.5);
      b.visible = false;
      this.beacons.push(b);
      this.shaft.add(b);
    }
    this.deck = deck();
    this.group.add(this.deck, railing());
    this.shaft.add(shaftWalls(), footWalls(), this.lamps);
    for (const dress of [dressBack, dressWest, dressEast, dressSouth]) {
      const { still, moving } = dressing(dress);
      this.shaft.add(still);
      this.lamps.add(moving);
      this.blinks.push(moving.getObjectByName("blink")!);
      if (dress === dressSouth) this.south.push(still, moving);
    }
    const slab = southWall();
    this.shaft.add(slab);
    this.south.push(slab);
    // seen from inside it's a screen door: the core shows through every other pixel (solid over the door, update())
    for (const o of this.south) {
      o.traverse((c) => {
        if (c instanceof THREE.Mesh) c.material = screenDoor(c.material as THREE.Material);
      });
    }
    this.setInside(false);
    // the work lights on the shaft's back wall: theirs, so they go down with it
    for (const lamp of LAMPS.filter((l) => l.shaft)) {
      const f = lampFixture(lamp)!;
      this.shaft.add(mesh(f.housing), mesh(f.glowing, "emissive"));
      const d = FACING_DIR[lamp.facing ?? "south"];
      const halo = glow(LAMP_SPECS[lamp.kind].emit, 1.4, 0.35);
      halo.position.set(lamp.x + d.x * 0.25, LAMP_SPECS[lamp.kind].height, lamp.z + d.z * 0.25);
      this.shaft.add(halo);
    }
    this.group.add(this.shaft);
    this.sweep = new THREE.PointLight(0xfff0d8, 0, 14, 1.4);
    this.sweep.position.set(CX, 2.5, CZ);
    this.group.add(this.sweep);
  }

  /** the viewer's in the shaft (or not): the south wall's up only then (and only half there, a dither), so from the core the platform shows through the open door */
  setInside(inside: boolean): void {
    for (const o of this.south) o.visible = inside;
  }

  /** move it all to the evacuation's stage at server time `now`; what the camera and lights should do back */
  update(evac: EvacState | undefined, now: number, time: number): EvacFx {
    const open = blastDoorOpen(evac, now);
    // each half slides away from the middle into the walls either side
    const slide = open * this.half * 0.98;
    this.halves[0].position.x = BLAST_DOOR.x - slide;
    this.halves[1].position.x = BLAST_DOOR.x + slide;
    const st = evac ? evacStage(evac, now) : undefined;
    const moving = st?.stage === "opening" || st?.stage === "shutting";
    const alarm = moving || st?.stage === "boarding" || st?.stage === "open";
    for (const [i, b] of this.beacons.entries()) {
      b.visible = alarm;
      b.getObjectByName("arm")!.rotation.y = time * 4 + i * 1.3;
    }
    // the blinking pilots: a short wink every couple of seconds
    for (const b of this.blinks) b.visible = time % 2.2 < 0.18;
    const button = this.deck.getObjectByName("button")!;
    button.visible = st?.stage !== "open" || Math.sin(time * 6) > -0.3;
    let rising = 0;
    let shake = 0;
    if (st?.stage === "opening" || st?.stage === "shutting") shake = 0.35;
    if (st?.stage === "rising" || st?.stage === "thanks") {
      // the climb goes on under the thanks card until the screen's dark
      rising = (st.stage === "rising" ? st.ms : RISE_MS + st.ms) / 1000;
      // the climb starts with a lurch and settles into a grind
      shake = 0.5 + 0.5 * Math.max(0, 1 - rising / 1.5);
    }
    // the shaft goes by. First the whole of it sinks (door, foot, walls) until
    // the door's out of sight; from then on it's held and the lamps and seams
    // slide down a loop and jump back, so the same wall seems to stream past.
    const fallen = rising * RISE_SPEED;
    this.shaft.position.y = -Math.min(fallen, SINK);
    // the south wall's dither: solid over each door half while the door's still in sight (user 2026-11-04), so a shut door seals the view
    const doorSeen = fallen <= H;
    const a = this.halves[0].position.x;
    const b = this.halves[1].position.x;
    if (doorSeen) SCREEN_DOOR_SOLID.value.set(a - this.half - WALL_T, a, b, b + this.half + WALL_T);
    else SCREEN_DOOR_SOLID.value.set(1, 0, 1, 0);
    this.lamps.position.y = fallen > SINK ? -((fallen - SINK) % LOOP) : 0;
    // the climb's light on the deck: steady, with a slow unevenness as the walls go by
    const deckLight = rising ? 0.5 + 0.15 * Math.sin(rising * 2.3) : 0;
    this.sweep.intensity = deckLight * 14;
    return { shake, deckLight };
  }

  /** the shaft has sunk past the door's top: the map's walls round the foot are under the deck, so the lamps that hang on them shouldn't light it */
  footGone(evac: EvacState | undefined, now: number): boolean {
    const st = evac ? evacStage(evac, now) : undefined;
    return st?.stage === "thanks" || (st?.stage === "rising" && (st.ms / 1000) * RISE_SPEED > H);
  }

  /** the door as a sight blocker while it's shut (the facility's base sight walls leave it out) */
  doorOccluders(evac: EvacState | undefined, now: number): { x: number; z: number; halfX: number; halfZ: number; halfHeight: number }[] {
    const open = blastDoorOpen(evac, now);
    if (open <= 0) return [BLAST_DOOR];
    const slide = open * this.half * 0.98;
    return this.halves.map((_, i) => {
      const side = i === 0 ? -1 : 1;
      return { x: BLAST_DOOR.x + side * (slide + this.half / 2), z: BLAST_DOOR.z, halfX: this.half / 2, halfZ: BLAST_DOOR.halfZ, halfHeight: BLAST_DOOR.halfHeight };
    });
  }
}
