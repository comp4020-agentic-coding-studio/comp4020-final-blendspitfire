import {
  EMIT_AMBER,
  EMIT_FLUORO,
  EMIT_RED,
  EMIT_WHITE,
  LIGHT_EMERGENCY,
  LIGHT_FLUORO_COOL,
  LIGHT_INCANDESCENT,
  LIGHT_LED,
  LIGHT_SODIUM,
  PAINT_OCHRE,
  PAINT_OXIDE,
  PAINT_PUTTY,
  PAINT_SAGE,
  PAINT_STEEL_BLUE,
  CONCRETE,
  type Ramp,
} from "../../shared/palette.ts";
import { FACILITY_HALF, YARD, type Zone } from "../../shared/protocol.ts";

// Where the facility's light comes from, and how each zone is dressed.
// Pure data: the lighting system and the facility builder read it, so
// moving a lamp or repainting a room never touches either.
//
// Each zone has one dominant light temperature --- the main way the scene
// gets hue variety while every surface stays greyed. The intake room is
// warm (tungsten: the one place that feels safe), the corridor's tubes
// are failing, the lab is clinical cool fluorescent, the server hall cold
// LED with green status lights, and the core puts sodium amber right
// around the reactor against cool tubes at its edges. Emergency red pulses everywhere once the reactor is live.

export type LampKind = "fluoro" | "led" | "bulb" | "sodium" | "emergency";

export interface Lamp {
  kind: LampKind;
  x: number;
  z: number;
  /** "ceiling" lamps hang over the floor; "wall" lamps are mounted on a wall face, facing `facing` */
  mount: "ceiling" | "wall";
  /** wall lamps: the direction the lamp faces (away from its wall) */
  facing?: "north" | "south" | "east" | "west";
  /** a failing tube: flickers on and off */
  flicker?: boolean;
  /** a dead tube: drawn, gives no light */
  dead?: boolean;
}

export interface LampSpec {
  /** colour of the light */
  light: number;
  /** colour of the glowing part */
  emit: number;
  intensity: number;
  /** how far its light reaches, in world units */
  range: number;
  /** height of the light above the floor */
  height: number;
}

export const LAMP_SPECS: Record<LampKind, LampSpec> = {
  fluoro: { light: LIGHT_FLUORO_COOL, emit: EMIT_FLUORO, intensity: 9, range: 9, height: 2.3 },
  led: { light: LIGHT_LED, emit: EMIT_WHITE, intensity: 7, range: 8, height: 2.3 },
  bulb: { light: LIGHT_INCANDESCENT, emit: EMIT_WHITE, intensity: 8, range: 8, height: 2.2 },
  sodium: { light: LIGHT_SODIUM, emit: EMIT_AMBER, intensity: 10, range: 9, height: 2.2 },
  emergency: { light: LIGHT_EMERGENCY, emit: EMIT_RED, intensity: 4, range: 6, height: 2.2 },
};

const ceiling = (kind: LampKind, x: number, z: number, extra: Partial<Lamp> = {}): Lamp => ({
  kind,
  x,
  z,
  mount: "ceiling",
  ...extra,
});
const wall = (kind: LampKind, x: number, z: number, facing: Lamp["facing"], extra: Partial<Lamp> = {}): Lamp => ({
  kind,
  x,
  z,
  mount: "wall",
  facing,
  ...extra,
});

/** which way each facing points on the floor plan */
export const FACING_DIR: Record<NonNullable<Lamp["facing"]>, { x: number; z: number }> = {
  south: { x: 0, z: 1 },
  north: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/**
 * Where a lamp's light comes from on the floor plan: a wall lamp's sits a
 * little out from the wall, so it lights the room rather than the wall
 * behind it, and a sight line to it isn't cut by that wall.
 */
export function lampSource(lamp: Lamp): { x: number; z: number } {
  if (lamp.mount !== "wall") return lamp;
  const d = FACING_DIR[lamp.facing ?? "south"];
  return { x: lamp.x + d.x * 0.35, z: lamp.z + d.z * 0.35 };
}

const Y_MID = (YARD.minZ + YARD.maxZ) / 2;

// The camera looks down through the ceiling, so a fixture hung from it
// would float over everyone's heads. Where a room's edges can light it ---
// the narrow corridor and passages, the intake, the core's margins ---
// lamps are on the walls, where they're seen the way they'd really be
// mounted. Out in the middle of the big rooms the light stays overhead,
// but its fixture is above the camera's cut and isn't drawn: you see the
// pool it throws on the floor, not the lamp.
export const LAMPS: Lamp[] = [
  // intake room: warm bulbs on the side walls, one overhead to fill the middle
  ceiling("bulb", 0, Y_MID),
  wall("bulb", -6.95, 22, "east"),
  wall("bulb", 6.95, 22, "west"),
  // corridor: tubes down alternate walls (clear of the doorways), one failing, one dead
  wall("fluoro", -1.95, 16, "east"),
  wall("fluoro", 1.95, 10.5, "west", { flicker: true }),
  wall("fluoro", -1.95, 7, "east", { dead: true }),
  wall("fluoro", 1.95, 3.5, "west"),
  // lab: cool tubes over the benches
  ceiling("fluoro", -9.5, 9.75),
  ceiling("fluoro", -14.5, 5),
  ceiling("fluoro", -5, 15),
  ceiling("fluoro", -14.5, 15.5, { flicker: true }),
  // passages: one bulb each
  wall("bulb", -13.65, -1.5, "east"),
  wall("bulb", 13.65, 0, "west"),
  wall("bulb", -1.95, -1, "east", { dead: true }),
  // server hall: cold LED panels down the aisles
  ceiling("led", 7, 10),
  ceiling("led", 13, 10),
  ceiling("led", 10, 4, { flicker: true }),
  ceiling("led", 5, 16),
  // core: sodium flanking the reactor, cool tubes out on the walls --- the
  // warm/cool split is what keeps a big room from going one flat colour
  ceiling("sodium", -6, -11.5),
  ceiling("sodium", 6, -11.5),
  ceiling("fluoro", 0, -6),
  wall("fluoro", -10, -17.95, "south", { flicker: true }),
  wall("fluoro", 10, -17.95, "south"),
  wall("fluoro", -13.65, -7, "east"),
  wall("fluoro", 13.65, -7, "west", { dead: true }),
  // emergency beacons by every way in (dim until the reactor's live)
  wall("emergency", 0, FACILITY_HALF - 0.05, "north"),
  wall("emergency", -17.95, 12.5, "east"),
  wall("emergency", 17.95, 11, "west"),
  wall("emergency", 3.6, -17.95, "south"),
  wall("emergency", -12, -4.35, "south"),
  wall("emergency", 12, -4.35, "south"),
];

/**
 * How each zone's walls are painted: an upper colour (most of the wall), a
 * darker wainscot band below, and a plate on the wall by the door. Each
 * zone has its own hue, all inside the surface gamut.
 */
export interface ZonePaint {
  upper: Ramp;
  lower: Ramp;
  /** short ID stencilled on a wall plate */
  label: string;
}

export const ZONE_PAINT: Record<Zone, ZonePaint> = {
  intake: { upper: PAINT_PUTTY, lower: PAINT_OCHRE, label: "B1 INTAKE" },
  corridor: { upper: CONCRETE, lower: PAINT_OXIDE, label: "B2 CORRIDOR" },
  lab: { upper: PAINT_SAGE, lower: PAINT_SAGE, label: "B2 LAB 04" },
  hall: { upper: PAINT_STEEL_BLUE, lower: PAINT_STEEL_BLUE, label: "B2 DATA" },
  westPassage: { upper: CONCRETE, lower: PAINT_OXIDE, label: "W SVC" },
  eastPassage: { upper: CONCRETE, lower: PAINT_OXIDE, label: "E SVC" },
  airlock: { upper: CONCRETE, lower: CONCRETE, label: "" },
  core: { upper: CONCRETE, lower: PAINT_OXIDE, label: "B3 CORE" },
};
