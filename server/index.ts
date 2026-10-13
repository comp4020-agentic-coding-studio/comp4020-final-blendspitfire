import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { loadDefence, loadItems, loadObjective, loadOrCreatePlayer, saveWorld, savePlayer } from "./db.ts";
import { Defence } from "./defence.ts";
import { PLAYER_COLORS } from "../shared/palette.ts";
import {
  BROADCAST_INTERVAL_MS,
  DEATH_DURATION_MS,
  FIRE_COOLDOWN_MS,
  HIT_RADIUS,
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
  SPAWN_POINTS,
  STATIONS,
  STATION_RESTOCK_MS,
  activateVerdict,
  clampToPlayBounds,
  hasPassedGate,
  inRect,
  isInYard,
  isWalkable,
  obstaclesFor,
  overlapsAnyObstacle,
  placementVerdict,
  resolveObstacles,
  worldObstacles,
  type ClientMessage,
  type ObjectiveState,
  type ItemKind,
  type ItemState,
  type MoveMessage,
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
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });

interface Connection {
  socket: WebSocket;
  player: PlayerState;
  dirty: boolean;
  /** 0 while alive; otherwise the Date.now()-scale timestamp they respawn at */
  deadUntil: number;
  /** in-memory only: resets to 0 on every (re)connect, never persisted */
  score: number;
  lastFireAt: number;
  /** through the one-way gate since the last (re)spawn; in memory only */
  entered: boolean;
}

const connections = new Map<string, Connection>();

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
  if (item.kind !== "box") return !overlapsAnyObstacle(item.x, item.z, 0.1, OBSTACLES);
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
function announce(text: string): void {
  pendingAnnouncements.push(text);
}

const defence = new Defence(
  {
    objective,
    items,
    players: () => [...connections.values()].filter((c) => !isDead(c, Date.now())).map((c) => c.player),
    hurtPlayer: (id, now) => {
      const conn = connections.get(id);
      if (conn && !isDead(conn, now)) kill(conn, now);
    },
    changed: markWorldDirty,
    announce,
  },
  loadDefence(),
);

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
  item.heldBy = undefined;
  item.x = player.x;
  item.z = player.z;
  markWorldDirty();
}

function livingPlayers(now: number): PlayerState[] {
  return [...connections.values()].filter((c) => !isDead(c, now)).map((c) => c.player);
}

function handlePrimary(conn: Connection, x: number, z: number, now: number): void {
  const item = heldItem(conn.player.id);
  if (!item) return;
  if (item.kind === "gun") {
    // the yard is a no-fire zone; the client says so, the server enforces it
    if (isInYard(conn.player.x, conn.player.z)) return;
    if (now - conn.lastFireAt < FIRE_COOLDOWN_MS) return;
    conn.lastFireAt = now;
    // aim at the point the shooter clicked, not their last-reported facing,
    // which can lag a move packet behind
    let dx = x - conn.player.x;
    let dz = z - conn.player.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 0.05) {
      dx = Math.sin(conn.player.rotation);
      dz = Math.cos(conn.player.rotation);
    }
    spawnProjectile(conn.player, dx, dz, now);
  } else if (item.kind === "box") {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const verdict = placementVerdict(x, z, conn.player, worldObstacles(items.values()), livingPlayers(now));
    if (verdict !== "ok") return;
    item.heldBy = undefined;
    item.x = x;
    item.z = z;
    markWorldDirty();
  }
}

function isDead(conn: Connection, now: number): boolean {
  return conn.deadUntil > now;
}

function netPlayer(conn: Connection, now: number): PlayerState {
  return {
    ...conn.player,
    respawnAt: isDead(conn, now) ? conn.deadUntil : undefined,
    score: conn.score,
    entered: conn.entered ? true : undefined,
  };
}
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

  const player = loadOrCreatePlayer(playerId);
  // Everyone starts in the yard: the saved position only matters while
  // connected (it's what a reconnect mid-session would otherwise restore).
  respawn(player);
  const taken = [...connections.values()].map((c) => c.player.color);
  if (!PLAYER_COLORS.includes(player.color as (typeof PLAYER_COLORS)[number]) || taken.includes(player.color)) {
    player.color = leastUsedColor(taken);
  }
  const conn: Connection = { socket, player, dirty: true, deadUntil: 0, score: 0, lastFireAt: 0, entered: false };
  connections.set(playerId, conn);

  const now = Date.now();
  const welcome: ServerMessage & { type: "welcome" } = {
    type: "welcome",
    t: now,
    you: netPlayer(conn, now),
    players: [...connections.values()].map((c) => netPlayer(c, now)),
  };
  socket.send(JSON.stringify(welcome));

  socket.on("message", (raw) => {
    if (isDead(conn, Date.now())) return; // frozen while waiting to respawn

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "move") {
      const move = msg as MoveMessage;
      if (!Number.isFinite(move.x) || !Number.isFinite(move.z)) return;
      const clamped = clampToPlayBounds(move.x, move.z);
      const resolved = resolveObstacles(clamped.x, clamped.z, obstaclesFor(conn.entered, worldObstacles(items.values())));
      // walls stop a walking player, but a client could still claim a
      // jump straight to the far side of one --- or back through the gate
      if (!isWalkable(resolved.x, resolved.z)) return;
      if (conn.entered && isInYard(resolved.x, resolved.z)) return;
      conn.player.x = resolved.x;
      conn.player.z = resolved.z;
      conn.player.rotation = move.rotation;
      if (!conn.entered && hasPassedGate(resolved.z)) conn.entered = true;
      conn.dirty = true;
      return;
    }

    if (msg.type === "activate") {
      const verdict = activateVerdict(conn.player, heldItem(playerId) !== undefined, objective);
      if (verdict === "ok") {
        objective.active = true;
        defence.start(Date.now());
        announce("the reactor is live — hold it");
        markWorldDirty();
      }
      return;
    }

    if (msg.type === "pickup") {
      const item = items.get(msg.itemId);
      if (!item || item.heldBy !== undefined || heldItem(playerId)) return;
      const reach = Math.hypot(item.x - conn.player.x, item.z - conn.player.z);
      if (reach > PICKUP_RANGE) return;
      item.heldBy = playerId;
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
      if (item && item.kind !== "box") dropHeld(conn.player);
      return;
    }
  });

  socket.on("close", () => {
    dropHeld(conn.player);
    connections.delete(playerId);
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

function spawnProjectile(owner: PlayerState, aimX: number, aimZ: number, now: number): void {
  const len = Math.hypot(aimX, aimZ);
  const dirX = aimX / len;
  const dirZ = aimZ / len;
  const x = owner.x + dirX * MUZZLE_OFFSET;
  const z = owner.z + dirZ * MUZZLE_OFFSET;
  const range = shotRange(x, z, dirX, dirZ, worldObstacles(items.values()));
  const id = randomUUID();
  projectiles.set(id, { id, ownerId: owner.id, x, z, dirX, dirZ, firedAt: now, range, travelled: 0 });
}

function respawn(player: PlayerState): void {
  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  player.x = spawn.x;
  player.z = spawn.z;
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
    for (const conn of connections.values()) {
      if (isDead(conn, now)) continue;
      const t = segmentHitsCircle(p.x, p.z, p.dirX, p.dirZ, p.travelled, at, conn.player.x, conn.player.z, HIT_RADIUS);
      if (t !== undefined && t <= at) {
        victim = conn;
        at = t;
      }
    }
    // the safe room is a no-fire zone: a shot that reaches its line stops there
    const hx = p.x + p.dirX * at;
    const hz = p.z + p.dirZ * at;
    if (isInYard(hx, hz)) {
      p.range = p.travelled;
      p.travelled = p.range;
      continue;
    }
    // an enemy nearer along the line than any player takes the shot instead
    const enemyHit = defence.firstHit(p.x, p.z, p.dirX, p.dirZ, p.travelled, at);
    p.travelled = enemyHit ? enemyHit.at : at;
    if (enemyHit) {
      p.range = enemyHit.at;
      if (defence.damage(enemyHit.id)) {
        const ownerConn = connections.get(p.ownerId);
        if (ownerConn) ownerConn.score += 1;
      }
    } else if (victim) {
      p.range = at;
      kill(victim, now);
      const ownerConn = connections.get(p.ownerId);
      if (ownerConn) ownerConn.score += victim.player.id === p.ownerId ? -1 : 1;
    }
  }
}

function kill(conn: Connection, now: number): void {
  conn.deadUntil = now + DEATH_DURATION_MS;
  conn.dirty = true;
  dropHeld(conn.player);
}

function processRespawns(now: number): void {
  for (const conn of connections.values()) {
    if (conn.deadUntil !== 0 && now >= conn.deadUntil) {
      respawn(conn.player);
      conn.entered = false;
      conn.deadUntil = 0;
      conn.dirty = true;
    }
  }
}

setInterval(() => {
  if (connections.size === 0) return;
  const now = Date.now();
  defence.step(now, BROADCAST_INTERVAL_MS / 1000);
  stepProjectiles(now);
  processRespawns(now);
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
  }));
  const state: ServerMessage = {
    type: "state",
    t: now,
    players,
    projectiles: projectileList,
    items: [...items.values()],
    objective,
    enemies: defence.snapshot(),
    defence: defence.state,
    announcements: pendingAnnouncements.length ? pendingAnnouncements : undefined,
  };
  pendingAnnouncements = [];
  const payload = JSON.stringify(state);
  for (const conn of connections.values()) {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(payload);
  }
}, BROADCAST_INTERVAL_MS);

function flushWorld(): void {
  if (!worldDirty) return;
  worldDirty = false;
  saveWorld(items.values(), objective, defence.state, (id) => connections.get(id)?.player);
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${PORT}`);
});
