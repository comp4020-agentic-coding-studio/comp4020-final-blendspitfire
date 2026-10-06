import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { loadOrCreatePlayer, savePlayer } from "./db.ts";
import {
  BROADCAST_INTERVAL_MS,
  PERSIST_INTERVAL_MS,
  WORLD_BOUNDS,
  type ClientMessage,
  type MoveMessage,
  type PlayerState,
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
}

const connections = new Map<string, Connection>();
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
  const conn: Connection = { socket, player, dirty: false };
  connections.set(playerId, conn);

  const welcome: ServerMessage & { type: "welcome" } = {
    type: "welcome",
    you: player,
    players: [...connections.values()].map((c) => c.player),
  };
  socket.send(JSON.stringify(welcome));

  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type !== "move") return;
    const move = msg as MoveMessage;
    conn.player.x = clamp(move.x, -WORLD_BOUNDS, WORLD_BOUNDS);
    conn.player.z = clamp(move.z, -WORLD_BOUNDS, WORLD_BOUNDS);
    conn.player.rotation = move.rotation;
    conn.dirty = true;
  });

  socket.on("close", () => {
    connections.delete(playerId);
    savePlayer(conn.player);
  });
});

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

setInterval(() => {
  if (connections.size === 0) return;
  const players = [...connections.values()].map((c) => c.player);
  const state: ServerMessage = { type: "state", players };
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
