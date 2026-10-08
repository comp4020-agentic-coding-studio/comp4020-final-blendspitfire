export interface PlayerState {
  id: string;
  color: string;
  x: number;
  z: number;
  rotation: number;
  /** wire-only: set while dead, the timestamp (Date.now()-scale) they respawn at */
  respawnAt?: number;
  /** wire-only: in-memory for the current connection, not persisted */
  score?: number;
}

export interface WelcomeMessage {
  type: "welcome";
  you: PlayerState;
  players: PlayerState[];
}

export interface StateMessage {
  type: "state";
  players: PlayerState[];
  projectiles: ProjectileState[];
  items: ItemState[];
}

export interface MoveMessage {
  type: "move";
  x: number;
  z: number;
  rotation: number;
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

export interface ProjectileState {
  id: string;
  ownerId: string;
  x: number;
  z: number;
}

export type ServerMessage = WelcomeMessage | StateMessage;
export type ClientMessage = MoveMessage | PickupMessage | PrimaryMessage | DropMessage;

/**
 * Every pickup-able thing in the world is one of these: same shape, same
 * pickup/drop rules, differing only in what its primary (and optional
 * secondary) action does. The "equipment slot" is just `heldBy` --- a
 * player holds at most one item, and nothing on screen shows a slot.
 */
export type ItemKind = "gun" | "box";

export interface ItemState {
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
  /** id of the player holding it; absent while it's lying in the world */
  heldBy?: string;
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
};

/** how far (center to center) a player can reach to pick something up */
export const PICKUP_RANGE = 2.2;
/** how far from the player a box can be put down */
export const PLACE_RANGE = 3.5;
export const BOX_HALF_EXTENT = 0.5;
export const GRID_SIZE = 1;

export const BROADCAST_INTERVAL_MS = 66;
export const PERSIST_INTERVAL_MS = 1000;

// --- World layout ----------------------------------------------------------
// A square arena with a walled yard off its south side (screen-down, +Z),
// joined by a door in the arena's south wall. Every player spawns and
// respawns in the yard, where the floor teaches the controls and firing is
// off; the door leads up into the arena.

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const ARENA_HALF = 18;
export const ARENA: Rect = { minX: -ARENA_HALF, maxX: ARENA_HALF, minZ: -ARENA_HALF, maxZ: ARENA_HALF };
const WALL_HALF = 0.3;
/** the yard's open interior (inside its walls) */
export const YARD: Rect = { minX: -7, maxX: 7, minZ: ARENA_HALF + 2 * WALL_HALF, maxZ: 28 };
export const DOOR_HALF_WIDTH = 2;
/** everything anyone can stand in; movement is clamped to it before walls */
export const PLAY_BOUNDS: Rect = { minX: ARENA.minX, maxX: ARENA.maxX, minZ: ARENA.minZ, maxZ: YARD.maxZ };

export const inRect = (r: Rect, x: number, z: number, margin = 0): boolean =>
  x >= r.minX + margin && x <= r.maxX - margin && z >= r.minZ + margin && z <= r.maxZ - margin;

/** the gap in the arena's south wall */
export const DOOR: Rect = {
  minX: -DOOR_HALF_WIDTH,
  maxX: DOOR_HALF_WIDTH,
  minZ: ARENA_HALF,
  maxZ: ARENA_HALF + 2 * WALL_HALF,
};

/**
 * Somewhere a player can actually be: the arena, the yard, or the doorway
 * between. The play bounds' outer corners (beside the yard, outside its
 * walls) are not.
 */
export const isWalkable = (x: number, z: number): boolean =>
  inRect(ARENA, x, z) || inRect(YARD, x, z) || inRect(DOOR, x, z);

/** the yard, counted from the middle of the doorway so the door is a clean line */
export const isInYard = (x: number, z: number): boolean =>
  x > YARD.minX - WALL_HALF && x < YARD.maxX + WALL_HALF && z > ARENA_HALF + WALL_HALF;

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

export type ObstacleKind = "wall" | "rock";

const WALL_HALF_HEIGHT = 0.4;
const wallBetween = (x1: number, z1: number, x2: number, z2: number): Obstacle => ({
  x: (x1 + x2) / 2,
  z: (z1 + z2) / 2,
  halfX: Math.max(WALL_HALF, Math.abs(x2 - x1) / 2),
  halfZ: Math.max(WALL_HALF, Math.abs(z2 - z1) / 2),
  halfHeight: WALL_HALF_HEIGHT,
});

const A = ARENA_HALF + WALL_HALF; // arena wall centre line
const Y = YARD.maxX + WALL_HALF; // yard side wall centre line
export const WALLS: Obstacle[] = [
  wallBetween(-A - WALL_HALF, -A, A + WALL_HALF, -A), // north
  wallBetween(-A, -A, -A, A), // west
  wallBetween(A, -A, A, A), // east
  wallBetween(-A - WALL_HALF, A, -DOOR_HALF_WIDTH, A), // south, left of the door
  wallBetween(DOOR_HALF_WIDTH, A, A + WALL_HALF, A), // south, right of the door
  wallBetween(-Y, A + WALL_HALF, -Y, YARD.maxZ + 2 * WALL_HALF), // yard west
  wallBetween(Y, A + WALL_HALF, Y, YARD.maxZ + 2 * WALL_HALF), // yard east
  wallBetween(-Y - WALL_HALF, YARD.maxZ + WALL_HALF, Y + WALL_HALF, YARD.maxZ + WALL_HALF), // yard south
];

/** the arena's fixed rocks */
export const ROCKS: Obstacle[] = [
  { x: 6, z: 4, halfX: 1, halfZ: 1, halfHeight: 1 },
  { x: -7, z: -3, halfX: 1, halfZ: 1, halfHeight: 1.5 },
  { x: 3, z: -8, halfX: 1, halfZ: 1, halfHeight: 0.8 },
  { x: -4, z: 7, halfX: 1, halfZ: 1, halfHeight: 1 },
];

export const OBSTACLES: Obstacle[] = [...WALLS, ...ROCKS];

/**
 * Where boxes can't be put down: the doorway (so nobody can wall the yard
 * shut) and the spawn strip (so nobody spawns inside a box).
 */
export const NO_BUILD: Rect[] = [
  { minX: -DOOR_HALF_WIDTH - 0.5, maxX: DOOR_HALF_WIDTH + 0.5, minZ: ARENA_HALF - 2, maxZ: ARENA_HALF + 2.5 },
  { minX: -3.5, maxX: 3.5, minZ: 25.5, maxZ: YARD.maxZ },
];

export const SPAWN_POINTS: { x: number; z: number }[] = [
  { x: -2, z: 26.5 },
  { x: 0, z: 26.5 },
  { x: 2, z: 26.5 },
  { x: -1, z: 27.3 },
  { x: 1, z: 27.3 },
];

/**
 * Tutorial stations in the yard: each keeps one item of its kind lying at
 * its spot, restocking a while after it's taken (up to a world-wide cap,
 * so carrying them off can't flood the map).
 */
export const STATIONS: { kind: ItemKind; x: number; z: number }[] = [
  { kind: "gun", x: -4.5, z: 22 },
  { kind: "box", x: 4.5, z: 22 },
];
export const STATION_RESTOCK_MS = 3000;
export const ITEM_CAPS: Record<ItemKind, number> = { gun: 12, box: 30 };

export const PLAYER_RADIUS = 0.4;

/** a box resting in the world, as an obstacle: it blocks players and projectiles */
export function boxObstacle(item: { x: number; z: number }): Obstacle {
  return { x: item.x, z: item.z, halfX: BOX_HALF_EXTENT, halfZ: BOX_HALF_EXTENT, halfHeight: BOX_HALF_EXTENT };
}

/** the fixed walls and rocks plus every box currently sitting on the ground */
export function worldObstacles(items: Iterable<ItemState>): Obstacle[] {
  const result = [...OBSTACLES];
  for (const item of items) {
    if (item.kind === "box" && item.heldBy === undefined) result.push(boxObstacle(item));
  }
  return result;
}

export function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

export type PlacementVerdict = "ok" | "too far" | "blocked" | "no building here";

/**
 * Whether a box may be put down centered at (x, z), and if not, why: in
 * reach of the placer, inside the arena or yard, outside the no-build
 * zones, and not overlapping a wall, rock, box, or anyone's body. Shared so
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
  if (!inRect(ARENA, x, z, BOX_HALF_EXTENT) && !inRect(YARD, x, z, BOX_HALF_EXTENT)) return "blocked";
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

export const PROJECTILE_SPEED = 14;
export const PROJECTILE_RADIUS = 0.15;
export const PROJECTILE_MAX_BOUNCES = 4;
export const PROJECTILE_TTL_MS = 6000;
export const HIT_RADIUS = PLAYER_RADIUS + PROJECTILE_RADIUS + 0.1;
/** minimum time between shots from one gun-holder */
export const FIRE_COOLDOWN_MS = 250;

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
