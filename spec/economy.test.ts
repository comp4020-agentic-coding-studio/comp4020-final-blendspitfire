import { describe, expect, it } from "vitest";
import {
  BUY_RANGE,
  HEAL_COST,
  ITEM_CAPS,
  PAR_MS_PER_ENEMY,
  SUPPLY_TERMINAL,
  TURRET_COST,
  WAVE_BASE_REWARD,
  buyVerdict,
  waveReward,
  GORE_CAPS,
  capGore,
  type GoreMark,
} from "../shared/protocol.ts";

// The quota: what clearing a wave pays, and what the supply terminal will
// sell. Pure rules, shared by the client's prompt and the server's check.

const atTerminal = { x: SUPPLY_TERMINAL.x, z: SUPPLY_TERMINAL.z + SUPPLY_TERMINAL.halfZ + 0.5 };
const empty = { holding: false, wounds: 0 };

describe("wave rewards", () => {
  it("pays the base for a slow clear and more for every second under par", () => {
    expect(waveReward(10, 10 * PAR_MS_PER_ENEMY + 60000)).toBe(WAVE_BASE_REWARD);
    expect(waveReward(10, 10 * PAR_MS_PER_ENEMY - 5000)).toBe(WAVE_BASE_REWARD + 5);
  });
});

describe("buying at the supply terminal", () => {
  it("sells a turret to someone close, empty-handed, with the quota for it", () => {
    expect(buyVerdict("turret", atTerminal, empty, TURRET_COST, 0)).toBe("ok");
  });

  it("says why it won't", () => {
    expect(buyVerdict("turret", { x: atTerminal.x, z: atTerminal.z + BUY_RANGE + 1 }, empty, 999, 0)).toBe("too far");
    expect(buyVerdict("turret", atTerminal, { holding: true, wounds: 0 }, 999, 0)).toBe("hands full");
    expect(buyVerdict("turret", atTerminal, empty, TURRET_COST - 1, 0)).toBe("can't afford");
    expect(buyVerdict("turret", atTerminal, empty, 999, ITEM_CAPS.turret)).toBe("sold out");
  });

  it("patches up only someone who's hurt, hands full or not", () => {
    expect(buyVerdict("heal", atTerminal, { holding: true, wounds: 2 }, HEAL_COST, 0)).toBe("ok");
    expect(buyVerdict("heal", atTerminal, empty, 999, 0)).toBe("unhurt");
    expect(buyVerdict("heal", atTerminal, { holding: false, wounds: 1 }, HEAL_COST - 1, 0)).toBe("can't afford");
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
