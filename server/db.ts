import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GoreMark, ItemState, ObjectiveState, PlayerState } from "../shared/protocol.ts";
import type { DefenceState } from "../shared/enemies.ts";
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

/** the reactor's health and the wave count, so a restart mid-attack picks up where it was */
export function loadDefence(): DefenceState | undefined {
  const row = getWorldStmt.get("defence") as { value: string } | undefined;
  if (!row) return undefined;
  const d = JSON.parse(row.value) as DefenceState;
  // a run that ended (won, or the reactor dead) before the restart stays ended: the caller winds it up
  if (d.phase === "won" || d.phase === "blackout") return d;
  // the enemies out at the time weren't saved, and neither is a wave/break
  // timer from before the restart: back to a fresh break before the same wave
  return { reactorHealth: d.reactorHealth, wave: d.wave, phase: "break" };
}

/**
 * Write the whole world in one transaction: a few dozen rows, so replacing
 * them all is simpler than tracking each change and still cheap.
 * `positionOf` says where a held item would land if its holder vanished.
 */
export function saveWorld(
  items: Iterable<ItemState>,
  objective: ObjectiveState,
  defence: DefenceState,
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
    setWorldStmt.run("defence", JSON.stringify(defence));
    setWorldStmt.run("seeded", "1");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// The arcade board: what each player has done across every attempt and run
// (never reset), and every run that was won. The run in progress --- how
// many attempts, how far the best got --- lives in `world` as "run".
db.exec(`
  CREATE TABLE IF NOT EXISTS stats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0,
    boxes INTEGER NOT NULL DEFAULT 0, -- retired stat, kept so older databases stay compatible
    attempts INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS runs (
    n INTEGER PRIMARY KEY,
    won_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    crew TEXT NOT NULL
  );
`);

export interface PlayerStats {
  id: string;
  name: string;
  kills: number;
  attempts: number;
  wins: number;
}
export interface RunRecord {
  n: number;
  wonAt: number;
  attempts: number;
  crew: string[];
}
export interface RunProgress {
  /** attempts started in this run so far */
  attempts: number;
  /** the most waves any of them cleared */
  best: number;
}

const bumpStmt = db.prepare(`
  INSERT INTO stats (id, name, kills, attempts, wins) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, kills = kills + excluded.kills,
    attempts = attempts + excluded.attempts, wins = wins + excluded.wins
`);
const topStatsStmt = db.prepare("SELECT id, name, kills, attempts, wins FROM stats ORDER BY wins DESC, kills DESC LIMIT ?");
const listRunsStmt = db.prepare("SELECT n, won_at, attempts, crew FROM runs ORDER BY n DESC LIMIT ?");
const insertRunStmt = db.prepare("INSERT INTO runs (won_at, attempts, crew) VALUES (?, ?, ?)");

/** add to a player's lifetime totals (and record the name they're shown under now) */
export function bumpStats(id: string, name: string, add: Partial<Omit<PlayerStats, "id" | "name">>): void {
  bumpStmt.run(id, name, add.kills ?? 0, add.attempts ?? 0, add.wins ?? 0);
}
export function topStats(limit: number): PlayerStats[] {
  return topStatsStmt.all(limit) as unknown as PlayerStats[];
}
export function recentRuns(limit: number): RunRecord[] {
  return (listRunsStmt.all(limit) as { n: number; won_at: number; attempts: number; crew: string }[]).map((r) => ({
    n: r.n,
    wonAt: r.won_at,
    attempts: r.attempts,
    crew: JSON.parse(r.crew) as string[],
  }));
}
export function recordRun(attempts: number, crew: string[]): void {
  insertRunStmt.run(Date.now(), attempts, JSON.stringify(crew));
}
export function loadRun(): RunProgress {
  const row = getWorldStmt.get("run") as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as RunProgress) : { attempts: 0, best: 0 };
}
export function saveRun(run: RunProgress): void {
  setWorldStmt.run("run", JSON.stringify(run));
}

/** the crew's shared quota; kept across attempts and restarts, cleared when a run's won */
export function loadFunds(): number {
  const row = getWorldStmt.get("funds") as { value: string } | undefined;
  return row ? Number(JSON.parse(row.value)) || 0 : 0;
}
export function saveFunds(funds: number): void {
  setWorldStmt.run("funds", JSON.stringify(funds));
}

export function loadGore(): GoreMark[] {
  const row = getWorldStmt.get("gore") as { value: string } | undefined;
  try {
    return row ? (JSON.parse(row.value) as GoreMark[]) : [];
  } catch {
    return [];
  }
}
export function saveGore(marks: GoreMark[]): void {
  setWorldStmt.run("gore", JSON.stringify(marks));
}

/** a won run: the world goes back to how a fresh volume starts it */
export function clearItems(): void {
  clearItemsStmt.run();
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
