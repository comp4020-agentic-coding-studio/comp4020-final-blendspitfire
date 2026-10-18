import { describe, expect, it } from "vitest";
import { Defence, type World } from "../server/defence.ts";
import { AGGRO_RANGE, CHARGE_MS, ENEMY_REACTOR_DAMAGE, waveGapMs, waveSize } from "../shared/enemies.ts";
import { REACTOR, type ItemState } from "../shared/protocol.ts";

// Enemies pick between the reactor and a player: a player they can see and
// reach close by draws them off, anything else and they keep for the
// reactor. Run against the real flow field and layout, with a fake world.

function world(players: { id: string; x: number; z: number }[]) {
  const hurt: string[] = [];
  const outcome: { ended?: number; won?: boolean } = {};
  const w: World = {
    objective: { active: true },
    items: new Map<string, ItemState>(),
    players: () => players,
    hurtPlayer: (id) => hurt.push(id),
    changed: () => {},
    announce: () => {},
    ended: (_reason, charge) => (outcome.ended = charge),
    won: () => (outcome.won = true),
  };
  return { w, hurt, outcome };
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
    const d = new Defence(w, { reactorHealth: 1, charge: 0, wave: 1, nextWaveAt: 1e12 });
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
    const d = new Defence(w, { reactorHealth: 1, charge: 0, wave: 1, nextWaveAt: 1e12 });
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
    const d = new Defence(w, { reactorHealth: 1, charge: 0, wave: 1, nextWaveAt: 1e12 });
    d.spawnAt(REACTOR.x, REACTOR.z + 2.4);
    run(d, 3);
    expect(hurt).toEqual([]);
    expect(d.state.reactorHealth).toBeLessThan(1 - ENEMY_REACTOR_DAMAGE);
  });

  it("gives up on a player who gets away and goes back to the reactor", () => {
    const player = { id: "p", x: -6, z: -16 };
    const { w } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, charge: 0, wave: 1, nextWaveAt: 1e12 });
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

describe("chewing through boxes", () => {
  it("wears a box that seals the way, step by step, until it breaks", () => {
    // an enemy in the open core, boxed in on all sides: no route anywhere, so it has to chew out
    const { w } = world([]);
    const ring: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) ring.push([-8 + dx, -12 + dz]);
    ring.forEach(([x, z], i) => w.items.set(`b${i}`, { id: `b${i}`, kind: "box", x, z }));
    const d = new Defence(w, { reactorHealth: 1, charge: 0, wave: 1, nextWaveAt: 1e12 });
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
    // wear went up in steps before the box gave way (the last reading is after it broke)
    const before = wears.slice(0, -1);
    expect(before.length).toBeGreaterThan(2);
    expect(before).toEqual([...before].sort((a, b) => a - b));
  });
});

describe("the charge", () => {
  it("fills in CHARGE_MS of holding, and a full charge wins the run", () => {
    const { w, outcome } = world([]);
    const d = new Defence(w, { reactorHealth: 1, charge: 0, wave: 0, nextWaveAt: 1e12 });
    run(d, CHARGE_MS / 1000 / 2);
    expect(d.state.charge).toBeCloseTo(0.5, 2);
    expect(outcome.won).toBeUndefined();
    run(d, CHARGE_MS / 1000 / 2 + 1);
    expect(outcome.won).toBe(true);
    expect(w.objective.active).toBe(false);
    expect(d.state.charge).toBe(0);
  });

  it("a failed attempt reports how far it got and starts the charge again from zero", () => {
    const { w, outcome } = world([]);
    const d = new Defence(w, { reactorHealth: 1, charge: 0.4, wave: 3, nextWaveAt: 1e12 });
    d.fail("the reactor is down");
    expect(outcome.ended).toBeCloseTo(0.4);
    expect(d.state.charge).toBe(0);
  });

  it("waves grow and come faster as the charge climbs", () => {
    expect(waveSize(1)).toBeGreaterThan(waveSize(0) * 4);
    expect(waveGapMs(1)).toBeLessThan(waveGapMs(0) / 3);
  });
});
