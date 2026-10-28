import { describe, expect, it } from "vitest";
import { Defence, type World } from "../server/defence.ts";
import {
  AGGRO_RANGE,
  ENEMY_HIT_POINTS,
  ENEMY_REACTOR_DAMAGE,
  FIRST_WAVE_DELAY_MS,
  MAX_ENEMIES,
  SPIT_MIN_RANGE,
  SPIT_RANGE,
  SPIT_SPLASH,
  SPITTER_FROM_WAVE,
  spawnInterval,
  spitterShare,
  TURRET_RANGE,
  WAVE_BREAK_MS,
  READY_LEAD_MS,
  WAVES_TO_WIN,
  waveSize,
} from "../shared/enemies.ts";
import { GRENADE_DAMAGE, GRENADE_RADIUS, REACTOR, type ItemState } from "../shared/protocol.ts";

// Enemies pick between the reactor and a player: a player they can see and
// reach close by draws them off, anything else and they keep for the
// reactor. Run against the real flow field and layout, with a fake world.

function world(players: { id: string; x: number; z: number }[]) {
  const hurt: string[] = [];
  const outcome: { ended?: number; won?: boolean; blackout?: number; blackoutMs?: number } = {};
  const paid: { wave: number; size: number; clearMs: number }[] = [];
  const shots: { from: string; tx: number; tz: number }[] = [];
  const w: World = {
    objective: { active: true },
    items: new Map<string, ItemState>(),
    players: () => players,
    hurtPlayer: (id) => hurt.push(id),
    changed: () => {},
    announce: () => {},
    ended: (_reason, wave, ms) => {
      outcome.ended = wave;
      outcome.blackoutMs = ms;
    },
    blackout: (wave) => (outcome.blackout = wave),
    won: () => (outcome.won = true),
    cleared: (wave, size, clearMs) => paid.push({ wave, size, clearMs }),
    turretFire: (from, _x, _z, tx, tz) => shots.push({ from, tx, tz }),
  };
  return { w, hurt, outcome, paid, shots };
}

/** run the defence for `seconds` of 50 ms ticks, starting the clock well past the first wave's delay */
function run(d: Defence, seconds: number, t0 = 0): number {
  let now = t0;
  for (let i = 0; i < seconds * 20; i++) {
    now += 50;
    d.step(now, 0.05);
  }
  return now;
}

const enemyAt = (d: Defence, id: string) => d.snapshot().find((e) => e.id === id)!;

describe("enemy targeting", () => {
  it("goes for a player it can see close by", () => {
    // the core is open floor: an enemy at its west end, a player a few units east
    const player = { id: "p", x: -6, z: -16 };
    const { w, hurt } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, wave: 1, phase: "spawning", nextWaveAt: 1e12 });
    const id = d.spawnAt(-6 - (AGGRO_RANGE - 1.5), -16);
    run(d, 3);
    expect(hurt).toContain("p");
    const e = enemyAt(d, id);
    expect(Math.hypot(e.x - player.x, e.z - player.z)).toBeLessThan(1.5);
  });

  it("ignores a player behind a wall and heads for the reactor", () => {
    // enemy in the west passage, player in the lab on the far side of its wall: in range, out of sight
    const player = { id: "p", x: -9, z: 3 };
    const { w, hurt } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, wave: 1, phase: "spawning", nextWaveAt: 1e12 });
    const start = { x: -12, z: -1 };
    expect(Math.hypot(player.x - start.x, player.z - start.z)).toBeLessThan(AGGRO_RANGE);
    const id = d.spawnAt(start.x, start.z);
    run(d, 4);
    expect(hurt).toEqual([]);
    const e = enemyAt(d, id);
    // it went south, through the passage toward the core, not north to the lab
    expect(e.z).toBeLessThan(start.z - 3);
  });

  it("stays on the reactor once it's there, even with a player close by", () => {
    const player = { id: "p", x: REACTOR.x + 4, z: REACTOR.z + 3.2 };
    const { w, hurt } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, wave: 1, phase: "spawning", nextWaveAt: 1e12 });
    d.spawnAt(REACTOR.x, REACTOR.z + 2.4);
    run(d, 3);
    expect(hurt).toEqual([]);
    expect(d.state.reactorHealth).toBeLessThan(1 - ENEMY_REACTOR_DAMAGE);
  });

  it("gives up on a player who gets away and goes back to the reactor", () => {
    const player = { id: "p", x: -6, z: -16 };
    const { w } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, wave: 1, phase: "spawning", nextWaveAt: 1e12 });
    const id = d.spawnAt(-10, -16);
    run(d, 0.5);
    // the player vanishes from reach (through a door, out of range)
    player.x = 60;
    player.z = 60;
    const t = run(d, 6, 1000);
    run(d, 4, t);
    const e = enemyAt(d, id);
    expect(Math.hypot(e.x - REACTOR.x, e.z - REACTOR.z)).toBeLessThan(4);
  });
});

describe("spitters", () => {
  it("holds at range and lobs acid that wounds a player who stays put", () => {
    const player = { id: "p", x: -6, z: -16 };
    const { w, hurt } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, wave: 3, phase: "spawning", nextWaveAt: 1e12 });
    const id = d.spawnAt(-6 - (SPIT_RANGE - 1), -16, "spitter");
    run(d, 3);
    expect(hurt).toContain("p");
    // it never closed in to bite
    const e = enemyAt(d, id);
    expect(Math.hypot(e.x - player.x, e.z - player.z)).toBeGreaterThan(SPIT_MIN_RANGE - 0.5);
  });

  it("misses a player who steps out of the landing spot", () => {
    const player = { id: "p", x: -6, z: -16 };
    const { w, hurt } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, wave: 3, phase: "spawning", nextWaveAt: 1e12 });
    d.spawnAt(-6 - (SPIT_RANGE - 1), -16, "spitter");
    run(d, 0.1);
    expect(d.spits().length).toBe(1);
    player.z += SPIT_SPLASH + 1;
    run(d, 1, 100);
    expect(hurt).toEqual([]);
  });

  it("come in from wave 3, as a share of the wave rather than on top of it", () => {
    expect(spitterShare(SPITTER_FROM_WAVE - 1)).toBe(0);
    expect(spitterShare(SPITTER_FROM_WAVE)).toBeGreaterThan(0);
    expect(spitterShare(WAVES_TO_WIN)).toBeGreaterThan(spitterShare(SPITTER_FROM_WAVE));
    const { w } = world([]);
    const d = new Defence(w, { reactorHealth: 1, wave: WAVES_TO_WIN - 1, phase: "break", nextWaveAt: 0 });
    run(d, (waveSize(WAVES_TO_WIN) * spawnInterval(WAVES_TO_WIN)) / 1000 + 1);
    const all = d.snapshot();
    expect(all.length).toBe(Math.min(waveSize(WAVES_TO_WIN), MAX_ENEMIES));
    expect(all.some((e) => e.kind === "spitter")).toBe(true);
    expect(all.some((e) => e.kind === "crawler")).toBe(true);
  });
});

describe("blasts", () => {
  it("kill a spitter outright and wound a crawler, only inside the radius", () => {
    const { w } = world([]);
    const d = new Defence(w, { reactorHealth: 1, wave: 3, phase: "spawning", nextWaveAt: 1e12 });
    const s = d.spawnAt(-6, -14, "spitter");
    const c = d.spawnAt(-5, -14);
    const far = d.spawnAt(-6 + GRENADE_RADIUS + 3, -14);
    const killed = d.blast(-6, -14, GRENADE_RADIUS, GRENADE_DAMAGE);
    expect(killed.map((k) => k.id)).toEqual([s]);
    expect(enemyAt(d, c).health).toBeLessThan(1);
    expect(enemyAt(d, far).health).toBe(1);
  });
});

describe("chewing through turrets", () => {
  it("wears a turret that seals the way, step by step, until it breaks", () => {
    // an enemy in the open core, walled in by turrets on all sides: no route anywhere, so it has to chew out
    const { w } = world([]);
    const ring: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) ring.push([-8 + dx, -12 + dz]);
    ring.forEach(([x, z], i) => w.items.set(`b${i}`, { id: `b${i}`, kind: "turret", x, z }));
    const d = new Defence(w, { reactorHealth: 1, wave: 1, phase: "spawning", nextWaveAt: 1e12 });
    d.spawnAt(-8, -12);
    const wears: number[] = [];
    let now = 0;
    for (let i = 0; i < 20 * 20 && w.items.size === ring.length; i++) {
      now += 50;
      d.step(now, 0.05);
      const worst = Math.max(...[...w.items.values()].map((b) => b.wear ?? 0));
      if (worst !== wears[wears.length - 1]) wears.push(worst);
    }
    expect(w.items.size).toBe(ring.length - 1);
    // wear went up in steps before the turret gave way (the last reading is after it broke)
    const before = wears.slice(0, -1);
    expect(before.length).toBeGreaterThan(2);
    expect(before).toEqual([...before].sort((a, b) => a - b));
  });
});

/** kill everything currently alive, as if the crew shot it all */
function killAll(d: Defence): void {
  for (const e of d.snapshot()) while (!d.damage(e.id));
}

describe("waves", () => {
  it("the first wave comes after the breather; a cleared wave starts a break", () => {
    const { w } = world([]);
    const d = new Defence(w, undefined);
    d.start(0);
    expect(d.state.phase).toBe("break");
    let now = run(d, FIRST_WAVE_DELAY_MS / 1000 + 0.1);
    expect(d.state.phase).toBe("spawning");
    expect(d.state.wave).toBe(1);
    // let the whole wave come in, then shoot it all
    now = run(d, (waveSize(1) * spawnInterval(1)) / 1000 + 0.5, now);
    expect(d.snapshot().length).toBe(waveSize(1));
    killAll(d);
    now = run(d, 0.1, now);
    expect(d.state.phase).toBe("break");
    expect(d.state.nextWaveAt).toBeGreaterThan(now);
    // the break runs out and the next wave starts
    run(d, WAVE_BREAK_MS / 1000 + 0.1, now);
    expect(d.state.phase).toBe("spawning");
    expect(d.state.wave).toBe(2);
  });

  it("the next wave comes early only once everyone below is ready, and a vote taken back holds it", () => {
    const { w } = world([]);
    const d = new Defence(w, undefined);
    d.start(0);
    const end = d.state.nextWaveAt!;
    expect(d.vote("a", ["a", "b"], 10)).toBe(true);
    expect(d.state.nextWaveAt).toBe(end);
    expect(d.state.ready).toEqual(["a"]);
    expect(d.vote("b", ["a", "b"], 20)).toBe(true);
    expect(d.state.nextWaveAt).toBe(20 + READY_LEAD_MS);
    // b changes their mind: back to the break's own end
    expect(d.vote("b", ["a", "b"], 30)).toBe(false);
    expect(d.state.nextWaveAt).toBe(end);
    // b dies (drops out of the voters): a alone is everyone
    d.tallyVotes(["a"], 40);
    expect(d.state.nextWaveAt).toBe(40 + READY_LEAD_MS);
    run(d, READY_LEAD_MS / 1000 + 0.1, 40);
    expect(d.state.phase).toBe("spawning");
    expect(d.state.wave).toBe(1);
    expect(d.state.ready).toBeUndefined();
    expect(d.vote("a", ["a"], 9000)).toBeUndefined();
  });

  it("clearing the last wave wins: the facility goes quiet and stays on until the crew's out", () => {
    const { w, outcome } = world([]);
    const d = new Defence(w, { reactorHealth: 1, wave: WAVES_TO_WIN, phase: "spawning" });
    run(d, 0.1);
    expect(outcome.won).toBe(true);
    expect(d.state.phase).toBe("won");
    expect(w.objective.active).toBe(true);
    // nothing more comes, whatever the time
    run(d, 60, 1000);
    expect(d.snapshot()).toEqual([]);
    d.finish();
    expect(w.objective.active).toBe(false);
    expect(d.state.wave).toBe(0);
  });

  it("a failed attempt reports how many waves it cleared and starts again from zero", () => {
    const { w, outcome } = world([]);
    const d = new Defence(w, { reactorHealth: 1, wave: 4, phase: "spawning", nextWaveAt: 1e12 });
    d.fail("everyone's down");
    // wave 4 was being fought: three were cleared
    expect(outcome.ended).toBe(3);
    expect(d.state.wave).toBe(0);
  });

  it("a dead reactor blacks out: no win, no let-up, spawns tightening until the crew is gone", () => {
    const player = { id: "p", x: -12, z: 10 };
    const { w, outcome } = world([player]);
    const d = new Defence(w, { reactorHealth: ENEMY_REACTOR_DAMAGE, wave: 3, phase: "break", nextWaveAt: 1e12 });
    d.spawnAt(REACTOR.x, REACTOR.z + 2.4);
    let now = run(d, 1.5);
    expect(outcome.blackout).toBe(3);
    expect(d.state.phase).toBe("blackout");
    expect(w.objective.active).toBe(true);
    // they keep coming
    now = run(d, 8, now);
    const early = d.snapshot().length;
    expect(early).toBeGreaterThan(3);
    // and they hunt: the one that was at the reactor has left it for the crew
    now = run(d, 10, now);
    expect(d.snapshot().some((e) => Math.hypot(e.x - player.x, e.z - player.z) < 4)).toBe(true);
    d.fail("everyone's down in the dark", now);
    expect(outcome.ended).toBe(3);
    expect(outcome.blackoutMs).toBeGreaterThan(15000);
  });

  it("an enemy kind has the same stats on every wave", () => {
    for (const wave of [1, WAVES_TO_WIN]) {
      const d = new Defence(world([]).w, { reactorHealth: 1, wave, phase: "spawning", nextWaveAt: 1e12 });
      d.spawnAt(-6, -16);
      const [e] = d.snapshot();
      d.damage(e.id, ENEMY_HIT_POINTS - 1);
      expect(d.snapshot()[0].health).toBeCloseTo(1 / ENEMY_HIT_POINTS);
    }
  });

  it("waves grow faster than linearly toward the last one", () => {
    expect(waveSize(WAVES_TO_WIN)).toBeGreaterThan(waveSize(1) * 4);
    const half = Math.round(WAVES_TO_WIN / 2);
    // the second half adds more than the first: the curve bends upward
    expect(waveSize(WAVES_TO_WIN) - waveSize(half)).toBeGreaterThan(waveSize(half) - waveSize(1));
    expect(waveSize(WAVES_TO_WIN + 5)).toBe(waveSize(WAVES_TO_WIN));
  });
});

describe("turrets", () => {
  it("a placed turret fires at an enemy it can see in range", () => {
    const { w, shots } = world([]);
    w.items.set("t", { id: "t", kind: "turret", x: -6, z: -14 });
    const d = new Defence(w, { reactorHealth: 1, wave: 1, phase: "spawning", nextWaveAt: 1e12 });
    const id = d.spawnAt(-6 + TURRET_RANGE - 2, -14);
    run(d, 0.2);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0].from).toBe("t");
    expect(w.items.get("t")!.aim).toBeDefined();
    void id;
  });

  it("a turret in someone's hands doesn't fire", () => {
    const { w, shots } = world([]);
    w.items.set("t", { id: "t", kind: "turret", x: -6, z: -14, heldBy: "p" });
    const d = new Defence(w, { reactorHealth: 1, wave: 1, phase: "spawning", nextWaveAt: 1e12 });
    d.spawnAt(-4, -14);
    run(d, 0.5);
    expect(shots).toEqual([]);
  });

  it("clearing a wave pays out, with how long it took", () => {
    const { w, paid } = world([]);
    const d = new Defence(w, undefined);
    d.start(0);
    d.vote("a", ["a"], 0);
    d.state.nextWaveAt = 0;
    let now = run(d, 0.1);
    now = run(d, (waveSize(1) * spawnInterval(1)) / 1000 + 0.5, now);
    killAll(d);
    run(d, 0.1, now);
    expect(paid.length).toBe(1);
    expect(paid[0].wave).toBe(1);
    expect(paid[0].size).toBe(waveSize(1));
    expect(paid[0].clearMs).toBeGreaterThan(0);
  });
});
