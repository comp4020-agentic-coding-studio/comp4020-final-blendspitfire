import * as THREE from "three";
import { CONCRETE_DARK, EMIT_AMBER, HAZARD, PAINT_CHARCOAL, RUBBER, STEEL } from "../../shared/palette.ts";
import { BLAST_DOOR, FACILITY_WALL_HALF_HEIGHT, FREIGHT, CARGO_W, FREIGHT_CARGO, FREIGHT_PANEL, FREIGHT_SHAFT, FREIGHT_WALLS } from "../../shared/protocol.ts";
import { equipmentCargo, munitionsCargo } from "../models/cargo.ts";
import { blastDoorOpen, evacStage, type EvacState } from "../../shared/enemies.ts";
import { glow } from "../look.ts";
import { lampFixture } from "../models/facility.ts";
import { FACING_DIR, LAMPS, LAMP_SPECS } from "./dressing.ts";
import { glowPart, merge, mesh, multiMesh, part } from "../models/kit.ts";

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
/** the moving pattern's repeat: three lamps and one panel seam, so it loops without a jump */
const LOOP = 3;
/** the shaft's walls go up to here: a whole number of lamp steps past SHAFT_TOP */
const SHAFT_H = SHAFT_TOP + 3;
/** how fast the shaft goes by, in metres a second */
const RISE_SPEED = 2.4;
/** how far the shaft sinks as a whole before only its lamps move: the door's top well under the deck, a whole number of LOOPs */
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
  // the cargo: one heap, the two halves hard up against each other
  const [heap] = FREIGHT_CARGO;
  const halves = [heap.x - CARGO_W / 2 - 0.025, heap.x + CARGO_W / 2 + 0.025];
  const ammo = munitionsCargo(CARGO_W, heap.halfZ * 2);
  ammo.position.set(halves[0], 0, heap.z);
  const kit = equipmentCargo(CARGO_W, heap.halfZ * 2);
  kit.position.set(halves[1], 0, heap.z);
  g.add(ammo, kit);
  // the load's own light: a warm work lamp's pool over each half, so it's what the eye goes to
  for (const x of halves) {
    const pool = new THREE.PointLight(0xffe2b8, 18, 9, 1.4);
    pool.position.set(x, 2.8, heap.z + 0.4);
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
// Blade Runner, the Expanse): plain concrete in tall panels, a couple of
// steel guide rails per wall, and a lamp beside each rail every metre in
// its own dark housing --- lit from within, not throwing light. Lamps and
// the panels' seams slide down together while the platform climbs; the
// rails, being continuous, don't need to.

/** where the lamp columns stand: two up each side wall, three across the back (user 2026-11-04: fewer columns) */
const BACK_COLUMNS = [0.2, 0.5, 0.8].map((k) => FREIGHT_SHAFT.minX + k * (FREIGHT_SHAFT.maxX - FREIGHT_SHAFT.minX));
const SIDE_COLUMNS = [0.3, 0.75].map((k) => FREIGHT_SHAFT.minZ + k * (FREIGHT_SHAFT.maxZ - FREIGHT_SHAFT.minZ));
/** the south wall's inner face, over the blast door */
const SOUTH_FACE = BLAST_DOOR.z - BLAST_DOOR.halfZ;
/** a lamp's face: a warm white held well under the light fittings', so it reads as glowing without lighting anything */
const LAMP_FACE = 0xd8cbb0;

/**
 * What slides by: the lamps (housing + face) and the panel seams, from
 * below the deck to the top plus one LOOP so sliding down a LOOP and
 * jumping back is seamless. Each lamp sits a hand's width to one side of
 * its column's rail.
 */
function wallLamps(): THREE.Group {
  const housings: THREE.BufferGeometry[] = [];
  const faces: THREE.BufferGeometry[] = [];
  // along the wall the lamp is 0.36 wide and 0.22 tall; it stands 0.08 off the wall
  const lamp = (x: number, y: number, z: number, nx: number, nz: number): void => {
    const along = (w: number, h: number, d: number) => box(nx ? d : w, h, nz ? d : w);
    housings.push(part(along(0.46, 0.32, 0.06), STEEL.shade, x + nx * 0.03, y, z + nz * 0.03));
    faces.push(glowPart(along(0.36, 0.22, 0.04), LAMP_FACE, x + nx * 0.06, y, z + nz * 0.06));
  };
  for (let y = -2; y < SHAFT_H + LOOP; y += LAMP_STEP) {
    for (const x of BACK_COLUMNS) {
      lamp(x + 0.35, y, FREIGHT_SHAFT.minZ, 0, 1);
      // the south wall, over the door: from the door's top up, same as the rest
      if (y > H + 0.4) lamp(x + 0.35, y, SOUTH_FACE, 0, -1);
    }
    for (const z of SIDE_COLUMNS) {
      lamp(FREIGHT_SHAFT.minX, y, z + 0.35, 1, 0);
      lamp(FREIGHT_SHAFT.maxX, y, z + 0.35, -1, 0);
    }
  }
  // the panels' horizontal seams, every LOOP
  for (let y = -2; y < SHAFT_H + LOOP; y += LOOP) {
    housings.push(part(box(FREIGHT_SHAFT.maxX - FREIGHT_SHAFT.minX, 0.06, 0.03), PAINT_CHARCOAL.shade, (FREIGHT_SHAFT.minX + FREIGHT_SHAFT.maxX) / 2, y + 0.5, FREIGHT_SHAFT.minZ + 0.015));
    for (const x of [FREIGHT_SHAFT.minX + 0.015, FREIGHT_SHAFT.maxX - 0.015]) housings.push(part(box(0.03, 0.06, FREIGHT_SHAFT.maxZ - FREIGHT_SHAFT.minZ), PAINT_CHARCOAL.shade, x, y + 0.5, (FREIGHT_SHAFT.minZ + FREIGHT_SHAFT.maxZ) / 2));
  }
  return multiMesh({ matte: [merge(housings, "none")], emissive: faces });
}

/** the guide rails, one per lamp column, the whole height: still while the lamps go by */
function wallRails(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const h = SHAFT_H + 2;
  for (const x of BACK_COLUMNS) {
    parts.push(part(box(0.16, h, 0.14), STEEL.base, x, h / 2 - 2, FREIGHT_SHAFT.minZ + 0.07));
    parts.push(part(box(0.16, SHAFT_H - H - 0.2, 0.14), STEEL.base, x, (SHAFT_H + H + 0.2) / 2, SOUTH_FACE - 0.07));
  }
  for (const z of SIDE_COLUMNS) {
    for (const x of [FREIGHT_SHAFT.minX + 0.07, FREIGHT_SHAFT.maxX - 0.07]) parts.push(part(box(0.14, h, 0.16), STEEL.base, x, h / 2 - 2, z));
  }
  return mesh(merge(parts, "none"));
}

/**
 * The shaft's four walls above head height, the door's side the same as
 * the rest: the facility's walls stop under a ceiling the sight mask paints
 * black, but a shaft has no ceiling, so from the platform the view is wall
 * on every side, past the camera. Below the deck they carry on into the
 * drop. The south wall stands over the blast door, which is the map's.
 */
const WALL_T = 0.6;
const DROP = 4;
function shaftWalls(): THREE.Mesh {
  const t = WALL_T;
  const h = SHAFT_H - H;
  const southZ = BLAST_DOOR.z;
  const parts: THREE.BufferGeometry[] = [
    part(box(SW + 2 * t, h, t), CONCRETE_DARK.shade, SCX, H + h / 2, FREIGHT_SHAFT.minZ - t / 2),
    part(box(SW + 2 * t, h - 0.15, BLAST_DOOR.halfZ * 2), CONCRETE_DARK.shade, SCX, H + 0.15 + (h - 0.15) / 2, southZ),
  ];
  for (const x of [FREIGHT_SHAFT.minX - t / 2, FREIGHT_SHAFT.maxX + t / 2]) parts.push(part(box(t, h, SD + t), CONCRETE_DARK.shade, x, H + h / 2, SCZ - t / 2));
  // under the deck's level: the same walls going on down
  parts.push(part(box(SW + 2 * t, DROP, t), CONCRETE_DARK.shade, SCX, -DROP / 2, FREIGHT_SHAFT.minZ - t / 2));
  for (const x of [FREIGHT_SHAFT.minX - t / 2, FREIGHT_SHAFT.maxX + t / 2]) parts.push(part(box(t, DROP, SD + t), CONCRETE_DARK.shade, x, -DROP / 2, SCZ - t / 2));
  return mesh(merge(parts, "none"));
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
  private readonly lamps = wallLamps();
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
    this.shaft.add(shaftWalls(), footWalls(), wallRails(), this.lamps);
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
    const button = this.deck.getObjectByName("button")!;
    button.visible = st?.stage !== "open" || Math.sin(time * 6) > -0.3;
    let rising = 0;
    let shake = 0;
    if (st?.stage === "opening" || st?.stage === "shutting") shake = 0.35;
    if (st?.stage === "rising") {
      rising = st.ms / 1000;
      // the climb starts with a lurch and settles into a grind
      shake = 0.5 + 0.5 * Math.max(0, 1 - st.ms / 1500);
    }
    // the shaft goes by. First the whole of it sinks (door, foot, walls) until
    // the door's out of sight; from then on it's held and the lamps and seams
    // slide down a loop and jump back, so the same wall seems to stream past.
    const climbing = st?.stage === "rising" || st?.stage === "thanks";
    const fallen = climbing ? (st?.stage === "thanks" ? Infinity : rising * RISE_SPEED) : 0;
    this.shaft.position.y = -Math.min(fallen, SINK);
    this.lamps.position.y = fallen > SINK ? -((fallen - SINK) % LOOP) : 0;
    // the climb's light on the deck: steady, with a slow unevenness as the walls go by
    const deckLight = st?.stage === "rising" ? 0.5 + 0.15 * Math.sin(rising * 2.3) : 0;
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
