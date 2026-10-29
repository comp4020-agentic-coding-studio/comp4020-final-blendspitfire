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
// every cell the step that leads closer. Turrets count as walls in that
// grid, so what players build really does reroute them --- and when a
// turret seals a route completely, enemies stuck against it chew through it.

/**
 * "crawler": the original --- melee, straight at whatever it's after.
 * "spitter": keeps its distance and lobs an acid glob instead of closing
 * in; slower and squishier, so it's a threat from range rather than a
 * tougher wall to shoot through.
 */
export type EnemyKind = "crawler" | "spitter" | "brute" | "runner";

export interface EnemyState {
  id: string;
  kind: EnemyKind;
  x: number;
  z: number;
  rotation: number;
  /** 0..1, for a health bar */
  health: number;
}

/** an acid glob in flight: client draws it travelling from (x, z) to (tx, tz) over (firedAt, arriveAt), then a splash */
export interface SpitState {
  id: string;
  x: number;
  z: number;
  tx: number;
  tz: number;
  firedAt: number;
  arriveAt: number;
}

/** what the reactor has left, which wave is on, and whether it's fighting or between waves; broadcast with the objective */
export interface DefenceState {
  /** 0..1 */
  reactorHealth: number;
  /** waves cleared so far this attempt; the objective is WAVES_TO_WIN of them */
  wave: number;
  /**
   * "spawning": the current wave's enemies are still coming or still alive.
   * "break": cleared, waiting (or sent early) to start the next.
   * "won": every wave cleared: the facility's lit and quiet, and the crew leaves by the blast door and the freight lift (evac).
   * "blackout": the reactor's dead: the lights are out and they keep coming, faster, until nobody's left.
   */
  phase: "spawning" | "break" | "won" | "blackout";
  /** blackout: server time the power went, for how long the crew held out in the dark */
  blackoutAt?: number;
  /** server time the next wave starts (spawning: when the gap ends; break: when it ends, unless the crew votes it in early) */
  nextWaveAt?: number;
  /** break: who's voted ready for the next wave (player ids) */
  ready?: string[];
  /** break: how many votes it takes (everyone alive below) */
  voters?: number;
  /** won: the way out, by blast door and freight lift (server times; see evacStage) */
  evac?: EvacState;
}

// --- The way out after a win ---------------------------------------------------
// Every stage is a server time, so every screen (and the server) reads the
// same stage off the clock. The numbers are the agent's (ADR-060).

export interface EvacState {
  /** the blast door starts to open */
  doorAt: number;
  /** someone started the freight lift: the rest have until boardBy to get on */
  boardBy?: number;
  /** who started it (their name), for the log and the screen */
  startedBy?: string;
  /** boarding's over: anyone not on is put on, the door shuts behind them */
  shutAt?: number;
}
/** from the win to the door starting to move: the lights come up first */
export const EVAC_DOOR_DELAY_MS = 3000;
/** the door grinding open, end to end */
export const EVAC_DOOR_MS = 9000;
/** from the button to the forced boarding */
export const FREIGHT_BOARD_MS = 20000;
/** the door shutting again behind the platform */
export const EVAC_SHUT_MS = 4000;
/** the settlement's pages, played while the platform rises */
export const SETTLE_PAGES_MS = [11000, 13000, 9000] as const;
export const RISE_MS = SETTLE_PAGES_MS.reduce((a, b) => a + b, 0);
/** the screen fading to black at the end of the rise */
export const EVAC_FADE_MS = 2500;
/** the thanks card, on black: a beat of black, the card fades in, holds, fades back to black (THANKS_IN/OUT_MS) */
export const THANKS_MS = 7000;
export const THANKS_BLACK_MS = 800;
export const THANKS_IN_MS = 1200;
export const THANKS_OUT_MS = 1500;

export type EvacStage =
  | { stage: "lights" }
  | { stage: "opening"; k: number }
  | { stage: "open" }
  | { stage: "boarding"; left: number }
  | { stage: "shutting"; k: number }
  /** page 0..2 of the settlement, `k` 0..1 through it; `fade` 0..1 at the end */
  | { stage: "rising"; ms: number; page: number; k: number; fade: number }
  | { stage: "thanks"; k: number }
  | { stage: "done" };

/** where the evacuation stands at server time `now` */
export function evacStage(e: EvacState, now: number): EvacStage {
  if (now < e.doorAt) return { stage: "lights" };
  if (now < e.doorAt + EVAC_DOOR_MS) return { stage: "opening", k: (now - e.doorAt) / EVAC_DOOR_MS };
  if (e.boardBy === undefined) return { stage: "open" };
  if (now < e.boardBy) return { stage: "boarding", left: e.boardBy - now };
  const shutAt = e.shutAt ?? e.boardBy;
  if (now < shutAt + EVAC_SHUT_MS) return { stage: "shutting", k: (now - shutAt) / EVAC_SHUT_MS };
  const rise = now - (shutAt + EVAC_SHUT_MS);
  if (rise < RISE_MS) {
    let page = 0;
    let start = 0;
    while (page < SETTLE_PAGES_MS.length - 1 && rise >= start + SETTLE_PAGES_MS[page]) start += SETTLE_PAGES_MS[page++];
    return { stage: "rising", ms: rise, page, k: (rise - start) / SETTLE_PAGES_MS[page], fade: Math.max(0, 1 - (RISE_MS - rise) / EVAC_FADE_MS) };
  }
  const thanks = rise - RISE_MS;
  if (thanks < THANKS_MS) return { stage: "thanks", k: thanks / THANKS_MS };
  return { stage: "done" };
}
/** how open the blast door is, 0..1, at server time `now` (0 with no evacuation on) */
export function blastDoorOpen(e: EvacState | undefined, now: number): number {
  if (!e) return 0;
  const st = evacStage(e, now);
  if (st.stage === "lights") return 0;
  if (st.stage === "opening") return st.k;
  if (st.stage === "open" || st.stage === "boarding") return 1;
  if (st.stage === "shutting") return 1 - st.k;
  return 0;
}

export const ENEMY_RADIUS = 0.38;
/**
 * Stats are fixed per kind, never scaled by wave: a crawler on wave 10 must
 * be the crawler from wave 1. A tougher enemy has to look different.
 */
export const ENEMY_SPEED = 2.2;
/** rifle rounds to drop one: the rifle fires fast and each round does little */
export const ENEMY_HIT_POINTS = 5;
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
/** hits it takes an enemy to break a turret blocking its way */
export const TURRET_HIT_POINTS = 10;
/**
 * A placed turret fires at the nearest enemy it can see within range, a
 * shot every interval --- slower than a player on full auto, so it holds a
 * lane rather than winning the wave on its own.
 */
export const TURRET_RANGE = 7;
export const TURRET_FIRE_INTERVAL_MS = 450;

/**
 * The objective: clear WAVES_TO_WIN waves. Each wave ends when every enemy
 * in it is down; a WAVE_BREAK_MS breather follows (buy time), then the next
 * wave starts --- sooner if someone sends it early. A failed attempt (the
 * reactor destroyed, or everyone out) starts the wave count again from
 * zero, turrets left standing. Waves grow in size as the count
 * climbs toward the win; six waves to the win (ten was too long in playtest, ADR-060).
 */
export const WAVES_TO_WIN =
  // DEV_WAVES: local testing only (never set in fly.toml), to see a whole run end quickly
  (typeof process !== "undefined" ? Number(process.env?.DEV_WAVES) || 0 : 0) || 6;
export const FIRST_WAVE_DELAY_MS = 10000;
/** the breather between a cleared wave and the next */
export const WAVE_BREAK_MS = 30000;
/** once everyone below is ready, how long until the next wave comes */
export const READY_LEAD_MS = 3000;
/** never more than this many alive at once: the 256 MB machine is the limit */
export const MAX_ENEMIES = 50;
/**
 * How many come in the wave numbered `wave` (1-based): quadratic, so the
 * late waves are a different fight from the early ones (9, 19, 40 at waves
 * 1, 3, 6). Past the last wave it stays at the last wave's size.
 */
export const waveSize = (wave: number): number => {
  const w = Math.min(wave, WAVES_TO_WIN);
  return Math.round(6 + 3 * w + 0.45 * w * w);
};
/**
 * The blackout: once the reactor's dead the breaches never stop. Spawns
 * start at BLACKOUT_SPAWN_MS apart and tighten by a tenth every
 * BLACKOUT_RAMP_MS down to BLACKOUT_SPAWN_MIN_MS, so holding out is a
 * matter of seconds, not something to sit in.
 */
export const BLACKOUT_SPAWN_MS = 600;
export const BLACKOUT_SPAWN_MIN_MS = 150;
export const BLACKOUT_RAMP_MS = 5000;
export const blackoutSpawnInterval = (sinceMs: number): number =>
  Math.max(BLACKOUT_SPAWN_MIN_MS, BLACKOUT_SPAWN_MS * Math.pow(0.9, Math.floor(sinceMs / BLACKOUT_RAMP_MS)));
/** gap between spawns within a wave: tighter as the waves climb */
export const spawnInterval = (wave: number): number => Math.max(250, 700 - 50 * (Math.min(wave, WAVES_TO_WIN) - 1));

// --- The spitter ---------------------------------------------------------------
// Same breaches, same flow field, but it stops short: once a player is in
// sight within SPIT_RANGE it holds there and lobs acid. The glob travels
// (SPIT_SPEED), so stepping aside dodges it; it lands where the target
// stood when it was thrown. Waves keep their size: from SPITTER_FROM_WAVE a
// growing share of each wave are spitters instead of crawlers.

export const SPITTER_HIT_POINTS = 3;
export const SPITTER_SPEED_FACTOR = 0.8;
export const SPIT_RANGE = 6.5;
/** it won't spit from closer than this: it backs off instead, so it never just melees */
export const SPIT_MIN_RANGE = 3;
export const SPIT_INTERVAL_MS = 2200;
export const SPIT_SPEED = 9;
/** a glob landing within this of a player wounds them */
export const SPIT_SPLASH = 0.7;
export const SPITTER_FROM_WAVE = 3;
/** share of a wave that's spitters: none before SPITTER_FROM_WAVE, then climbing to a third */
export const spitterShare = (wave: number): number =>
  wave < SPITTER_FROM_WAVE ? 0 : Math.min(0.33, 0.1 + 0.04 * (Math.min(wave, WAVES_TO_WIN) - SPITTER_FROM_WAVE));

// --- The elites ----------------------------------------------------------------
// With a full crew one person can camp each breach and a wave melts
// (ADR-060). Two elites break that up, each strong in one way and each
// plainly a different animal (ADR-053: a kind's stats never change, so
// tougher has to look it). The brute is a big plated thing that soaks a
// breach-camper's fire; the runner is thin and quick and gets past one.

export const BRUTE_HIT_POINTS = 15;
export const BRUTE_SPEED_FACTOR = 0.7;
/** drawn this much bigger than a crawler (its body still fits the same corridors) */
export const BRUTE_SCALE = 1.35;
export const RUNNER_HIT_POINTS = 3;
export const RUNNER_SPEED_FACTOR = 1.7;
export const ELITE_FROM_WAVE = 3;
/** share of a wave that's elites (half brutes, half runners): none before ELITE_FROM_WAVE, then about a tenth climbing to a quarter by the last wave */
export const eliteShare = (wave: number): number => {
  if (wave < ELITE_FROM_WAVE) return 0;
  const k = WAVES_TO_WIN > ELITE_FROM_WAVE ? (Math.min(wave, WAVES_TO_WIN) - ELITE_FROM_WAVE) / (WAVES_TO_WIN - ELITE_FROM_WAVE) : 1;
  return 0.1 + 0.15 * k;
};

const HIT_POINTS: Record<EnemyKind, number> = {
  crawler: ENEMY_HIT_POINTS,
  spitter: SPITTER_HIT_POINTS,
  brute: BRUTE_HIT_POINTS,
  runner: RUNNER_HIT_POINTS,
};
const SPEED_FACTOR: Record<EnemyKind, number> = { crawler: 1, spitter: SPITTER_SPEED_FACTOR, brute: BRUTE_SPEED_FACTOR, runner: RUNNER_SPEED_FACTOR };
export const hitPointsOf = (kind: EnemyKind): number => HIT_POINTS[kind];
export const speedOf = (kind: EnemyKind): number => ENEMY_SPEED * SPEED_FACTOR[kind];

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
  private goal?: { x: number; z: number };

  /**
   * Rebuild for this set of obstacles (walls, fixtures, turrets); cheap
   * enough to run whenever a turret goes up or comes down. Leads to the reactor, or to `goal`
   * when given (the blackout's hunt for whoever's left).
   */
  build(obstacles: Obstacle[], goal?: { x: number; z: number }): void {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const [x, z] = centreOf(c, r);
        // enemies stay in the facility, never the lift or the surface
        const inSafeRoom = isSafe(x, z);
        this.open[r * COLS + c] = isWalkable(x, z) && !inSafeRoom && !overlapsAnyObstacle(x, z, ENEMY_RADIUS * 0.9, obstacles) ? 1 : 0;
      }
    }
    this.goal = goal;
    this.dist.fill(UNREACHED);
    // seed: every open cell touching the reactor's footprint (or right by the goal)
    const queue: number[] = [];
    const reach = ENEMY_REACH + ENEMY_RADIUS;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!this.open[r * COLS + c]) continue;
        const [x, z] = centreOf(c, r);
        const seed = goal
          ? Math.hypot(x - goal.x, z - goal.z) < CELL * 1.5
          : Math.abs(x - REACTOR.x) < REACTOR_BODY.halfX + reach && Math.abs(z - REACTOR.z) < REACTOR_BODY.halfZ + reach;
        if (seed) {
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
   * (sealed in by turrets) --- the caller then heads straight for the reactor
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
      if (here === 0) return this.goal ? { dx: this.goal.x - x, dz: this.goal.z - z } : { dx: REACTOR.x - x, dz: REACTOR.z - z };
      return undefined;
    }
    const [tx, tz] = centreOf(bc, br);
    return { dx: tx - x, dz: tz - z };
  }
}
