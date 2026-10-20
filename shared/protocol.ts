import type { DefenceState, EnemyState } from "./enemies.ts";

export interface PlayerState {
  id: string;
  color: string;
  x: number;
  z: number;
  rotation: number;
  /** wire-only: set while dead and coming back, the timestamp (Date.now()-scale) they respawn at */
  respawnAt?: number;
  /** wire-only: dead for the rest of this attempt (died while the reactor was live): spectating */
  out?: true;
  /** wire-only: in-memory for the current connection, not persisted */
  score?: number;
  /** wire-only: out of the lift into the facility since they came down; during an attempt the lift's shut to them */
  entered?: true;
  /**
   * wire-only: bumped every time the server moves them somewhere walking
   * can't (a respawn, a lift ride). The client jumps there and stamps its
   * moves with it, so a move sent from where they used to be is ignored
   */
  warp?: number;
  /** wire-only: wounds taken since their last (re)spawn, 0..MAX_WOUNDS-1 (absent = unhurt); see WOUNDS */
  wounds?: number;
  /** wire-only: what they're called on screen and in the server log (palette.ts codename) */
  name?: string;
}

/** the facility's objective: for now just whether someone has switched the reactor on */
export interface ObjectiveState {
  active: boolean;
}

export interface WelcomeMessage {
  type: "welcome";
  /** server time when sent, so the client can estimate the clock offset straight away */
  t: number;
  you: PlayerState;
  players: PlayerState[];
}

export interface StateMessage {
  type: "state";
  /** server time (Date.now() scale) this snapshot was taken: clients interpolate other players against it */
  t: number;
  players: PlayerState[];
  projectiles: ProjectileState[];
  /**
   * Every item in the world --- but only in a message where something about
   * them changed (or the first one a client gets). Items move rarely and are
   * most of the payload, so most ticks leave this out and the client keeps
   * what it had.
   */
  items?: ItemState[];
  objective: ObjectiveState;
  enemies: EnemyState[];
  defence: DefenceState;
  /** the crew's shared quota, to spend at the supply terminal */
  funds: number;
  /** one-off lines to show everyone (a wave starting, the reactor going down) */
  announcements?: string[];
  lift: LiftState;
}

/**
 * The arcade board, sent on joining and whenever it changes: the run in
 * progress, the best players of all time, and the runs that were won.
 * Players are named by codename only (see palette.ts codename), never by id.
 */
export interface BoardMessage {
  type: "board";
  run: { attempts: number; best: number };
  top: { name: string; kills: number; boxes: number; attempts: number; wins: number }[];
  wins: { n: number; wonAt: number; attempts: number; crew: string[] }[];
}

export interface MoveMessage {
  type: "move";
  x: number;
  z: number;
  rotation: number;
  /** the PlayerState.warp this move was made after; a stale one is dropped */
  warp?: number;
}

export interface PickupMessage {
  type: "pickup";
  itemId: string;
}

/**
 * The held item's primary action. What it does is up to the item's kind;
 * (x, z) is where the player is pointing on the ground, for kinds that need
 * a target (a box's placement spot) --- kinds that don't just ignore it.
 */
export interface PrimaryMessage {
  type: "primary";
  x: number;
  z: number;
}

export interface DropMessage {
  type: "drop";
}

/** switch the reactor on: empty hands, within reach of it */
export interface ActivateMessage {
  type: "activate";
}

/** the lift button: inside the car it sends it (after a wait for the others), outside its door it calls it */
export interface LiftMessage {
  type: "lift";
}

/** at the supply terminal: spend the crew's quota on a turret, handed straight to the buyer */
export interface BuyMessage {
  type: "buy";
}

/**
 * A shot, sent once rather than every tick: where it started, which way it
 * flies and when, and how far it gets before it stops (a wall, a box, or
 * someone it hit). Every client plays the same straight line forward from
 * those, so a fast bullet looks identical everywhere without streaming its
 * position. `range` can shrink once (when it hits a player mid-flight); the
 * next broadcast carries the new value.
 */
export interface ProjectileState {
  id: string;
  ownerId: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** server time (Date.now() scale) it was fired */
  firedAt: number;
  /** distance it travels before stopping */
  range: number;
}

/**
 * This tab has been taken over by a newer one for the same player. Sent
 * just before the server closes the socket: a close frame doesn't always
 * make it through a proxy, a message on the open socket does.
 */
export interface ReplacedMessage {
  type: "replaced";
}

export type ServerMessage = WelcomeMessage | StateMessage | BoardMessage | ReplacedMessage;
export type ClientMessage = MoveMessage | PickupMessage | PrimaryMessage | DropMessage | ActivateMessage | LiftMessage | BuyMessage;

/**
 * Every pickup-able thing in the world is one of these: same shape, same
 * pickup/drop rules, differing only in what its primary (and optional
 * secondary) action does. The "equipment slot" is just `heldBy` --- a
 * player holds at most one item, and nothing on screen shows a slot.
 */
export type ItemKind = "gun" | "box" | "turret";

/** kinds that stand on a 1×1 tile once put down: placed like a box, block like a box, get chewed like a box */
export const BLOCKING_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(["box", "turret"]);
export const isBlocking = (item: { kind: ItemKind; heldBy?: string }): boolean => BLOCKING_KINDS.has(item.kind) && item.heldBy === undefined;

export interface ItemState {
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
  /** id of the player holding it; absent while it's lying in the world */
  heldBy?: string;
  /** wire-only: a box being chewed, 0..1 of the way to breaking (absent = intact) */
  wear?: number;
  /** wire-only: a placed turret's barrel heading (radians, atan2(dx, dz)), set when it fires */
  aim?: number;
}

export interface ItemKindInfo {
  /** label for the on-screen control hint */
  primaryLabel: string;
  /** absent when the kind has no secondary action */
  secondaryLabel?: string;
}

export const ITEM_KINDS: Record<ItemKind, ItemKindInfo> = {
  gun: { primaryLabel: "fire" },
  box: { primaryLabel: "place", secondaryLabel: "grid snap" },
  turret: { primaryLabel: "place", secondaryLabel: "grid snap" },
};

/** how far (center to center) a player can reach to pick something up */
export const PICKUP_RANGE = 2.2;
/** how far from the player a box can be put down */
export const PLACE_RANGE = 3.5;
export const BOX_HALF_EXTENT = 0.5;
export const GRID_SIZE = 1;

/** 20 updates a second: smooth enough to interpolate between, small enough for the 256 MB machine */
export const BROADCAST_INTERVAL_MS = 50;
export const PERSIST_INTERVAL_MS = 1000;

// --- World layout ----------------------------------------------------------
// An underground facility, and a sunlit garden on the surface above it,
// joined by one lift. Everyone spawns in the garden, where the tutorial is
// (stations, targets, the scoreboard); the lift takes them down, and its
// car opens onto the facility's main corridor off the south side
// (screen-down, +Z). The two levels share one coordinate space: the
// surface sits LIFT_DZ further south, out of sight of the facility, and a
// ride moves everyone in the car by exactly that much, so the car looks
// the same before and after.
//
//   z=-18  +------+======== ~~ ====+------+   ~~ breach: stuck elevator shaft
//          |######|      CORE       |######|
//          |######|    (reactor)    |######|
//   z=-4   |######+-  -+##+-  -+##+-  -+####|
//          |######|WPAS|##|AIRL|##|EPAS|####|
//   z=2    +------+-  -+--+=BD=+--+-  -+----+   BD sealed blast door
//          |              |    |            |
//          ~~    LAB      D  C |   HALL     ~~  ~~ breaches: vent (W), collapse (E)
//          |              |  O D            |   D doorways off the corridor
//   z=18   +--------------+-><-+------------+   >< the lift door
//                        |LIFT|
//
// The corridor branches into the lab and the server hall, each of which
// reaches the core through its own narrow passage, so the core can be come
// at from two sides --- and every room except the corridor has a breach,
// the way a horde would get in. The loop the facility is built for:
// activate the reactor, then hold it.

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const FACILITY_HALF = 18;
/** the facility's overall footprint: every room lies inside it */
export const FACILITY: Rect = {
  minX: -FACILITY_HALF,
  maxX: FACILITY_HALF,
  minZ: -FACILITY_HALF,
  maxZ: FACILITY_HALF,
};
const WALL_HALF = 0.3;
export const DOOR_HALF_WIDTH = 2;
/** walls run well over head height: everything is indoors */
export const FACILITY_WALL_HALF_HEIGHT = 1.25;

// --- The lift and the surface ------------------------------------------------

/** how far south of its facility twin everything on the surface is */
export const LIFT_DZ = 40;
/** the lift car's floor at the bottom (inside its walls); the door is its north side */
const CAR_BOTTOM: Rect = { minX: -3, maxX: 3, minZ: FACILITY_HALF + 2 * WALL_HALF, maxZ: FACILITY_HALF + 2 * WALL_HALF + 5.8 };
const shiftRect = (r: Rect, dz: number): Rect => ({ ...r, minZ: r.minZ + dz, maxZ: r.maxZ + dz });
export type LiftLevel = "top" | "bottom";
export const LIFT_CARS: Record<LiftLevel, Rect> = { bottom: CAR_BOTTOM, top: shiftRect(CAR_BOTTOM, LIFT_DZ) };
/** the garden on the surface: the car's door opens north into it */
export const SURFACE: Rect = { minX: -13, maxX: 13, minZ: LIFT_CARS.top.minZ - 2 * WALL_HALF - 18, maxZ: LIFT_CARS.top.minZ - 2 * WALL_HALF };
/** anything south of this is on the surface */
export const LEVEL_SPLIT_Z = (CAR_BOTTOM.maxZ + SURFACE.minZ) / 2;
export const levelOf = (z: number): LiftLevel => (z > LEVEL_SPLIT_Z ? "top" : "bottom");
export const inCar = (level: LiftLevel, x: number, z: number, margin = 0): boolean => inRect(LIFT_CARS[level], x, z, margin);
export const inAnyCar = (x: number, z: number): boolean => inCar("top", x, z) || inCar("bottom", x, z);

/** everything anyone can stand in; movement is clamped to it before walls */
export const PLAY_BOUNDS: Rect = { minX: FACILITY.minX, maxX: FACILITY.maxX, minZ: FACILITY.minZ, maxZ: LIFT_CARS.top.maxZ };
/** as far as sight reaches in the facility: a little past the outer walls, so a breach shows what's just beyond it and no further */
export const SIGHT_BOUNDS: Rect = { minX: -FACILITY_HALF - 3, maxX: FACILITY_HALF + 3, minZ: -FACILITY_HALF - 3, maxZ: CAR_BOTTOM.maxZ + 1 };

export const inRect = (r: Rect, x: number, z: number, margin = 0): boolean =>
  x >= r.minX + margin && x <= r.maxX - margin && z >= r.minZ + margin && z <= r.maxZ - margin;

/** the gap in the facility's south wall: the lift door at the bottom */
export const DOOR: Rect = {
  minX: -DOOR_HALF_WIDTH,
  maxX: DOOR_HALF_WIDTH,
  minZ: FACILITY_HALF,
  maxZ: FACILITY_HALF + 2 * WALL_HALF,
};

/** the facility's rooms: open floor, inside their walls */
export const ROOMS = {
  core: { minX: -13.7, maxX: 13.7, minZ: -18, maxZ: -4.3 },
  westPassage: { minX: -13.7, maxX: -10.3, minZ: -3.7, maxZ: 1.7 },
  airlock: { minX: -2, maxX: 2, minZ: -3.7, maxZ: 1.7 },
  eastPassage: { minX: 10.3, maxX: 13.7, minZ: -3.7, maxZ: 1.7 },
  lab: { minX: -18, maxX: -2.6, minZ: 2.3, maxZ: 18 },
  corridor: { minX: -2, maxX: 2, minZ: 2.3, maxZ: 18 },
  hall: { minX: 2.6, maxX: 18, minZ: 2.3, maxZ: 18 },
} satisfies Record<string, Rect>;
const ROOM_LIST: Rect[] = Object.values(ROOMS);

/** the lift door's opening at the top, out into the garden */
export const TOP_DOOR: Rect = shiftRect(
  { minX: -DOOR_HALF_WIDTH, maxX: DOOR_HALF_WIDTH, minZ: FACILITY_HALF, maxZ: FACILITY_HALF + 2 * WALL_HALF },
  LIFT_DZ,
);

/** the openings between rooms (and out to the lift), where a wall would otherwise be */
export const DOORWAYS: Rect[] = [
  DOOR,
  { minX: -2.6, maxX: -2, minZ: 9, maxZ: 12 }, // corridor -> lab
  { minX: 2, maxX: 2.6, minZ: 12, maxZ: 15 }, // corridor -> hall
  { minX: -13.7, maxX: -10.3, minZ: 1.7, maxZ: 2.3 }, // lab -> west passage
  { minX: 10.3, maxX: 13.7, minZ: 1.7, maxZ: 2.3 }, // hall -> east passage
  { minX: -13.7, maxX: -10.3, minZ: -4.3, maxZ: -3.7 }, // west passage -> core
  { minX: -2, maxX: 2, minZ: -4.3, maxZ: -3.7 }, // airlock -> core
  { minX: 10.3, maxX: 13.7, minZ: -4.3, maxZ: -3.7 }, // east passage -> core
];

/**
 * Where a horde would get in: openings in the facility's outer wall that
 * lead nowhere a player can go (movement is clamped to the facility), so
 * for now they're scenery --- and a place to build in front of. Not
 * no-build: blocking a breach is the point.
 */
export type BreachKind = "vent" | "collapse" | "shaft";
export interface Breach {
  kind: BreachKind;
  /** which outer wall it's in */
  side: "west" | "east" | "north";
  /** the opening's centre, on the wall's centre line */
  x: number;
  z: number;
  width: number;
}
export const BREACHES: Breach[] = [
  { kind: "vent", side: "west", x: -FACILITY_HALF - WALL_HALF, z: 10, width: 2 },
  { kind: "collapse", side: "east", x: FACILITY_HALF + WALL_HALF, z: 8, width: 4 },
  { kind: "shaft", side: "north", x: 5.5, z: -FACILITY_HALF - WALL_HALF, width: 3 },
];
const breachGap = (b: Breach): [number, number] => {
  const c = b.side === "north" ? b.x : b.z;
  return [c - b.width / 2, c + b.width / 2];
};

/**
 * Inside the facility's footprint but in no room: solid structure, drawn
 * as a block. Nothing reaches it (walls close every room), so it isn't an
 * obstacle, just not walkable.
 */
export const SOLID: Rect[] = [
  { minX: -18.6, maxX: -14.3, minZ: -18.6, maxZ: 1.7 },
  { minX: 14.3, maxX: 18.6, minZ: -18.6, maxZ: 1.7 },
  { minX: -9.7, maxX: -2.6, minZ: -3.7, maxZ: 1.7 },
  { minX: 2.6, maxX: 9.7, minZ: -3.7, maxZ: 1.7 },
];

/**
 * Somewhere a player can actually be: a room, the lift car, the garden, or
 * a doorway between. Solid structure, and the gap between the two levels,
 * are not.
 */
export const isWalkable = (x: number, z: number): boolean =>
  ROOM_LIST.some((r) => inRect(r, x, z)) ||
  inAnyCar(x, z) ||
  inRect(SURFACE, x, z) ||
  inRect(TOP_DOOR, x, z) ||
  DOORWAYS.some((r) => inRect(r, x, z));

/**
 * Out of the facility: the lift car (at either end) and the whole surface.
 * Enemies never go there; counted from the middle of the bottom doorway so
 * the door is a clean line.
 */
export const isSafe = (x: number, z: number): boolean => z > FACILITY_HALF + WALL_HALF;
/** no firing in the lift car; the garden has a range to practise on */
export const noFireAt = (x: number, z: number): boolean => inAnyCar(x, z) || inRect(DOOR, x, z) || inRect(TOP_DOOR, x, z);

// The lift. One car, shared by everyone, run by the server: it waits open
// at one end, counts down once someone presses its button, shuts, rides,
// and opens at the other end. Whoever's inside when it shuts goes with it.
export type LiftPhase = "open" | "closing" | "moving" | "opening";
export interface LiftState {
  at: LiftLevel;
  phase: LiftPhase;
  /** server time the current closing/moving/opening phase ends */
  until?: number;
  /** while open: server time it'll shut and leave (set once someone presses the button) */
  departAt?: number;
}
export const LIFT_DOOR_MS = 900;
export const LIFT_RIDE_MS = 2600;
/** how long the car waits before leaving if there's anyone else on that level who might want to come */
export const LIFT_WAIT_MS = 15000;
/** ...and if everyone there is already aboard */
export const LIFT_SHORT_WAIT_MS = 3000;
/** an empty car left at the bottom goes back up after this, so newcomers can always come down */
export const LIFT_RETURN_MS = 5000;

/** the car's door at each end, as an obstacle (its centre line is the wall line) */
export const LIFT_DOORS: Record<LiftLevel, Obstacle> = {
  bottom: { x: 0, z: FACILITY_HALF + WALL_HALF, halfX: DOOR_HALF_WIDTH, halfZ: WALL_HALF, halfHeight: FACILITY_WALL_HALF_HEIGHT },
  top: { x: 0, z: FACILITY_HALF + WALL_HALF + LIFT_DZ, halfX: DOOR_HALF_WIDTH, halfZ: WALL_HALF, halfHeight: FACILITY_WALL_HALF_HEIGHT },
};

/** how open a level's door is, 0..1, at server time `now` */
export function liftDoorOpen(lift: LiftState, level: LiftLevel, now: number): number {
  if (lift.at !== level) return 0;
  if (lift.phase === "open") return 1;
  if (lift.phase === "moving") return 0;
  const left = Math.max(0, Math.min(1, ((lift.until ?? now) - now) / LIFT_DOOR_MS));
  return lift.phase === "closing" ? left : 1 - left;
}

/**
 * The lift doors that are shut, as obstacles: every door but the one the
 * car is standing open at. `lockedOut` (someone in the facility while an
 * attempt is on) has the bottom door shut to them regardless.
 */
export function liftDoorObstacles(lift: LiftState, lockedOut: boolean): Obstacle[] {
  const shut: Obstacle[] = [];
  for (const level of ["top", "bottom"] as const) {
    const open = lift.at === level && lift.phase === "open" && !(level === "bottom" && lockedOut);
    if (!open) shut.push(LIFT_DOORS[level]);
  }
  return shut;
}

/** what a given player collides with: the world, plus whichever lift doors are shut to them */
export function obstaclesFor(lift: LiftState, lockedOut: boolean, base: Obstacle[]): Obstacle[] {
  return [...base, ...liftDoorObstacles(lift, lockedOut)];
}

export interface Obstacle {
  x: number;
  z: number;
  /** half the footprint along X */
  halfX: number;
  /** half the footprint along Z */
  halfZ: number;
  /** half the height; also its center's Y position */
  halfHeight: number;
}

const wallBetween = (x1: number, z1: number, x2: number, z2: number, halfHeight: number): Obstacle => ({
  x: (x1 + x2) / 2,
  z: (z1 + z2) / 2,
  halfX: Math.max(WALL_HALF, Math.abs(x2 - x1) / 2),
  halfZ: Math.max(WALL_HALF, Math.abs(z2 - z1) / 2),
  halfHeight,
});


const facilityWall = (x1: number, z1: number, x2: number, z2: number) =>
  wallBetween(x1, z1, x2, z2, FACILITY_WALL_HALF_HEIGHT);

// Wall centre lines. Segments overlap at corners so every room is closed.
const O = FACILITY_HALF + WALL_HALF; // outer walls
const C = CAR_BOTTOM.maxX + WALL_HALF; // the lift car's side walls
const [ventFrom, ventTo] = breachGap(BREACHES[0]);
const [collapseFrom, collapseTo] = breachGap(BREACHES[1]);
const [shaftFrom, shaftTo] = breachGap(BREACHES[2]);

export const FACILITY_WALLS: Obstacle[] = [
  // outer: south (either side of the yard door), the lab's west, the
  // hall's east, the core's north --- each with its breach left open
  // (the stretch either side of the lift door is its own piece, so its face
  // inside the car is painted like the car's, exactly as at the top)
  facilityWall(-O - WALL_HALF, O, -CAR_BOTTOM.maxX - 2 * WALL_HALF, O),
  facilityWall(-CAR_BOTTOM.maxX - 2 * WALL_HALF, O, -DOOR_HALF_WIDTH, O),
  facilityWall(DOOR_HALF_WIDTH, O, CAR_BOTTOM.maxX + 2 * WALL_HALF, O),
  facilityWall(CAR_BOTTOM.maxX + 2 * WALL_HALF, O, O + WALL_HALF, O),
  facilityWall(-O, 1.7, -O, ventFrom),
  facilityWall(-O, ventTo, -O, O),
  facilityWall(O, 1.7, O, collapseFrom),
  facilityWall(O, collapseTo, O, O),
  facilityWall(-14.3, -O, shaftFrom, -O),
  facilityWall(shaftTo, -O, 14.3, -O),
  // the corridor's sides, which carry on north as the airlock's
  facilityWall(-2.3, -4.3, -2.3, 9),
  facilityWall(-2.3, 12, -2.3, O),
  facilityWall(2.3, -4.3, 2.3, 12),
  facilityWall(2.3, 15, 2.3, O),
  // the row between the lab/corridor/hall and the passages (the blast
  // door fills the corridor's end)
  facilityWall(-O - WALL_HALF, 2, -13.7, 2),
  facilityWall(-10.3, 2, -2, 2),
  facilityWall(2, 2, 10.3, 2),
  facilityWall(13.7, 2, O + WALL_HALF, 2),
  // the passages' sides, and the core's west and east
  facilityWall(-14, -O, -14, 2.3),
  facilityWall(-10, -4.3, -10, 2.3),
  facilityWall(10, -4.3, 10, 2.3),
  facilityWall(14, -O, 14, 2.3),
  // the core's south wall, between the three ways in
  facilityWall(-10.3, -4, -2, -4),
  facilityWall(2, -4, 10.3, -4),
];

/** the car's sides and back, at the bottom (its front is the facility's south wall) */
export const LIFT_WALLS: Obstacle[] = [
  facilityWall(-C, O, -C, CAR_BOTTOM.maxZ + 2 * WALL_HALF), // west
  facilityWall(C, O, C, CAR_BOTTOM.maxZ + 2 * WALL_HALF), // east
  facilityWall(-C - WALL_HALF, CAR_BOTTOM.maxZ + WALL_HALF, C + WALL_HALF, CAR_BOTTOM.maxZ + WALL_HALF), // back
];

/** the facility's walls, drawn and sight-blocking as the facility */
export const WALLS: Obstacle[] = [...FACILITY_WALLS, ...LIFT_WALLS];

const shiftObstacle = (o: Obstacle, dz: number): Obstacle => ({ ...o, z: o.z + dz });
const S = SURFACE;
const hedge = (x1: number, z1: number, x2: number, z2: number) => wallBetween(x1, z1, x2, z2, 0.55);
/**
 * The surface: the same car, LIFT_DZ further south, with its own front
 * wall either side of the door (the lift house), and the garden's hedges.
 */
export const LIFT_HOUSE_WALLS: Obstacle[] = [
  ...LIFT_WALLS.map((w) => shiftObstacle(w, LIFT_DZ)),
  facilityWall(-CAR_BOTTOM.maxX - 2 * WALL_HALF, O + LIFT_DZ, -DOOR_HALF_WIDTH, O + LIFT_DZ),
  facilityWall(DOOR_HALF_WIDTH, O + LIFT_DZ, CAR_BOTTOM.maxX + 2 * WALL_HALF, O + LIFT_DZ),
];
export const HEDGES: Obstacle[] = [
  hedge(S.minX - WALL_HALF, S.minZ - 2 * WALL_HALF, S.minX - WALL_HALF, S.maxZ + 2 * WALL_HALF), // west
  hedge(S.maxX + WALL_HALF, S.minZ - 2 * WALL_HALF, S.maxX + WALL_HALF, S.maxZ + 2 * WALL_HALF), // east
  hedge(S.minX - 2 * WALL_HALF, S.minZ - WALL_HALF, S.maxX + 2 * WALL_HALF, S.minZ - WALL_HALF), // north
  hedge(S.minX - 2 * WALL_HALF, S.maxZ + WALL_HALF, -C - WALL_HALF, S.maxZ + WALL_HALF), // south, either side of the lift house
  hedge(C + WALL_HALF, S.maxZ + WALL_HALF, S.maxX + 2 * WALL_HALF, S.maxZ + WALL_HALF),
];

/** every wall, as the room it faces: so a wall's two faces can be painted for the rooms either side */
export type Zone = keyof typeof ROOMS | "lift" | "liftTop";
export const ZONE_RECTS: Record<Zone, Rect> = { ...ROOMS, lift: CAR_BOTTOM, liftTop: LIFT_CARS.top };
/** everything built in the facility's style: its walls, and the lift car at the top too */
export const BUILT_WALLS: Obstacle[] = [...WALLS, ...LIFT_HOUSE_WALLS];

/**
 * The facility's fixed furniture and structure: everything solid a player
 * walks around and takes cover behind. A footprint like any obstacle (it
 * blocks movement and projectiles alike); `kind` says which model the
 * client draws to fill it, turned to run along the footprint's long side.
 */
export type FixtureKind =
  | "blastDoor"
  | "barrier"
  | "bench"
  | "lockers"
  | "terminal"
  | "crates"
  | "rack"
  | "toppledRack"
  | "rubble"
  | "reactor"
  | "console"
  | "pillar"
  | "fumeHood"
  | "gasRack"
  | "cooler"
  | "vending"
  | "supplyTerminal"
  | "seating"
  | "table";

/** which way a fixture's working side points, for the ones that have one (a desk, a locker door) */
export type Facing = "north" | "south" | "east" | "west";

export interface Fixture extends Obstacle {
  kind: FixtureKind;
  facing?: Facing;
}

const fixture = (
  kind: FixtureKind,
  x: number,
  z: number,
  halfX: number,
  halfZ: number,
  halfHeight: number,
  facing?: Facing,
): Fixture => ({ kind, x, z, halfX, halfZ, halfHeight, facing });

const RACK_HALF_HEIGHT = 1.1;
export const FIXTURES: Fixture[] = [
  // the corridor: a sealed blast door at its end, a checkpoint barrier
  // narrowing the way in to one lane, a dead vending machine and a bench
  fixture("blastDoor", 0, 2, 2, WALL_HALF, FACILITY_WALL_HALF_HEIGHT),
  fixture("barrier", -1, 15.5, 1, 0.34, 0.4),
  // the corp's supply terminal, where the old vending machine stood: spend quota here between waves
  fixture("supplyTerminal", 1.55, 6.5, 0.45, 0.6, 0.75, "west"),
  fixture("seating", -1.65, 5, 0.35, 1, 0.25, "east"),
  // the lab: two bench islands to duck behind, lockers, a terminal, a fume
  // hood and gas cylinders against the walls, stores by the door
  fixture("bench", -9.5, 7, 2.5, 0.6, 0.45),
  fixture("bench", -9.5, 12.5, 2.5, 0.6, 0.45),
  fixture("lockers", -13.5, 17.55, 2.5, 0.45, 1, "north"),
  fixture("terminal", -5, 2.8, 1.2, 0.5, 0.45, "south"),
  fixture("fumeHood", -16.5, 2.85, 1.2, 0.55, 1.1, "south"),
  fixture("gasRack", -17.6, 14.5, 0.4, 1, 0.8, "east"),
  fixture("crates", -3.6, 17.4, 1, 0.5, 0.5),
  // the passages: each half-blocked, so the way into the core is narrow
  fixture("barrier", -12.7, -1, 1, 0.34, 0.4),
  fixture("crates", 13.1, -2.5, 0.5, 1, 0.5),
  // the server hall: rack rows make aisles, cooling units on the south
  // wall; by the collapse a rack has gone over and rubble has spilled in
  ...[5.5, 8.5, 11.5].map((x) => fixture("rack", x, 7, 0.5, 2.5, RACK_HALF_HEIGHT)),
  ...[5.5, 8.5, 11.5, 14.5].map((x) => fixture("rack", x, 13.25, 0.5, 2.25, RACK_HALF_HEIGHT)),
  fixture("cooler", 8, 17.45, 1.1, 0.55, 1, "north"),
  fixture("cooler", 13.5, 17.45, 1.1, 0.55, 1, "north"),
  fixture("toppledRack", 15.2, 5.4, 1.1, 0.5, 0.3),
  fixture("rubble", 17.1, 9.3, 0.8, 0.7, 0.4),
  // the core: the objective in the middle, its consoles, four pillars for
  // cover, and stores in a corner
  fixture("reactor", 0, -11.5, 2.2, 2.2, 0.9),
  fixture("console", -4.2, -11.5, 0.45, 1.2, 0.5, "east"),
  fixture("console", 4.2, -11.5, 0.45, 1.2, 0.5, "west"),
  ...[
    [-8, -8],
    [8, -8],
    [-8, -15],
    [8, -15],
  ].map(([x, z]) => fixture("pillar", x, z, 0.6, 0.6, FACILITY_WALL_HALF_HEIGHT)),
  fixture("crates", -12.2, -16.5, 1, 1, 0.5),
];

export const REACTOR = FIXTURES.find((f) => f.kind === "reactor")!;
/**
 * The reactor's solid body, for collision. Its footprint above is the
 * whole plinth it stands on (what gets drawn), but the plinth is only
 * knee-high: people stand on its rim to defend the reactor and shoot past
 * it, so only the cylinder in the middle blocks movement and shots.
 */
export const REACTOR_BODY: Obstacle = { x: REACTOR.x, z: REACTOR.z, halfX: 1.5, halfZ: 1.5, halfHeight: REACTOR.halfHeight };

/**
 * The garden's furniture: not the facility's art (the surface has its own,
 * see client/world/surface.ts), but solid all the same.
 */
export type SurfaceKind = "tree" | "target" | "scoreboard" | "bench" | "planter";
export interface SurfaceFixture extends Obstacle {
  kind: SurfaceKind;
}
const sf = (kind: SurfaceKind, x: number, z: number, halfX: number, halfZ: number, halfHeight: number): SurfaceFixture => ({ kind, x, z, halfX, halfZ, halfHeight });
export const SURFACE_FIXTURES: SurfaceFixture[] = [
  // the range, north-west: targets to shoot at from the gun station
  sf("target", -11, S.minZ + 2.6, 0.45, 0.15, 0.8),
  sf("target", -8.5, S.minZ + 1.8, 0.45, 0.15, 0.8),
  sf("target", -6, S.minZ + 2.6, 0.45, 0.15, 0.8),
  // the scoreboard on the north hedge
  sf("scoreboard", 4, S.minZ + 0.45, 1.8, 0.3, 1.4),
  // trees in the corners (only the trunk is solid)
  sf("tree", -11.6, S.maxZ - 1.6, 0.3, 0.3, 1.5),
  sf("tree", 11.4, S.maxZ - 1.8, 0.3, 0.3, 1.5),
  sf("tree", 11.6, S.minZ + 1.5, 0.3, 0.3, 1.5),
  sf("tree", -2.2, S.minZ + 1.2, 0.3, 0.3, 1.5),
  // a bench by the east hedge, planters either side of the lift
  sf("bench", S.maxX - 0.45, S.minZ + 10, 0.35, 1.2, 0.25),
  sf("planter", -4.6, S.maxZ - 0.7, 0.9, 0.5, 0.35),
  sf("planter", 4.6, S.maxZ - 0.7, 0.9, 0.5, 0.35),
];
export const SCOREBOARD = SURFACE_FIXTURES.find((f) => f.kind === "scoreboard")!;
/** how close to stand to read the scoreboard */
export const SCOREBOARD_RANGE = 2.8;

export const OBSTACLES: Obstacle[] = [
  ...WALLS,
  ...LIFT_HOUSE_WALLS,
  ...HEDGES,
  ...FIXTURES.map((f) => (f === REACTOR ? REACTOR_BODY : f)),
  ...SURFACE_FIXTURES,
];

/** how close (centre to centre) a player has to be to switch the reactor on */
export const ACTIVATE_RANGE = REACTOR.halfX + PICKUP_RANGE;

export type ActivateVerdict = "ok" | "too far" | "already active" | "skip break";

/**
 * Shared, so the client's hint says exactly what the server would decide. E
 * at the reactor switches it on; once it's live, the same key sends the
 * next wave early during a break (anyone can, not just whoever started the
 * attempt) and does nothing mid-wave. No empty-hands requirement: that rule
 * dated from click-to-activate, when a click with a gun meant firing, and E
 * has no such conflict.
 */
export function activateVerdict(player: { x: number; z: number }, objective: ObjectiveState, onBreak: boolean): ActivateVerdict {
  if (Math.hypot(player.x - REACTOR.x, player.z - REACTOR.z) > ACTIVATE_RANGE) return "too far";
  if (!objective.active) return "ok";
  return onBreak ? "skip break" : "already active";
}

const SPAWN_Z = S.maxZ - 6;
export type LiftVerdict = "send" | "call" | "too far" | "attempt on" | "busy" | "already leaving";
/** how close to the lift door (outside the car) the call button is */
export const LIFT_CALL_RANGE = 2.5;

/**
 * What the lift button does for this player right now. Shared, so the
 * client's prompt says exactly what the server would decide.
 */
export function liftVerdict(player: { x: number; z: number }, lift: LiftState, objective: ObjectiveState): LiftVerdict {
  const level = levelOf(player.z);
  const door = LIFT_DOORS[level];
  const aboard = inCar(level, player.x, player.z);
  if (!aboard && Math.hypot(player.x - door.x, player.z - door.z) > LIFT_CALL_RANGE) return "too far";
  if (level === "bottom" && objective.active) return "attempt on";
  if (lift.phase !== "open") return "busy";
  if (aboard && lift.at === level) return lift.departAt !== undefined ? "already leaving" : "send";
  if (!aboard && lift.at !== level) return "call";
  return "busy";
}

/**
 * Where boxes can't be put down: the lift car and both its doors (so
 * nobody can wall the lift shut) and the spawn strip (so nobody spawns
 * inside a box). Doorways inside the facility are fair game --- holding a
 * chokepoint is what they're for.
 */
export const NO_BUILD: Rect[] = [
  { minX: -CAR_BOTTOM.maxX - 0.5, maxX: CAR_BOTTOM.maxX + 0.5, minZ: FACILITY_HALF - 2, maxZ: CAR_BOTTOM.maxZ + 1 },
  { minX: -CAR_BOTTOM.maxX - 0.5, maxX: CAR_BOTTOM.maxX + 0.5, minZ: FACILITY_HALF - 2.5 + LIFT_DZ, maxZ: LIFT_CARS.top.maxZ + 1 },
  { minX: -3, maxX: 3, minZ: SPAWN_Z - 1.5, maxZ: SPAWN_Z + 1.5 },
];

/** everyone (re)spawns in the garden, a few steps north of the lift */
export const SPAWN_POINTS: { x: number; z: number }[] = [
  { x: -1.5, z: SPAWN_Z },
  { x: 0, z: SPAWN_Z },
  { x: 1.5, z: SPAWN_Z },
  { x: -0.75, z: SPAWN_Z + 0.8 },
  { x: 0.75, z: SPAWN_Z + 0.8 },
];

/**
 * Tutorial stations in the garden: each keeps one item of its kind lying at
 * its spot, restocking a while after it's taken (up to a world-wide cap,
 * so carrying them off can't flood the map).
 */
export const STATIONS: { kind: ItemKind; x: number; z: number }[] = [
  { kind: "gun", x: -7, z: SPAWN_Z - 1 },
  { kind: "box", x: 7, z: SPAWN_Z - 1 },
];
export const STATION_RESTOCK_MS = 3000;
/** boxes are capped higher than a single attempt needs: they're what carries over between attempts */
export const ITEM_CAPS: Record<ItemKind, number> = { gun: 12, box: 60, turret: 8 };

// The quota: a shared supply credit the corp issues the crew for every wave
// they clear (faster = more), spent at the supply terminal on kit. Shared,
// not per player --- the defences are everyone's, so is what pays for them.
export const SUPPLY_TERMINAL = FIXTURES.find((f) => f.kind === "supplyTerminal")!;
export const BUY_RANGE = 2;
export const TURRET_COST = 40;
/** what clearing a wave pays, before the speed bonus */
export const WAVE_BASE_REWARD = 15;
/** par time per enemy in a wave; every second under par is one more quota */
export const PAR_MS_PER_ENEMY = 2500;
export const waveReward = (size: number, clearMs: number): number =>
  WAVE_BASE_REWARD + Math.max(0, Math.round((size * PAR_MS_PER_ENEMY - clearMs) / 1000));

export type BuyVerdict = "ok" | "too far" | "hands full" | "can't afford" | "sold out";

/** shared, so the terminal's prompt says exactly what the server would decide */
export function buyVerdict(player: { x: number; z: number }, holding: boolean, funds: number, turretsInWorld: number): BuyVerdict {
  const dx = Math.max(0, Math.abs(player.x - SUPPLY_TERMINAL.x) - SUPPLY_TERMINAL.halfX);
  const dz = Math.max(0, Math.abs(player.z - SUPPLY_TERMINAL.z) - SUPPLY_TERMINAL.halfZ);
  if (Math.hypot(dx, dz) > BUY_RANGE) return "too far";
  if (holding) return "hands full";
  if (turretsInWorld >= ITEM_CAPS.turret) return "sold out";
  if (funds < TURRET_COST) return "can't afford";
  return "ok";
}

export const PLAYER_RADIUS = 0.4;
/** walking speed, units/second: the client moves at it and the server won't accept faster */
export const PLAYER_SPEED = 6;

/** a box resting in the world, as an obstacle: it blocks players and projectiles */
export function boxObstacle(item: { x: number; z: number }): Obstacle {
  return { x: item.x, z: item.z, halfX: BOX_HALF_EXTENT, halfZ: BOX_HALF_EXTENT, halfHeight: BOX_HALF_EXTENT };
}

/**
 * What a shot stops at besides walls and boxes: the edge of the world, just
 * past the outer walls. The breaches are open, so without these a shot
 * through one would fly on into nothing.
 */
const EDGE = 0.5;
export const SHOT_BOUNDS: Obstacle[] = [
  { x: 0, z: SIGHT_BOUNDS.minZ - EDGE, halfX: 40, halfZ: EDGE, halfHeight: 2 },
  { x: 0, z: SIGHT_BOUNDS.maxZ + EDGE, halfX: 40, halfZ: EDGE, halfHeight: 2 },
  { x: SIGHT_BOUNDS.minX - EDGE, z: 5, halfX: EDGE, halfZ: 40, halfHeight: 2 },
  { x: SIGHT_BOUNDS.maxX + EDGE, z: 5, halfX: EDGE, halfZ: 40, halfHeight: 2 },
];

/**
 * How far a shot fired from (x, z) along (dirX, dirZ) gets before a wall, a
 * box or the world's edge stops it. Shared so your own shot is drawn
 * stopping exactly where the server will stop it.
 */
export function shotRange(x: number, z: number, dirX: number, dirZ: number, obstacles: Obstacle[]): number {
  if (overlapsAnyObstacle(x, z, PROJECTILE_RADIUS, obstacles)) return 0; // point-blank into a wall
  return rayToObstacles(x, z, dirX, dirZ, [...obstacles, ...SHOT_BOUNDS], PROJECTILE_MAX_RANGE);
}

/** the fixed walls and fixtures plus every box currently sitting on the ground */
export function worldObstacles(items: Iterable<ItemState>): Obstacle[] {
  const result = [...OBSTACLES];
  for (const item of items) {
    if (isBlocking(item)) result.push(boxObstacle(item));
  }
  return result;
}

export function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

export type PlacementVerdict = "ok" | "too far" | "blocked" | "no building here";

/**
 * Whether a box may be put down centered at (x, z), and if not, why: in
 * reach of the placer, somewhere walkable (a room, a doorway, the yard),
 * outside the no-build zones, and not overlapping a wall, fixture, box, or
 * anyone's body. Shared so
 * the client's preview refuses exactly what the server would --- and can
 * say why.
 */
export function placementVerdict(
  x: number,
  z: number,
  placer: { x: number; z: number },
  obstacles: Obstacle[],
  players: { x: number; z: number }[],
): PlacementVerdict {
  if (Math.hypot(x - placer.x, z - placer.z) > PLACE_RANGE) return "too far";
  // the box's own overlap with walls is caught below; this just keeps its
  // centre out of solid structure and off the outdoor margins
  if (!isWalkable(x, z)) return "blocked";
  if (NO_BUILD.some((r) => inRect(r, x, z))) return "no building here";
  for (const obs of obstacles) {
    if (Math.abs(x - obs.x) < obs.halfX + BOX_HALF_EXTENT && Math.abs(z - obs.z) < obs.halfZ + BOX_HALF_EXTENT) {
      return "blocked";
    }
  }
  for (const p of players) {
    const reach = BOX_HALF_EXTENT + PLAYER_RADIUS;
    if (Math.abs(x - p.x) < reach && Math.abs(z - p.z) < reach) return "blocked";
  }
  return "ok";
}

export const DEATH_DURATION_MS = 3000;

// Wounds. A player isn't a health bar: they can take a few hits, and each
// one leaves something you feel rather than a number going down --- the
// first slows you, the second blurs your sight, the third shakes your aim.
// The next hit after that is fatal. Wounds last until you die.

/** hits a player can take and keep going; the one after this kills */
export const MAX_WOUNDS = 3;
/** after a hit, a short grace before the next can land, so a pack can't take you from fine to dead in one bite */
export const WOUND_GRACE_MS = 1000;
/** what each wound adds, in the order they're taken */
export const WOUNDS = [
  { label: "leg hurt: slower" },
  { label: "dazed: vision blurred" },
  { label: "arm hurt: aim shaking" },
] as const;
/** walking speed with this many wounds: the first one costs a quarter */
export const woundedSpeed = (wounds: number): number => PLAYER_SPEED * (wounds >= 1 ? 0.75 : 1);
/** with an arm wound, each shot strays up to this far (radians) either side of where you aim */
export const WOUNDED_AIM_SPREAD = 0.12;

/** a rifle round, fast enough to read as a tracer rather than a ball you could dodge */
export const PROJECTILE_SPEED = 45;
export const PROJECTILE_RADIUS = 0.05;
/** the furthest a shot flies if nothing stops it */
export const PROJECTILE_MAX_RANGE = 40;
export const HIT_RADIUS = PLAYER_RADIUS + PROJECTILE_RADIUS;
/** how far in front of the shooter a shot starts: past their own body, so it can't hit them */
export const MUZZLE_OFFSET = 0.8;

/**
 * How far a ray from (x, z) along (dirX, dirZ) gets before it meets an
 * obstacle (inflated by `radius`), up to `max`. A slab test per box, so a
 * fast shot can't step over a thin wall between ticks.
 */
export function rayToObstacles(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  obstacles: Obstacle[],
  max: number,
  radius = PROJECTILE_RADIUS,
): number {
  let best = max;
  for (const o of obstacles) {
    const minX = o.x - o.halfX - radius;
    const maxX = o.x + o.halfX + radius;
    const minZ = o.z - o.halfZ - radius;
    const maxZ = o.z + o.halfZ + radius;
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dirX) < 1e-9) {
      if (x < minX || x > maxX) continue;
    } else {
      let a = (minX - x) / dirX;
      let b = (maxX - x) / dirX;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    if (Math.abs(dirZ) < 1e-9) {
      if (z < minZ || z > maxZ) continue;
    } else {
      let a = (minZ - z) / dirZ;
      let b = (maxZ - z) / dirZ;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    if (t0 < best) best = t0;
  }
  return best;
}

/**
 * Where along a segment (from distance `from` to `to` on the ray) it first
 * passes within `radius` of point (px, pz), or undefined if it doesn't.
 */
export function segmentHitsCircle(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  from: number,
  to: number,
  px: number,
  pz: number,
  radius: number,
): number | undefined {
  // project the point onto the ray, then step back to where the ray enters the circle
  const fx = px - x;
  const fz = pz - z;
  const along = fx * dirX + fz * dirZ;
  const perp2 = fx * fx + fz * fz - along * along;
  if (perp2 > radius * radius) return undefined;
  const enter = along - Math.sqrt(radius * radius - perp2);
  const t = Math.max(enter, from);
  if (t > to || along + Math.sqrt(radius * radius - perp2) < from) return undefined;
  return t;
}
/** minimum time between shots from one gun-holder: the automatic rifle's rate of fire (~400 rpm) */
export const FIRE_COOLDOWN_MS = 150;

export function clampToPlayBounds(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(PLAY_BOUNDS.maxX, Math.max(PLAY_BOUNDS.minX, x)),
    z: Math.min(PLAY_BOUNDS.maxZ, Math.max(PLAY_BOUNDS.minZ, z)),
  };
}

/**
 * Push (x, z) out of any obstacle it overlaps, treating the player as a
 * circle of radius PLAYER_RADIUS against each obstacle's footprint inflated
 * by that same radius. When inside, it moves to the nearest edge of the
 * inflated box --- the shortest way out --- which handles a point sitting
 * right at an obstacle's center as correctly as one just grazing its side.
 * Run on both client (so movement feels right) and server (so a client
 * can't claim a position inside a wall).
 */
export function resolveObstacles(
  x: number,
  z: number,
  obstacles: Obstacle[] = OBSTACLES,
): { x: number; z: number } {
  let px = x;
  let pz = z;
  // Boxes can sit edge to edge, so pushing out of one can land inside its
  // neighbour; a few passes settles any arrangement a player can build.
  for (let pass = 0; pass < 3; pass++) {
    for (const obs of obstacles) {
      const left = obs.x - obs.halfX - PLAYER_RADIUS;
      const right = obs.x + obs.halfX + PLAYER_RADIUS;
      const near = obs.z - obs.halfZ - PLAYER_RADIUS;
      const far = obs.z + obs.halfZ + PLAYER_RADIUS;
      if (px <= left || px >= right || pz <= near || pz >= far) continue;

      const distances = [px - left, right - px, pz - near, far - pz];
      const closest = Math.min(...distances);
      if (closest === distances[0]) px = left;
      else if (closest === distances[1]) px = right;
      else if (closest === distances[2]) pz = near;
      else pz = far;
    }
  }
  return { x: px, z: pz };
}

export function overlapsAnyObstacle(
  x: number,
  z: number,
  radius: number,
  obstacles: Obstacle[] = OBSTACLES,
): boolean {
  return obstacles.some(
    (obs) =>
      x > obs.x - obs.halfX - radius &&
      x < obs.x + obs.halfX + radius &&
      z > obs.z - obs.halfZ - radius &&
      z < obs.z + obs.halfZ + radius,
  );
}
