import { describe, expect, it } from "vitest";
import {
  BUY_RANGE,
  GRENADE_COST,
  GRENADE_RANGE,
  grenadeLanding,
  HEAL_COST,
  ITEM_CAPS,
  PAR_MS_PER_ENEMY,
  PLACE_RANGE,
  SUPPLY_TERMINAL,
  TURRET_COST,
  WAVE_BASE_REWARD,
  buildTurretVerdict,
  buyVerdict,
  scrapVerdict,
  waveReward,
  GORE_CAPS,
  capGore,
  type GoreMark,
} from "../shared/protocol.ts";

// The quota: what clearing a wave pays, and what the supply terminal will
// sell. Pure rules, shared by the client's prompt and the server's check.

const atTerminal = { x: SUPPLY_TERMINAL.x, z: SUPPLY_TERMINAL.z + SUPPLY_TERMINAL.halfZ + 0.5 };
const empty = { wounds: 0 };

describe("wave rewards", () => {
  it("pays the base for a slow clear and more for every second under par", () => {
    expect(waveReward(10, 10 * PAR_MS_PER_ENEMY + 60000)).toBe(WAVE_BASE_REWARD);
    expect(waveReward(10, 10 * PAR_MS_PER_ENEMY - 5000)).toBe(WAVE_BASE_REWARD + 5);
  });
});

describe("ordering at the supply terminal", () => {
  it("clears a turret order to someone close, with the quota for it", () => {
    expect(buyVerdict("turret", atTerminal, empty, TURRET_COST, 0)).toBe("ok");
  });

  it("says why it won't", () => {
    expect(buyVerdict("turret", { x: atTerminal.x, z: atTerminal.z + BUY_RANGE + 1 }, empty, 999, 0)).toBe("too far");
    expect(buyVerdict("turret", atTerminal, empty, TURRET_COST - 1, 0)).toBe("can't afford");
    expect(buyVerdict("turret", atTerminal, empty, 999, ITEM_CAPS.turret)).toBe("sold out");
  });

  it("patches up only someone who's hurt", () => {
    expect(buyVerdict("heal", atTerminal, { wounds: 2 }, HEAL_COST, 0)).toBe("ok");
    expect(buyVerdict("heal", atTerminal, empty, 999, 0)).toBe("unhurt");
    expect(buyVerdict("heal", atTerminal, { wounds: 1 }, HEAL_COST - 1, 0)).toBe("can't afford");
  });
});

describe("grenades", () => {
  it("are handed over, so need empty hands", () => {
    expect(buyVerdict("grenade", atTerminal, empty, GRENADE_COST, 0)).toBe("ok");
    expect(buyVerdict("grenade", atTerminal, { wounds: 0, holding: true }, GRENADE_COST, 0)).toBe("hands full");
    expect(buyVerdict("grenade", atTerminal, empty, GRENADE_COST - 1, 0)).toBe("can't afford");
  });

  it("land at the cursor, pulled in to range and short of a wall", () => {
    expect(grenadeLanding({ x: 0, z: 0 }, 3, 0, [])).toEqual({ x: 3, z: 0 });
    expect(grenadeLanding({ x: 0, z: 0 }, 50, 0, []).x).toBeCloseTo(GRENADE_RANGE, 5);
    const wall = { x: 5, z: 0, halfX: 0.3, halfZ: 3, halfHeight: 1 };
    expect(grenadeLanding({ x: 0, z: 0 }, 7, 0, [wall]).x).toBeLessThan(4.7);
  });
});

describe("building a turret", () => {
  const placer = { x: 0, z: -11.5 };
  const spot = { x: placer.x, z: placer.z - 2 };

  it("builds where any blocker could, with the quota and under the corp's cap", () => {
    expect(buildTurretVerdict(spot.x, spot.z, placer, [], [], TURRET_COST, 0)).toBe("ok");
  });

  it("refuses without the quota, at the cap, or somewhere a blocker couldn't go", () => {
    expect(buildTurretVerdict(spot.x, spot.z, placer, [], [], TURRET_COST - 1, 0)).toBe("can't afford");
    expect(buildTurretVerdict(spot.x, spot.z, placer, [], [], TURRET_COST, ITEM_CAPS.turret)).toBe("sold out");
    expect(buildTurretVerdict(placer.x + PLACE_RANGE + 2, placer.z, placer, [], [], TURRET_COST, 0)).toBe("too far");
  });
});

describe("scrapping a turret", () => {
  it("tears down a turret in reach, no refund", () => {
    expect(scrapVerdict({ kind: "turret", x: 2, z: 2 }, { x: 2, z: 2 })).toBe("ok");
  });

  it("refuses out of reach, or anything that isn't a turret", () => {
    expect(scrapVerdict({ kind: "turret", x: 20, z: 20 }, { x: 0, z: 0 })).toBe("too far");
    expect(scrapVerdict({ kind: "gun", x: 2, z: 2 }, { x: 2, z: 2 })).toBe("not a turret");
    expect(scrapVerdict(undefined, { x: 0, z: 0 })).toBe("not a turret");
  });
});

describe("gore", () => {
  it("keeps the newest marks of each kind up to its cap, in order", () => {
    const marks: GoreMark[] = [];
    for (let n = 0; n < GORE_CAPS.blood + 20; n++) marks.push({ n, kind: "blood", who: "enemy", x: 0, z: 0, r: 0 });
    marks.push({ n: 9999, kind: "corpse", who: "player", x: 0, z: 0, r: 0 });
    const kept = capGore(marks);
    expect(kept.filter((m) => m.kind === "blood").length).toBe(GORE_CAPS.blood);
    expect(kept[0].n).toBe(20);
    expect(kept.some((m) => m.kind === "corpse")).toBe(true);
  });
});
