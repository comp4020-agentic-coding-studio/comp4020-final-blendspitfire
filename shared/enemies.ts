import {
  BREACHES,
  FACILITY_HALF,
  REACTOR,
  REACTOR_BODY,
  isSafe,
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

/** what the reactor has left, which wave is on, and whether it's fighting or between waves; broadcast with the objective */
export interface DefenceState {
  /** 0..1 */
  reactorHealth: number;
  /** waves cleared so far this attempt; the objective is WAVES_TO_WIN of them */
  wave: number;
  /** "spawning": the current wave's enemies are still coming or still alive. "break": cleared, waiting (or voted) to start the next */
  phase: "spawning" | "break";
  /** server time the next wave starts (spawning: when the gap ends; break: when it ends, unless skipped) */
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
/**
 * Choosing a target. An enemy goes for the reactor unless a player is the
 * better target: one it can see and walk straight at within AGGRO_RANGE.
 * It keeps after them out to LEASH_RANGE, and if they break line of sight
 * it searches where they were last seen for SEARCH_MS before going back to
 * the reactor. One already at the reactor stays on it: a player walking
 * past can't pull the whole pack off. Targets are re-picked every THINK_MS.
 */
export const AGGRO_RANGE = 6;
export const LEASH_RANGE = 10;
export const SEARCH_MS = 2000;
export const THINK_MS = 400;
/** within this of the reactor's footprint an enemy is committed to it */
export const REACTOR_COMMIT = 2.5;
/** hits it takes an enemy to break a box blocking its way */
export const BOX_HIT_POINTS = 6;

/**
 * The objective: clear WAVES_TO_WIN waves. Each wave ends when every enemy
 * in it is down; a WAVE_BREAK_MS breather follows (buy time), then the next
 * wave starts --- sooner if someone sends it early. A failed attempt (the
 * reactor destroyed, or everyone out) starts the wave count again from
 * zero, boxes and turrets left standing. Waves grow in size as the count
 * climbs toward the win; tuned so a run takes a dozen or so attempts, the
 * defences piling up from one to the next.
 */
export const WAVES_TO_WIN =
  // DEV_WAVES: local testing only (never set in fly.toml), to see a whole run end quickly
  (typeof process !== "undefined" ? Number(process.env?.DEV_WAVES) || 0 : 0) || 10;
export const FIRST_WAVE_DELAY_MS = 10000;
/** the breather between a cleared wave and the next */
export const WAVE_BREAK_MS = 30000;
/** never more than this many alive at once: the 256 MB machine is the limit */
export const MAX_ENEMIES = 40;
/** how many come in the wave numbered `wave` (1-based), scaled by how close that is to the win */
export const waveSize = (wave: number): number => Math.round(4 + 22 * Math.min(1, wave / WAVES_TO_WIN));
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
        // enemies stay in the facility, never the lift or the surface
        const inSafeRoom = isSafe(x, z);
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
