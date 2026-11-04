import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PlayerState } from "../shared/protocol.ts";
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
// the name they play under (added after the table: older databases get the column here)
if (!(db.prepare("PRAGMA table_info(players)").all() as { name: string }[]).some((c) => c.name === "handle")) {
  db.exec("ALTER TABLE players ADD COLUMN handle TEXT");
}

// (Sites --- items, the reactor, quota, gore --- live only in memory now:
// server/room.ts. Older databases still carry `items` and `world` tables;
// they're left alone, unread.)

// The arcade board: what each player has done across every attempt and run
// (never reset), and every run that was won, from every site.
db.exec(`
  CREATE TABLE IF NOT EXISTS stats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0,
    boxes INTEGER NOT NULL DEFAULT 0, -- retired stat, kept so older databases stay compatible
    attempts INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0
  );
  -- the arcade board proper: one row per name, its best single attempt
  CREATE TABLE IF NOT EXISTS names (
    name TEXT PRIMARY KEY,
    score INTEGER NOT NULL,
    kills INTEGER NOT NULL,
    waves INTEGER NOT NULL,
    won INTEGER NOT NULL,
    at INTEGER NOT NULL
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

const bumpStmt = db.prepare(`
  INSERT INTO stats (id, name, kills, attempts, wins) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, kills = kills + excluded.kills,
    attempts = attempts + excluded.attempts, wins = wins + excluded.wins
`);
const topStatsStmt = db.prepare("SELECT id, name, kills, attempts, wins FROM stats ORDER BY wins DESC, kills DESC LIMIT ?");

/** one name's best attempt on the board */
export interface NameScore {
  name: string;
  score: number;
  kills: number;
  waves: number;
  won: boolean;
}
const getNameStmt = db.prepare("SELECT score FROM names WHERE name = ?");
const putNameStmt = db.prepare(`
  INSERT INTO names (name, score, kills, waves, won, at) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET score = excluded.score, kills = excluded.kills, waves = excluded.waves, won = excluded.won, at = excluded.at
`);
const topNamesStmt = db.prepare("SELECT name, score, kills, waves, won FROM names ORDER BY score DESC, at ASC LIMIT ?");
const rankStmt = db.prepare("SELECT COUNT(*) AS above FROM names WHERE score > ?");

/**
 * An attempt's score for a name: kept only if it beats what that name
 * already has (arcade rules: a lower score never overwrites). True if it
 * went on the board.
 */
export function recordScore(s: NameScore): boolean {
  const had = getNameStmt.get(s.name) as { score: number } | undefined;
  if (had && had.score >= s.score) return false;
  putNameStmt.run(s.name, s.score, s.kills, s.waves, s.won ? 1 : 0, Date.now());
  return true;
}
export function topNames(limit: number): NameScore[] {
  return (topNamesStmt.all(limit) as { name: string; score: number; kills: number; waves: number; won: number }[]).map((r) => ({ ...r, won: r.won === 1 }));
}
/** where a name stands on the board now (1 = top), or undefined if it isn't on it */
export function rankOf(name: string): number | undefined {
  const had = getNameStmt.get(name) as { score: number } | undefined;
  if (!had) return undefined;
  return (rankStmt.get(had.score) as { above: number }).above + 1;
}
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

const getStmt = db.prepare("SELECT id, color, x, z, rotation, handle FROM players WHERE id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO players (id, color, x, z, rotation, last_seen, handle)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET color = excluded.color, x = excluded.x, z = excluded.z, rotation = excluded.rotation,
    last_seen = excluded.last_seen, handle = excluded.handle
`);

export function loadPlayer(id: string): PlayerState | undefined {
  const row = getStmt.get(id) as
    | { id: string; color: string; x: number; z: number; rotation: number; handle: string | null }
    | undefined;
  if (!row) return undefined;
  const { handle, ...rest } = row;
  return handle ? { ...rest, handle } : rest;
}

export function savePlayer(player: PlayerState): void {
  upsertStmt.run(player.id, player.color, player.x, player.z, player.rotation, Date.now(), player.handle ?? null);
}

const randomColor = (): string => PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

export function loadOrCreatePlayer(id: string): PlayerState {
  const existing = loadPlayer(id);
  if (existing) return existing;
  const player: PlayerState = { id, color: randomColor(), x: 0, z: 0, rotation: 0 };
  savePlayer(player);
  return player;
}
