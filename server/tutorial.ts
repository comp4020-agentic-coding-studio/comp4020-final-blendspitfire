import { randomUUID } from "node:crypto";
import { type ItemKind, type ItemState, segmentHitsCircle } from "../shared/protocol.ts";
import {
  DROP_PAD,
  LESSONS,
  MOVE_PAD,
  TARGET_HITS,
  TARGET_RADIUS,
  TUT_CLUSTER,
  TUT_GRENADE_AT,
  TUT_GUN_AT,
  TUT_TARGETS,
  inTutorial,
  roomAt,
} from "../shared/tutorial.ts";

// The tutorial's rules, per player (shared/tutorial.ts has the layout).
// Each player in it has a stage (lessons done); the door out of a room is
// open to them once their stage is past it. What a lesson needs --- a
// rifle to pick up, targets to drop, a grenade, a huddle to throw it at ---
// exists only for them and only while they're in the tutorial: their items
// carry `owner` and nobody else can take them, and the lot is cleared when
// they leave (fly out, disconnect) so it never piles up or gets saved.

export interface Trainee {
  stage: number;
  /** hits on each target so far (shoot room) */
  hits: number[];
  /** the huddle's been blasted (grenade room) */
  blasted: boolean;
}

export interface TutorialWorld {
  items: Map<string, ItemState>;
  /** an item of theirs has changed (spawned, gone): resend items */
  changed(): void;
  /** a lesson done: say so in the log */
  log(playerId: string, what: string): void;
  /** they've a grenade in the air right now (thrown, not yet gone off) */
  throwing(playerId: string): boolean;
}

const near = (a: { x: number; z: number }, b: { x: number; z: number }, r: number) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

export class Tutorial {
  readonly trainees = new Map<string, Trainee>();
  private readonly world: TutorialWorld;

  constructor(world: TutorialWorld) {
    this.world = world;
  }

  /** start (or restart) someone at the first lesson */
  enrol(playerId: string): Trainee {
    this.leave(playerId);
    const t: Trainee = { stage: 0, hits: TUT_TARGETS.map(() => 0), blasted: false };
    this.trainees.set(playerId, t);
    return t;
  }

  /** they've left the tutorial (flown out, disconnected): clear away what was theirs */
  leave(playerId: string): void {
    if (!this.trainees.delete(playerId)) return;
    let gone = false;
    for (const item of this.world.items.values()) {
      if (item.owner === playerId) {
        this.world.items.delete(item.id);
        gone = true;
      }
    }
    if (gone) this.world.changed();
  }

  private give(playerId: string, kind: ItemKind, at: { x: number; z: number }): void {
    const id = randomUUID();
    this.world.items.set(id, { id, kind, x: at.x, z: at.z, owner: playerId });
    this.world.changed();
  }

  private mine(playerId: string, kind: ItemKind): ItemState | undefined {
    for (const item of this.world.items.values()) if (item.owner === playerId && item.kind === kind) return item;
    return undefined;
  }

  private pass(playerId: string, t: Trainee): void {
    this.world.log(playerId, `tutorial: ${LESSONS[t.stage]} done`);
    t.stage += 1;
  }

  /**
   * Once a tick for everyone in the tutorial: check the lesson they're on,
   * and keep what it needs on hand (a rifle back on its stand if they've
   * dropped it somewhere silly, a fresh grenade after a miss).
   */
  step(playerId: string, at: { x: number; z: number }, holding: ItemState | undefined): void {
    const t = this.trainees.get(playerId);
    if (!t || !inTutorial(at.x, at.z)) return;
    const lesson = LESSONS[t.stage];
    // nothing of theirs is loose in a room they've already left behind them
    if (lesson === "move") {
      if (near(at, MOVE_PAD, MOVE_PAD.r)) this.pass(playerId, t);
    } else if (lesson === "pickup") {
      if (holding?.kind === "gun") this.pass(playerId, t);
      else if (!this.mine(playerId, "gun")) this.give(playerId, "gun", TUT_GUN_AT);
    } else if (lesson === "shoot") {
      if (!this.mine(playerId, "gun")) this.give(playerId, "gun", TUT_GUN_AT);
      if (t.hits.every((h) => h >= TARGET_HITS)) this.pass(playerId, t);
    } else if (lesson === "drop") {
      const gun = this.mine(playerId, "gun");
      if (gun && gun.heldBy === undefined && near(gun, DROP_PAD, DROP_PAD.r + 0.3)) {
        this.pass(playerId, t);
        this.world.items.delete(gun.id);
        this.world.changed();
      } else if (!gun) this.give(playerId, "gun", DROP_PAD);
    } else if (lesson === "grenade") {
      if (t.blasted) this.pass(playerId, t);
      else if (!this.mine(playerId, "grenade") && !this.world.throwing(playerId) && roomAt(at.x, at.z) === 4) this.give(playerId, "grenade", TUT_GRENADE_AT);
    }
  }

  /** a shot of theirs, swept from `from` to `to` along the line: does it stop on a standing target first? */
  shot(playerId: string, x: number, z: number, dirX: number, dirZ: number, from: number, to: number): number | undefined {
    const t = this.trainees.get(playerId);
    if (!t || LESSONS[t.stage] !== "shoot") return undefined;
    let best: { i: number; at: number } | undefined;
    TUT_TARGETS.forEach((target, i) => {
      if (t.hits[i] >= TARGET_HITS) return;
      const at = segmentHitsCircle(x, z, dirX, dirZ, from, to, target.x, target.z, TARGET_RADIUS);
      if (at !== undefined && (!best || at < best.at)) best = { i, at };
    });
    if (!best) return undefined;
    t.hits[best.i] += 1;
    return best.at;
  }

  /** a grenade of theirs went off here */
  blast(playerId: string, x: number, z: number, radius: number): void {
    const t = this.trainees.get(playerId);
    if (!t || LESSONS[t.stage] !== "grenade") return;
    if (TUT_CLUSTER.some((d) => near(d, { x, z }, radius))) t.blasted = true;
  }
}
