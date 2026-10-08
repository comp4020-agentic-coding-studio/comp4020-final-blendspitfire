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

export const WORLD_BOUNDS = 18;
export const BROADCAST_INTERVAL_MS = 66;
export const PERSIST_INTERVAL_MS = 1000;

export interface Obstacle {
  x: number;
  z: number;
  /** half the box's footprint in both X and Z */
  halfExtent: number;
  /** half the box's height; also its center's Y position */
  halfHeight: number;
}

export const OBSTACLES: Obstacle[] = [
  { x: 6, z: 4, halfExtent: 1, halfHeight: 1 },
  { x: -7, z: -3, halfExtent: 1, halfHeight: 1.5 },
  { x: 3, z: -8, halfExtent: 1, halfHeight: 0.8 },
  { x: -4, z: 7, halfExtent: 1, halfHeight: 1 },
];

export const PLAYER_RADIUS = 0.4;

/** a box resting in the world, as an obstacle: it blocks players and projectiles */
export function boxObstacle(item: { x: number; z: number }): Obstacle {
  return { x: item.x, z: item.z, halfExtent: BOX_HALF_EXTENT, halfHeight: BOX_HALF_EXTENT };
}

/** the fixed terrain plus every box currently sitting on the ground */
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

/**
 * Whether a box may be put down centered at (x, z): in reach of the placer,
 * inside the world, and not overlapping terrain, another box, or any
 * player's body. Shared so the client's preview turns red for exactly the
 * spots the server would refuse.
 */
export function canPlaceBox(
  x: number,
  z: number,
  placer: { x: number; z: number },
  obstacles: Obstacle[],
  players: { x: number; z: number }[],
): boolean {
  if (Math.hypot(x - placer.x, z - placer.z) > PLACE_RANGE) return false;
  const limit = WORLD_BOUNDS - BOX_HALF_EXTENT;
  if (Math.abs(x) > limit || Math.abs(z) > limit) return false;
  for (const obs of obstacles) {
    const reach = obs.halfExtent + BOX_HALF_EXTENT;
    if (Math.abs(x - obs.x) < reach && Math.abs(z - obs.z) < reach) return false;
  }
  for (const p of players) {
    const reach = BOX_HALF_EXTENT + PLAYER_RADIUS;
    if (Math.abs(x - p.x) < reach && Math.abs(z - p.z) < reach) return false;
  }
  return true;
}

export const SPAWN_POINTS: { x: number; z: number }[] = [
  { x: 0, z: 0 },
  { x: 12, z: 12 },
  { x: -12, z: 12 },
  { x: 12, z: -12 },
  { x: -12, z: -12 },
];

export const DEATH_DURATION_MS = 3000;

export const PROJECTILE_SPEED = 14;
export const PROJECTILE_RADIUS = 0.15;
export const PROJECTILE_MAX_BOUNCES = 4;
export const PROJECTILE_TTL_MS = 6000;
export const HIT_RADIUS = PLAYER_RADIUS + PROJECTILE_RADIUS + 0.1;

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
      const left = obs.x - obs.halfExtent - PLAYER_RADIUS;
      const right = obs.x + obs.halfExtent + PLAYER_RADIUS;
      const near = obs.z - obs.halfExtent - PLAYER_RADIUS;
      const far = obs.z + obs.halfExtent + PLAYER_RADIUS;
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
      x > obs.x - obs.halfExtent - radius &&
      x < obs.x + obs.halfExtent + radius &&
      z > obs.z - obs.halfExtent - radius &&
      z < obs.z + obs.halfExtent + radius,
  );
}
