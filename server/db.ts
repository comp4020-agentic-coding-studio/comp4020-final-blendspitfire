import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ItemState, ObjectiveState, PlayerState } from "../shared/protocol.ts";
import { PLAYER_COLORS } from "../shared/palette.ts";

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

// The world: every item where it lies (held ones saved where their holder
// stood, since nobody is holding anything after a restart), and the
// objective. This is what makes the facility persistent --- what people
// built and moved is still there the next day, after the machine has
// stopped and started again.
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    x REAL NOT NULL,
    z REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS world (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const listItemsStmt = db.prepare("SELECT id, kind, x, z FROM items");
const clearItemsStmt = db.prepare("DELETE FROM items");
const insertItemStmt = db.prepare("INSERT INTO items (id, kind, x, z) VALUES (?, ?, ?, ?)");
const getWorldStmt = db.prepare("SELECT value FROM world WHERE key = ?");
const setWorldStmt = db.prepare(
  "INSERT INTO world (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);

/** the saved items, or undefined if the world has never been saved (a fresh volume) */
export function loadItems(): ItemState[] | undefined {
  if (getWorldStmt.get("seeded") === undefined) return undefined;
  return (listItemsStmt.all() as { id: string; kind: ItemState["kind"]; x: number; z: number }[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    x: r.x,
    z: r.z,
  }));
}

export function loadObjective(): ObjectiveState {
  const row = getWorldStmt.get("objective") as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as ObjectiveState) : { active: false };
}

/**
 * Write the whole world in one transaction: a few dozen rows, so replacing
 * them all is simpler than tracking each change and still cheap.
 * `positionOf` says where a held item would land if its holder vanished.
 */
export function saveWorld(
  items: Iterable<ItemState>,
  objective: ObjectiveState,
  positionOf: (playerId: string) => { x: number; z: number } | undefined,
): void {
  db.exec("BEGIN");
  try {
    clearItemsStmt.run();
    for (const item of items) {
      const at = item.heldBy !== undefined ? positionOf(item.heldBy) ?? item : item;
      insertItemStmt.run(item.id, item.kind, at.x, at.z);
    }
    setWorldStmt.run("objective", JSON.stringify(objective));
    setWorldStmt.run("seeded", "1");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const getStmt = db.prepare("SELECT id, color, x, z, rotation FROM players WHERE id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO players (id, color, x, z, rotation, last_seen)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET color = excluded.color, x = excluded.x, z = excluded.z, rotation = excluded.rotation, last_seen = excluded.last_seen
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

const randomColor = (): string => PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

export function loadOrCreatePlayer(id: string): PlayerState {
  const existing = loadPlayer(id);
  if (existing) return existing;
  const player: PlayerState = { id, color: randomColor(), x: 0, z: 0, rotation: 0 };
  savePlayer(player);
  return player;
}
