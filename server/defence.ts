import { randomUUID } from "node:crypto";
import {
  AGGRO_RANGE,
  BOX_HIT_POINTS,
  ENEMY_ATTACK_INTERVAL_MS,
  ENEMY_HIT_POINTS,
  ENEMY_RADIUS,
  ENEMY_REACH,
  ENEMY_REACTOR_DAMAGE,
  enemySpeed,
  FIRST_WAVE_DELAY_MS,
  FlowField,
  LEASH_RANGE,
  MAX_ENEMIES,
  REACTOR_COMMIT,
  SEARCH_MS,
  SPAWNS,
  spawnInterval,
  THINK_MS,
  TURRET_FIRE_INTERVAL_MS,
  TURRET_HIT_POINTS,
  TURRET_RANGE,
  WAVE_BREAK_MS,
  WAVES_TO_WIN,
  waveSize,
  blackoutSpawnInterval,
  type DefenceState,
  type EnemyState,
} from "../shared/enemies.ts";
import {
  OBSTACLES,
  PLAYER_RADIUS,
  REACTOR,
  REACTOR_BODY,
  boxObstacle,
  isBlocking,
  rayToObstacles,
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
  /** the player it's after, if any (otherwise the reactor) */
  target?: string;
  /** where its target was last seen, and until when it'll search there */
  lastSeen?: { x: number; z: number; until: number };
  nextThinkAt: number;
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
  /** the attempt just ended in failure, having cleared this many waves (and held `blackoutMs` in the dark, if the reactor died) */
  ended(reason: string, wave: number, blackoutMs: number): void;
  /** the reactor's dead: the lights go and the breaches never stop */
  blackout(wave: number): void;
  /** WAVES_TO_WIN cleared: the facility's lit, the crew can leave */
  won(): void;
  /** a wave was cleared, `size` enemies in `clearMs` from its start: pay the crew */
  cleared(wave: number, size: number, clearMs: number): void;
  /** a placed turret fires from (x, z) toward (tx, tz) */
  turretFire(turretId: string, x: number, z: number, tx: number, tz: number, now: number): void;
}

export class Defence {
  private readonly enemies = new Map<string, Enemy>();
  private readonly field = new FlowField();
  private fieldKey = "";
  /** the blackout's hunt: a flow field to one of the crew, rebuilt as they move */
  private readonly hunt = new FlowField();
  private huntAt = 0;
  private readonly boxDamage = new Map<string, number>();
  state: DefenceState;
  private toSpawn = 0;
  private nextSpawnAt = 0;
  private spawnTurn = 0;
  /** when the current wave started, and how big it was: for the clear-time reward */
  private waveStartedAt = 0;
  private waveSizeNow = 0;
  private readonly turretReadyAt = new Map<string, number>();

  private readonly world: World;

  constructor(world: World, saved: DefenceState | undefined) {
    this.world = world;
    this.state = { reactorHealth: 1, wave: 0, phase: "spawning", ...saved };
  }

  /** the reactor just went live: the first wave comes after a breather, same as any other break */
  start(now: number): void {
    // DEV_REACTOR: local testing only (never set in fly.toml), to reach the blackout quickly
    const hp = (typeof process !== "undefined" ? Number(process.env?.DEV_REACTOR) || 0 : 0) || 1;
    this.state = { reactorHealth: hp, wave: 0, phase: "break", nextWaveAt: now + FIRST_WAVE_DELAY_MS };
    this.toSpawn = 0;
    this.world.changed();
  }

  /** put one enemy at (x, z) straight away, outside the wave schedule (tests, debugging) */
  spawnAt(x: number, z: number): string {
    const id = randomUUID();
    this.enemies.set(id, { id, x, z, rotation: 0, health: 1, hp: ENEMY_HIT_POINTS, nextAttackAt: 0, nextThinkAt: 0 });
    return id;
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
    if (!this.world.objective.active || this.state.phase === "won") {
      // no live reactor (or a won one), no attack: anything left over goes away
      if (this.enemies.size) this.enemies.clear();
      return;
    }
    this.rebuildFieldIfBoxesMoved();
    if (this.state.phase === "blackout") this.runBlackout(now);
    else this.runWaves(now);
    this.moveAndAttack(now, dt);
    // turrets run off the reactor too
    if (this.world.objective.active && this.state.phase !== "blackout") this.fireTurrets(now);
  }

  /** the dark: they keep coming from every breach, closer together the longer it goes on */
  private runBlackout(now: number): void {
    // and they know where the crew is: every second, a fresh trail to one of them
    if (now >= this.huntAt) {
      this.huntAt = now + 1000;
      const players = this.world.players();
      if (players.length) {
        const prey = players[Math.floor(now / 4000) % players.length];
        const boxes = [...this.world.items.values()].filter(isBlocking);
        this.hunt.build([...OBSTACLES, ...boxes.map(boxObstacle)], prey);
      }
    }
    const since = now - (this.state.blackoutAt ?? now);
    while (now >= this.nextSpawnAt && this.enemies.size < MAX_ENEMIES) {
      this.spawnAtBreach();
      this.nextSpawnAt = now + blackoutSpawnInterval(since);
    }
  }

  private spawnAtBreach(): void {
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
      nextThinkAt: 0,
    });
  }

  /** the crew is gone (dead, or ridden out after a win): the attempt is over */
  finish(): void {
    this.world.objective.active = false;
    this.enemies.clear();
    this.toSpawn = 0;
    this.state = { reactorHealth: 1, wave: 0, phase: "spawning" };
    this.world.changed();
  }

  private fireTurrets(now: number): void {
    if (this.enemies.size === 0) return;
    const blockers = [...this.world.items.values()].filter(isBlocking);
    for (const t of blockers) {
      if (t.kind !== "turret" || now < (this.turretReadyAt.get(t.id) ?? 0)) continue;
      // other blockers stop its line of fire, but not the turret's own tile
      const solid = [...OBSTACLES, ...blockers.filter((b) => b !== t).map(boxObstacle)];
      let target: Enemy | undefined;
      let bestD = TURRET_RANGE;
      for (const e of this.enemies.values()) {
        const d = Math.hypot(e.x - t.x, e.z - t.z);
        if (d < bestD && this.clearLine(t.x, t.z, e.x, e.z, solid)) {
          target = e;
          bestD = d;
        }
      }
      if (!target) continue;
      this.turretReadyAt.set(t.id, now + TURRET_FIRE_INTERVAL_MS);
      t.aim = Math.round(Math.atan2(target.x - t.x, target.z - t.z) * 100) / 100;
      this.world.turretFire(t.id, t.x, t.z, target.x, target.z, now);
    }
  }

  /** anyone can send the break early --- the one in it, or anyone else: ok while on a break */
  skipBreak(now: number): boolean {
    if (this.state.phase !== "break") return false;
    this.state.nextWaveAt = now;
    return true;
  }

  private rebuildFieldIfBoxesMoved(): void {
    const boxes = [...this.world.items.values()].filter(isBlocking);
    const key = boxes.map((b) => `${b.id}:${b.x.toFixed(2)},${b.z.toFixed(2)}`).join("|");
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.field.build([...OBSTACLES, ...boxes.map(boxObstacle)]);
  }

  private runWaves(now: number): void {
    const s = this.state;
    if (s.phase === "break") {
      if (s.nextWaveAt !== undefined && now < s.nextWaveAt) return;
      this.startWave(now);
      return;
    }
    // spawning: once the wave's fully out and nothing's left alive, it's cleared
    if (this.toSpawn === 0 && this.enemies.size === 0) {
      this.world.cleared(s.wave, this.waveSizeNow, now - this.waveStartedAt);
      if (s.wave >= WAVES_TO_WIN) {
        // the reactor's stable: the attempt stays on (the crew's still below) until they've ridden up
        s.phase = "won";
        s.nextWaveAt = undefined;
        this.world.changed();
        this.world.won();
        return;
      }
      s.phase = "break";
      s.nextWaveAt = now + WAVE_BREAK_MS;
      this.world.announce(`wave ${s.wave} cleared — next: ${waveSize(s.wave + 1)} hostiles in ${WAVE_BREAK_MS / 1000}s`);
      this.world.changed();
      return;
    }
    while (this.toSpawn > 0 && now >= this.nextSpawnAt && this.enemies.size < MAX_ENEMIES) {
      this.spawnAtBreach();
      this.toSpawn -= 1;
      this.nextSpawnAt = now + spawnInterval(this.state.wave);
    }
  }

  private startWave(now: number): void {
    const s = this.state;
    s.wave += 1;
    s.phase = "spawning";
    s.nextWaveAt = undefined;
    this.toSpawn = waveSize(s.wave);
    this.waveSizeNow = this.toSpawn;
    this.waveStartedAt = now;
    this.nextSpawnAt = now;
    this.world.announce(`wave ${s.wave}/${WAVES_TO_WIN} incoming — ${this.toSpawn} hostiles`);
    this.world.changed();
  }

  private moveAndAttack(now: number, dt: number): void {
    const boxes = [...this.world.items.values()].filter(isBlocking);
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
      const gapX = Math.abs(e.x - REACTOR.x) - REACTOR_BODY.halfX;
      const gapZ = Math.abs(e.z - REACTOR.z) - REACTOR_BODY.halfZ;
      const reactorGap = Math.max(gapX, gapZ);
      if (now >= e.nextThinkAt) {
        e.nextThinkAt = now + THINK_MS;
        this.chooseTarget(e, players, solid, reactorGap, now);
      }
      // after a player: walk straight at them, or to where they were last seen
      const chase = this.chasePoint(e, players, now);
      if (chase) {
        this.walk(e, chase.x - e.x, chase.z - e.z, dt, solid, boxes, now, false);
        continue;
      }
      // at the reactor: attack it (not in the dark: it's dead, they're hunting)
      if (reactorGap < ENEMY_REACH + ENEMY_RADIUS && this.state.phase !== "blackout") {
        e.rotation = Math.atan2(REACTOR.x - e.x, REACTOR.z - e.z);
        if (now >= e.nextAttackAt) {
          e.nextAttackAt = now + ENEMY_ATTACK_INTERVAL_MS;
          this.hitReactor(now);
        }
        continue;
      }
      // otherwise walk the flow field (in the dark, the hunt's); sealed in,
      // head straight at the reactor and chew through whatever box is in the way
      let dir = (this.state.phase === "blackout" ? this.hunt : this.field).direction(e.x, e.z);
      let sealed = false;
      if (!dir) {
        dir = { dx: REACTOR.x - e.x, dz: REACTOR.z - e.z };
        sealed = true;
      }
      this.walk(e, dir.dx, dir.dz, dt, solid, boxes, now, sealed);
    }
  }

  /** one step along (dx, dz); stuck (or sealed in), chew whatever box is in the way */
  private walk(e: Enemy, dx: number, dz: number, dt: number, solid: typeof OBSTACLES, boxes: ItemState[], now: number, sealed: boolean): void {
    const len = Math.hypot(dx, dz) || 1;
    const step = enemySpeed(this.state.wave) * dt;
    e.rotation = Math.atan2(dx, dz);
    const moved = this.collide(e, e.x + (dx / len) * step, e.z + (dz / len) * step, solid);
    if (sealed || Math.hypot(moved.x - e.x, moved.z - e.z) < step * 0.25) this.chewNearestBox(e, boxes, now);
    e.x = moved.x;
    e.z = moved.z;
  }

  /** whether an enemy at (x, z) could walk in a straight line to (tx, tz): nothing solid in between */
  private clearLine(x: number, z: number, tx: number, tz: number, solid: typeof OBSTACLES): boolean {
    const d = Math.hypot(tx - x, tz - z);
    if (d < 1e-6) return true;
    return rayToObstacles(x, z, (tx - x) / d, (tz - z) / d, solid, d, ENEMY_RADIUS * 0.8) >= d - 0.05;
  }

  /** reactor or player: see AGGRO_RANGE in shared/enemies.ts */
  private chooseTarget(e: Enemy, players: { id: string; x: number; z: number }[], solid: typeof OBSTACLES, reactorGap: number, now: number): void {
    const current = e.target ? players.find((p) => p.id === e.target) : undefined;
    if (current) {
      const d = Math.hypot(current.x - e.x, current.z - e.z);
      if (d <= LEASH_RANGE && this.clearLine(e.x, e.z, current.x, current.z, solid)) {
        e.lastSeen = { x: current.x, z: current.z, until: now + SEARCH_MS };
        return;
      }
      // lost sight (or too far): search where they were last seen, then give up
      e.target = undefined;
    }
    const dark = this.state.phase === "blackout";
    if (reactorGap < REACTOR_COMMIT && !dark) {
      e.lastSeen = undefined;
      return;
    }
    let best: { id: string; x: number; z: number } | undefined;
    // in the dark they hunt: any crewmate they can see, however far
    let bestD = dark ? LEASH_RANGE * 2 : AGGRO_RANGE;
    for (const p of players) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bestD && this.clearLine(e.x, e.z, p.x, p.z, solid)) {
        best = p;
        bestD = d;
      }
    }
    if (best) {
      e.target = best.id;
      e.lastSeen = { x: best.x, z: best.z, until: now + SEARCH_MS };
    }
  }

  /** where a chasing enemy is heading this tick, or undefined if it's going for the reactor */
  private chasePoint(e: Enemy, players: { id: string; x: number; z: number }[], now: number): { x: number; z: number } | undefined {
    const target = e.target ? players.find((p) => p.id === e.target) : undefined;
    if (target) return target;
    e.target = undefined;
    if (!e.lastSeen) return undefined;
    // searching: head for the last sighting, give up on arriving or when time runs out
    if (now > e.lastSeen.until || Math.hypot(e.lastSeen.x - e.x, e.lastSeen.z - e.z) < 0.4) {
      e.lastSeen = undefined;
      return undefined;
    }
    return e.lastSeen;
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
    const hp = near.kind === "turret" ? TURRET_HIT_POINTS : BOX_HIT_POINTS;
    const dmg = (this.boxDamage.get(near.id) ?? 0) + 1;
    if (dmg >= hp) {
      this.world.items.delete(near.id);
      this.boxDamage.delete(near.id);
      this.turretReadyAt.delete(near.id);
      if (near.kind === "turret") this.world.announce("a turret's been torn down");
      this.world.changed();
    } else {
      this.boxDamage.set(near.id, dmg);
      near.wear = Math.round((dmg / hp) * 100) / 100;
    }
  }

  private hitReactor(now: number): void {
    if (this.state.phase === "blackout") return; // already dead; they've come for the crew now
    this.state.reactorHealth = Math.max(0, this.state.reactorHealth - ENEMY_REACTOR_DAMAGE);
    this.world.changed();
    if (this.state.reactorHealth > 0) return;
    // the reactor's dead: the lights go, the waves stop counting, the breaches never close
    const cleared = this.state.phase === "break" ? this.state.wave : Math.max(0, this.state.wave - 1);
    this.state = { reactorHealth: 0, wave: cleared, phase: "blackout", blackoutAt: now };
    this.toSpawn = 0;
    this.nextSpawnAt = now + 1500;
    // every crawler forgets the reactor and comes for whoever's left
    for (const e of this.enemies.values()) e.nextThinkAt = 0;
    this.world.changed();
    this.world.blackout(cleared);
  }

  /**
   * The attempt has failed: everyone defending the reactor is dead (in the
   * blackout, or before it). The attack stops, but every box players built
   * stays for the next attempt.
   */
  fail(reason: string, now = Date.now()): void {
    if (!this.world.objective.active) return;
    const s = this.state;
    const blackoutMs = s.phase === "blackout" && s.blackoutAt ? now - s.blackoutAt : 0;
    const wave = s.phase === "blackout" ? s.wave : s.phase === "break" ? s.wave : Math.max(0, s.wave - 1);
    this.finish();
    this.world.ended(reason, wave, blackoutMs);
  }
}
