// No runtime imports from protocol.ts: that file folds these walls into its
// OBSTACLES, so the dependency only runs that way (types are fine).
import type { Obstacle, Rect } from "./protocol.ts";

const inRect = (r: Rect, x: number, z: number, margin = 0): boolean =>
  x >= r.minX + margin && x <= r.maxX - margin && z >= r.minZ + margin && z <= r.maxZ - margin;
/** the garden's north fence line (SURFACE.minZ; spec/tutorial.test.ts keeps the two in step) */
export const GARDEN_MIN_Z = 34;

// The tutorial: a row of small rooms off to one side of the world, one
// lesson each, a door at the far end of each that opens once you've done
// what that room teaches. It sits on the surface's band of Z (so it counts
// as "top": the sun, the safe-zone rules, a 3 s respawn), well east of the
// garden's ruins, where nothing else is drawn. The last room holds a
// transport helicopter; riding it lands you at its twin in the garden.
//
// Shared by everyone in it, but progress (and so which doors are open,
// which targets stand, which items lie waiting) is per player: the server
// keeps a stage per connection, and both ends work out the doors from it.

/** how far east of the garden the tutorial is */
export const TUT_DX = 80;
const W = 0.3; // wall half-thickness, as the facility's
const ROOM_W = 8; // east-west, inside
const ROOM_D = 7; // north-south, inside
const DOOR_HALF = 1.1;
export const TUT_WALL_HALF_HEIGHT = 1.25;

/** what each room teaches, south to north; you start in the first */
export const LESSONS = ["move", "pickup", "shoot", "drop", "grenade", "fly"] as const;
export type Lesson = (typeof LESSONS)[number];

// the rooms run south from the garden's north edge: everything south of
// LEVEL_SPLIT_Z is the surface level, so the row can be as long as it needs
const NORTH = GARDEN_MIN_Z; // the first room's north wall (inside face)
/** room i's floor (inside its walls) */
// (the last is deeper: the helicopter, nose to tail, needs the room)
const LAST_D = 11;
export const TUT_ROOMS: Rect[] = LESSONS.map((_, i) => ({
  minX: TUT_DX - ROOM_W / 2,
  maxX: TUT_DX + ROOM_W / 2,
  minZ: NORTH + i * (ROOM_D + 2 * W),
  maxZ: NORTH + i * (ROOM_D + 2 * W) + (i === LESSONS.length - 1 ? LAST_D : ROOM_D),
}));
/** the whole tutorial, walls and all */
export const TUT_BOUNDS: Rect = {
  minX: TUT_DX - ROOM_W / 2 - 2 * W,
  maxX: TUT_DX + ROOM_W / 2 + 2 * W,
  minZ: NORTH - 2 * W,
  maxZ: TUT_ROOMS[TUT_ROOMS.length - 1].maxZ + 2 * W,
};
export const inTutorial = (x: number, z: number): boolean => inRect(TUT_BOUNDS, x, z);
/** which room (lesson index) a point is in, or -1 */
export const roomAt = (x: number, z: number): number => TUT_ROOMS.findIndex((r) => inRect(r, x, z, -W));

const wall = (x1: number, z1: number, x2: number, z2: number): Obstacle => ({
  x: (x1 + x2) / 2,
  z: (z1 + z2) / 2,
  halfX: Math.max(W, Math.abs(x2 - x1) / 2),
  halfZ: Math.max(W, Math.abs(z2 - z1) / 2),
  halfHeight: TUT_WALL_HALF_HEIGHT,
});

/** the doorway out of room i (south, into room i+1) */
export function tutDoor(i: number): Obstacle {
  const r = TUT_ROOMS[i];
  return { x: TUT_DX, z: r.maxZ + W, halfX: DOOR_HALF, halfZ: W, halfHeight: TUT_WALL_HALF_HEIGHT };
}
/** the doorways, as rects someone can stand in (an open door is walkable) */
export const TUT_DOORWAYS: Rect[] = LESSONS.slice(0, -1).map((_, i) => {
  const d = tutDoor(i);
  return { minX: d.x - d.halfX, maxX: d.x + d.halfX, minZ: d.z - W, maxZ: d.z + W };
});

const xl = TUT_DX - ROOM_W / 2;
const xr = TUT_DX + ROOM_W / 2;
/** the fixed walls: outer shell, and each cross wall either side of its door */
export const TUT_WALLS: Obstacle[] = [
  wall(xl - W, TUT_BOUNDS.minZ, xl - W, TUT_BOUNDS.maxZ),
  wall(xr + W, TUT_BOUNDS.minZ, xr + W, TUT_BOUNDS.maxZ),
  wall(xl - 2 * W, TUT_BOUNDS.minZ + W, xr + 2 * W, TUT_BOUNDS.minZ + W),
  wall(xl - 2 * W, TUT_BOUNDS.maxZ - W, xr + 2 * W, TUT_BOUNDS.maxZ - W),
  ...LESSONS.slice(0, -1).flatMap((_, i) => {
    const z = TUT_ROOMS[i].maxZ + W;
    return [wall(xl, z, TUT_DX - DOOR_HALF, z), wall(TUT_DX + DOOR_HALF, z, xr, z)];
  }),
];

/** the doors still shut for someone at this stage (stage = lessons done) */
export function shutTutDoors(stage: number): Obstacle[] {
  const out: Obstacle[] = [];
  for (let i = Math.max(0, stage); i < LESSONS.length - 1; i++) out.push(tutDoor(i));
  return out;
}

// --- What's in each room -----------------------------------------------------

const centre = (i: number) => ({ x: TUT_DX, z: (TUT_ROOMS[i].minZ + TUT_ROOMS[i].maxZ) / 2 });
/** where a newcomer appears: the first room's north end */
export const TUT_SPAWN = { x: TUT_DX - 1.5, z: TUT_ROOMS[0].minZ + 1.2 };
/** move: walk onto this pad at the room's south end */
export const MOVE_PAD = { x: TUT_DX + 2, z: TUT_ROOMS[0].maxZ - 1.6, r: 1 };
/** pickup: a rifle lies here */
export const TUT_GUN_AT = centre(1);
/** shoot: three targets along the west wall (the doorway's to the south, out of the line of fire), each down after TARGET_HITS */
export const TUT_TARGETS: { x: number; z: number }[] = [-2, 0, 2].map((dz) => ({ x: TUT_DX - 3.2, z: centre(2).z + dz }));
export const TARGET_HITS = 3;
export const TARGET_RADIUS = 0.45;
/** drop: put the rifle down on this rack mat */
export const DROP_PAD = { x: TUT_DX - 2.2, z: centre(3).z, r: 1 };
/** grenade: one lies here; a huddle of dummies stands by the far wall */
export const TUT_GRENADE_AT = { x: TUT_DX + 2.4, z: TUT_ROOMS[4].minZ + 1.4 };
export const TUT_CLUSTER: { x: number; z: number }[] = [
  [0, 0],
  [-0.7, 0.3],
  [0.7, 0.3],
  [-0.35, -0.5],
  [0.4, -0.5],
].map(([dx, dz]) => ({ x: TUT_DX + dx - 1.4, z: TUT_ROOMS[4].maxZ - 2 + dz }));

// --- The helicopters ---------------------------------------------------------

/**
 * The transport helicopter, one in the tutorial's last room and its twin in
 * the garden, identical so the ride is a swap like the lift's. Its cabin
 * (the walk-in part) is open along its west side, the side door slid back.
 * `x, z` is the cabin's centre.
 */
export interface Helipad {
  x: number;
  z: number;
}
export const CABIN = { halfX: 1.1, halfZ: 1.6 };
export const HELIPADS = {
  tutorial: { x: TUT_DX + 1.8, z: TUT_ROOMS[5].minZ + 4.2 },
  garden: { x: 9.5, z: GARDEN_MIN_Z + 9.5 },
} as const;
export type PadName = keyof typeof HELIPADS;
export const HELI_RIDE_MS = 2600;

export const inCabin = (pad: Helipad, x: number, z: number, margin = 0): boolean =>
  Math.abs(x - pad.x) <= CABIN.halfX - margin && Math.abs(z - pad.z) <= CABIN.halfZ - margin;
export const padAt = (x: number, z: number): PadName | undefined =>
  (Object.keys(HELIPADS) as PadName[]).find((n) => inCabin(HELIPADS[n], x, z, -0.2));

/**
 * The helicopter's solid parts, as obstacles: the cabin's east wall and its
 * two ends (the west side is the open door), the nose to the north and the
 * tail boom to the south. Skids and rotor are overhead or underfoot.
 */
export function heliObstacles(pad: Helipad): Obstacle[] {
  const { x, z } = pad;
  const t = 0.12;
  const h = 0.9;
  return [
    { x: x + CABIN.halfX + t, z, halfX: t, halfZ: CABIN.halfZ + 2 * t, halfHeight: h },
    { x, z: z - CABIN.halfZ - t, halfX: CABIN.halfX + 2 * t, halfZ: t, halfHeight: h },
    { x, z: z + CABIN.halfZ + t, halfX: CABIN.halfX + 2 * t, halfZ: t, halfHeight: h },
    // the cockpit forward (north), and the tail boom aft (south)
    { x, z: z - CABIN.halfZ - 1.05, halfX: 0.9, halfZ: 0.85, halfHeight: h },
    { x, z: z + CABIN.halfZ + 2.2, halfX: 0.22, halfZ: 1.9, halfHeight: 0.4 },
  ];
}
/** the same spot in the other helicopter */
export function heliDestination(from: PadName, x: number, z: number): { to: PadName; x: number; z: number } {
  const to: PadName = from === "tutorial" ? "garden" : "tutorial";
  const a = HELIPADS[from];
  const b = HELIPADS[to];
  return { to, x: b.x + (x - a.x), z: b.z + (z - a.z) };
}

export const TUT_OBSTACLES: Obstacle[] = [...TUT_WALLS, ...heliObstacles(HELIPADS.tutorial)];
export const GARDEN_HELI_OBSTACLES: Obstacle[] = heliObstacles(HELIPADS.garden);

// --- The lessons' words ------------------------------------------------------

/** what each room's floor and marker say */
export const LESSON_TEXT: Record<Lesson, { title: string; how: string }> = {
  move: { title: "walk", how: "WASD to walk · onto the pad" },
  pickup: { title: "pick up", how: "walk to the rifle · E to pick it up" },
  shoot: { title: "shoot", how: "aim with the mouse · click to fire · drop every target" },
  drop: { title: "put down", how: "stand on the mat · Q to put the rifle down" },
  grenade: { title: "grenade", how: "E: pick it up · click to throw it at the huddle" },
  fly: { title: "fly out", how: "step into the helicopter · E to take off" },
};
