import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  bumpStats,
  clearItems,
  loadDefence,
  loadItems,
  loadObjective,
  loadOrCreatePlayer,
  loadPlayer,
  loadRun,
  loadFunds,
  saveFunds,
  loadGore,
  saveGore,
  recentRuns,
  recordRun,
  saveRun,
  saveWorld,
  savePlayer,
  topStats,
} from "./db.ts";
import { Defence } from "./defence.ts";
import { Lift } from "./lift.ts";
import { Tutorial } from "./tutorial.ts";
import {
  HELI_RIDE_MS,
  LESSONS,
  TUT_SPAWN,
  heliDestination,
  inTutorial,
  padAt,
  shutTutDoors,
} from "../shared/tutorial.ts";
import { PLAYER_COLORS, codename } from "../shared/palette.ts";
import {
  BROADCAST_INTERVAL_MS,
  DEATH_DURATION_MS,
  FIRE_COOLDOWN_MS,
  HIT_RADIUS,
  FRIENDLY_FIRE,
  MUZZLE_OFFSET,
  shotRange,
  segmentHitsCircle,
  ITEM_CAPS,
  OBSTACLES,
  PERSIST_INTERVAL_MS,
  PICKUP_RANGE,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PLAY_BOUNDS,
  MAX_WOUNDS,
  SPAWN_POINTS,
  WOUND_GRACE_MS,
  woundedSpeed,
  STATIONS,
  STATION_RESTOCK_MS,
  activateVerdict,
  clampToPlayBounds,
  inAnyCar,
  inCar,
  inRect,
  isSafe,
  isWalkable,
  levelOf,
  liftVerdict,
  noFireAt,
  LIFT_DZ,
  FACILITY_HALF,
  type LiftLevel,
  obstaclesFor,
  overlapsAnyObstacle,
  placementVerdict,
  resolveObstacles,
  worldObstacles,
  BLOCKING_KINDS,
  BOX_HALF_EXTENT,
  SHOP,
  TURRET_COST,
  GRENADE_DAMAGE,
  GRENADE_FLIGHT_MS,
  GRENADE_FUSE_MS,
  GRENADE_RADIUS,
  grenadeLanding,
  type GrenadeState,
  buyVerdict,
  buildTurretVerdict,
  scrapVerdict,
  waveReward,
  PAR_MS_PER_ENEMY,
  WAVE_BASE_REWARD,
  WIPE_HOLD_MS,
  type Report,
  capGore,
  type GoreMark,
  type ClientMessage,
  type ObjectiveState,
  type ItemKind,
  type ItemState,
  type MoveMessage,
  type Obstacle,
  type PlayerState,
  type ProjectileState,
  type ServerMessage,
} from "../shared/protocol.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * package.json's version plus the running commit's short hash, so the UI can
 * show at a glance whether a deploy actually picked up the latest code.
 * Falls back to just the package version if there's no .git (the built
 * Docker image doesn't carry one: baked in at build time instead, below).
 */
const VERSION: string = (() => {
  const pkgVersion = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).version as string;
  const bakedSha = process.env.GIT_SHA;
  if (bakedSha) return `${pkgVersion}-${bakedSha}`;
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8" }).trim();
    return `${pkgVersion}-${sha}`;
  } catch {
    return pkgVersion;
  }
})();

const readmePage = (): string => {
  const body = escapeHtml(readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8"));
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About</title>
  </head>
  <body>
    <main>
      <h1>About</h1>
      <pre>${body}</pre>
    </main>
  </body>
</html>
`;
};

function parsePlayerId(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === "playerId" && value) return value;
  }
  return undefined;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/readme/" || url.pathname === "/readme") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readmePage());
    return;
  }

  let filePath: string;
  if (url.pathname === "/") {
    filePath = join(PUBLIC_DIR, "index.html");
  } else {
    filePath = join(PUBLIC_DIR, url.pathname);
  }

  readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    // No build-time versioning on bundle.js's filename, so without this a
    // returning visitor's browser can silently keep serving last week's
    // script instead of fetching what's actually deployed now.
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    // the version is in the page itself, so it shows before (and without) a connection
    res.end(filePath.endsWith("index.html") ? data.toString("utf8").replace('<div id="version"></div>', `<div id="version">${escapeHtml(VERSION)}</div>`) : data);
  });
});

// no client message is more than a few hundred bytes: cap frames well below
// ws's 100 MB default so one connection can't exhaust a 256 MB machine
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4 * 1024 });
// same for the listener itself and for malformed HTTP (port scanners,
// half-open connections): log and carry on, never crash the shared world
wss.on("error", (err) => console.error("ws server error:", err.message));
server.on("clientError", (_err, sock) => sock.destroy());

interface Connection {
  socket: WebSocket;
  player: PlayerState;
  dirty: boolean;
  /**
   * 0 while alive; otherwise the Date.now()-scale timestamp they respawn
   * at, or Infinity if they're out until the current attempt ends
   */
  deadUntil: number;
  /** in-memory only: resets to 0 on every (re)connect, never persisted */
  score: number;
  lastFireAt: number;
  /** bumped whenever the server moves them (respawn, lift ride): moves stamped with an older one are dropped */
  warp: number;
  /** wounds taken since the last (re)spawn; in memory only */
  wounds: number;
  /** patched up at the terminal with this many wounds: the next hit puts them straight back (0 = not bandaged) */
  bandaged: number;
  /** no further wound lands before this (Date.now()-scale) */
  woundGraceUntil: number;
  /** when their last move was accepted, for the speed check */
  lastMoveAt: number;
  /** has been sent the full item list at least once (see StateMessage.items) */
  hasItems: boolean;
  /** message rate limiting: the current one-second window and how many it's had */
  windowStart: number;
  windowCount: number;
  /** when each kind of refusal may next be logged (see refuse) */
  refusalLoggedAt: Map<string, number>;
  /** shots fired and enemies killed since the last shot line in the log */
  shots: number;
  kills: number;
  /** riding a helicopter: when the ride ends and where it puts them (0 = not flying) */
  flyingUntil: number;
  flyTo?: { x: number; z: number; to: string };
}

/** an honest client sends a move ~20 times a second plus the odd action */
const MAX_MESSAGES_PER_SECOND = 60;
/** packets can arrive bunched after a stall: allow up to this long's worth of walking in one move */
const MOVE_BURST_S = 0.5;
/** and a margin over walking speed, for timing jitter */
const MOVE_SLACK = 1.5;

const connections = new Map<string, Connection>();

/**
 * The action log: one line per thing a player did or was refused, named by
 * the codename they see on screen, so `flyctl logs` tells people apart.
 */
function act(player: { id: string; color: string }, what: string): void {
  console.log(`[${codename(player)}] ${what}`);
}
const pos = (x: number, z: number): string => `(${x.toFixed(1)}, ${z.toFixed(1)})`;
const shortId = (id: string): string => id.slice(0, 6);

/**
 * Wounds and being out belong to the attempt, not the connection: someone
 * who leaves mid-attempt and comes back gets them back, rather than a fresh
 * body. Cleared when the attempt ends.
 */
const carried = new Map<string, { wounds: number; bandaged: number; out: boolean }>();

/**
 * A refused action is logged too --- it's the server holding a line --- but
 * at most once per player per kind every few seconds, so a broken or
 * hostile client can't bury everyone else's lines.
 */
const REFUSAL_LOG_GAP_MS = 3000;
function refuse(conn: Connection, kind: string, what: string): void {
  const now = Date.now();
  if (now < (conn.refusalLoggedAt.get(kind) ?? 0)) return;
  conn.refusalLoggedAt.set(kind, now + REFUSAL_LOG_GAP_MS);
  act(conn.player, what);
}

/** shots are too many for a line each: each player's are summed and logged every few seconds */
const SHOT_LOG_EVERY_MS = 5000;
function flushShots(conn: Connection): void {
  if (conn.shots === 0) return;
  act(conn.player, `fired ${conn.shots} shot(s): ${conn.kills} kill(s)`);
  conn.shots = 0;
  conn.kills = 0;
}

// The world --- items and the reactor --- is saved to SQLite (server/db.ts)
// and loaded back on boot, so what people built and moved survives the
// machine stopping overnight. Changes mark it dirty; it's flushed on the
// same interval as players, and on shutdown.
const objective: ObjectiveState = loadObjective();
const items = new Map<string, ItemState>();
let worldDirty = false;
const markWorldDirty = (): void => {
  worldDirty = true;
};

const INITIAL_ITEMS: { kind: ItemKind; x: number; z: number }[] = [
  { kind: "gun", x: 0.8, z: 9 }, // corridor
  { kind: "gun", x: -6, z: 15 }, // lab
  { kind: "gun", x: 10, z: -10 }, // core
  { kind: "box", x: -15, z: 5 }, // lab, near the vent
  { kind: "box", x: -16, z: 5 },
  { kind: "box", x: 4, z: 16.8 }, // hall
  { kind: "box", x: 5, z: 16.8 },
  { kind: "box", x: -6, z: -6 }, // core
  { kind: "box", x: 6, z: -6 },
];
/**
 * Somewhere this item can legitimately lie in the current layout. A saved
 * world can predate a layout change, which can leave an item inside a new
 * wall or out where nobody can walk; those are dropped rather than left
 * stranded or blocking a doorway.
 */
function stillPlaceable(item: ItemState, placed: ItemState[]): boolean {
  if (!isWalkable(item.x, item.z)) return false;
  if (!BLOCKING_KINDS.has(item.kind)) return !overlapsAnyObstacle(item.x, item.z, 0.1, OBSTACLES);
  return placementVerdict(item.x, item.z, item, worldObstacles(placed), []) !== "blocked";
}

const saved = loadItems();
if (saved) {
  const kept: ItemState[] = [];
  for (const item of saved) if (stillPlaceable(item, kept)) kept.push(item);
  for (const item of kept) items.set(item.id, item);
  if (kept.length !== saved.length) {
    console.log(`world: dropped ${saved.length - kept.length} saved item(s) the current layout has no room for`);
    markWorldDirty();
  }
  console.log(`world: loaded ${kept.length} item(s), reactor ${objective.active ? "active" : "off"}`);
} else {
  for (const it of [...INITIAL_ITEMS, ...STATIONS]) spawnItem(it.kind, it.x, it.z);
  console.log("world: fresh, seeded the starting items");
}

// Announcements: short lines every client shows across the screen (a new
// wave, the reactor going down). Queued and sent with the next broadcast.
let pendingAnnouncements: string[] = [];
let lastItemsKey = "";
function announce(text: string): void {
  pendingAnnouncements.push(text);
}

const defence = new Defence(
  {
    objective,
    items,
    // enemies never leave the facility, so a player in the lift or the garden isn't a target
    players: () => [...connections.values()].filter((c) => !isDead(c) && !isSafe(c.player.x, c.player.z)).map((c) => c.player),
    hurtPlayer: (id, now, by) => {
      const conn = connections.get(id);
      if (conn && !isDead(conn)) wound(conn, now, by);
    },
    changed: markWorldDirty,
    announce,
    ended: (reason, wave, blackoutMs) => {
      console.log(`[attempt ${attempt.number}] failed: ${reason}, ${wave} wave(s) cleared${blackoutMs ? `, ${Math.round(blackoutMs / 1000)}s in the dark` : ""} (crew: ${crewNames().join(", ") || "nobody"})`);
      run.best = Math.max(run.best, wave);
      saveRun(run);
      report({ type: "attempt", outcome: "lost", reason, attempt: attempt.number, waves: wave, blackoutMs, crew: crewReport() });
      carried.clear();
      // a moment where they fell before the cut to black and back to the garden
      bringUpAt = Date.now() + WIPE_HOLD_MS;
      boardDirty = true;
    },
    blackout: (wave) => {
      console.log(`[attempt ${attempt.number}] the reactor is dead after ${wave} wave(s): blackout`);
      announce("reactor lost — power's out. they're still coming");
    },
    won: winRun,
    cleared: (wave, size, clearMs) => {
      const pay = waveReward(size, clearMs);
      funds += pay;
      saveFunds(funds);
      report({ type: "wave", wave, size, clearMs, parMs: size * PAR_MS_PER_ENEMY, base: WAVE_BASE_REWARD, bonus: pay - WAVE_BASE_REWARD, total: funds });
      console.log(`[attempt ${attempt.number}] wave ${wave} cleared in ${Math.round(clearMs / 1000)}s: quota +${pay} -> ${funds}`);
    },
    turretFire: (id, x, z, tx, tz, now) => spawnProjectile({ id, x, z }, tx - x, tz - z, now, TURRET_MUZZLE),
  },
  loadDefence(),
);

/** the crew's shared quota (see SUPPLY_TERMINAL in shared/protocol.ts) */
let funds = loadFunds();

// Blood and bodies (GoreMark in shared/protocol.ts): left on the facility
// floor until the run is won. Only the new ones go out with each broadcast;
// a client joining, or everyone after a clean-up, gets the lot.
let gore = loadGore();
let goreSeq = gore.length ? gore[gore.length - 1].n + 1 : 0;
let goreNew: GoreMark[] = [];
let goreReset = false;
let goreDirty = false;
function leaveGore(mark: Omit<GoreMark, "n" | "r"> & { r?: number }): void {
  // the garden is practice: nothing stays on the lawn
  if (levelOf(mark.z) !== "bottom") return;
  const m: GoreMark = { ...mark, n: goreSeq++, x: Math.round(mark.x * 100) / 100, z: Math.round(mark.z * 100) / 100, r: Math.round((mark.r ?? Math.random() * Math.PI * 2) * 100) / 100 };
  gore.push(m);
  goreNew.push(m);
  if (gore.length > 1400) gore = capGore(gore);
  goreDirty = true;
}
function cleanGore(): void {
  gore = [];
  goreNew = [];
  goreReset = true;
  goreDirty = true;
}

// The run: attempts at charging the reactor, failed ones and all, until one
// gets it to full. Every attempt is logged and counted; a win goes on the
// board and the facility starts over.
const run = loadRun();
/** the attempt under way: its number in the run, and everyone who's come down to the facility during it */
const attempt = { number: run.attempts, players: new Set<string>() };
const crewNames = (): string[] =>
  [...attempt.players].map((id) => {
    const c = connections.get(id);
    return c ? codename(c.player) : shortId(id);
  });

/**
 * The last wave's down: the reactor's stable and the facility lights up.
 * The win is recorded now, but the crew is left to walk out: the lift
 * takes them up, and once nobody's left below the facility resets.
 */
function winRun(): void {
  const crew = crewNames();
  console.log(`[attempt ${attempt.number}] WON: the reactor is stable after ${attempt.number} attempt(s) (crew: ${crew.join(", ")})`);
  recordRun(attempt.number, crew);
  for (const id of attempt.players) {
    const c = connections.get(id);
    if (c) bumpStats(id, codename(c.player), { wins: 1 });
  }
  report({ type: "attempt", outcome: "won", reason: "reactor stable", attempt: attempt.number, waves: defence.state.wave, blackoutMs: 0, crew: crewReport() });
  // the fallen are back up at the garden: the crew that's left walks out
  for (const conn of connections.values()) {
    if (conn.deadUntil === Infinity) {
      dropHeld(conn.player);
      reviveAt(conn);
    }
  }
  carried.clear();
  boardDirty = true;
}

/** after a win, once the crew's all out of the facility: start the run over */
function resetAfterWin(): void {
  console.log(`[attempt ${attempt.number}] crew evacuated: the facility resets`);
  defence.finish();
  run.attempts = 0;
  run.best = 0;
  saveRun(run);
  funds = 0;
  saveFunds(funds);
  attempt.number = 0;
  attempt.players.clear();
  attemptKills.clear();
  // the facility starts over: what was built goes, the starting kit comes back
  items.clear();
  clearItems();
  for (const it of [...INITIAL_ITEMS, ...STATIONS]) spawnItem(it.kind, it.x, it.z);
  cleanGore();
  everyoneUp();
  boardDirty = true;
}

/** set after a wipe: when to cut back to the garden (0 = not pending) */
let bringUpAt = 0;

/** kills this attempt, by player id, for the end-of-attempt summary */
const attemptKills = new Map<string, number>();
const crewReport = (): { name: string; kills: number; out: boolean }[] =>
  [...attempt.players].map((id) => {
    const c = connections.get(id);
    return { name: c ? codename(c.player) : shortId(id), kills: attemptKills.get(id) ?? 0, out: c ? c.deadUntil === Infinity : true };
  });

/** summaries (a wave's pay, an attempt's end) for every client's report panel */
let pendingReports: Report[] = [];
function report(r: Report): void {
  pendingReports.push(r);
}

/**
 * An attempt's over (won, lost, or everyone down before it began): whoever
 * was down there, the fallen included, is back in the garden, unhurt, and
 * the lift's waiting at the top.
 */
function everyoneUp(): void {
  for (const conn of connections.values()) {
    if (conn.deadUntil === Infinity || levelOf(conn.player.z) === "bottom") {
      dropHeld(conn.player);
      reviveAt(conn);
    }
  }
  lift.reset();
}

function reviveAt(conn: Connection): void {
  respawn(conn.player);
  conn.wounds = 0;
  conn.bandaged = 0;
  conn.woundGraceUntil = 0;
  conn.deadUntil = 0;
  warped(conn);
}

/** an attempt's on and not yet won: the lift won't carry anyone up out of it */
function attemptLocked(): boolean {
  return objective.active && defence.state.phase !== "won";
}

/** in the facility, outside the car, while an attempt's on: the lift won't let them back in */
function lockedOut(conn: Connection): boolean {
  return attemptLocked() && levelOf(conn.player.z) === "bottom" && !inCar("bottom", conn.player.x, conn.player.z);
}

/** the server just moved them: the client jumps there, and moves sent from the old spot are dropped */
function warped(conn: Connection): void {
  conn.warp += 1;
  conn.lastMoveAt = 0;
  conn.dirty = true;
}

// The lift (server/lift.ts). A ride moves whoever's in the car, and
// anything lying in it, to the same spot in the car at the other end.
const lift = new Lift({
  aboard: (level) => [...connections.values()].filter((c) => !isDead(c) && inCar(level, c.player.x, c.player.z)).map((c) => c.player.id),
  attemptOn: () => attemptLocked(),
  onLevel: (level) => [...connections.values()].filter((c) => !isDead(c) && levelOf(c.player.z) === level).length,
  shut(level) {
    if (level !== "bottom" || !attemptLocked()) return;
    for (const conn of connections.values()) {
      if (!isDead(conn) && inCar("bottom", conn.player.x, conn.player.z)) standOutOfCar(conn);
    }
  },
  ride(from, to) {
    const dz = to === "bottom" ? -LIFT_DZ : LIFT_DZ;
    for (const conn of connections.values()) {
      if (isDead(conn) || !inCar(from, conn.player.x, conn.player.z)) continue;
      // normally done when the doors shut; this catches an attempt that went live mid-ride
      if (from === "bottom" && attemptLocked()) {
        standOutOfCar(conn);
        continue;
      }
      conn.player.z += dz;
      warped(conn);
      act(conn.player, to === "bottom" ? "rode the lift down" : "rode the lift up");
      if (to === "bottom" && objective.active && !attempt.players.has(conn.player.id)) {
        attempt.players.add(conn.player.id);
        bumpStats(conn.player.id, codename(conn.player), { attempts: 1 });
        boardDirty = true;
      }
    }
    for (const item of items.values()) {
      if (item.heldBy === undefined && inCar(from, item.x, item.z) && !(from === "bottom" && attemptLocked())) {
        item.z += dz;
        markWorldDirty();
      }
    }
  },
});

// The tutorial (server/tutorial.ts): per-player lessons and props.
const tutorial = new Tutorial({
  items,
  changed: markWorldDirty,
  log: (id, what) => {
    const c = connections.get(id);
    if (c) act(c.player, what);
  },
});

/** what stops this player: the world, the lift's doors, and the tutorial doors still shut to them */
function obstaclesOf(conn: Connection): Obstacle[] {
  const base = obstaclesFor(lift.state, lockedOut(conn), worldObstacles(items.values()));
  const t = tutorial.trainees.get(conn.player.id);
  return inTutorial(conn.player.x, conn.player.z) ? [...base, ...shutTutDoors(t?.stage ?? LESSONS.length)] : base;
}

/** E in a helicopter's cabin: a short ride, then the same spot in the other one */
function takeOff(conn: Connection, now: number): void {
  const from = padAt(conn.player.x, conn.player.z);
  if (!from || conn.flyingUntil) return;
  // the tutorial's door is the lessons: its helicopter only flies once the rest are done
  const t = tutorial.trainees.get(conn.player.id);
  if (from === "tutorial" && t && t.stage < LESSONS.length - 1) {
    refuse(conn, "heli", "refused: helicopter (lessons not done)");
    return;
  }
  if (from === "garden" && heldItem(conn.player.id)) {
    refuse(conn, "heli", "refused: helicopter (hands full)");
    return;
  }
  const dest = heliDestination(from, conn.player.x, conn.player.z);
  conn.flyingUntil = now + HELI_RIDE_MS;
  conn.flyTo = dest;
  act(conn.player, `took off: ${from} -> ${dest.to}`);
}

function stepFlights(now: number): void {
  for (const conn of connections.values()) {
    if (!conn.flyingUntil || now < conn.flyingUntil || !conn.flyTo) continue;
    const to = conn.flyTo;
    conn.flyingUntil = 0;
    conn.flyTo = undefined;
    if (to.to === "tutorial") {
      dropHeld(conn.player);
      tutorial.enrol(conn.player.id).stage = LESSONS.length - 1;
    } else {
      dropHeld(conn.player);
      tutorial.leave(conn.player.id);
    }
    conn.player.x = to.x;
    conn.player.z = to.z;
    warped(conn);
    act(conn.player, to.to === "tutorial" ? "landed at the tutorial" : "landed in the garden");
  }
}

/** a tick for everyone in the tutorial: their lesson, their props */
function stepTutorial(): void {
  for (const conn of connections.values()) {
    if (isDead(conn) || !tutorial.trainees.has(conn.player.id)) continue;
    tutorial.step(conn.player.id, conn.player, heldItem(conn.player.id));
  }
}

/** nobody leaves a live attempt: the doors won't shut on them, so they're stood back out in the corridor */
function standOutOfCar(conn: Connection): void {
  conn.player.z = FACILITY_HALF - 1;
  conn.player.x = Math.max(-1.5, Math.min(1.5, conn.player.x));
  warped(conn);
}

function spawnItem(kind: ItemKind, x: number, z: number): void {
  const id = randomUUID();
  items.set(id, { id, kind, x, z });
  markWorldDirty();
}

// Each yard station keeps one of its item lying on its spot: once the spot
// has been empty for STATION_RESTOCK_MS a fresh one appears, unless the
// world already holds that kind's cap.
const stationEmptySince = STATIONS.map(() => 0);
function restockStations(now: number): void {
  STATIONS.forEach((station, i) => {
    const stocked = [...items.values()].some(
      (it) =>
        it.kind === station.kind &&
        it.heldBy === undefined &&
        Math.hypot(it.x - station.x, it.z - station.z) < 0.8,
    );
    if (stocked) {
      stationEmptySince[i] = 0;
      return;
    }
    if (stationEmptySince[i] === 0) stationEmptySince[i] = now;
    const count = [...items.values()].filter((it) => it.kind === station.kind).length;
    if (now - stationEmptySince[i] >= STATION_RESTOCK_MS && count < ITEM_CAPS[station.kind]) {
      spawnItem(station.kind, station.x, station.z);
      stationEmptySince[i] = 0;
    }
  });
}

function heldItem(playerId: string): ItemState | undefined {
  for (const item of items.values()) if (item.heldBy === playerId) return item;
  return undefined;
}

/**
 * Let go of whatever this player holds, right where they stand. Used when
 * they die or disconnect, so an item never leaves the world with them.
 */
function dropHeld(player: PlayerState): void {
  const item = heldItem(player.id);
  if (!item) return;
  // a tutorial prop doesn't come out with them: it's gone (the lesson hands out another)
  if (item.owner !== undefined && !inTutorial(player.x, player.z)) {
    items.delete(item.id);
    markWorldDirty();
    return;
  }
  item.heldBy = undefined;
  item.x = player.x;
  item.z = player.z;
  markWorldDirty();
}

function livingPlayers(now: number): PlayerState[] {
  return [...connections.values()].filter((c) => !isDead(c)).map((c) => c.player);
}

function handlePrimary(conn: Connection, x: number, z: number, now: number): void {
  const item = heldItem(conn.player.id);
  if (!item) return;
  if (item.kind === "gun") {
    // the lift car is a no-fire zone; the client says so, the server enforces it
    if (noFireAt(conn.player.x, conn.player.z)) {
      refuse(conn, "fire", "refused: firing in the lift");
      return;
    }
    if (now - conn.lastFireAt < FIRE_COOLDOWN_MS) return;
    conn.lastFireAt = now;
    if (conn.shots++ === 0) setTimeout(() => flushShots(conn), SHOT_LOG_EVERY_MS);
    // aim at the point the shooter clicked, not their last-reported facing,
    // which can lag a move packet behind
    let dx = x - conn.player.x;
    let dz = z - conn.player.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 0.05) {
      dx = Math.sin(conn.player.rotation);
      dz = Math.cos(conn.player.rotation);
    }
    spawnProjectile(conn.player, dx, dz, now, MUZZLE_OFFSET, obstaclesOf(conn));
  } else if (item.kind === "grenade") {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (noFireAt(conn.player.x, conn.player.z)) {
      refuse(conn, "fire", "refused: throwing in the lift");
      return;
    }
    const land = grenadeLanding(conn.player, x, z, obstaclesOf(conn));
    items.delete(item.id);
    grenades.set(item.id, {
      id: item.id,
      ownerId: conn.player.id,
      x: conn.player.x,
      z: conn.player.z,
      tx: land.x,
      tz: land.z,
      thrownAt: now,
      blowsAt: now + GRENADE_FLIGHT_MS + GRENADE_FUSE_MS,
    });
    act(conn.player, `threw grenade ${shortId(item.id)} at ${pos(land.x, land.z)}`);
    markWorldDirty();
  } else if (BLOCKING_KINDS.has(item.kind)) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const verdict = placementVerdict(x, z, conn.player, worldObstacles(items.values()), livingPlayers(now));
    if (verdict !== "ok") {
      refuse(conn, "place", `refused: ${item.kind} at ${pos(x, z)} (${verdict})`);
      return;
    }
    item.heldBy = undefined;
    item.x = x;
    item.z = z;
    item.wear = undefined;
    act(conn.player, `placed ${item.kind} ${shortId(item.id)} at ${pos(x, z)}`);
    if (item.kind === "box") bumpStats(conn.player.id, codename(conn.player), { boxes: 1 });
    boardDirty = true;
    markWorldDirty();
  }
}

/**
 * Dead until the server has actually moved them back to the garden ---
 * not merely until the timer runs out. Between the two (up to one tick) a
 * player counted as alive would still be standing where they died, and
 * anything there would kill them again the moment the timer expired.
 */
/** everyone alive below: the ones a break's ready vote waits on */
function voterIds(): string[] {
  return [...connections.values()].filter((c) => !isDead(c) && levelOf(c.player.z) === "bottom").map((c) => c.player.id);
}

function voteReady(conn: Connection): void {
  const ready = defence.vote(conn.player.id, voterIds(), Date.now());
  if (ready === undefined) return;
  const s = defence.state;
  act(conn.player, `${ready ? "ready" : "not ready"} (${s.ready?.length ?? 0}/${s.voters ?? 0})`);
}

function isDead(conn: Connection): boolean {
  return conn.deadUntil !== 0;
}

function netPlayer(conn: Connection, now: number): PlayerState {
  return {
    ...conn.player,
    respawnAt: isDead(conn) && conn.deadUntil !== Infinity ? conn.deadUntil : undefined,
    out: conn.deadUntil === Infinity ? true : undefined,
    score: conn.score,
    entered: levelOf(conn.player.z) === "bottom" ? true : undefined,
    warp: conn.warp,
    wounds: conn.wounds || undefined,
    bandaged: conn.bandaged || undefined,
    name: codename(conn.player),
    ...tutWire(conn),
    flyingUntil: conn.flyingUntil || undefined,
  };
}

function tutWire(conn: Connection): Partial<PlayerState> {
  const t = tutorial.trainees.get(conn.player.id);
  if (!t) return {};
  return { tut: t.stage, tutHits: LESSONS[t.stage] === "shoot" ? t.hits : undefined, tutBlasted: t.blasted || undefined };
}

// The arcade board goes out when something on it changed, at most once a
// second, rather than with every tick.
let boardDirty = true;
const BOARD_SIZE = 8;
function boardMessage(): string {
  return JSON.stringify({
    type: "board",
    run: { attempts: run.attempts, best: run.best },
    top: topStats(BOARD_SIZE).map(({ name, kills, boxes, attempts, wins }) => ({ name, kills, boxes, attempts, wins })),
    wins: recentRuns(5),
  } satisfies ServerMessage);
}
setInterval(() => {
  if (!boardDirty || connections.size === 0) return;
  boardDirty = false;
  const msg = boardMessage();
  for (const conn of connections.values()) if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(msg);
}, 1000);
const pendingIds = new WeakMap<object, string>();

wss.on("headers", (headers, req) => {
  let playerId = parsePlayerId(req.headers.cookie);
  if (!playerId) {
    playerId = randomUUID();
    headers.push(`Set-Cookie: playerId=${playerId}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }
  pendingIds.set(req, playerId);
});

wss.on("connection", (socket, req) => {
  const playerId = pendingIds.get(req) ?? randomUUID();

  // someone the server's never seen starts in the tutorial; everyone else in
  // the garden (the saved position only matters while connected)
  const newcomer = !loadPlayer(playerId) || TUT_ALWAYS;
  const player = loadOrCreatePlayer(playerId);
  respawn(player, true);
  if (newcomer && !DEV_SPAWN && !DEV_JOIN) {
    tutorial.enrol(playerId);
    player.x = TUT_SPAWN.x;
    player.z = TUT_SPAWN.z;
  }
  // (not counting this same player's older tab, which is about to be replaced)
  const taken = [...connections.values()].filter((c) => c.player.id !== playerId).map((c) => c.player.color);
  // a tab still open for this player keeps its colour: the database copy may
  // not have caught up with a colour picked when that tab joined
  const live = connections.get(playerId);
  if (live) player.color = live.player.color;
  if (!PLAYER_COLORS.includes(player.color as (typeof PLAYER_COLORS)[number]) || taken.includes(player.color)) {
    player.color = leastUsedColor(taken);
  }
  const conn: Connection = {
    socket,
    player,
    dirty: true,
    deadUntil: 0,
    score: 0,
    lastFireAt: 0,
    warp: 0,
    wounds: 0,
    bandaged: 0,
    woundGraceUntil: 0,
    lastMoveAt: 0,
    windowStart: 0,
    windowCount: 0,
    hasItems: false,
    refusalLoggedAt: new Map(),
    shots: 0,
    kills: 0,
    flyingUntil: 0,
  };
  // the same browser in a second tab (one cookie, one person): the newer
  // tab takes over and the older is closed, never two bodies for one id
  const previous = connections.get(playerId);
  if (previous) {
    act(player, "opened a second tab: closing the first");
    dropHeld(previous.player);
    previous.socket.send(JSON.stringify({ type: "replaced" } satisfies ServerMessage));
    previous.socket.close(4000, "opened in another tab");
    // and if the closing handshake never completes (a proxy in between can
    // swallow it), drop the connection outright
    setTimeout(() => previous.socket.terminate(), 2000);
  }
  const back = carried.get(playerId);
  if (back) {
    carried.delete(playerId);
    conn.wounds = back.wounds;
    conn.bandaged = back.bandaged;
    if (back.out) conn.deadUntil = Infinity;
  }
  connections.set(playerId, conn);
  if (DEV_ARMED && !heldItem(playerId)) {
    const id = randomUUID();
    items.set(id, { id, kind: "gun", x: player.x, z: player.z, heldBy: playerId });
  }
  act(
    player,
    `joined (id ${shortId(playerId)}, ${connections.size} online)${back?.out ? " — still out this attempt" : back?.wounds ? ` — ${back.wounds} wound(s) carried over` : ""}`,
  );

  const now = Date.now();
  const welcome: ServerMessage & { type: "welcome" } = {
    type: "welcome",
    t: now,
    you: netPlayer(conn, now),
    players: [...connections.values()].map((c) => netPlayer(c, now)),
    version: VERSION,
  };
  socket.send(JSON.stringify(welcome));
  socket.send(boardMessage());

  // a protocol error on one socket (an oversized frame, a bad handshake
  // byte) is emitted as an 'error' event; with no listener Node treats it as
  // uncaught and the whole server --- everyone's game --- goes down. Drop
  // just that connection instead.
  socket.on("error", () => socket.terminate());

  socket.on("message", (raw) => {
    const now = Date.now();
    // a flood of messages is dropped rather than processed: an honest
    // client sends ~20 a second, so this only ever catches a broken or
    // hostile one
    if (now - conn.windowStart >= 1000) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    if (++conn.windowCount > MAX_MESSAGES_PER_SECOND) {
      refuse(conn, "flood", `refused: over ${MAX_MESSAGES_PER_SECOND} messages/s, dropping the excess`);
      return;
    }
    if (isDead(conn)) return; // frozen while waiting to respawn

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // valid JSON isn't necessarily an object (null, a number): never let a
    // malformed message throw, or one client could take the server down
    if (typeof msg !== "object" || msg === null || typeof msg.type !== "string") return;
    if (msg.type === "move") {
      const move = msg as MoveMessage;
      if (!Number.isFinite(move.x) || !Number.isFinite(move.z) || !Number.isFinite(move.rotation)) return;
      // sent before the server last moved them (a respawn, a lift ride): from somewhere they no longer are
      if (move.warp !== undefined && move.warp !== conn.warp) return;
      // no teleporting: a move can only cover as far as the player could
      // have walked since the last one (with slack for packets that arrive
      // bunched up); a longer claim is cut short along the way
      // (the first move after joining or respawning gets one tick's worth, not a burst)
      const elapsed = conn.lastMoveAt === 0 ? BROADCAST_INTERVAL_MS / 1000 : (now - conn.lastMoveAt) / 1000;
      const budget = woundedSpeed(conn.wounds) * Math.min(MOVE_BURST_S, elapsed) * MOVE_SLACK + 0.05;
      conn.lastMoveAt = now;
      let tx = move.x;
      let tz = move.z;
      const dist = Math.hypot(tx - conn.player.x, tz - conn.player.z);
      if (dist > budget) {
        // a little over budget is ordinary network jitter; only a claim
        // well past it is worth a line
        if (dist > budget * 3 + 0.5) refuse(conn, "teleport", `refused: move of ${dist.toFixed(1)}u (allowed ${budget.toFixed(1)}u), cut short`);
        tx = conn.player.x + ((tx - conn.player.x) / dist) * budget;
        tz = conn.player.z + ((tz - conn.player.z) / dist) * budget;
      }
      const clamped = clampToPlayBounds(tx, tz);
      if (conn.flyingUntil) return; // aboard and away: they're not walking anywhere
      const resolved = resolveObstacles(clamped.x, clamped.z, obstaclesOf(conn));
      // walls stop a walking player, but a client could still claim a
      // jump straight to the far side of one --- or from one level to the other
      if (!isWalkable(resolved.x, resolved.z) || levelOf(resolved.z) !== levelOf(conn.player.z)) {
        refuse(conn, "wall", `refused: move into a wall at ${pos(resolved.x, resolved.z)}`);
        return;
      }
      conn.player.x = resolved.x;
      conn.player.z = resolved.z;
      conn.player.rotation = move.rotation;
      conn.dirty = true;
      return;
    }

    if (msg.type === "lift") {
      const verdict = liftVerdict(conn.player, lift.state, objective, defence.state.phase);
      if (verdict === "send") {
        lift.send(now);
        act(conn.player, `pressed the lift button (${lift.state.at})`);
      } else if (verdict === "call") {
        lift.call(levelOf(conn.player.z), now);
        act(conn.player, `called the lift (${levelOf(conn.player.z)})`);
      } else {
        refuse(conn, "lift", `refused: lift (${verdict})`);
      }
      return;
    }

    if (msg.type === "heli") {
      takeOff(conn, now);
      return;
    }

    if (msg.type === "ready") {
      if (defence.state.phase === "break" && objective.active && !isDead(conn) && levelOf(conn.player.z) === "bottom") voteReady(conn);
      else refuse(conn, "ready", "refused: ready (no break on)");
      return;
    }

    if (msg.type === "activate") {
      const verdict = activateVerdict(conn.player, objective, defence.state.phase);
      if (verdict === "ok") {
        objective.active = true;
        attemptKills.clear();
        defence.start(Date.now());
        attempt.number += 1;
        // everyone down here is in it: from now on the lift won't take them back up
        attempt.players = new Set([playerId, ...[...connections.values()].filter((c) => !isDead(c) && levelOf(c.player.z) === "bottom").map((c) => c.player.id)]);
        run.attempts = attempt.number;
        saveRun(run);
        for (const id of attempt.players) bumpStats(id, codename(connections.get(id)!.player), { attempts: 1 });
        boardDirty = true;
        act(conn.player, `switched the reactor on: attempt ${attempt.number} begins`);
        announce("the reactor is live — hold it");
        markWorldDirty();
      } else if (verdict === "ready") {
        voteReady(conn);
      } else {
        refuse(conn, "activate", `refused: reactor switch (${verdict})`);
      }
      return;
    }

    if (msg.type === "buy") {
      const what = msg.item;
      // a turret isn't handed over by this message any more: ordering one
      // opens its placement panel client-side; buildTurret is what pays for
      // it, atomically with a spot passing (see below)
      if (what !== "heal" && what !== "grenade") return;
      const verdict = buyVerdict(what, conn.player, { wounds: conn.wounds, holding: heldItem(playerId) !== undefined }, funds, 0);
      if (verdict !== "ok") {
        refuse(conn, "buy", `refused: ${what} (${verdict})`);
        return;
      }
      const cost = SHOP[what].cost;
      funds -= cost;
      saveFunds(funds);
      if (what === "grenade") {
        const id = randomUUID();
        items.set(id, { id, kind: "grenade", x: conn.player.x, z: conn.player.z, heldBy: playerId });
        act(conn.player, `bought grenade ${shortId(id)} for ${cost} quota (${funds} left)`);
        markWorldDirty();
        return;
      }
      // a dressing, not a cure: whatever they had comes back with the next hit
      conn.bandaged = Math.max(conn.bandaged, conn.wounds);
      conn.wounds = 0;
      conn.dirty = true;
      act(conn.player, `patched up (${conn.bandaged} wound(s) dressed) for ${cost} quota (${funds} left)`);
      return;
    }

    if (msg.type === "buildTurret") {
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
      const turrets = [...items.values()].filter((i) => i.kind === "turret").length;
      const verdict = buildTurretVerdict(msg.x, msg.z, conn.player, worldObstacles(items.values()), livingPlayers(now), funds, turrets);
      if (verdict !== "ok") {
        refuse(conn, "build", `refused: turret at ${pos(msg.x, msg.z)} (${verdict})`);
        return;
      }
      funds -= TURRET_COST;
      saveFunds(funds);
      const id = randomUUID();
      items.set(id, { id, kind: "turret", x: msg.x, z: msg.z });
      act(conn.player, `built turret ${shortId(id)} at ${pos(msg.x, msg.z)} for ${TURRET_COST} quota (${funds} left)`);
      markWorldDirty();
      return;
    }

    if (msg.type === "scrap") {
      if (typeof msg.itemId !== "string") return;
      const item = items.get(msg.itemId);
      const verdict = scrapVerdict(item, conn.player);
      if (verdict !== "ok") {
        refuse(conn, "scrap", `refused: ${verdict}`);
        return;
      }
      items.delete(msg.itemId);
      act(conn.player, `scrapped turret ${shortId(msg.itemId)} at ${pos(item!.x, item!.z)}`);
      markWorldDirty();
      return;
    }

    if (msg.type === "pickup") {
      if (typeof msg.itemId !== "string") return;
      const item = items.get(msg.itemId);
      if (!item) return;
      // a built turret never leaves the floor except by scrapping it
      if (item.kind === "turret") return;
      // someone else's tutorial prop is for them
      if (item.owner !== undefined && item.owner !== playerId) return;
      if (item.heldBy !== undefined && item.heldBy !== playerId) {
        const holder = connections.get(item.heldBy);
        refuse(conn, "pickup", `refused: ${item.kind} ${shortId(item.id)} is in ${holder ? codename(holder.player) : "someone else"}'s hands`);
        return;
      }
      if (item.heldBy !== undefined || heldItem(playerId)) return;
      const reach = Math.hypot(item.x - conn.player.x, item.z - conn.player.z);
      if (reach > PICKUP_RANGE) {
        refuse(conn, "pickup", `refused: ${item.kind} ${shortId(item.id)} out of reach (${reach.toFixed(1)}u)`);
        return;
      }
      item.heldBy = playerId;
      act(conn.player, `picked up ${item.kind} ${shortId(item.id)} at ${pos(item.x, item.z)}`);
      markWorldDirty();
      return;
    }

    if (msg.type === "primary") {
      handlePrimary(conn, msg.x, msg.z, Date.now());
      return;
    }

    if (msg.type === "drop") {
      // A box goes down through its primary action (it needs a valid spot);
      // only items that don't block anything can just be let go of.
      const item = heldItem(playerId);
      if (item && !BLOCKING_KINDS.has(item.kind)) {
        act(conn.player, `dropped ${item.kind} ${shortId(item.id)} at ${pos(conn.player.x, conn.player.z)}`);
        dropHeld(conn.player);
      }
      return;
    }
  });

  socket.on("close", () => {
    if (connections.get(playerId) === conn) tutorial.leave(playerId);
    dropHeld(conn.player);
    flushShots(conn);
    // a tab replaced by a newer one mustn't take the newer one down with it
    if (connections.get(playerId) === conn) {
      connections.delete(playerId);
      if (conn.deadUntil === Infinity || (objective.active && (conn.wounds > 0 || conn.bandaged > 0))) {
        carried.set(playerId, { wounds: conn.wounds, bandaged: conn.bandaged, out: conn.deadUntil === Infinity });
      }
      act(conn.player, `left (${connections.size} online)`);
    }
    savePlayer(conn.player);
  });
});

/**
 * The palette colour fewest connected players are wearing, so a handful of
 * players never share a colour (and only start doubling up past six).
 */
function leastUsedColor(taken: string[]): string {
  let best: string = PLAYER_COLORS[0];
  let bestCount = Infinity;
  for (const color of PLAYER_COLORS) {
    const count = taken.filter((t) => t === color).length;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

/**
 * A shot in flight. Its path is a straight line known the moment it's
 * fired: how far it gets before a wall or box (`range`) is ray-cast then.
 * Each tick only checks the stretch covered since the last one against
 * players, so even a very fast shot can't skip past anyone or through
 * anything.
 */
interface ServerProjectile extends ProjectileState {
  /** how far along it had got at the last tick */
  travelled: number;
}

const projectiles = new Map<string, ServerProjectile>();

function spawnProjectile(owner: { id: string; x: number; z: number }, aimX: number, aimZ: number, now: number, muzzle = MUZZLE_OFFSET, solid?: Obstacle[]): void {
  const len = Math.hypot(aimX, aimZ);
  const dirX = aimX / len;
  const dirZ = aimZ / len;
  const x = owner.x + dirX * muzzle;
  const z = owner.z + dirZ * muzzle;
  // the shooter's own tile (a turret) doesn't stop its shot
  const range = shotRange(x, z, dirX, dirZ, solid ?? worldObstacles([...items.values()].filter((i) => i.id !== owner.id)));
  const id = randomUUID();
  projectiles.set(id, { id, ownerId: owner.id, x, z, dirX, dirZ, firedAt: now, range, travelled: 0, hit: "wall" });
}

/** a turret's muzzle sits just past its own tile */
const TURRET_MUZZLE = BOX_HALF_EXTENT + 0.15;

/**
 * For local testing only, never set in production (fly.toml doesn't):
 * DEV_SPAWN="x,z" puts every player there instead of the garden, every
 * time; DEV_JOIN="x,z" only on joining, so deaths still respawn normally.
 * Lets a scene deep in the facility be checked without walking to it.
 */
const devPoint = (v: string | undefined) => {
  const p = v?.split(",").map(Number);
  return p && p.length === 2 && p.every(Number.isFinite) ? { x: p[0], z: p[1] } : undefined;
};
const DEV_SPAWN = devPoint(process.env.DEV_SPAWN);
const DEV_JOIN = devPoint(process.env.DEV_JOIN);
/** DEV_ARMED=1: everyone joins holding a rifle (local testing only, like the rest) */
const DEV_ARMED = process.env.DEV_ARMED === "1";
/** DEV_TUTORIAL=1: everyone joins in the tutorial, as a newcomer would (local testing only) */
const TUT_ALWAYS = process.env.DEV_TUTORIAL === "1";

function respawn(player: PlayerState, joining = false): void {
  const dev = DEV_SPAWN ?? (joining ? DEV_JOIN : undefined);
  if (dev) {
    player.x = dev.x;
    player.z = dev.z;
    return;
  }
  // still in the tutorial: back to its start (their lessons done stay done)
  if (!joining && tutorial.trainees.has(player.id)) {
    player.x = TUT_SPAWN.x;
    player.z = TUT_SPAWN.z;
    return;
  }
  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  player.x = spawn.x;
  player.z = spawn.z;
}

/** a kill goes on whoever's it was: their score, the attempt's tally, the all-time board */
function creditKill(ownerId: string): void {
  const ownerConn = connections.get(ownerId);
  if (!ownerConn) return;
  ownerConn.score += 1;
  ownerConn.kills += 1;
  if (objective.active) attemptKills.set(ownerConn.player.id, (attemptKills.get(ownerConn.player.id) ?? 0) + 1);
  bumpStats(ownerConn.player.id, codename(ownerConn.player), { kills: 1 });
  boardDirty = true;
}

// Grenades in the air or on the floor, by id; they go off at blowsAt.
const grenades = new Map<string, GrenadeState & { ownerId: string }>();
let pendingBlasts: { x: number; z: number }[] = [];

function stepGrenades(now: number): void {
  for (const g of grenades.values()) {
    if (now < g.blowsAt) continue;
    grenades.delete(g.id);
    pendingBlasts.push({ x: g.tx, z: g.tz });
    if (inTutorial(g.tx, g.tz)) tutorial.blast(g.ownerId, g.tx, g.tz, GRENADE_RADIUS);
    const killed = defence.blast(g.tx, g.tz, GRENADE_RADIUS, GRENADE_DAMAGE);
    for (const k of killed) {
      leaveGore({ kind: "blood", who: "enemy", x: k.x, z: k.z, size: 0.7 + Math.random() * 0.3 });
      leaveGore({ kind: "corpse", who: "enemy", x: k.x, z: k.z, r: Math.atan2(k.x - g.tx, k.z - g.tz) });
      creditKill(g.ownerId);
    }
    const owner = connections.get(g.ownerId);
    if (owner) act(owner.player, `grenade went off at ${pos(g.tx, g.tz)}: ${killed.length} kill(s)`);
  }
}

/** a stopped shot stays in the broadcast this long, so every client sees it reach where it stopped */
const PROJECTILE_LINGER_MS = 150;

function stepProjectiles(now: number): void {
  for (const p of projectiles.values()) {
    const reach = Math.min(p.range, ((now - p.firedAt) / 1000) * PROJECTILE_SPEED);
    if (reach >= p.range && p.travelled >= p.range) {
      // already stopped: forget it once every client has seen it land
      if (now - p.firedAt > (p.range / PROJECTILE_SPEED) * 1000 + PROJECTILE_LINGER_MS) projectiles.delete(p.id);
      continue;
    }
    // the stretch covered since last tick, swept against every living
    // player (the shooter included: past the muzzle offset, a shot is
    // neutral); the first one it meets stops it
    let victim: Connection | undefined;
    let at = reach;
    // a turret's shots pass through the crew: it's their defence, not a hazard to them
    const fromTurret = items.get(p.ownerId)?.kind === "turret";
    for (const conn of connections.values()) {
      if (isDead(conn) || fromTurret || !FRIENDLY_FIRE) continue;
      const t = segmentHitsCircle(p.x, p.z, p.dirX, p.dirZ, p.travelled, at, conn.player.x, conn.player.z, HIT_RADIUS);
      if (t !== undefined && t <= at) {
        victim = conn;
        at = t;
      }
    }
    // the lift car is a no-fire zone: a shot that reaches it stops there
    const hx = p.x + p.dirX * at;
    const hz = p.z + p.dirZ * at;
    if (inAnyCar(hx, hz)) {
      p.range = p.travelled;
      p.travelled = p.range;
      p.hit = "wall";
      continue;
    }
    // a tutorial target of the shooter's stops it (only theirs: each trainee's targets are their own)
    if (inTutorial(p.x, p.z)) {
      const tAt = tutorial.shot(p.ownerId, p.x, p.z, p.dirX, p.dirZ, p.travelled, at);
      if (tAt !== undefined) {
        p.range = tAt;
        p.travelled = tAt;
        p.hit = "enemy";
        continue;
      }
    }
    // an enemy nearer along the line than any player takes the shot instead
    const enemyHit = defence.firstHit(p.x, p.z, p.dirX, p.dirZ, p.travelled, at);
    p.travelled = enemyHit ? enemyHit.at : at;
    if (enemyHit) {
      p.range = enemyHit.at;
      p.hit = "enemy";
      const ex = p.x + p.dirX * enemyHit.at;
      const ez = p.z + p.dirZ * enemyHit.at;
      const killed = defence.damage(enemyHit.id);
      // a drip where it was hit, carried a little on along the shot; a body and a pool where it drops
      if (Math.random() < 0.5) leaveGore({ kind: "blood", who: "enemy", x: ex + p.dirX * 0.5, z: ez + p.dirZ * 0.5, size: 0.18 + Math.random() * 0.12 });
      if (killed) {
        leaveGore({ kind: "blood", who: "enemy", x: ex + p.dirX * 0.3, z: ez + p.dirZ * 0.3, size: 0.85 + Math.random() * 0.3 });
        leaveGore({ kind: "corpse", who: "enemy", x: ex + p.dirX * 0.3, z: ez + p.dirZ * 0.3, r: Math.atan2(p.dirX, p.dirZ) + (Math.random() - 0.5) });
      }
      if (killed) creditKill(p.ownerId);
    } else if (victim) {
      p.range = at;
      p.hit = "player";
      const ownerConn = connections.get(p.ownerId);
      const by = ownerConn ? (victim === ownerConn ? "their own shot" : codename(ownerConn.player)) : "a stray shot";
      // friendly fire only counts against the score when it kills
      if (wound(victim, now, by)) {
        if (ownerConn) ownerConn.score += victim.player.id === p.ownerId ? -1 : 1;
      }
    }
  }
}

/** a hit on a player: one more wound, or death if they've taken all they can; true if it killed */
function wound(conn: Connection, now: number, by: string): boolean {
  if (now < conn.woundGraceUntil) return false;
  if (conn.wounds >= MAX_WOUNDS) {
    kill(conn, now);
    act(conn.player, `killed by ${by} at ${pos(conn.player.x, conn.player.z)}${conn.deadUntil === Infinity ? ": out for this attempt" : ""}`);
    return true;
  }
  if (conn.bandaged > 0) {
    // the dressing gives way: every wound under it is back at once
    conn.wounds = conn.bandaged;
    conn.bandaged = 0;
    conn.woundGraceUntil = now + WOUND_GRACE_MS;
    conn.dirty = true;
    leaveGore({ kind: "blood", who: "player", x: conn.player.x, z: conn.player.z, size: 0.35 });
    act(conn.player, `wounded by ${by}: dressing torn, back to ${conn.wounds}/${MAX_WOUNDS}`);
    return false;
  }
  conn.wounds += 1;
  conn.woundGraceUntil = now + WOUND_GRACE_MS;
  conn.dirty = true;
  leaveGore({ kind: "blood", who: "player", x: conn.player.x + (Math.random() - 0.5) * 0.4, z: conn.player.z + (Math.random() - 0.5) * 0.4, size: 0.22 + Math.random() * 0.1 });
  act(conn.player, `wounded by ${by} (${conn.wounds}/${MAX_WOUNDS})`);
  return false;
}

/**
 * Coming down in the lift is joining the attempt, live or not yet: dying
 * down there is final until it's over, and you watch your team from then
 * on. Dying in the garden (practice gone wrong) you're back shortly.
 */
function kill(conn: Connection, now: number): void {
  conn.deadUntil = levelOf(conn.player.z) === "bottom" ? Infinity : now + DEATH_DURATION_MS;
  conn.dirty = true;
  dropHeld(conn.player);
  leaveGore({ kind: "blood", who: "player", x: conn.player.x, z: conn.player.z, size: 0.75 });
  leaveGore({ kind: "corpse", who: "player", x: conn.player.x, z: conn.player.z, r: conn.player.rotation, color: conn.player.color });
}

/**
 * Everyone down in the facility is dead: the attempt fails (or, before the
 * reactor was on, simply ends). Someone still up in the garden isn't
 * holding anything, and can't keep a lost attempt going.
 */
function checkWipe(): void {
  if (bringUpAt) return; // already over: holding on where they fell before the cut
  const below = [...connections.values()].filter((c) => c.deadUntil === Infinity || (!isDead(c) && levelOf(c.player.z) === "bottom"));
  if (below.length === 0 || !below.every((c) => c.deadUntil === Infinity)) return;
  if (objective.active) {
    defence.fail(defence.state.phase === "blackout" ? "everyone's down in the dark" : "everyone's down");
  } else {
    console.log(`everyone down in the facility died before the reactor was on (${below.map((c) => codename(c.player)).join(", ")})`);
    carried.clear();
    everyoneUp();
  }
}

function processRespawns(now: number): void {
  for (const conn of connections.values()) {
    if (conn.deadUntil !== 0 && conn.deadUntil !== Infinity && now >= conn.deadUntil) reviveAt(conn);
  }
}

setInterval(() => {
  if (connections.size === 0) return;
  const now = Date.now();
  // respawn first: someone whose timer just ran out is back in the safe
  // room before enemies or shots get a turn at them
  processRespawns(now);
  lift.step(now);
  stepFlights(now);
  stepTutorial();
  defence.tallyVotes(voterIds(), now);
  defence.step(now, BROADCAST_INTERVAL_MS / 1000);
  stepProjectiles(now);
  stepGrenades(now);
  checkWipe();
  if (bringUpAt && now >= bringUpAt) {
    bringUpAt = 0;
    everyoneUp();
  }
  // won: once nobody's left below, the facility starts over
  if (objective.active && defence.state.phase === "won" && ![...connections.values()].some((c) => levelOf(c.player.z) === "bottom")) resetAfterWin();
  restockStations(now);
  const players = [...connections.values()].map((c) => netPlayer(c, now));
  const projectileList: ProjectileState[] = [...projectiles.values()].map((p) => ({
    id: p.id,
    ownerId: p.ownerId,
    x: p.x,
    z: p.z,
    dirX: p.dirX,
    dirZ: p.dirZ,
    firedAt: p.firedAt,
    range: p.range,
    hit: p.hit,
  }));
  // items go out only when they've changed since the last tick, or to a
  // client that hasn't had them yet (see StateMessage.items)
  const itemList = [...items.values()];
  const itemsKey = itemList.map((i) => `${i.id}:${i.x.toFixed(2)},${i.z.toFixed(2)},${i.heldBy ?? ""},${i.wear ?? 0},${i.aim ?? ""}`).join("|");
  const itemsChanged = itemsKey !== lastItemsKey;
  lastItemsKey = itemsKey;
  const base = {
    type: "state" as const,
    t: now,
    players,
    projectiles: projectileList,
    objective,
    enemies: defence.snapshot(),
    spits: defence.spits(),
    grenades: [...grenades.values()].map(({ ownerId: _o, ...g }) => g),
    blasts: pendingBlasts.length ? pendingBlasts : undefined,
    defence: defence.state,
    funds,
    announcements: pendingAnnouncements.length ? pendingAnnouncements : undefined,
    reports: pendingReports.length ? pendingReports : undefined,
    lift: lift.state,
  };
  pendingAnnouncements = [];
  pendingReports = [];
  pendingBlasts = [];
  // a client that's never had the items, or the gore, gets them all; everyone else just what changed
  const newGore = goreReset ? { gore, goreReset: true as const } : goreNew.length ? { gore: goreNew } : {};
  const allGore = { gore, goreReset: true as const };
  goreNew = [];
  goreReset = false;
  const forNew = JSON.stringify({ ...base, items: itemList, ...allGore } satisfies ServerMessage);
  const forKnown = JSON.stringify({ ...base, ...(itemsChanged ? { items: itemList } : {}), ...newGore } satisfies ServerMessage);
  for (const conn of connections.values()) {
    if (conn.socket.readyState !== conn.socket.OPEN) continue;
    conn.socket.send(conn.hasItems ? forKnown : forNew);
    conn.hasItems = true;
  }
}, BROADCAST_INTERVAL_MS);

function flushWorld(): void {
  if (goreDirty) {
    goreDirty = false;
    gore = capGore(gore);
    saveGore(gore);
  }
  if (!worldDirty) return;
  worldDirty = false;
  saveWorld([...items.values()].filter((i) => i.owner === undefined), objective, defence.state, (id) => connections.get(id)?.player);
}

function flushPlayers(): void {
  for (const conn of connections.values()) {
    if (conn.dirty) {
      savePlayer(conn.player);
      conn.dirty = false;
    }
  }
}

setInterval(() => {
  flushPlayers();
  flushWorld();
}, PERSIST_INTERVAL_MS);

// Fly stops an idle machine with SIGINT/SIGTERM: write out the last second
// of changes before going, so nothing built just before everyone left is lost.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    flushPlayers();
    flushWorld();
    process.exit(0);
  });
}

// a restart in the middle of an ending: nobody's below any more, so finish it now
if (objective.active && defence.state.phase === "won") resetAfterWin();
else if (objective.active && defence.state.phase === "blackout") defence.fail("the server restarted in the dark");

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${PORT}`);
});
