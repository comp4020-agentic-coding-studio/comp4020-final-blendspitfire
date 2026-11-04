import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { WebSocketServer } from "ws";
import { ROOM_MAX, createRoom, type Room } from "./room.ts";
import { PERSIST_INTERVAL_MS, ROOM_CLOSE, type RoomInfo } from "../shared/protocol.ts";

const PORT = Number(process.env.PORT ?? 8080);
const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wav": "audio/wav",
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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/readme/" || url.pathname === "/readme") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readmePage());
    return;
  }

  // the title screen's list of sites (rooms), and making a new one
  if (url.pathname === "/api/rooms") {
    if (req.method === "POST") {
      const room = openRoom();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ id: room.id }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(roomList()));
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

// --- Rooms ------------------------------------------------------------------
// Players make their own sites from the title screen (ADR draft 2026-11-05):
// each is a world of its own for up to ROOM_MAX, listed for everyone, can't
// be joined once its reactor's on, and is thrown away a minute after the last
// player leaves. The board, names and stats are shared (server/db.ts).

const rooms = new Map<string, Room>();
/** when each room last had nobody in it (absent = someone's there) */
const emptySince = new Map<string, number>();
const ROOM_EMPTY_MS = 60_000;
/** a room nobody ever joined goes too, but only after the same minute */

function openRoom(): Room {
  let id: string;
  do id = `SITE-${randomBytes(2).toString("hex").toUpperCase()}`;
  while (rooms.has(id));
  const room = createRoom(id, {
    version: VERSION,
    boardChanged: () => {
      for (const r of rooms.values()) r.boardChanged();
    },
  });
  rooms.set(id, room);
  emptySince.set(id, Date.now());
  console.log(`{${id}} opened (${rooms.size} site(s))`);
  return room;
}

function roomList(): RoomInfo[] {
  return [...rooms.values()]
    .map((r) => ({ id: r.id, players: r.size(), max: ROOM_MAX, started: r.started(), wave: r.wave(), names: r.names() }))
    .sort((a, b) => Number(a.started) - Number(b.started) || b.players - a.players || a.id.localeCompare(b.id));
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.size() > 0) {
      emptySince.delete(room.id);
      continue;
    }
    const since = emptySince.get(room.id);
    if (since === undefined) emptySince.set(room.id, now);
    else if (now - since >= ROOM_EMPTY_MS) {
      room.dispose();
      rooms.delete(room.id);
      emptySince.delete(room.id);
      console.log(`{${room.id}} empty for ${ROOM_EMPTY_MS / 1000}s: closed (${rooms.size} site(s))`);
    }
  }
}, 5000);

function parsePlayerId(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === "playerId" && value) return value;
  }
  return undefined;
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

/**
 * /ws?room=SITE-XXXX&name=... joins that site; with no room it's a quick
 * join: the fullest site that still has space and hasn't started, or a new
 * one. A site that's gone, full or under way closes the socket with a code
 * the client reads (ROOM_CLOSE in shared/protocol.ts).
 */
wss.on("connection", (socket, req) => {
  const playerId = pendingIds.get(req) ?? randomUUID();
  const url = new URL(req.url ?? "/ws", "http://localhost");
  const wanted = url.searchParams.get("room");
  const name = url.searchParams.get("name") ?? undefined;
  socket.on("error", () => socket.terminate());
  let room: Room | undefined;
  if (wanted) {
    room = rooms.get(wanted.toUpperCase());
    if (!room) return socket.close(ROOM_CLOSE.gone, "no such site");
  } else {
    room =
      [...rooms.values()].filter((r) => r.canJoin(playerId)).sort((a, b) => b.size() - a.size())[0] ?? openRoom();
  }
  if (!room.canJoin(playerId)) {
    return socket.close(room.started() ? ROOM_CLOSE.started : ROOM_CLOSE.full, room.started() ? "under way" : "full");
  }
  // the same person in another site (another tab): that tab's closed, one body per id
  for (const other of rooms.values()) if (other !== room && other.has(playerId)) other.kick(playerId);
  emptySince.delete(room.id);
  room.join(socket, playerId, name);
});

setInterval(() => {
  for (const room of rooms.values()) room.flushPlayers();
}, PERSIST_INTERVAL_MS);

// Fly stops an idle machine with SIGINT/SIGTERM: write out players' last
// changes before going (the sites themselves aren't kept).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const room of rooms.values()) room.flushPlayers();
    process.exit(0);
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${PORT}`);
});
