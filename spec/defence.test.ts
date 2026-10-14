import { describe, expect, it } from "vitest";
import { Defence, type World } from "../server/defence.ts";
import { AGGRO_RANGE, ENEMY_REACTOR_DAMAGE } from "../shared/enemies.ts";
import { REACTOR, type ItemState } from "../shared/protocol.ts";

// Enemies pick between the reactor and a player: a player they can see and
// reach close by draws them off, anything else and they keep for the
// reactor. Run against the real flow field and layout, with a fake world.

function world(players: { id: string; x: number; z: number }[]) {
  const hurt: string[] = [];
  const w: World = {
    objective: { active: true },
    items: new Map<string, ItemState>(),
    players: () => players,
    hurtPlayer: (id) => hurt.push(id),
    changed: () => {},
    announce: () => {},
    ended: () => {},
  };
  return { w, hurt };
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
    const d = new Defence(w, { reactorHealth: 1, wave: 1, nextWaveAt: 1e12 });
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
    const d = new Defence(w, { reactorHealth: 1, wave: 1, nextWaveAt: 1e12 });
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
    const d = new Defence(w, { reactorHealth: 1, wave: 1, nextWaveAt: 1e12 });
    d.spawnAt(REACTOR.x, REACTOR.z + 2.4);
    run(d, 3);
    expect(hurt).toEqual([]);
    expect(d.state.reactorHealth).toBeLessThan(1 - ENEMY_REACTOR_DAMAGE);
  });

  it("gives up on a player who gets away and goes back to the reactor", () => {
    const player = { id: "p", x: -6, z: -16 };
    const { w } = world([player]);
    const d = new Defence(w, { reactorHealth: 1, wave: 1, nextWaveAt: 1e12 });
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
