import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { loadOrCreatePlayer, savePlayer } from "./db.ts";
import { PLAYER_COLORS } from "../shared/palette.ts";
import {
  BROADCAST_INTERVAL_MS,
  DEATH_DURATION_MS,
  FIRE_COOLDOWN_MS,
  HIT_RADIUS,
  ITEM_CAPS,
  PERSIST_INTERVAL_MS,
  PICKUP_RANGE,
  PROJECTILE_MAX_BOUNCES,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL_MS,
  PLAY_BOUNDS,
  SPAWN_POINTS,
  STATIONS,
  STATION_RESTOCK_MS,
  clampToPlayBounds,
  inRect,
  isInYard,
  isWalkable,
  overlapsAnyObstacle,
  placementVerdict,
  resolveObstacles,
  worldObstacles,
  type ClientMessage,
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
}

const connections = new Map<string, Connection>();

// In memory only for now: every restart puts the world's items back where
// they started. (Persisting them is planned, just not until the item set
// settles down.)
const items = new Map<string, ItemState>();

const INITIAL_ITEMS: { kind: ItemKind; x: number; z: number }[] = [
  { kind: "gun", x: 3, z: 3 },
  { kind: "gun", x: -3, z: -3 },
  { kind: "gun", x: 9, z: -9 },
  { kind: "box", x: 8, z: -2 },
  { kind: "box", x: 9, z: -2 },
  { kind: "box", x: -9, z: 3 },
  { kind: "box", x: -10, z: 3 },
  { kind: "box", x: 2, z: 11 },
  { kind: "box", x: -1, z: -12 },
];
for (const it of [...INITIAL_ITEMS, ...STATIONS]) spawnItem(it.kind, it.x, it.z);

function spawnItem(kind: ItemKind, x: number, z: number): void {
  const id = randomUUID();
  items.set(id, { id, kind, x, z });
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
    spawnProjectile(conn.player);
  } else if (item.kind === "box") {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const verdict = placementVerdict(x, z, conn.player, worldObstacles(items.values()), livingPlayers(now));
    if (verdict !== "ok") return;
    item.heldBy = undefined;
    item.x = x;
    item.z = z;
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
  const conn: Connection = { socket, player, dirty: true, deadUntil: 0, score: 0, lastFireAt: 0 };
  connections.set(playerId, conn);

  const now = Date.now();
  const welcome: ServerMessage & { type: "welcome" } = {
    type: "welcome",
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
      const resolved = resolveObstacles(clamped.x, clamped.z, worldObstacles(items.values()));
      // walls stop a walking player, but a client could still claim a
      // jump straight to the far side of one
      if (!isWalkable(resolved.x, resolved.z)) return;
      conn.player.x = resolved.x;
      conn.player.z = resolved.z;
      conn.player.rotation = move.rotation;
      conn.dirty = true;
      return;
    }

    if (msg.type === "pickup") {
      const item = items.get(msg.itemId);
      if (!item || item.heldBy !== undefined || heldItem(playerId)) return;
      const reach = Math.hypot(item.x - conn.player.x, item.z - conn.player.z);
      if (reach > PICKUP_RANGE) return;
      item.heldBy = playerId;
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

interface ServerProjectile {
  id: string;
  ownerId: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  bounces: number;
  spawnedAt: number;
}

const projectiles = new Map<string, ServerProjectile>();

function spawnProjectile(owner: PlayerState): void {
  const id = randomUUID();
  const dirX = Math.sin(owner.rotation);
  const dirZ = Math.cos(owner.rotation);
  projectiles.set(id, {
    id,
    ownerId: owner.id,
    // offset forward so it doesn't immediately overlap its own shooter
    x: owner.x + dirX * 0.8,
    z: owner.z + dirZ * 0.8,
    vx: dirX * PROJECTILE_SPEED,
    vz: dirZ * PROJECTILE_SPEED,
    bounces: 0,
    spawnedAt: Date.now(),
  });
}

function respawn(player: PlayerState): void {
  const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  player.x = spawn.x;
  player.z = spawn.z;
}

function stepProjectiles(dt: number): void {
  const now = Date.now();
  const obstacles = worldObstacles(items.values());
  for (const p of projectiles.values()) {
    if (now - p.spawnedAt > PROJECTILE_TTL_MS || p.bounces > PROJECTILE_MAX_BOUNCES) {
      projectiles.delete(p.id);
      continue;
    }

    const nx = p.x + p.vx * dt;
    const nz = p.z + p.vz * dt;
    // walls are obstacles like any other, so this is all the bouncing
    const hitX = overlapsAnyObstacle(nx, p.z, PROJECTILE_RADIUS, obstacles);
    const hitZ = overlapsAnyObstacle(p.x, nz, PROJECTILE_RADIUS, obstacles);

    if (hitX) p.vx = -p.vx;
    if (hitZ) p.vz = -p.vz;
    if (hitX || hitZ) {
      p.bounces += 1;
    } else {
      p.x = nx;
      p.z = nz;
    }
    // a shot through the doorway fizzles at the yard line rather than
    // reaching anyone in the no-fire zone; and nothing outlives the world
    if (isInYard(p.x, p.z) || !inRect(PLAY_BOUNDS, p.x, p.z, -1)) {
      projectiles.delete(p.id);
      continue;
    }

    // Neutral: a projectile can hit its own owner too (e.g. after bouncing
    // back), not just other players. The forward spawn offset already keeps
    // it clear of the shooter at the moment it's fired.
    for (const conn of connections.values()) {
      if (isDead(conn, now)) continue; // already down, can't be hit again
      const dx = conn.player.x - p.x;
      const dz = conn.player.z - p.z;
      if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS) {
        conn.deadUntil = now + DEATH_DURATION_MS;
        conn.dirty = true;
        dropHeld(conn.player);
        const ownerConn = connections.get(p.ownerId);
        if (ownerConn) {
          ownerConn.score += conn.player.id === p.ownerId ? -1 : 1;
        }
        projectiles.delete(p.id);
        break;
      }
    }
  }
}

function processRespawns(now: number): void {
  for (const conn of connections.values()) {
    if (conn.deadUntil !== 0 && now >= conn.deadUntil) {
      respawn(conn.player);
      conn.deadUntil = 0;
      conn.dirty = true;
    }
  }
}

setInterval(() => {
  if (connections.size === 0) return;
  const now = Date.now();
  stepProjectiles(BROADCAST_INTERVAL_MS / 1000);
  processRespawns(now);
  restockStations(now);
  const players = [...connections.values()].map((c) => netPlayer(c, now));
  const projectileList: ProjectileState[] = [...projectiles.values()].map((p) => ({
    id: p.id,
    ownerId: p.ownerId,
    x: p.x,
    z: p.z,
  }));
  const state: ServerMessage = {
    type: "state",
    players,
    projectiles: projectileList,
    items: [...items.values()],
  };
  const payload = JSON.stringify(state);
  for (const conn of connections.values()) {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(payload);
  }
}, BROADCAST_INTERVAL_MS);

setInterval(() => {
  for (const conn of connections.values()) {
    if (conn.dirty) {
      savePlayer(conn.player);
      conn.dirty = false;
    }
  }
}, PERSIST_INTERVAL_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${PORT}`);
});
