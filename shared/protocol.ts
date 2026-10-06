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
}

export interface MoveMessage {
  type: "move";
  x: number;
  z: number;
  rotation: number;
}

export interface ShootMessage {
  type: "shoot";
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  x: number;
  z: number;
}

export type ServerMessage = WelcomeMessage | StateMessage;
export type ClientMessage = MoveMessage | ShootMessage;

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
export function resolveObstacles(x: number, z: number): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const obs of OBSTACLES) {
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
  return { x: px, z: pz };
}

export function overlapsAnyObstacle(x: number, z: number, radius: number): boolean {
  return OBSTACLES.some(
    (obs) =>
      x > obs.x - obs.halfExtent - radius &&
      x < obs.x + obs.halfExtent + radius &&
      z > obs.z - obs.halfExtent - radius &&
      z < obs.z + obs.halfExtent + radius,
  );
}
