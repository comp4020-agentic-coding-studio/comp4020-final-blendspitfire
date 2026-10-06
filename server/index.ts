import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { loadOrCreatePlayer, savePlayer } from "./db.ts";
import {
  BROADCAST_INTERVAL_MS,
  DEATH_DURATION_MS,
  HIT_RADIUS,
  PERSIST_INTERVAL_MS,
  PROJECTILE_MAX_BOUNCES,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_TTL_MS,
  SPAWN_POINTS,
  WORLD_BOUNDS,
  overlapsAnyObstacle,
  resolveObstacles,
  type ClientMessage,
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
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
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
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
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
}

const connections = new Map<string, Connection>();

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
  const conn: Connection = { socket, player, dirty: false, deadUntil: 0, score: 0 };
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
      const clamped = {
        x: clamp(move.x, -WORLD_BOUNDS, WORLD_BOUNDS),
        z: clamp(move.z, -WORLD_BOUNDS, WORLD_BOUNDS),
      };
      const resolved = resolveObstacles(clamped.x, clamped.z);
      conn.player.x = resolved.x;
      conn.player.z = resolved.z;
      conn.player.rotation = move.rotation;
      conn.dirty = true;
      return;
    }

    if (msg.type === "shoot") {
      spawnProjectile(conn.player);
      return;
    }
  });

  socket.on("close", () => {
    connections.delete(playerId);
    savePlayer(conn.player);
  });
});

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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
  for (const p of projectiles.values()) {
    if (now - p.spawnedAt > PROJECTILE_TTL_MS || p.bounces > PROJECTILE_MAX_BOUNCES) {
      projectiles.delete(p.id);
      continue;
    }

    const nx = p.x + p.vx * dt;
    const nz = p.z + p.vz * dt;
    const hitWallX = nx < -WORLD_BOUNDS || nx > WORLD_BOUNDS;
    const hitWallZ = nz < -WORLD_BOUNDS || nz > WORLD_BOUNDS;
    const hitObstacleX = overlapsAnyObstacle(nx, p.z, PROJECTILE_RADIUS);
    const hitObstacleZ = overlapsAnyObstacle(p.x, nz, PROJECTILE_RADIUS);

    if (hitWallX || hitObstacleX) p.vx = -p.vx;
    if (hitWallZ || hitObstacleZ) p.vz = -p.vz;
    if (hitWallX || hitWallZ || hitObstacleX || hitObstacleZ) {
      p.bounces += 1;
    } else {
      p.x = nx;
      p.z = nz;
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
  const players = [...connections.values()].map((c) => netPlayer(c, now));
  const projectileList: ProjectileState[] = [...projectiles.values()].map((p) => ({
    id: p.id,
    ownerId: p.ownerId,
    x: p.x,
    z: p.z,
  }));
  const state: ServerMessage = { type: "state", players, projectiles: projectileList };
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
