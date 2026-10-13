import {
  BREACHES,
  FACILITY_HALF,
  REACTOR,
  REACTOR_BODY,
  YARD,
  isWalkable,
  overlapsAnyObstacle,
  type Breach,
  type Obstacle,
} from "./protocol.ts";

// The "defend" half of the loop. Once the reactor is live, enemies come in
// through the breaches in waves and make for it. The server simulates
// them; clients only draw what it sends.
//
// They find their way with a flow field: one breadth-first search outward
// from the reactor over a grid of the facility's walkable floor, giving
// every cell the step that leads closer. Boxes count as walls in that
// grid, so what players build really does reroute them --- and when a
// box seals a route completely, enemies stuck against it chew through it.

export interface EnemyState {
  id: string;
  x: number;
  z: number;
  rotation: number;
  /** 0..1, for a health bar */
  health: number;
}

/** what the reactor has left, and which wave is on; broadcast with the objective */
export interface DefenceState {
  /** 0..1 */
  reactorHealth: number;
  wave: number;
  /** server time the next wave starts, while waiting between waves */
  nextWaveAt?: number;
}

export const ENEMY_RADIUS = 0.38;
export const ENEMY_SPEED = 2.2;
export const ENEMY_HIT_POINTS = 3;
/** how close (centre to the reactor's footprint edge, or to a player) an enemy attacks from */
export const ENEMY_REACH = 0.7;
export const ENEMY_ATTACK_INTERVAL_MS = 900;
/**
 * damage to the reactor per hit, as a share of its total: a whole early
 * wave chewing on it unopposed takes it down in about half a minute, so a
 * wave left alone loses the round but a defended one doesn't
 */
export const ENEMY_REACTOR_DAMAGE = 0.007;
/** hits it takes an enemy to break a box blocking its way */
export const BOX_HIT_POINTS = 6;

export const FIRST_WAVE_DELAY_MS = 10000;
export const WAVE_GAP_MS = 15000;
/** never more than this many alive at once: the 256 MB machine is the limit */
export const MAX_ENEMIES = 40;
/** how many come in wave n (1-based) */
export const waveSize = (n: number): number => Math.min(3 + n * 2, 30);
/** gap between spawns within a wave */
export const SPAWN_INTERVAL_MS = 700;

/** where enemies come in: just inside each breach */
export function breachSpawn(b: Breach): { x: number; z: number } {
  if (b.side === "west") return { x: -FACILITY_HALF + 0.8, z: b.z };
  if (b.side === "east") return { x: FACILITY_HALF - 0.8, z: b.z };
  return { x: b.x, z: -FACILITY_HALF + 0.8 };
}
export const SPAWNS = BREACHES.map(breachSpawn);

// --- The flow field ----------------------------------------------------------

const CELL = 0.5;
const MIN_X = -FACILITY_HALF;
const MIN_Z = -FACILITY_HALF;
const COLS = Math.round((FACILITY_HALF * 2) / CELL);
const ROWS = Math.round((FACILITY_HALF * 2) / CELL);
const UNREACHED = 0xffff;

const cellOf = (x: number, z: number): [number, number] => [
  Math.floor((x - MIN_X) / CELL),
  Math.floor((z - MIN_Z) / CELL),
];
const centreOf = (c: number, r: number): [number, number] => [MIN_X + (c + 0.5) * CELL, MIN_Z + (r + 0.5) * CELL];

/** eight neighbours; diagonals only when both sides are open, so nothing cuts a corner through a wall */
const STEPS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class FlowField {
  /** distance (in steps) from the reactor for every cell, UNREACHED where blocked */
  private readonly dist = new Uint16Array(COLS * ROWS);
  private readonly open = new Uint8Array(COLS * ROWS);

  /** rebuild for this set of obstacles (walls, fixtures, boxes); cheap enough to run whenever a box moves */
  build(obstacles: Obstacle[]): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const [x, z] = centreOf(c, r);
        // enemies stay in the facility, never the safe room
        const inSafeRoom = z > YARD.minZ - 0.4;
        this.open[r * COLS + c] = isWalkable(x, z) && !inSafeRoom && !overlapsAnyObstacle(x, z, ENEMY_RADIUS * 0.9, obstacles) ? 1 : 0;
      }
    }
    this.dist.fill(UNREACHED);
    // seed: every open cell touching the reactor's footprint
    const queue: number[] = [];
    const reach = ENEMY_REACH + ENEMY_RADIUS;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!this.open[r * COLS + c]) continue;
        const [x, z] = centreOf(c, r);
        if (Math.abs(x - REACTOR.x) < REACTOR_BODY.halfX + reach && Math.abs(z - REACTOR.z) < REACTOR_BODY.halfZ + reach) {
          this.dist[r * COLS + c] = 0;
          queue.push(r * COLS + c);
        }
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const c = i % COLS;
      const r = (i - c) / COLS;
      for (const [dc, dr] of STEPS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const j = nr * COLS + nc;
        if (!this.open[j] || this.dist[j] !== UNREACHED) continue;
        if (dc && dr && (!this.open[r * COLS + nc] || !this.open[nr * COLS + c])) continue;
        this.dist[j] = this.dist[i] + 1;
        queue.push(j);
      }
    }
  }

  /** whether there's any route from (x, z) to the reactor */
  reachable(x: number, z: number): boolean {
    const [c, r] = cellOf(x, z);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    return this.dist[r * COLS + c] !== UNREACHED;
  }

  /**
   * Which way to walk from (x, z) to get closer to the reactor: toward the
   * centre of the best neighbouring cell. Undefined when there's no route
   * (sealed in by boxes) --- the caller then heads straight for the reactor
   * and chews through whatever's in the way.
   */
  direction(x: number, z: number): { dx: number; dz: number } | undefined {
    const [c, r] = cellOf(x, z);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return undefined;
    const here = this.dist[r * COLS + c];
    let best = here;
    let bc = -1;
    let br = -1;
    for (const [dc, dr] of STEPS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const d = this.dist[nr * COLS + nc];
      if (d === UNREACHED || d >= best) continue;
      if (dc && dr && (!this.open[r * COLS + nc] || !this.open[nr * COLS + c])) continue;
      best = d;
      bc = nc;
      br = nr;
    }
    if (bc < 0) {
      if (here === 0) return { dx: REACTOR.x - x, dz: REACTOR.z - z };
      return undefined;
    }
    const [tx, tz] = centreOf(bc, br);
    return { dx: tx - x, dz: tz - z };
  }
}
