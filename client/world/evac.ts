import * as THREE from "three";
import { CONCRETE_DARK, EMIT_AMBER, EMIT_WHITE, HAZARD, PAINT_CHARCOAL, PAINT_OXIDE, RUBBER, RUST, STEEL, WOOD } from "../../shared/palette.ts";
import { BLAST_DOOR, FACILITY_WALL_HALF_HEIGHT, FREIGHT, FREIGHT_PANEL } from "../../shared/protocol.ts";
import { blastDoorOpen, evacStage, type EvacState } from "../../shared/enemies.ts";
import { glow } from "../look.ts";
import { glowPart, merge, mesh, multiMesh, part, rng } from "../models/kit.ts";

// The way out after a win (ADR-060), drawn: the blast door across the core's
// north wall, the freight lift's platform behind it, and the shaft it rises
// up. All of it is moved by the evacuation's server times (evacStage), so
// every screen sees the door move and the shaft go by together.
//
// The rise is staged: the platform never moves. What moves is the shaft
// round it --- ribs, rails and lamps on its walls sliding down past the
// platform's edge and looping --- with the camera rumbling, and a band of
// light sweeping the deck each time a ring of lamps goes by.

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const H = FACILITY_WALL_HALF_HEIGHT * 2;
/** the shaft's walls go this far up: past the camera, so the ribs come down from out of sight */
const SHAFT_TOP = 18;
/** one repeat of the shaft wall's pattern: a rib, a rail joint, a lamp */
const BAY = 3;
/** how fast the shaft goes by, in metres a second */
const RISE_SPEED = 2.4;

const W = FREIGHT.maxX - FREIGHT.minX;
const D = FREIGHT.maxZ - FREIGHT.minZ;
const CX = (FREIGHT.minX + FREIGHT.maxX) / 2;
const CZ = (FREIGHT.minZ + FREIGHT.maxZ) / 2;

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
  const random = rng(77);
  const parts: THREE.BufferGeometry[] = [part(box(W, 0.06, D), STEEL.shade, CX, 0.0, CZ)];
  // deck plates and their seams
  for (let x = FREIGHT.minX + 1; x < FREIGHT.maxX; x += 2) parts.push(part(box(0.06, 0.07, D - 0.2), RUBBER.base, x, 0.01, CZ));
  // hazard edging round the deck, a gap where the door meets it
  parts.push(part(box(W, 0.075, 0.25), HAZARD.base, CX, 0.012, FREIGHT.minZ + 0.12));
  for (const x of [FREIGHT.minX + 0.12, FREIGHT.maxX - 0.12]) parts.push(part(box(0.25, 0.075, D), HAZARD.base, x, 0.012, CZ));
  // the cargo: crates and sealed cases lashed down in three uneven stacks,
  // each worth more than the crew; a lane kept clear to the panel
  const stacks: [number, number, number][] = [
    [FREIGHT.minX + 3, FREIGHT.minZ + 2.4, 7],
    [FREIGHT_PANEL.x + 4.2, FREIGHT.minZ + 2, 6],
    [FREIGHT.minX + 3.6, CZ + 2, 4],
  ];
  for (const [sx, sz, n] of stacks) {
    for (let i = 0; i < n; i++) {
      const s = 0.8 + random() * 0.6;
      const h = 0.5 + random() * 0.7;
      const x = sx + (random() - 0.5) * 2.6;
      const z = sz + (random() - 0.5) * 2;
      const r = random();
      const turn = (random() - 0.5) * 0.6;
      const tone = r < 0.4 ? WOOD : r < 0.75 ? PAINT_OXIDE : STEEL;
      parts.push(part(box(s, h, s * 0.85), tone.base, x, h / 2, z, 0, turn, 0));
      parts.push(part(box(s + 0.04, 0.05, 0.08), RUST.shade, x, h * 0.7, z, 0, turn, 0));
      parts.push(part(box(s * 0.6, 0.02, s * 0.3), tone.light, x, h + 0.01, z, 0, turn, 0));
    }
  }
  // the start panel on the back wall: a pedestal, a big mushroom button
  parts.push(part(box(0.9, 1.0, 0.5), STEEL.base, FREIGHT_PANEL.x, 0.5, FREIGHT_PANEL.z - 0.25));
  parts.push(part(box(0.7, 0.04, 0.38), HAZARD.base, FREIGHT_PANEL.x, 1.02, FREIGHT_PANEL.z - 0.25));
  const g = multiMesh({ matte: [merge(parts, "ground", 0.4)] });
  const button = mesh(glowPart(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10), EMIT_AMBER, FREIGHT_PANEL.x, 1.08, FREIGHT_PANEL.z - 0.25), "emissive");
  button.name = "button";
  g.add(button);
  return g;
}

/**
 * One bay of the shaft, BAY tall, all round the platform's edge (inside
 * the shaft's walls, which block sight): a girder ring, the rails' joints,
 * a caged lamp on each side. Stacked and slid down in a loop while the
 * platform rises; from overhead each ring comes down past the camera,
 * shrinks toward the deck and is gone just above it.
 */
function bay(): THREE.Group {
  const parts: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const e = 0.6;
  const ribT = 0.3;
  // the ring: girders along the back and both sides, hugging the walls,
  // painted hazard so they carry against the dark as they go by
  parts.push(part(box(W, ribT, e), HAZARD.shade, CX, 0, FREIGHT.minZ + e / 2));
  for (const x of [FREIGHT.minX + e / 2, FREIGHT.maxX - e / 2]) parts.push(part(box(e, ribT, D), HAZARD.shade, x, 0, CZ));
  // and the girders' stripes: what you actually see slide
  for (let x = FREIGHT.minX + 0.5; x < FREIGHT.maxX; x += 1) parts.push(part(box(0.4, ribT + 0.02, e + 0.02), PAINT_CHARCOAL.shade, x, 0, FREIGHT.minZ + e / 2, 0, 0.6, 0));
  for (const x of [FREIGHT.minX + e / 2, FREIGHT.maxX - e / 2]) {
    for (let z = FREIGHT.minZ + 0.5; z < FREIGHT.maxZ; z += 1) parts.push(part(box(e + 0.02, ribT + 0.02, 0.4), PAINT_CHARCOAL.shade, x, 0, z, 0, 0.6, 0));
  }
  // braces down to the next ring, and the rail joints: what reads as the shaft's structure
  for (const z of [FREIGHT.minZ + 2.5, CZ, FREIGHT.maxZ - 1.5]) {
    for (const x of [FREIGHT.minX + 0.12, FREIGHT.maxX - 0.12]) parts.push(part(box(0.16, BAY, 0.26), RUST.base, x, BAY / 2, z));
  }
  for (let x = FREIGHT.minX + 3; x < FREIGHT.maxX - 2; x += 4) parts.push(part(box(0.26, BAY, 0.16), RUST.base, x, BAY / 2, FREIGHT.minZ + 0.12));
  // lamps along the ring: white on the back, amber down the sides
  const spots: [number, number, number][] = [];
  for (const x of [CX - W / 3, CX, CX + W / 3]) spots.push([x, FREIGHT.minZ + 0.4, EMIT_WHITE]);
  for (const z of [FREIGHT.minZ + D / 4, CZ + D / 4]) for (const x of [FREIGHT.minX + 0.4, FREIGHT.maxX - 0.4]) spots.push([x, z, EMIT_AMBER]);
  for (const [x, z, c] of spots) lamps.push(glowPart(box(0.3, 0.12, 0.3), c, x, 0.25, z));
  const g = multiMesh({ matte: [merge(parts, "none")], emissive: lamps });
  for (const [x, z, c] of spots) {
    const s = glow(c, 1.8, 0.6);
    s.position.set(x, 0.3, z);
    g.add(s);
  }
  return g;
}

/**
 * The shaft's walls all the way up, on its three sides without the door:
 * the facility's walls stop at head height under a ceiling the sight mask
 * paints black, but a shaft has no ceiling, so from the platform the view
 * is wall on every side, past the camera. They start where the walls they
 * stand on stop (FREIGHT_WALLS, drawn with the facility). Plain: the bays
 * sliding down them are what move.
 */
const WALL_T = 0.6;
const SHAFT_H = SHAFT_TOP + BAY;
function shaftWalls(): THREE.Mesh {
  const t = WALL_T;
  const h = SHAFT_H - H;
  const parts: THREE.BufferGeometry[] = [part(box(W + 2 * t, h, t), CONCRETE_DARK.shade, CX, H + h / 2, FREIGHT.minZ - t / 2)];
  for (const x of [FREIGHT.minX - t / 2, FREIGHT.maxX + t / 2]) parts.push(part(box(t, h, D + t), CONCRETE_DARK.shade, x, H + h / 2, CZ - t / 2));
  return mesh(merge(parts, "none"));
}

/** the shaft wall over one half of the blast door, riding on it: the door shuts and the wall closes over the way out with it */
function doorWall(half: number, side: -1 | 1): THREE.Mesh {
  const h = SHAFT_H - H;
  return mesh(merge([part(box(half, h, BLAST_DOOR.halfZ * 2), CONCRETE_DARK.shade, (side * half) / 2, H + 0.15 + h / 2, 0)], "none"));
}

/** the shaft's footprint, its walls included: where there's no roof to hide (postprocess setOpenTop) */
export const SHAFT_AREA = { minX: FREIGHT.minX - WALL_T, maxX: FREIGHT.maxX + WALL_T, minZ: FREIGHT.minZ - WALL_T, maxZ: BLAST_DOOR.z + BLAST_DOOR.halfZ };

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
  private readonly shaft = new THREE.Group();
  private readonly deck: THREE.Group;
  private readonly sweep: THREE.PointLight;

  constructor() {
    const doorMinX = BLAST_DOOR.x - BLAST_DOOR.halfX;
    const doorMaxX = BLAST_DOOR.x + BLAST_DOOR.halfX;
    this.half = (doorMaxX - doorMinX) / 2;
    this.halves = [doorHalf(this.half, -1), doorHalf(this.half, 1)];
    for (const [i, h] of this.halves.entries()) {
      h.add(doorWall(this.half, i === 0 ? -1 : 1));
      h.position.set(BLAST_DOOR.x, 0, BLAST_DOOR.z);
      this.group.add(h);
    }
    for (let i = 0; i < 4; i++) {
      const b = beacon();
      b.position.set(doorMinX + 1.5 + (i * (doorMaxX - doorMinX - 3)) / 3, H + 0.15, BLAST_DOOR.z + 0.5);
      b.visible = false;
      this.beacons.push(b);
      this.group.add(b);
    }
    this.deck = deck();
    this.group.add(this.deck);
    for (let y = 0; y < SHAFT_TOP + BAY; y += BAY) {
      const b = bay();
      b.position.y = y;
      this.shaft.add(b);
    }
    this.group.add(this.shaft);
    this.group.add(shaftWalls());
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
    // the shaft goes by: bays slide down, wrapping from the bottom back to the top
    const span = this.shaft.children.length * BAY;
    const off = (rising * RISE_SPEED) % BAY;
    for (const [i, b] of this.shaft.children.entries()) {
      b.position.y = ((i * BAY - off + span) % span) + 0.4;
      // gone just before it would reach the deck (it'd cut through the crew), back at the top
      b.visible = b.position.y > 0.8;
    }
    // a lamp ring passing deck level lights it up a moment
    const phase = ((rising * RISE_SPEED) % BAY) / BAY;
    const deckLight = st?.stage === "rising" ? 0.35 + 0.65 * Math.max(0, 1 - Math.abs(phase - 0.5) * 4) : 0;
    this.sweep.intensity = deckLight * 14;
    // the shaft above is only there once the platform's on its way
    this.shaft.visible = st?.stage === "rising" || st?.stage === "thanks";
    return { shake, deckLight };
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
