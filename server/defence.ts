import { randomUUID } from "node:crypto";
import {
  BOX_HIT_POINTS,
  ENEMY_ATTACK_INTERVAL_MS,
  ENEMY_HIT_POINTS,
  ENEMY_RADIUS,
  ENEMY_REACH,
  ENEMY_REACTOR_DAMAGE,
  ENEMY_SPEED,
  FIRST_WAVE_DELAY_MS,
  FlowField,
  MAX_ENEMIES,
  SPAWNS,
  SPAWN_INTERVAL_MS,
  WAVE_GAP_MS,
  waveSize,
  type DefenceState,
  type EnemyState,
} from "../shared/enemies.ts";
import {
  OBSTACLES,
  PLAYER_RADIUS,
  REACTOR,
  REACTOR_BODY,
  boxObstacle,
  resolveObstacles,
  segmentHitsCircle,
  type ItemState,
  type ObjectiveState,
} from "../shared/protocol.ts";

// The defence: waves of enemies from the breaches while the reactor is
// live, walking the flow field to it and wearing it down. If it reaches
// zero the reactor goes dark --- the attempt has failed --- but everything
// players built stays where it is for the next one.

interface Enemy extends EnemyState {
  hp: number;
  nextAttackAt: number;
}

/** what the defence needs from the rest of the server */
export interface World {
  objective: ObjectiveState;
  items: Map<string, ItemState>;
  /** living players' positions, by id */
  players(): { id: string; x: number; z: number }[];
  /** an enemy reached a player */
  hurtPlayer(id: string, now: number): void;
  /** something about the world changed that should be saved */
  changed(): void;
  /** tell everyone something happened */
  announce(text: string): void;
}

export class Defence {
  private readonly enemies = new Map<string, Enemy>();
  private readonly field = new FlowField();
  private fieldKey = "";
  private readonly boxDamage = new Map<string, number>();
  state: DefenceState;
  private toSpawn = 0;
  private nextSpawnAt = 0;
  private spawnTurn = 0;

  private readonly world: World;

  constructor(world: World, saved: DefenceState | undefined) {
    this.world = world;
    this.state = saved ?? { reactorHealth: 1, wave: 0 };
  }

  /** the reactor just went live: the first wave comes after a breather */
  start(now: number): void {
    this.state = { reactorHealth: 1, wave: 0, nextWaveAt: now + FIRST_WAVE_DELAY_MS };
    this.world.changed();
  }

  snapshot(): EnemyState[] {
    return [...this.enemies.values()].map(({ id, x, z, rotation, hp }) => ({
      id,
      x: Math.round(x * 100) / 100,
      z: Math.round(z * 100) / 100,
      rotation: Math.round(rotation * 100) / 100,
      health: hp / ENEMY_HIT_POINTS,
    }));
  }

  /** a shot's stretch this tick: the first enemy on it, and where along it */
  firstHit(x: number, z: number, dirX: number, dirZ: number, from: number, to: number): { id: string; at: number } | undefined {
    let best: { id: string; at: number } | undefined;
    for (const e of this.enemies.values()) {
      const t = segmentHitsCircle(x, z, dirX, dirZ, from, best?.at ?? to, e.x, e.z, ENEMY_RADIUS + 0.05);
      if (t !== undefined) best = { id: e.id, at: t };
    }
    return best;
  }

  /** a shot landed; true if it killed */
  damage(id: string): boolean {
    const e = this.enemies.get(id);
    if (!e) return false;
    e.hp -= 1;
    if (e.hp > 0) return false;
    this.enemies.delete(id);
    return true;
  }

  step(now: number, dt: number): void {
    if (!this.world.objective.active) {
      // no live reactor, no attack: anything left over goes away
      if (this.enemies.size) this.enemies.clear();
      return;
    }
    this.rebuildFieldIfBoxesMoved();
    this.runWaves(now);
    this.moveAndAttack(now, dt);
  }

  private rebuildFieldIfBoxesMoved(): void {
    const boxes = [...this.world.items.values()].filter((i) => i.kind === "box" && i.heldBy === undefined);
    const key = boxes.map((b) => `${b.id}:${b.x.toFixed(2)},${b.z.toFixed(2)}`).join("|");
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.field.build([...OBSTACLES, ...boxes.map(boxObstacle)]);
  }

  private runWaves(now: number): void {
    const s = this.state;
    if (this.toSpawn === 0 && this.enemies.size === 0) {
      if (s.nextWaveAt === undefined) {
        s.nextWaveAt = now + WAVE_GAP_MS;
        this.world.changed();
      } else if (now >= s.nextWaveAt) {
        s.wave += 1;
        s.nextWaveAt = undefined;
        this.toSpawn = waveSize(s.wave);
        this.nextSpawnAt = now;
        this.world.announce(`wave ${s.wave} incoming`);
        this.world.changed();
      }
    }
    while (this.toSpawn > 0 && now >= this.nextSpawnAt && this.enemies.size < MAX_ENEMIES) {
      const spawn = SPAWNS[this.spawnTurn++ % SPAWNS.length];
      const id = randomUUID();
      this.enemies.set(id, {
        id,
        x: spawn.x + (Math.random() - 0.5) * 0.6,
        z: spawn.z + (Math.random() - 0.5) * 0.6,
        rotation: 0,
        health: 1,
        hp: ENEMY_HIT_POINTS,
        nextAttackAt: 0,
      });
      this.toSpawn -= 1;
      this.nextSpawnAt = now + SPAWN_INTERVAL_MS;
    }
  }

  private moveAndAttack(now: number, dt: number): void {
    const boxes = [...this.world.items.values()].filter((i) => i.kind === "box" && i.heldBy === undefined);
    const solid = [...OBSTACLES, ...boxes.map(boxObstacle)];
    const players = this.world.players();
    for (const e of this.enemies.values()) {
      // a player within reach is attacked first: they're in the way
      const victim = players.find((p) => Math.hypot(p.x - e.x, p.z - e.z) < ENEMY_REACH + PLAYER_RADIUS + ENEMY_RADIUS * 0.5);
      if (victim) {
        e.rotation = Math.atan2(victim.x - e.x, victim.z - e.z);
        if (now >= e.nextAttackAt) {
          e.nextAttackAt = now + ENEMY_ATTACK_INTERVAL_MS;
          this.world.hurtPlayer(victim.id, now);
        }
        continue;
      }
      // at the reactor: attack it
      const gapX = Math.abs(e.x - REACTOR.x) - REACTOR_BODY.halfX;
      const gapZ = Math.abs(e.z - REACTOR.z) - REACTOR_BODY.halfZ;
      if (Math.max(gapX, gapZ) < ENEMY_REACH + ENEMY_RADIUS) {
        e.rotation = Math.atan2(REACTOR.x - e.x, REACTOR.z - e.z);
        if (now >= e.nextAttackAt) {
          e.nextAttackAt = now + ENEMY_ATTACK_INTERVAL_MS;
          this.hitReactor();
          if (!this.world.objective.active) return;
        }
        continue;
      }
      // otherwise walk the flow field; sealed in, head straight at the
      // reactor and chew through whatever box is in the way
      let dir = this.field.direction(e.x, e.z);
      let sealed = false;
      if (!dir) {
        dir = { dx: REACTOR.x - e.x, dz: REACTOR.z - e.z };
        sealed = true;
      }
      const len = Math.hypot(dir.dx, dir.dz) || 1;
      const step = ENEMY_SPEED * dt;
      const nx = e.x + (dir.dx / len) * step;
      const nz = e.z + (dir.dz / len) * step;
      e.rotation = Math.atan2(dir.dx, dir.dz);
      const moved = this.collide(e, nx, nz, solid);
      if (sealed || Math.hypot(moved.x - e.x, moved.z - e.z) < step * 0.25) {
        this.chewNearestBox(e, boxes, now);
      }
      e.x = moved.x;
      e.z = moved.z;
    }
  }

  /** move, pushed out of walls/boxes and gently apart from each other so a crowd doesn't stack */
  private collide(e: Enemy, nx: number, nz: number, solid: typeof OBSTACLES): { x: number; z: number } {
    let x = nx;
    let z = nz;
    for (const o of this.enemies.values()) {
      if (o === e) continue;
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      const min = ENEMY_RADIUS * 1.8;
      if (d > 0 && d < min) {
        x += (dx / d) * (min - d) * 0.5;
        z += (dz / d) * (min - d) * 0.5;
      }
    }
    // reuse the player resolver: it pushes a 0.4-radius circle, close enough to an enemy's 0.38
    return resolveObstacles(x, z, solid);
  }

  private chewNearestBox(e: Enemy, boxes: ItemState[], now: number): void {
    if (now < e.nextAttackAt) return;
    const near = boxes.find((b) => Math.abs(b.x - e.x) < 0.5 + ENEMY_RADIUS + 0.3 && Math.abs(b.z - e.z) < 0.5 + ENEMY_RADIUS + 0.3);
    if (!near) return;
    e.nextAttackAt = now + ENEMY_ATTACK_INTERVAL_MS;
    const dmg = (this.boxDamage.get(near.id) ?? 0) + 1;
    if (dmg >= BOX_HIT_POINTS) {
      this.world.items.delete(near.id);
      this.boxDamage.delete(near.id);
      this.world.changed();
    } else {
      this.boxDamage.set(near.id, dmg);
    }
  }

  private hitReactor(): void {
    this.state.reactorHealth = Math.max(0, this.state.reactorHealth - ENEMY_REACTOR_DAMAGE);
    this.world.changed();
    if (this.state.reactorHealth > 0) return;
    // the attempt has failed: the reactor goes dark and the attack stops,
    // but every box players built stays for the next attempt
    this.world.objective.active = false;
    this.enemies.clear();
    this.toSpawn = 0;
    this.world.announce(`the reactor is down — survived ${Math.max(0, this.state.wave - 1)} wave(s)`);
    this.state = { reactorHealth: 1, wave: 0 };
  }
}
