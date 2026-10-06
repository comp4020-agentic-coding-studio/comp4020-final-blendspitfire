import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlayerState } from "../shared/protocol.ts";

const DB_PATH = process.env.DB_PATH ?? "/data/game.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    color TEXT NOT NULL,
    x REAL NOT NULL,
    z REAL NOT NULL,
    rotation REAL NOT NULL,
    last_seen INTEGER NOT NULL
  )
`);

const getStmt = db.prepare("SELECT id, color, x, z, rotation FROM players WHERE id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO players (id, color, x, z, rotation, last_seen)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET x = excluded.x, z = excluded.z, rotation = excluded.rotation, last_seen = excluded.last_seen
`);

export function loadPlayer(id: string): PlayerState | undefined {
  const row = getStmt.get(id) as
    | { id: string; color: string; x: number; z: number; rotation: number }
    | undefined;
  return row;
}

export function savePlayer(player: PlayerState): void {
  upsertStmt.run(player.id, player.color, player.x, player.z, player.rotation, Date.now());
}

const randomColor = (): string => {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 55%)`;
};

export function loadOrCreatePlayer(id: string): PlayerState {
  const existing = loadPlayer(id);
  if (existing) return existing;
  const player: PlayerState = { id, color: randomColor(), x: 0, z: 0, rotation: 0 };
  savePlayer(player);
  return player;
}
