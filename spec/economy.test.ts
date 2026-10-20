import { describe, expect, it } from "vitest";
import {
  BUY_RANGE,
  ITEM_CAPS,
  PAR_MS_PER_ENEMY,
  SUPPLY_TERMINAL,
  TURRET_COST,
  WAVE_BASE_REWARD,
  buyVerdict,
  waveReward,
} from "../shared/protocol.ts";

// The quota: what clearing a wave pays, and what the supply terminal will
// sell. Pure rules, shared by the client's prompt and the server's check.

const atTerminal = { x: SUPPLY_TERMINAL.x - SUPPLY_TERMINAL.halfX - 0.5, z: SUPPLY_TERMINAL.z };

describe("wave rewards", () => {
  it("pays the base for a slow clear and more for every second under par", () => {
    expect(waveReward(10, 10 * PAR_MS_PER_ENEMY + 60000)).toBe(WAVE_BASE_REWARD);
    expect(waveReward(10, 10 * PAR_MS_PER_ENEMY - 5000)).toBe(WAVE_BASE_REWARD + 5);
  });
});

describe("buying at the supply terminal", () => {
  it("sells a turret to someone close, empty-handed, with the quota for it", () => {
    expect(buyVerdict(atTerminal, false, TURRET_COST, 0)).toBe("ok");
  });

  it("says why it won't", () => {
    expect(buyVerdict({ x: atTerminal.x - BUY_RANGE - 1, z: atTerminal.z }, false, 999, 0)).toBe("too far");
    expect(buyVerdict(atTerminal, true, 999, 0)).toBe("hands full");
    expect(buyVerdict(atTerminal, false, TURRET_COST - 1, 0)).toBe("can't afford");
    expect(buyVerdict(atTerminal, false, 999, ITEM_CAPS.turret)).toBe("sold out");
  });
});
