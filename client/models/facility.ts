import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ALUMINIUM,
  CONCRETE,
  CONCRETE_DARK,
  EMIT_AMBER,
  EMIT_CYAN,
  EMIT_GREEN,
  EMIT_RED,
  EMIT_REACTOR,
  FLOOR,
  HAZARD,
  LINOLEUM,
  PAINT_OCHRE,
  PAINT_OXIDE,
  PAINT_CHARCOAL,
  PAINT_SAGE,
  PAINT_STEEL_BLUE,
  PAPER,
  PLASTIC,
  RAISED_FLOOR,
  RUBBER,
  RUST,
  STEEL,
  STENCIL,
  WOOD,
} from "../../shared/palette.ts";
import type { Breach, Facing, Fixture, FixtureKind, Obstacle, Rect, Zone } from "../../shared/protocol.ts";
import { LAMP_SPECS, ZONE_PAINT, type Lamp } from "../world/dressing.ts";
import { equipmentCaseGeometry } from "./index.ts";
import { FINISHES, glowPart, jitter, merge, mesh, part, profile, rng, type Finish } from "./kit.ts";

// The facility's static structure: walls, solid mass, fixtures, breaches,
// lamps and floor. Each builder makes its model in local space, `len`
// along X and `depth` along Z with its front toward +Z, standing on y = 0;
// buildFacility() turns and places every one, then merges them into one
// mesh per material, so the whole building costs a handful of draw calls.
//
// Walls are dressed on their faces only. The camera looks straight down
// and wall tops are always out of sight (client/visibility.ts blacks them
// out), so all the detail goes where a player standing in the room would
// actually see it: paint, wainscot, skirting, conduit, door frames, lamps.

const { PI } = Math;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rTop: number, rBottom: number, h: number, seg = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);

type Bins = Record<Finish, THREE.BufferGeometry[]>;
const emptyBins = (): Bins => ({ matte: [], tile: [], glossy: [], emissive: [] });

interface Piece {
  geometry: THREE.BufferGeometry;
  finish: Finish;
}
const matte = (geometry: THREE.BufferGeometry): Piece => ({ geometry, finish: "matte" });
const glossy = (geometry: THREE.BufferGeometry): Piece => ({ geometry, finish: "glossy" });
const emissive = (parts: THREE.BufferGeometry[]): Piece => ({ geometry: mergeGeometries(parts)!, finish: "emissive" });

type Builder = (len: number, depth: number, height: number) => Piece[];

/** hazard stripes across the top of something `len` long: what marks a door, an edge or a breach */
function hazardStripes(len: number, depth: number, y: number): THREE.BufferGeometry[] {
  const n = Math.max(2, Math.round(len / 0.5));
  const w = len / n;
  return Array.from({ length: n }, (_, i) =>
    part(box(w, 0.03, depth), i % 2 ? RUBBER.base : HAZARD.base, -len / 2 + w * (i + 0.5), y, 0),
  );
}

// --- Fixtures --------------------------------------------------------------

const blastDoor: Builder = (len, depth, h) => [
  matte(
    merge(
      [
        part(box(len, h, depth * 0.8), STEEL.base, 0, h / 2, 0),
        part(box(0.06, h, depth * 0.82), RUBBER.base, 0, h / 2, 0),
        ...[0.5, 1.2, 1.9].map((y) => part(box(len - 0.3, 0.12, depth * 0.84), STEEL.shade, 0, y, 0)),
        ...hazardStripes(len, depth * 0.8, h + 0.015),
        part(box(0.35, h + 0.1, depth * 1.5), CONCRETE_DARK.base, -len / 2, (h + 0.1) / 2, 0),
        part(box(0.35, h + 0.1, depth * 1.5), CONCRETE_DARK.base, len / 2, (h + 0.1) / 2, 0),
      ],
      "ground",
      0.3,
    ),
  ),
  emissive([glowPart(box(0.12, 0.12, depth * 0.9), EMIT_RED, len / 2 - 0.45, 1.5, 0)]),
];

/** A concrete jersey barrier, 2 long, with a worn hazard band along its top. */
const barrier: Builder = (len) => {
  const shape = profile(
    [
      [-0.34, 0],
      [0.34, 0],
      [0.34, 0.12],
      [0.14, 0.3],
      [0.1, 0.8],
      [-0.1, 0.8],
      [-0.14, 0.3],
      [-0.34, 0.12],
    ],
    len,
  );
  return [
    matte(
      merge(
        [part(shape, CONCRETE.light), ...hazardStripes(len, 0.2, 0.795)],
        "ground",
        0.3,
      ),
    ),
  ];
};

/** A lab island bench: putty cabinets, a dark epoxy top, a reagent shelf down the middle and some clutter. */
const bench: Builder = (len, depth, h) => {
  const random = rng(Math.round(len * 7 + depth * 13));
  const parts = [
    part(box(len - 0.1, h - 0.08, depth - 0.12), PLASTIC.base, 0, (h - 0.08) / 2, 0),
    part(box(len + 0.06, 0.08, depth + 0.06), RUBBER.light, 0, h - 0.04, 0),
    part(box(len - 0.4, 0.4, 0.14), PLASTIC.shade, 0, h + 0.2, 0),
    part(box(len - 0.4, 0.03, 0.3), ALUMINIUM.base, 0, h + 0.41, 0),
  ];
  // cabinet doors on both long sides
  const doors = Math.round(len / 0.6);
  for (let i = 0; i < doors; i++) {
    const x = -len / 2 + 0.3 + i * ((len - 0.6) / Math.max(1, doors - 1));
    for (const side of [-1, 1]) parts.push(part(box(0.5, h - 0.25, 0.02), PLASTIC.light, x, (h - 0.15) / 2, side * (depth / 2 - 0.05)));
  }
  for (let i = 0; i < 6; i++) {
    const x = -len / 2 + 0.4 + random() * (len - 0.8);
    const side = random() < 0.5 ? -1 : 1;
    const pick = i % 3;
    if (pick === 0) parts.push(part(cyl(0.08, 0.1, 0.24, 6), PAPER.base, x, h + 0.12, side * depth * 0.3));
    else if (pick === 1) parts.push(part(box(0.38, 0.28, 0.3), RUBBER.base, x, h + 0.14, side * depth * 0.28));
    else parts.push(part(box(0.3, 0.015, 0.22), PAPER.light, x, h + 0.008, side * depth * 0.3, 0, random(), 0));
  }
  return [
    matte(merge(parts, "ground", 0.3)),
    emissive([glowPart(box(0.06, 0.02, 0.06), EMIT_GREEN, len / 2 - 0.5, h + 0.29, 0.03)]),
  ];
};

/** A row of tall lockers on a dark backing, so their tops read as separate tiles; doors with vents on the front. */
const lockers: Builder = (len, depth, h) => {
  const n = Math.max(1, Math.round(len / 0.5));
  const w = len / n;
  const parts = [part(box(len, h - 0.03, depth - 0.06), RUBBER.base, 0, (h - 0.03) / 2, 0)];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + w * (i + 0.5);
    const tone = i % 3 === 1 ? PAINT_CHARCOAL.shade : PAINT_CHARCOAL.base;
    parts.push(part(box(w - 0.05, h, depth), tone, x, h / 2, 0));
    for (let v = 0; v < 3; v++) parts.push(part(box(w - 0.2, 0.025, 0.02), RUBBER.light, x, h - 0.2 - v * 0.06, depth / 2 + 0.005));
    parts.push(part(box(0.03, 0.12, 0.03), ALUMINIUM.light, x + w / 2 - 0.1, h * 0.55, depth / 2 + 0.01));
  }
  // one hanging open
  parts.push(part(box(w - 0.05, h - 0.05, 0.03), PAINT_CHARCOAL.light, -len / 2 + w * 1.5 + 0.18, h / 2, depth / 2 + 0.2, 0, -1.1, 0));
  return [matte(merge(parts, "ground", 0.3))];
};

/** A desk against a wall with two monitors along its back edge, both still on. */
const terminal: Builder = (len, depth, h) => {
  const parts = [
    part(box(len, 0.08, depth), RUBBER.light, 0, h - 0.04, 0),
    part(box(0.5, h - 0.08, depth - 0.1), STEEL.shade, -len / 2 + 0.3, (h - 0.08) / 2, 0),
    part(box(0.5, h - 0.08, depth - 0.1), STEEL.shade, len / 2 - 0.3, (h - 0.08) / 2, 0),
    part(box(0.9, 0.04, 0.3), RUBBER.base, 0, h + 0.02, depth * 0.15),
    part(box(0.3, 0.02, 0.22), PAPER.base, len / 2 - 0.35, h + 0.01, depth * 0.1, 0, 0.3, 0),
  ];
  const screens: THREE.BufferGeometry[] = [];
  for (const x of [-len * 0.22, len * 0.22]) {
    parts.push(part(box(0.75, 0.48, 0.08), RUBBER.base, x, h + 0.3, -depth / 2 + 0.15));
    screens.push(glowPart(box(0.62, 0.38, 0.02), x < 0 ? EMIT_GREEN : EMIT_CYAN, x, h + 0.3, -depth / 2 + 0.2));
  }
  return [matte(merge(parts, "ground", 0.3)), emissive(screens)];
};

/** Equipment cases filling the footprint, one stacked on top when there's room for four. */
const crates: Builder = (len, depth) => {
  const cols = Math.max(1, Math.round(len));
  const rows = Math.max(1, Math.round(depth));
  const one = equipmentCaseGeometry();
  const parts: THREE.BufferGeometry[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      parts.push(one.clone().translate(-len / 2 + 0.5 + c, 0, -depth / 2 + 0.5 + r));
    }
  }
  if (cols * rows >= 4) parts.push(one.clone().rotateY(0.3).translate(-len / 2 + 0.5, 1.0, -depth / 2 + 0.5));
  return [matte(mergeGeometries(parts)!)];
};

/**
 * A row of server cabinets: dark bodies, perforated doors, status LEDs
 * blinking on each, and a cable tray running above the row --- the tray is
 * what says "server hall" from straight overhead.
 */
const rack: Builder = (len, depth, h) => {
  const n = Math.max(1, Math.floor(len / 0.62));
  const w = len / n;
  const random = rng(Math.round(len * 31));
  const bodies: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const leds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + w * (i + 0.5);
    bodies.push(part(box(w - 0.04, h, depth), RUBBER.base, x, h / 2, 0));
    trim.push(part(box(w - 0.16, 0.02, depth - 0.25), STEEL.base, x, h + 0.01, -0.05));
    for (const side of [-1, 1]) {
      trim.push(part(box(w - 0.12, h - 0.2, 0.02), RUBBER.light, x, h / 2, side * (depth / 2 + 0.005)));
      for (let k = 0; k < 3; k++) {
        if (random() < 0.35) continue;
        const colour = random() < 0.85 ? EMIT_GREEN : EMIT_AMBER;
        leds.push(glowPart(box(0.04, 0.03, 0.02), colour, x - w / 2 + 0.12 + k * 0.08, 0.6 + random() * 1.2, side * (depth / 2 + 0.02)));
      }
    }
  }
  trim.push(part(box(len, 0.06, 0.34), HAZARD.shade, 0, h + 0.38, 0));
  for (let i = 0; i < n; i++) trim.push(part(box(0.04, 0.38, 0.04), STEEL.shade, -len / 2 + w * (i + 0.5), h + 0.19, 0.15));
  return [glossy(merge(bodies, "ground", 0.3)), matte(merge(trim, "self", 0.1)), emissive(leds)];
};

/** A rack gone over onto its back, a couple of blades spilled beside it. */
const toppledRack: Builder = (len, depth, h) => {
  const parts = [part(box(len, h, depth), RUBBER.base, 0, h / 2, 0, 0, 0.12, 0)];
  const n = Math.round(len / 0.45);
  for (let i = 0; i < n; i++) {
    parts.push(part(box(0.06, 0.02, depth - 0.15), STEEL.light, -len / 2 + 0.25 + i * 0.45, h + 0.01, 0, 0, 0.12, 0));
  }
  parts.push(part(box(0.5, 0.06, 0.35), STEEL.base, len / 2 - 0.3, 0.03, depth / 2 + 0.3, 0, 0.7, 0));
  parts.push(part(box(0.5, 0.06, 0.35), STEEL.base, -len / 2 + 0.6, 0.03, depth / 2 + 0.4, 0, -0.4, 0));
  return [glossy(merge(parts, "ground", 0.3))];
};

function rubbleChunks(random: () => number, len: number, depth: number, h: number, count: number): THREE.BufferGeometry[] {
  const shades = [CONCRETE.shade, CONCRETE.base, CONCRETE.light];
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const r = (0.25 + random() * 0.35) * (i === 0 ? 1.6 : 1);
    const g = jitter(new THREE.DodecahedronGeometry(1, 0), 0.25, random);
    g.scale(r, Math.min(h, r * 0.8), r);
    parts.push(part(g, shades[i % 3], (random() - 0.5) * len * 0.8, r * 0.3, (random() - 0.5) * depth * 0.8, 0, random() * PI, 0));
  }
  return parts;
}

const rubble: Builder = (len, depth, h) => {
  const random = rng(31);
  const parts = rubbleChunks(random, len, depth, h, 5);
  parts.push(part(cyl(0.05, 0.05, 1.1, 4), RUST.base, 0.1, 0.35, 0, 0.4, 0.8, 1.2));
  return [matte(merge(parts, "ground", 0.3))];
};

/**
 * The reactor: a squat cylinder on a plinth ringed with hazard segments,
 * pipes running down to the floor, a railing round the plinth's edge. The
 * glowing core window on top is built separately (reactorCore()) because
 * it changes when the reactor is switched on.
 */
const reactor: Builder = (len, _depth, h) => {
  const R = len / 2;
  const parts = [
    part(cyl(R - 0.1, R, 0.3, 10), CONCRETE_DARK.base, 0, 0.15, 0),
    part(cyl(1.3, 1.5, 1.2, 10), ALUMINIUM.base, 0, 0.9, 0),
    part(cyl(1.34, 1.34, 0.12, 10), HAZARD.base, 0, 0.6, 0),
    part(cyl(1.34, 1.34, 0.12, 10), HAZARD.base, 0, 1.25, 0),
    part(cyl(0.95, 1.3, 0.3, 10), ALUMINIUM.light, 0, h - 0.15, 0),
    part(cyl(0.7, 0.7, 0.05, 10), RUBBER.base, 0, h + 0.01, 0),
  ];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2 + PI / 10;
    parts.push(
      part(box(0.5, 0.04, 0.3), i % 2 ? RUBBER.base : HAZARD.base, Math.cos(a) * (R - 0.35), 0.32, Math.sin(a) * (R - 0.35), 0, -a + PI / 2, 0),
    );
    // railing posts round the plinth edge
    parts.push(part(box(0.05, 0.55, 0.05), STEEL.light, Math.cos(a) * (R - 0.08), 0.57, Math.sin(a) * (R - 0.08)));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    parts.push(part(box(0.28, 0.28, 0.9), STEEL.base, Math.cos(a) * 1.75, 0.5, Math.sin(a) * 1.75, 0, -a + PI / 2, 0));
  }
  return [glossy(merge(parts, "ground", 0.4))];
};

/** the reactor's core window, as its own mesh so its glow can change with the objective */
export function reactorCore(): THREE.BufferGeometry {
  return glowPart(cyl(0.6, 0.6, 0.06, 10), 0xffffff, 0, 0.9 * 2 + 0.06, 0);
}
export const REACTOR_STANDBY = EMIT_RED;
export const REACTOR_LIVE = EMIT_REACTOR;

/** A control console: a cabinet, a button deck on top, a screen along the back. */
const consoleDesk: Builder = (len, depth, h) => {
  const parts = [
    part(box(len, h - 0.25, depth), STEEL.base, 0, (h - 0.25) / 2, 0),
    part(box(len - 0.1, 0.06, depth - 0.15), RUBBER.base, 0, h - 0.22, 0.04),
    part(box(len * 0.85, 0.5, 0.1), RUBBER.base, 0, h + 0.05, -depth / 2 + 0.08),
  ];
  const lights = [glowPart(box(len * 0.78, 0.4, 0.02), EMIT_AMBER, 0, h + 0.05, -depth / 2 + 0.14)];
  const colours = [EMIT_RED, EMIT_GREEN, EMIT_AMBER];
  const n = Math.floor(len / 0.4);
  for (let i = 0; i < n; i++) lights.push(glowPart(box(0.12, 0.04, 0.12), colours[i % 3], -len / 2 + 0.3 + i * 0.4, h - 0.17, 0.12));
  return [matte(merge(parts, "ground", 0.3)), emissive(lights)];
};

const pillar: Builder = (len, depth, h) => [
  matte(
    merge(
      [
        part(box(len - 0.2, h, depth - 0.2), CONCRETE.base, 0, h / 2, 0),
        part(box(len, 0.3, depth), CONCRETE_DARK.base, 0, 0.15, 0),
        part(box(len - 0.18, 0.5, depth - 0.18), HAZARD.base, 0, 0.55, 0),
        part(box(len - 0.16, 0.08, depth - 0.16), RUBBER.base, 0, 0.84, 0),
        part(box(len, 0.15, depth), CONCRETE.light, 0, h + 0.075, 0),
      ],
      "ground",
      0.4,
    ),
  ),
];

/** A fume hood: a tall steel cabinet with a glass sash and a duct going up through the ceiling. */
const fumeHood: Builder = (len, depth, h) => {
  const parts = [
    part(box(len, 0.9, depth), PLASTIC.base, 0, 0.45, 0),
    part(box(len, h - 0.9, depth * 0.85), STEEL.light, 0, 0.9 + (h - 0.9) / 2, -depth * 0.075),
    part(box(len - 0.2, 0.7, 0.03), ALUMINIUM.light, 0, 1.35, depth / 2 - 0.12),
    part(cyl(0.22, 0.22, 0.6, 8), STEEL.base, 0, h + 0.3, -0.1),
  ];
  return [matte(merge(parts, "ground", 0.3)), emissive([glowPart(box(len - 0.3, 0.04, 0.04), 0xd8e6ff, 0, 1.75, depth / 2 - 0.15)])];
};

/** Gas cylinders chained to a wall rack, alternate ones capped in a different greyed colour. */
const gasRack: Builder = (len, depth, h) => {
  const parts = [part(box(len, 0.08, depth), STEEL.shade, 0, h * 0.75, -depth / 2 + 0.04)];
  const n = Math.max(2, Math.round(len / 0.36));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    parts.push(part(cyl(0.14, 0.14, h * 1.6, 8), i % 2 ? PAINT_OCHRE.base : STEEL.light, x, h * 0.8, 0));
    parts.push(part(cyl(0.08, 0.12, 0.14, 6), i % 2 ? PAINT_OXIDE.base : PAINT_CHARCOAL.base, x, h * 1.6 + 0.07, 0));
  }
  return [matte(merge(parts, "ground", 0.3))];
};

/** A computer-room air conditioner: a tall grey cabinet with louvres and a status panel. */
const cooler: Builder = (len, depth, h) => {
  const parts = [part(box(len, h, depth), ALUMINIUM.base, 0, h / 2, 0)];
  for (let i = 0; i < 6; i++) parts.push(part(box(len - 0.2, 0.04, 0.03), ALUMINIUM.shade, 0, 0.35 + i * 0.22, depth / 2 + 0.01));
  parts.push(part(box(len - 0.1, 0.05, depth - 0.1), ALUMINIUM.light, 0, h + 0.025, 0));
  parts.push(part(cyl(0.3, 0.3, 0.04, 10), RUBBER.base, -len / 4, h + 0.06, 0));
  parts.push(part(cyl(0.3, 0.3, 0.04, 10), RUBBER.base, len / 4, h + 0.06, 0));
  return [matte(merge(parts, "ground", 0.3)), emissive([glowPart(box(0.25, 0.12, 0.02), EMIT_CYAN, len / 2 - 0.25, h - 0.25, depth / 2 + 0.02)])];
};

/** A dead vending machine: dark glass front with one tile of light still on. */
const vending: Builder = (len, depth, h) => {
  const parts = [
    part(box(len, h, depth), PAINT_OXIDE.base, 0, h / 2, 0),
    part(box(len * 0.65, h * 0.7, 0.03), RUBBER.base, -len * 0.12, h * 0.55, depth / 2 + 0.01),
    part(box(len * 0.2, 0.3, 0.03), STEEL.base, len * 0.35, h * 0.5, depth / 2 + 0.01),
    part(box(len, 0.06, depth), PAINT_OXIDE.shade, 0, h + 0.03, 0),
  ];
  return [matte(merge(parts, "ground", 0.3)), emissive([glowPart(box(0.12, 0.08, 0.02), EMIT_GREEN, len * 0.35, h * 0.62, depth / 2 + 0.02)])];
};

/**
 * The corp's comms set, patched in beside the reactor: a field desk with a
 * stacked radio and a ruggedised screen, a whip antenna clamped to one end
 * and a cable run back to the reactor's consoles. Clean olive-and-steel
 * kit against the old facility; the screen and the radio's dials are lit.
 */
const supplyTerminal: Builder = (len, depth, h) => {
  const deck = h * 0.62;
  const parts = [
    // the desk: a steel frame, a rubber-topped deck
    part(box(len, 0.06, depth), RUBBER.base, 0, deck, 0),
    part(box(len - 0.1, deck - 0.06, depth - 0.15), STEEL.shade, 0, (deck - 0.06) / 2, -0.05),
    // the radio stack at the west end: two olive cases, one on the other
    part(box(len * 0.32, 0.26, depth * 0.7), PAINT_SAGE.shade, -len * 0.3, deck + 0.16, -depth * 0.08),
    part(box(len * 0.3, 0.22, depth * 0.62), PAINT_SAGE.base, -len * 0.3, deck + 0.4, -depth * 0.1),
    // the screen, tipped back toward whoever stands at the front
    part(box(len * 0.42, 0.42, 0.08), RUBBER.light, len * 0.12, deck + 0.3, -depth * 0.18),
    // keyboard on the deck, a handset beside it
    part(box(len * 0.34, 0.03, 0.2), STEEL.light, len * 0.12, deck + 0.045, depth * 0.22),
    part(box(0.12, 0.06, 0.32), RUBBER.base, len * 0.38, deck + 0.06, depth * 0.15),
    // the antenna mast clamped to the east end, and its base
    part(cyl(0.06, 0.08, 0.14, 6), STEEL.base, len / 2 - 0.12, deck + 0.1, -depth / 2 + 0.12),
    part(cyl(0.02, 0.02, 1.3, 5), ALUMINIUM.base, len / 2 - 0.12, deck + 0.8, -depth / 2 + 0.12),
    // a stencilled band on the top case, readable from overhead
    part(box(len * 0.24, 0.02, depth * 0.18), PAPER.base, -len * 0.3, deck + 0.52, -depth * 0.1),
  ];
  for (const cx of [-1, 1]) parts.push(part(box(0.1, deck, 0.1), HAZARD.base, cx * (len / 2 - 0.05), deck / 2, depth / 2 - 0.05));
  return [
    matte(merge(parts, "ground", 0.3)),
    emissive([
      glowPart(box(len * 0.36, 0.34, 0.02), EMIT_AMBER, len * 0.12, deck + 0.3, -depth * 0.18 + 0.05),
      glowPart(box(0.06, 0.04, 0.02), EMIT_GREEN, -len * 0.36, deck + 0.42, depth * 0.22),
      glowPart(box(0.06, 0.04, 0.02), EMIT_RED, -len * 0.26, deck + 0.42, depth * 0.22),
      glowPart(box(0.05, 0.05, 0.05), EMIT_RED, len / 2 - 0.12, deck + 1.47, -depth / 2 + 0.12),
    ]),
  ];
};

/** A waiting-room bench: steel frame, slatted seat. */
const seating: Builder = (len, depth, h) => {
  const parts = [
    part(box(0.06, h, depth - 0.1), STEEL.shade, -len / 2 + 0.15, h / 2, 0),
    part(box(0.06, h, depth - 0.1), STEEL.shade, len / 2 - 0.15, h / 2, 0),
  ];
  for (let i = 0; i < 3; i++) parts.push(part(box(len, 0.04, depth / 3.6), WOOD.base, 0, h, -depth / 2 + depth * (i + 0.5) / 3));
  parts.push(part(box(len, 0.35, 0.05), WOOD.shade, 0, h + 0.2, -depth / 2 + 0.03));
  return [matte(merge(parts, "ground", 0.25))];
};

/** A briefing table with a map spread out and a mug. */
const table: Builder = (len, depth, h) => {
  const parts = [part(box(len, 0.06, depth), WOOD.base, 0, h - 0.03, 0)];
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) parts.push(part(box(0.06, h - 0.06, 0.06), STEEL.shade, cx * (len / 2 - 0.1), (h - 0.06) / 2, cz * (depth / 2 - 0.1)));
  parts.push(part(box(len * 0.6, 0.01, depth * 0.5), PAPER.base, -len * 0.1, h + 0.005, 0, 0, 0.08, 0));
  parts.push(part(box(len * 0.3, 0.012, depth * 0.25), PAPER.shade, len * 0.25, h + 0.006, depth * 0.2, 0, -0.2, 0));
  parts.push(part(cyl(0.05, 0.05, 0.1, 6), PLASTIC.light, len * 0.3, h + 0.05, -depth * 0.25));
  return [matte(merge(parts, "ground", 0.25))];
};

const BUILDERS: Record<FixtureKind, Builder> = {
  blastDoor,
  barrier,
  bench,
  lockers,
  terminal,
  crates,
  rack,
  toppledRack,
  rubble,
  reactor,
  console: consoleDesk,
  pillar,
  fumeHood,
  gasRack,
  cooler,
  vending,
  supplyTerminal,
  seating,
  table,
};

const FACING_ANGLE: Record<Facing, number> = { south: 0, north: PI, east: PI / 2, west: -PI / 2 };

/** how to turn a model whose front is +Z (and length along X) to fit a footprint */
function orientation(o: Obstacle, facing?: Facing): { len: number; depth: number; angle: number } {
  const alongZ = facing ? facing === "east" || facing === "west" : o.halfZ > o.halfX;
  const angle = facing ? FACING_ANGLE[facing] : alongZ ? PI / 2 : 0;
  return alongZ ? { len: o.halfZ * 2, depth: o.halfX * 2, angle } : { len: o.halfX * 2, depth: o.halfZ * 2, angle };
}

/** one fixture as its own (unmerged) model, for the model sheet */
export function fixtureModel(kind: FixtureKind, len: number, depth: number, height: number): THREE.Group {
  const g = new THREE.Group();
  for (const p of BUILDERS[kind](len, depth, height)) g.add(mesh(p.geometry, p.finish));
  return g;
}

// --- Walls ------------------------------------------------------------------

/** which zone, if any, lies just beyond a point --- used to paint each wall face for the room it faces */
function zoneAt(zones: Record<Zone, Rect>, x: number, z: number): Zone | undefined {
  for (const [name, r] of Object.entries(zones) as [Zone, Rect][]) {
    if (x >= r.minX - 0.01 && x <= r.maxX + 0.01 && z >= r.minZ - 0.01 && z <= r.maxZ + 0.01) return name;
  }
  return undefined;
}

/**
 * A wall: a concrete core, and on each face that looks into a room, that
 * room's paint --- a darker wainscot below a dado rail, the upper colour
 * above, a rubber skirting at the floor, a conduit run near the top and a
 * pilaster every few metres. Faces that look into solid structure get
 * nothing (no-one sees them).
 */
function wallModel(w: Obstacle, zones: Record<Zone, Rect>, bins: Bins): void {
  const alongX = w.halfX >= w.halfZ;
  const len = (alongX ? w.halfX : w.halfZ) * 2;
  const thick = (alongX ? w.halfZ : w.halfX) * 2;
  const h = w.halfHeight * 2;
  const local: THREE.BufferGeometry[] = [part(box(len, h, thick), CONCRETE_DARK.base, 0, h / 2, 0)];
  const face: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    // what's just beyond this face, sampled at a few points along it (a wall can face two zones)
    const samples = [-0.4, 0, 0.4].map((t) => {
      const along = t * len;
      const out = side * (thick / 2 + 0.3);
      const x = w.x + (alongX ? along : out);
      const z = w.z + (alongX ? out : along);
      return zoneAt(zones, x, z);
    });
    const zone = samples.find((s) => s !== undefined);
    if (!zone) continue;
    const paint = ZONE_PAINT[zone];
    const f = side * (thick / 2);
    const s = side;
    const wainscot = 0.95;
    face.push(part(box(len, wainscot, 0.03), paint.lower.shade, 0, wainscot / 2, f + s * 0.015));
    face.push(part(box(len, h - wainscot, 0.03), paint.upper.base, 0, wainscot + (h - wainscot) / 2, f + s * 0.015));
    face.push(part(box(len, 0.05, 0.06), paint.lower.light, 0, wainscot, f + s * 0.03));
    face.push(part(box(len, 0.14, 0.05), RUBBER.base, 0, 0.07, f + s * 0.025));
    // conduit and a pipe near the top
    face.push(part(box(len, 0.06, 0.06), STEEL.base, 0, h - 0.25, f + s * 0.06));
    face.push(part(cyl(0.05, 0.05, len, 6), PAINT_OXIDE.shade, 0, h - 0.42, f + s * 0.08, 0, 0, PI / 2));
    const bays = Math.max(1, Math.round(len / 4));
    for (let i = 0; i <= bays; i++) {
      face.push(part(box(0.22, h, 0.08), paint.upper.shade, -len / 2 + (len * i) / bays, h / 2, f + s * 0.04));
    }
    // an extinguisher cabinet or junction box on longer walls
    if (len > 6) {
      const at = len * (side > 0 ? 0.18 : -0.22);
      face.push(part(box(0.35, 0.55, 0.12), PAINT_OXIDE.base, at, 1.35, f + s * 0.06));
      face.push(part(box(0.3, 0.3, 0.1), STEEL.light, -at * 0.6, 1.7, f + s * 0.05));
      glow.push(glowPart(box(0.05, 0.03, 0.02), EMIT_GREEN, -at * 0.6 + 0.08, 1.78, f + s * 0.105));
    }
  }
  const m = new THREE.Matrix4().makeRotationY(alongX ? 0 : PI / 2).setPosition(w.x, 0, w.z);
  bins.matte.push(merge(local, "none").applyMatrix4(m));
  if (face.length) bins.matte.push(merge(face, "ground", 0.3).applyMatrix4(m));
  for (const g of glow) bins.emissive.push(g.applyMatrix4(m));
}

/** A solid mass between rooms: wall-height concrete. Only its top would show, and that's out of sight. */
function solidBlock(r: Rect, height: number): THREE.BufferGeometry {
  return merge([part(box(r.maxX - r.minX, height, r.maxZ - r.minZ), CONCRETE_DARK.shade, 0, height / 2, 0)], "none");
}

/** steel door frames either side of a doorway, with a hazard-striped threshold */
function doorFrame(d: Rect, height: number, bins: Bins): void {
  const alongX = d.maxX - d.minX > d.maxZ - d.minZ;
  const len = alongX ? d.maxX - d.minX : d.maxZ - d.minZ;
  const depth = alongX ? d.maxZ - d.minZ : d.maxX - d.minX;
  const parts = [
    part(box(0.14, height, depth + 0.24), STEEL.shade, -len / 2 - 0.02, height / 2, 0),
    part(box(0.14, height, depth + 0.24), STEEL.shade, len / 2 + 0.02, height / 2, 0),
    ...hazardStripes(len, depth + 0.2, 0.012),
  ];
  const m = new THREE.Matrix4()
    .makeRotationY(alongX ? 0 : PI / 2)
    .setPosition((d.minX + d.maxX) / 2, 0, (d.minZ + d.maxZ) / 2);
  bins.matte.push(merge(parts, "ground", 0.3).applyMatrix4(m));
}

// --- Breaches -----------------------------------------------------------------

/** hazard-striped jambs either side of a breach: the shared mark for "something gets in here" */
function breachJambs(b: Breach, height: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (const end of [-1, 1]) {
    const along = (b.width / 2 + 0.15) * end;
    const jamb = [part(box(0.3, height, 0.75), CONCRETE_DARK.base, 0, height / 2, 0), ...hazardStripes(0.74, 0.32, 0.6).map((g) => g.rotateY(PI / 2))];
    for (const g of jamb) {
      if (b.side === "north") g.translate(b.x + along, 0, b.z);
      else g.rotateY(PI / 2).translate(b.x, 0, b.z + along);
      parts.push(g);
    }
  }
  return parts;
}

/**
 * The model for one breach, in world space. A vent: a duct beyond the wall
 * and its grille knocked onto the floor. A collapse: broken wall stubs and
 * rubble spilling both ways. A shaft: an elevator pit beyond, its doors
 * pried apart. Beyond each, nothing: that's the dark they come out of.
 */
function breachModel(b: Breach, height: number): THREE.BufferGeometry {
  const parts = breachJambs(b, height);
  const random = rng(b.x * 3 + b.z * 7);
  if (b.kind === "vent") {
    const out = -1;
    parts.push(part(box(1.8, 1.2, b.width + 0.5), STEEL.shade, b.x + out * 1.15, 0.6, b.z));
    parts.push(part(box(1.4, 0.04, b.width - 0.2), RUBBER.base, b.x + out * 0.9, 1.22, b.z));
    const grille = [part(box(1.1, 0.05, 1.5), STEEL.base, 0, 0.025, 0)];
    for (let i = 0; i < 5; i++) grille.push(part(box(0.9, 0.03, 0.1), STEEL.shade, 0, 0.06, -0.55 + i * 0.275));
    for (const g of grille) parts.push(g.rotateY(0.5).translate(b.x + 1.6, 0, b.z + 1.6));
    for (let i = 0; i < 4; i++) parts.push(part(box(0.04, 0.02, 0.04), STEEL.light, b.x + 0.6 + random() * 1.2, 0.01, b.z + (random() - 0.5) * 2));
  } else if (b.kind === "collapse") {
    for (const end of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const hgt = height * (0.75 - i * 0.22) * (0.8 + random() * 0.3);
        const g = jitter(box(0.6, hgt, 0.7), 0.08, random);
        parts.push(part(g, CONCRETE.base, b.x + (random() - 0.5) * 0.2, hgt / 2, b.z + end * (b.width / 2 - 0.3 - i * 0.45)));
      }
    }
    for (const g of rubbleChunks(random, 1.6, b.width - 1, 0.5, 7)) parts.push(g.translate(b.x - 1.1, 0, b.z));
    parts.push(part(cyl(0.04, 0.04, 1.6, 4), RUST.base, b.x - 0.8, 0.2, b.z + 0.6, 0.2, 0.4, 1.3));
  } else {
    const out = -1;
    const d = 2.4;
    const cz = b.z + out * (d / 2 + 0.3);
    parts.push(part(box(0.3, height, d + 0.3), CONCRETE_DARK.base, b.x - b.width / 2 - 0.25, height / 2, cz));
    parts.push(part(box(0.3, height, d + 0.3), CONCRETE_DARK.base, b.x + b.width / 2 + 0.25, height / 2, cz));
    parts.push(part(box(b.width + 0.8, height, 0.3), CONCRETE_DARK.base, b.x, height / 2, cz + out * (d / 2 + 0.15)));
    parts.push(part(box(b.width * 0.35, height * 0.9, 0.08), STEEL.base, b.x - b.width * 0.33, height * 0.45, b.z));
    parts.push(part(box(b.width * 0.5, 0.08, height * 0.85), STEEL.base, b.x + 0.7, 0.04, b.z + 1.5, 0, 0.35, 0));
  }
  return merge(parts, "ground", 0.4);
}

// --- Lamps --------------------------------------------------------------------

/**
 * A lamp's visible fixture: a ceiling tube/panel/bulb hanging over the
 * floor, or a wall beacon. The glowing part is emissive, so it reads as a
 * light even where its light isn't in the active pool.
 */
function lampModel(lamp: Lamp, bins: Bins): void {
  // A ceiling lamp's fixture is above the camera's cut through the ceiling,
  // so it isn't drawn: what shows is the light it throws (lampHalos). Only
  // wall lamps have a model.
  if (lamp.mount !== "wall") return;
  const spec = LAMP_SPECS[lamp.kind];
  const housing: THREE.BufferGeometry[] = [];
  const glowing: THREE.BufferGeometry[] = [];
  const emit = lamp.dead ? STEEL.shade : spec.emit;
  const y = spec.height;
  const m = new THREE.Matrix4().makeRotationY(FACING_ANGLE[lamp.facing ?? "south"]).setPosition(lamp.x, 0, lamp.z);
  if (lamp.kind === "fluoro" || lamp.kind === "led") {
    // a batten along the wall: a steel channel with the tube lying in it,
    // the tube's top showing from overhead
    housing.push(part(box(1.3, 0.12, 0.16), STEEL.light, 0, y, 0.08).applyMatrix4(m));
    glowing.push(glowPart(box(1.16, 0.08, 0.1), emit, 0, y + 0.03, 0.17).applyMatrix4(m));
  } else if (lamp.kind === "emergency") {
    housing.push(part(box(0.3, 0.3, 0.12), RUBBER.base, 0, y, 0.06).applyMatrix4(m));
    glowing.push(glowPart(cyl(0.11, 0.13, 0.14, 8), emit, 0, y, 0.18, PI / 2, 0, 0).applyMatrix4(m));
  } else {
    // a bulkhead lamp: a bracket off the wall holding a caged globe
    housing.push(part(box(0.22, 0.08, 0.3), STEEL.base, 0, y - 0.1, 0.15).applyMatrix4(m));
    glowing.push(glowPart(new THREE.IcosahedronGeometry(0.15, 0), emit, 0, y, 0.24).applyMatrix4(m));
  }
  bins.matte.push(merge(housing, "none"));
  for (const g of glowing) bins.emissive.push(g);
}

// --- Floor ------------------------------------------------------------------------

/**
 * Floors by zone: sealed concrete with expansion joints in circulation, a
 * linoleum sheet in the lab, raised-floor tiles in the server hall. Plus
 * painted markings: lane lines down the corridor, a hazard ring round the
 * reactor, and scattered paper and drains.
 */
function floorModel(zones: Record<Zone, Rect>, bins: Bins): void {
  const tiles: THREE.BufferGeometry[] = [];
  const marks: THREE.BufferGeometry[] = [];
  const zoneRandom = rng(77);
  for (const [name, r] of Object.entries(zones) as [Zone, Rect][]) {
    // the two ends of the lift are the same car: same tiles, same litter
    const random = name === "lift" || name === "liftTop" ? rng(41) : zoneRandom;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const grid = name === "hall" ? 0.6 : name === "lab" ? 1 : 2;
    const ramp = name === "lab" ? LINOLEUM : name === "hall" ? RAISED_FLOOR : FLOOR;
    // a tile grid (pad by the wall thickness so floors meet under doorways)
    const pad = 0.35;
    const nx = Math.max(1, Math.round((w + pad * 2) / grid));
    const nz = Math.max(1, Math.round((d + pad * 2) / grid));
    const tw = (w + pad * 2) / nx;
    const td = (d + pad * 2) / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const pick = random();
        const tone = name === "lab" ? ramp.base : pick < 0.33 ? ramp.shade : pick < 0.8 ? ramp.base : ramp.light;
        const gap = name === "hall" ? 0.03 : 0.02;
        tiles.push(part(box(tw - gap, 0.02, td - gap), tone, r.minX - pad + tw * (i + 0.5), 0.01, r.minZ - pad + td * (j + 0.5)));
      }
    }
    // a dark joint underlay so the gaps between tiles read
    tiles.push(part(box(w + pad * 2, 0.01, d + pad * 2), RUBBER.base, cx, 0.003, cz));
    // scattered paper and the odd drain
    for (let k = 0; k < Math.round((w * d) / 25); k++) {
      marks.push(part(box(0.3, 0.004, 0.22), PAPER.base, r.minX + random() * w, 0.024, r.minZ + random() * d, 0, random() * PI, 0));
    }
    if (w * d > 40) marks.push(part(box(0.4, 0.004, 0.4), STEEL.shade, cx + w * 0.3, 0.024, cz - d * 0.3));
  }
  // corridor lane lines, both edges
  const c = zones.corridor;
  for (const x of [c.minX + 0.25, c.maxX - 0.25]) {
    for (let z = c.minZ + 0.5; z < c.maxZ - 0.5; z += 1.2) marks.push(part(box(0.08, 0.004, 0.7), HAZARD.shade, x, 0.024, z));
  }
  // the reactor's keep-clear ring
  const ring = new THREE.RingGeometry(3.0, 3.25, 32, 1);
  ring.rotateX(-PI / 2);
  marks.push(part(ring, HAZARD.base, 0, 0.025, -11.5));
  // stencilled "B3" on the core floor by the airlock
  marks.push(part(box(1.4, 0.004, 0.5), STENCIL, 0, 0.026, -5.4));
  bins.tile.push(merge(tiles, "none"));
  bins.matte.push(merge(marks, "none"));
}

// --- The whole building ---------------------------------------------------------

export interface FacilityLayout {
  zones: Record<Zone, Rect>;
  walls: Obstacle[];
  doorways: Rect[];
  solids: Rect[];
  fixtures: Fixture[];
  breaches: Breach[];
  lamps: Lamp[];
  wallHeight: number;
}

/** The whole building, merged: one mesh per material for everything static. */
export function buildFacility(layout: FacilityLayout): THREE.Group {
  const bins = emptyBins();
  const place = (pieces: Piece[], x: number, z: number, angle: number): void => {
    const m = new THREE.Matrix4().makeRotationY(angle).setPosition(x, 0, z);
    for (const p of pieces) bins[p.finish].push(p.geometry.clone().applyMatrix4(m));
  };
  // identical fixtures (the rack rows) share one build, AO and all
  const cache = new Map<string, Piece[]>();

  for (const w of layout.walls) wallModel(w, layout.zones, bins);
  for (const r of layout.solids) {
    place([matte(solidBlock(r, layout.wallHeight))], (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, 0);
  }
  for (const d of layout.doorways) doorFrame(d, layout.wallHeight, bins);
  for (const f of layout.fixtures) {
    const o = orientation(f, f.facing);
    const key = `${f.kind}:${o.len}:${o.depth}:${f.halfHeight}`;
    let pieces = cache.get(key);
    if (!pieces) {
      pieces = BUILDERS[f.kind](o.len, o.depth, f.halfHeight * 2);
      cache.set(key, pieces);
    }
    place(pieces, f.x, f.z, o.angle);
  }
  for (const b of layout.breaches) place([matte(breachModel(b, layout.wallHeight))], 0, 0, 0);
  for (const lamp of layout.lamps) lampModel(lamp, bins);
  floorModel(layout.zones, bins);

  const group = new THREE.Group();
  for (const finish of FINISHES) {
    if (bins[finish].length === 0) continue;
    const m = mesh(mergeGeometries(bins[finish])!, finish);
    if (finish === "tile") m.castShadow = false;
    group.add(m);
  }
  return group;
}
